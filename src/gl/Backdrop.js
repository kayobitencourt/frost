import * as THREE from 'three';
import { noise, voronoi } from './glsl.js';

// Full-screen misty backdrop: pale overcast gradient, drifting haze and an optional
// dot grid that slides with the camera, like a HUD reticle behind the objects.
export function createBackdrop({ dots = 0, haze = 1 } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDots: { value: dots },
      uHaze: { value: haze },
      uOffset: { value: new THREE.Vector2() },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTop: { value: new THREE.Color(0.6, 0.63, 0.68) },
      uBottom: { value: new THREE.Color(0.42, 0.45, 0.5) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.9999, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uDots, uHaze;
      uniform vec2 uOffset, uRes;
      uniform vec3 uTop, uBottom;
      varying vec2 vUv;
      ${noise}
      void main() {
        vec2 uv = vUv;
        vec3 col = mix(uBottom, uTop, smoothstep(0.0, 1.0, uv.y));
        // a brighter bloom of light high on the left, as in an overcast sky
        col += vec3(0.1, 0.105, 0.11) * exp(-dot(uv - vec2(0.25, 0.85), uv - vec2(0.25, 0.85)) * 3.0);
        vec2 p = uv * vec2(uRes.x / uRes.y, 1.0);
        float h = fbm(vec3(p * 2.2 + uOffset * 0.15 + vec2(uTime * 0.015, 0.0), uTime * 0.02));
        float wisps = fbm(vec3(p * vec2(1.5, 5.0) + uOffset * 0.25, uTime * 0.03 + 3.0));
        col += vec3(0.08) * (h - 0.5) * uHaze + vec3(0.06) * smoothstep(0.55, 0.8, wisps) * uHaze;
        // dot grid
        vec2 px = (uv + uOffset) * uRes / 64.0;
        vec2 g = abs(fract(px) - 0.5);
        float dotMask = smoothstep(0.04, 0.012, length(g)) * uDots;
        col = mix(col, vec3(0.95), dotMask * 0.75);
        // vignette
        vec2 d = uv - 0.5;
        col *= 1.0 - dot(d, d) * 0.35;
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, material };
}

// Rough grey stone with chipped faces, lit by a soft key light and by an optional
// glowing source (the portal) that rims every face turned towards it.
export function createStoneMaterial({ grooves = 0 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uGlowPos: { value: new THREE.Vector3() },
      uGlow: { value: 0 },
      uGrooves: { value: grooves },
      uFog: { value: new THREE.Color(0.55, 0.58, 0.63) },
      uFogRange: { value: new THREE.Vector2(14, 60) },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN, vW, vL;
      void main() {
        vL = position;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uGlow, uGrooves, uOpacity;
      uniform vec3 uGlowPos, uFog;
      uniform vec2 uFogRange;
      varying vec3 vN, vW, vL;
      ${noise}
      ${voronoi}
      const vec3 KEY = normalize(vec3(-0.6, 0.8, 0.22));
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vW);
        vec3 sp = vL * 2.4;
        vec3 b1 = vec3(noise(sp * 3.0), noise(sp * 3.0 + 4.1), noise(sp * 3.0 + 8.3)) - 0.5;
        vec3 b2 = vec3(noise(sp * 14.0), noise(sp * 14.0 + 2.7), noise(sp * 14.0 + 6.1)) - 0.5;
        N = normalize(N + b1 * 0.45 + b2 * 0.22);
        float grain = fbm(sp * 4.0);
        float pits = smoothstep(0.68, 0.82, noise(sp * 9.0));
        // hairline cracks and frost settled in them
        vec2 cr = voronoi(sp * 1.6 + 3.0);
        float crack = smoothstep(0.035, 0.0, cr.y) * smoothstep(0.35, 0.6, noise(sp * 2.0 + 9.0));
        float rime = smoothstep(0.55, 0.75, fbm(sp * 1.2 + 5.0)) * max(N.y, 0.0);

        float wrap = dot(N, KEY) * 0.5 + 0.5;
        vec3 col = mix(vec3(0.1, 0.11, 0.14), vec3(0.5, 0.53, 0.58), smoothstep(0.1, 0.95, wrap));
        col *= 0.84 + grain * 0.22 - pits * 0.1 - crack * 0.35;
        col = mix(col, vec3(0.78, 0.81, 0.86), rime * 0.35);
        // edge wear: convex corners catch the light
        float edge = clamp(length(fwidth(vN)) * 6.0, 0.0, 1.0);
        col += vec3(0.25, 0.27, 0.3) * edge * (0.5 + 0.5 * wrap);

        // concentric grooves cut into a platform
        float r = length(vW.xz);
        float gr = smoothstep(0.06, 0.0, abs(fract(r / 1.7) - 0.5) - 0.44) * uGrooves * step(0.5, N.y);
        col *= 1.0 - gr * 0.35;

        float ndv = max(dot(N, V), 0.0);
        col += vec3(0.85, 0.9, 0.97) * pow(1.0 - ndv, 3.0) * 0.22;
        // glow from the portal / light source
        vec3 Lg = uGlowPos - vW;
        float dg = length(Lg);
        float facing = max(dot(N, Lg / dg), 0.0);
        col += vec3(0.92, 0.96, 1.0) * pow(facing, 2.0) * uGlow / (1.0 + dg * dg * 0.25);

        float f = smoothstep(uFogRange.x, uFogRange.y, distance(vW, cameraPosition));
        gl_FragColor = vec4(mix(col, uFog, f), uOpacity);
      }`,
  });
}
