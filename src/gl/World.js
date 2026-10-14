import * as THREE from 'three';
import { createIceMaterial, createIceInstances } from './IceMaterial.js';
import { noise, fog, climate, terrain, sky } from './glsl.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

export const DOME_RADIUS = 4.2;
export const CORE = new THREE.Vector3(0, 1.6, 0);
export const RING_CENTER = new THREE.Vector3(0, 3, -30);
export const CUBES_CENTER = new THREE.Vector3(0, 3, -60);
export const FLAKE_CENTER = new THREE.Vector3(0, 26, -84);

/* ---------- Frost dome: stacked ice blocks that assemble and shatter ---------- */
export function createDome() {
  const rows = 9;
  const blockH = 0.62;
  const items = [];
  const dummy = new THREE.Object3D();
  for (let r = 0; r < rows; r++) {
    const phi = ((r + 0.5) / rows) * (Math.PI / 2) * 0.9;
    const ringR = DOME_RADIUS * Math.cos(phi);
    const y = DOME_RADIUS * Math.sin(phi);
    const circ = Math.PI * 2 * ringR;
    const n = Math.max(5, Math.round(circ / 0.95));
    const width = (circ / n) * 0.93;
    const offset = r % 2 ? 0.5 : 0;
    for (let k = 0; k < n; k++) {
      const theta = ((k + offset) / n) * Math.PI * 2;
      const pos = new THREE.Vector3(ringR * Math.cos(theta), y, ringR * Math.sin(theta));
      if (pos.z > 2.4 && Math.abs(pos.x) < 1.7 && y < 1.9) continue; // doorway
      dummy.position.copy(pos);
      dummy.rotation.set(0, 0, 0);
      dummy.lookAt(pos.clone().multiplyScalar(2));
      dummy.scale.set(width, blockH * rnd(0.88, 0.96), rnd(0.5, 0.62));
      dummy.updateMatrix();
      const dir = pos.clone().normalize().add(new THREE.Vector3(gauss() * 0.3, gauss() * 0.3, gauss() * 0.3)).normalize();
      items.push({ matrix: dummy.matrix.clone(), dir, row: r / rows });
    }
  }
  dummy.position.set(0, DOME_RADIUS - 0.05, 0);
  dummy.rotation.set(-Math.PI / 2, 0, 0);
  dummy.scale.set(1.3, 1.3, 0.5);
  dummy.updateMatrix();
  items.push({ matrix: dummy.matrix.clone(), dir: new THREE.Vector3(0, 1, 0), row: 1, rand: 0.9 });

  // entrance tunnel: three half-rings of blocks sticking out towards the camera
  const tunnelR = 1.35;
  const per = 7;
  const m = new THREE.Matrix4();
  for (let s = 0; s < 3; s++) {
    const z = 3.55 + s * 0.7;
    for (let k = 0; k < per; k++) {
      const a = ((k + 0.5 + (s % 2) * 0.25) / per) * Math.PI;
      const radial = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
      const tangent = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
      m.makeBasis(tangent, new THREE.Vector3(0, 0, 1), radial);
      m.scale(new THREE.Vector3(((Math.PI * tunnelR) / per) * 0.92, 0.66, rnd(0.46, 0.56)));
      m.setPosition(radial.x * tunnelR, radial.y * tunnelR, z);
      const dir = radial.clone().add(new THREE.Vector3(0, 0, 0.6)).normalize();
      items.push({ matrix: m.clone(), dir, row: 0.05 * s });
    }
  }

  const material = createIceMaterial({ snow: 1 });
  material.uniforms.uCore.value.copy(CORE);
  material.uniforms.uReveal.value = 0;
  const mesh = createIceInstances(new THREE.BoxGeometry(1, 1, 1), material, items);
  const rand = mesh.geometry.getAttribute('aRand').array;
  const blocks = items.map((it, i) => ({
    center: new THREE.Vector3().setFromMatrixPosition(it.matrix),
    dir: it.dir.clone(),
    rand: rand[i],
  }));
  return { mesh, material, blocks };
}

/* ---------- Core light inside the dome ---------- */
export function createCore() {
  const group = new THREE.Group();
  group.position.copy(CORE);
  const sphere = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.32, 3),
    new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 1.6);
          gl_FragColor = vec4(mix(vec3(1.0), vec3(0.25, 0.62, 0.95), f), 1.0);
        }`,
    })
  );
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uIntensity: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vNear;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vNear = smoothstep(0.6, 3.5, -mv.z);
        mv.xy += position.xy;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      uniform float uTime;
      varying vec2 vUv;
      varying float vNear;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float g = exp(-d * 4.0) * 0.9 + exp(-d * 12.0);
        float rays = pow(abs(sin(atan(vUv.y - 0.5, vUv.x - 0.5 + 1e-4) * 3.0 + uTime * 0.2)), 40.0) * exp(-d * 3.0) * 0.4;
        gl_FragColor = vec4(vec3(0.3, 0.68, 1.0), clamp((g + rays) * uIntensity * 0.55, 0.0, 0.85) * vNear);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), glowMat);
  group.add(sphere, glow);
  return { group, sphere, glowMat };
}

/* ---------- Particles that spiral in and form the dome ---------- */
export function createIntroParticles(count = 9000) {
  const pos = new Float32Array(count * 3);
  const start = new Float32Array(count * 3);
  const rand = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = Math.acos(Math.random() * 0.98);
    const r = DOME_RADIUS + rnd(-0.25, 0.35);
    pos.set([r * Math.sin(v) * Math.cos(u), r * Math.cos(v), r * Math.sin(v) * Math.sin(u)], i * 3);
    const a = Math.random() * Math.PI * 2;
    const sr = rnd(14, 40);
    start.set([sr * Math.cos(a), rnd(-4, 22), sr * Math.sin(a)], i * 3);
    rand[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aStart', new THREE.BufferAttribute(start, 3));
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uIntro: { value: 0 }, uTime: { value: 0 }, uExplode: { value: 0 }, uPixel: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aStart;
      attribute float aRand;
      uniform float uIntro, uTime, uExplode, uPixel;
      varying float vAlpha;
      void main() {
        float t = clamp(uIntro * 1.5 - aRand * 0.5, 0.0, 1.0);
        t = 1.0 - pow(1.0 - t, 4.0);
        float ang = (1.0 - t) * (5.0 + aRand * 3.0) + uTime * 0.05 * (1.0 - t);
        vec3 s = aStart;
        s.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * s.xz;
        vec3 p = mix(s, position, t);
        p += normalize(position) * uExplode * (2.0 + aRand * 9.0);
        p += vec3(sin(uTime * 0.5 + aRand * 40.0), cos(uTime * 0.4 + aRand * 30.0), sin(uTime * 0.3 + aRand * 20.0)) * (0.04 + uExplode * 0.6 + (1.0 - t) * 0.5);
        vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
        gl_PointSize = 0.045 * uPixel * (0.4 + aRand) / -mv.z * (1.0 + (1.0 - t) * 1.5);
        float settle = mix(0.9, 0.12, smoothstep(0.85, 1.0, uIntro));
        vAlpha = settle * (0.55 + 0.45 * sin(uTime * 2.0 + aRand * 50.0)) * (1.0 - smoothstep(30.0, 80.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vAlpha;
        gl_FragColor = vec4(vec3(0.92, 0.96, 1.0), a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return { points, material };
}

/* ---------- Snow drifting through the whole scene ---------- */
export function createSnow(count = 7000) {
  const pos = new Float32Array(count * 3);
  const rand = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([rnd(-35, 35), rnd(0, 45), rnd(-110, 25)], i * 3);
    rand[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixel: { value: 1 }, uWind: { value: 0 }, uWindT: { value: 0 }, uGust: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aRand;
      uniform float uTime, uPixel, uWind;
      ${noise}
      ${climate}
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.y = mod(p.y - uTime * (0.5 + aRand * 1.1), 45.0);
        p.xz += WIND * uWindT * (0.5 + aRand * 0.9) + WIND * uWind * aRand * 6.0;
        p.x += sin(uTime * 0.3 + aRand * 20.0) * 1.2;
        p.z += cos(uTime * 0.25 + aRand * 10.0) * 0.8;
        p.xz = mod(p.xz - vec2(-35.0, -110.0), vec2(70.0, 135.0)) + vec2(-35.0, -110.0);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = 0.045 * uPixel * (0.3 + aRand * aRand * 1.1) / -mv.z;
        vAlpha = (0.25 + aRand * 0.55) * smoothstep(0.0, 3.0, p.y) * (1.0 - smoothstep(25.0, 60.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.1, d) * vAlpha;
        gl_FragColor = vec4(vec3(0.94, 0.96, 1.0), a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return { points, material };
}

/* ---------- Snow field: heavy packed snow, dunes and wind-blown streaks ---------- */
export function createGround() {
  const material = new THREE.ShaderMaterial({
    uniforms: { uCoreIntensity: { value: 0 }, uTime: { value: 0 }, uWindT: { value: 0 }, uGust: { value: 0 } },
    vertexShader: /* glsl */ `
      ${noise}
      ${climate}
      ${terrain}
      varying vec3 vW;
      void main() {
        vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
        p.y = snowHeight(p.xz) + gustAt(p.xz) * 0.04;
        vW = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uCoreIntensity, uTime;
      varying vec3 vW;
      ${noise}
      ${fog}
      ${climate}
      ${terrain}
      ${sky}
      void main() {
        vec2 xz = vW.xz;
        float camD = distance(vW, cameraPosition);
        float near = 1.0 - smoothstep(4.0, 32.0, camD);

        // relief normal from the height field plus fine crust bumps
        float h0 = snowHeight(xz);
        vec3 N = normalize(vec3(h0 - snowHeight(xz + vec2(0.1, 0.0)), 0.1, h0 - snowHeight(xz + vec2(0.0, 0.1))));
        vec2 bump = vec2(noise(vec3(xz * 5.0, 0.0)), noise(vec3(xz * 5.0, 7.0))) - 0.5;
        vec2 micro = vec2(noise(vec3(xz * 22.0, 3.0)), noise(vec3(xz * 22.0, 9.0))) - 0.5;
        N = normalize(N + vec3(bump.x, 0.0, bump.y) * 0.5 * near + vec3(micro.x, 0.0, micro.y) * 0.35 * near * near);
        vec3 V = normalize(cameraPosition - vW);

        // dense layered grain: big drifts, crust, compacted grains, fine powder
        float drifts = fbm(vec3(xz * 0.35, 1.0));
        float grain = fbm(vec3(xz * 3.2, 2.0));
        float crust = smoothstep(0.45, 0.7, fbm(vec3(xz * 0.9, 5.0)));
        float fine = hash(floor(vW * 90.0)) * (1.0 - smoothstep(5.0, 16.0, camD));
        float tex = 0.84 + drifts * 0.08 + grain * 0.1 + fine * 0.06 + crust * 0.04;

        // daylight on white snow: lit faces near white, shaded slopes go cold blue,
        // light scattering inside the snowpack keeps shadows luminous
        float diff = clamp(dot(N, MOON), 0.0, 1.0);
        float wrap = dot(N, MOON) * 0.5 + 0.5;
        vec3 shade = vec3(0.3, 0.38, 0.5);
        vec3 lit = vec3(0.74, 0.78, 0.84);
        vec3 col = mix(shade, lit, smoothstep(0.15, 0.9, wrap * 0.7 + diff * 0.4)) * tex;
        col += vec3(0.05, 0.1, 0.16) * (1.0 - wrap) * grain;
        col = mix(col, skyColor(reflect(-V, N)), pow(1.0 - max(dot(N, V), 0.0), 5.0) * 0.4);

        // snow pushed by the wind: powder streaks sliding downwind inside gust fronts,
        // each one dragging a faint blue shadow on its lee side
        float along = dot(xz, WIND);
        float across = dot(xz, vec2(-WIND.y, WIND.x));
        float gust = gustAt(xz);
        vec3 sp = vec3((along - uWindT * 1.6) * 0.5, across * 3.2, uTime * 0.15);
        float streak = smoothstep(0.5, 0.82, fbm(sp)) * (0.25 + gust);
        float lee = smoothstep(0.5, 0.82, fbm(sp + vec3(0.35, 0.0, 0.0))) * (0.25 + gust);
        col = mix(col, vec3(0.28, 0.36, 0.48), clamp(lee - streak, 0.0, 1.0) * 0.35 * (0.4 + near));
        col = mix(col, vec3(0.88, 0.91, 0.95), streak * 0.5 * (0.4 + near));

        // prismatic glints on crystals catching the light
        vec3 cell = floor(vW * 60.0);
        float glint = step(0.992, hash(cell + floor(uTime * 3.0 + hash(cell) * 8.0)));
        vec3 tint = 0.6 + 0.4 * cos(6.2831 * (hash(cell + 3.0) + vec3(0.0, 0.33, 0.67)));
        float catchL = pow(clamp(dot(reflect(-V, N), MOON), 0.0, 1.0), 2.0);
        col = mix(col, tint * 0.55, glint * catchL * near * 0.9);

        float d = length(xz);
        col = mix(col, vec3(0.45, 0.75, 1.0), uCoreIntensity * 0.25 * exp(-d * d * 0.07));
        col = mix(col, vec3(0.15, 0.4, 0.6), smoothstep(0.05, 0.0, abs(d - 5.2)) * 0.35 * uCoreIntensity);
        float path = smoothstep(0.04, 0.0, abs(abs(xz.x) - 1.6)) * step(xz.y, -6.0) * step(-56.0, xz.y);
        float dash = step(0.5, fract(xz.y * 0.5 + uTime * 0.4));
        col = mix(col, vec3(0.1, 0.18, 0.26), path * dash * 0.45 * near);
        gl_FragColor = vec4(applyFog(col, vW), 1.0);
      }`,
  });
  const geo = new THREE.PlaneGeometry(240, 240, 320, 320);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -30);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return { mesh, material };
}

/* ---------- Spindrift: grains hopping along the surface when a gust passes ---------- */
export function createDrift(count = 9000) {
  const pos = new Float32Array(count * 3);
  const rand = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([rnd(-30, 30), Math.random(), rnd(-30, 30)], i * 3);
    rand[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uPixel: { value: 1 }, uWindT: { value: 0 }, uGust: { value: 0 },
      uCenter: { value: new THREE.Vector2() },
    },
    vertexShader: /* glsl */ `
      attribute float aRand;
      uniform float uTime, uPixel;
      uniform vec2 uCenter;
      varying float vAlpha;
      ${noise}
      ${climate}
      ${terrain}
      void main() {
        vec2 off = WIND * uWindT * (1.4 + aRand * 1.6);
        vec2 rel = mod(position.xz + off - uCenter + 30.0, 60.0) - 30.0;
        vec2 xz = uCenter + rel;
        xz += vec2(-WIND.y, WIND.x) * sin(uTime * 1.7 + aRand * 40.0) * 0.15;
        float g = gustAt(xz);
        float hop = abs(sin(uTime * (2.0 + aRand * 3.0) + aRand * 30.0));
        float y = snowHeight(xz) + 0.02 + position.y * position.y * (0.08 + g * 0.7) * hop;
        vec4 mv = viewMatrix * vec4(xz.x, y, xz.y, 1.0);
        gl_PointSize = 0.022 * uPixel * (0.5 + aRand) / -mv.z;
        float edge = 1.0 - smoothstep(22.0, 30.0, length(rel));
        vAlpha = (0.05 + g * 0.75) * edge * (0.4 + aRand * 0.6) * (1.0 - smoothstep(18.0, 40.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float a = smoothstep(0.5, 0.05, length(gl_PointCoord - 0.5)) * vAlpha;
        gl_FragColor = vec4(vec3(0.9, 0.93, 0.97), a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return { points, material };
}

/* ---------- Three halos of ice shards, spaced along the passage ---------- */
export const HALOS = [
  { radius: 5.0, z: 7, tilt: [0.1, -0.16], count: 300, dir: 1 },
  { radius: 6.6, z: 0, tilt: [0, 0], count: 420, dir: -1 },
  { radius: 8.4, z: -5.5, tilt: [-0.12, 0.18], count: 540, dir: 1 },
];

export function createRings() {
  return HALOS.map((h, i) => {
    const ring = createRing(h.count, h.radius, i);
    ring.group.position.z += h.z;
    ring.group.rotation.set(h.tilt[0], h.tilt[1], 0);
    ring.spin.rotation.z = (i * Math.PI) / 3;
    ring.material.uniforms.uCore.value.copy(ring.group.position);
    return { ...ring, ...h, index: i };
  });
}

function createRing(count, radius, index) {
  const items = [];
  const dummy = new THREE.Object3D();
  const spread = 0.45 + index * 0.25;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd(-0.02, 0.02);
    // the middle halo is the shattered one; the outer two keep a hexagonal rhythm
    const hex = index === 1 ? 0 : Math.pow(Math.abs(Math.cos(a * 3)), 24) * 0.9;
    const r = radius + gauss() * spread + hex;
    dummy.position.set(Math.cos(a) * r, Math.sin(a) * r, gauss() * (0.4 + index * 0.3));
    dummy.rotation.set(rnd(0, 6.28), rnd(0, 6.28), rnd(0, 6.28));
    const s = Math.pow(Math.random(), 2.2) * 0.55 + 0.06;
    dummy.scale.set(s * rnd(0.3, 1), s * rnd(1, 2.6), s * rnd(0.2, 0.7));
    dummy.updateMatrix();
    items.push({
      matrix: dummy.matrix.clone(),
      dir: new THREE.Vector3(Math.cos(a), Math.sin(a), gauss() * 0.4).normalize(),
    });
  }
  const material = createIceMaterial({ edge: 0, spin: 1 });
  material.uniforms.uCoreIntensity.value = 0.6;
  material.uniforms.uCore.value.copy(RING_CENTER);
  const mesh = createIceInstances(new THREE.OctahedronGeometry(1, 0), material, items);
  const group = new THREE.Group();
  group.position.copy(RING_CENTER);
  const spin = new THREE.Group();
  spin.add(mesh);

  // six tick marks on the rim: the snowflake's arms, read as a gauge
  const ticks = [];
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 + Math.PI / 2;
    const r0 = radius + 1.4 + index * 0.2;
    ticks.push(Math.cos(a) * r0, Math.sin(a) * r0, 0, Math.cos(a) * (r0 + 0.6), Math.sin(a) * (r0 + 0.6), 0);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
  const tickMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
  spin.add(new THREE.LineSegments(tg, tickMat));
  group.add(spin);

  // dust orbiting with the ring
  const n = 1400 + index * 800;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = radius + gauss() * 1.6;
    pos.set([Math.cos(a) * r, Math.sin(a) * r, gauss() * 1.5], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xe6f0fa, size: 0.05, transparent: true, opacity: 0.45, depthWrite: false,
  }));
  group.add(dust);
  return { group, spin, mesh, material, dust, tickMat };
}

/* ---------- Venture cubes: ice blocks holding glowing artefacts ---------- */
export function createCubes() {
  const shapes = [
    new THREE.IcosahedronGeometry(0.55, 1),
    new THREE.TorusKnotGeometry(0.36, 0.11, 64, 6, 2, 3),
    new THREE.OctahedronGeometry(0.62, 0),
  ];
  return shapes.map((shapeGeo, i) => {
    const group = new THREE.Group();
    group.position.set((i - 1) * 3.3, CUBES_CENTER.y, CUBES_CENTER.z);
    const material = createIceMaterial({ alpha: 0.18 });
    material.uniforms.uCore.value.copy(group.position);
    material.uniforms.uCoreIntensity.value = 0.5;
    const mesh = createIceInstances(new THREE.BoxGeometry(1, 1, 1), material, [
      { matrix: new THREE.Matrix4(), dir: new THREE.Vector3(0, 1, 0), rand: 0.5 },
    ]);
    mesh.scale.setScalar(2);
    mesh.renderOrder = 2;
    mesh.userData.index = i;
    const inner = new THREE.LineSegments(
      new THREE.EdgesGeometry(shapeGeo, 1),
      new THREE.LineBasicMaterial({ color: 0x0d2a40, transparent: true, opacity: 0.9 })
    );
    const innerCore = new THREE.Mesh(shapeGeo, new THREE.MeshBasicMaterial({ color: 0xdfeaf3 }));
    innerCore.scale.setScalar(0.985);
    const holder = new THREE.Group();
    holder.add(innerCore, inner);
    group.add(holder, mesh);
    return { group, mesh, material, holder, inner, hover: 0 };
  });
}

/* ---------- Giant procedural snowflake for the manifesto ---------- */
export function createSnowflake() {
  const segs = [];
  const branch = (x, y, ang, len, depth, t0) => {
    const x2 = x + Math.cos(ang) * len;
    const y2 = y + Math.sin(ang) * len;
    segs.push([x, y, t0, x2, y2, t0 + len]);
    if (depth <= 0) return;
    for (const k of [0.3, 0.55, 0.78]) {
      const bx = x + Math.cos(ang) * len * k;
      const by = y + Math.sin(ang) * len * k;
      const bl = len * (0.46 - k * 0.32);
      branch(bx, by, ang + Math.PI / 3, bl, depth - 1, t0 + len * k);
      branch(bx, by, ang - Math.PI / 3, bl, depth - 1, t0 + len * k);
    }
  };
  for (let arm = 0; arm < 6; arm++) branch(0, 0, (arm * Math.PI) / 3 + Math.PI / 2, 1, 2, 0);
  for (const [rad, t] of [[0.22, 0.2], [0.42, 0.45]]) {
    for (let k = 0; k < 6; k++) {
      const a1 = (k * Math.PI) / 3 + Math.PI / 2;
      const a2 = a1 + Math.PI / 3;
      segs.push([Math.cos(a1) * rad, Math.sin(a1) * rad, t, Math.cos(a2) * rad, Math.sin(a2) * rad, t + 0.15]);
    }
  }
  const pos = new Float32Array(segs.length * 6);
  const tt = new Float32Array(segs.length * 2);
  segs.forEach(([x1, y1, t1, x2, y2, t2], i) => {
    pos.set([x1, y1, 0, x2, y2, 0], i * 6);
    tt.set([t1, t2], i * 2);
  });
  let maxT = 0;
  for (const t of tt) maxT = Math.max(maxT, t);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aT', new THREE.BufferAttribute(tt, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uDraw: { value: 0 }, uMaxT: { value: maxT }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aT;
      varying float vT;
      void main() {
        vT = aT;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uDraw, uMaxT, uTime;
      varying float vT;
      void main() {
        float lim = uDraw * uMaxT;
        if (vT > lim) discard;
        float tip = smoothstep(lim - 0.12, lim, vT) * (1.0 - step(0.999, uDraw));
        float pulse = 0.5 + 0.5 * sin(vT * 14.0 - uTime * 2.0);
        vec3 col = mix(vec3(0.85, 0.92, 1.0), vec3(1.0), pulse * 0.6 + tip);
        gl_FragColor = vec4(col, 0.55 + pulse * 0.25 + tip * 0.2);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, material);
  lines.frustumCulled = false;
  const group = new THREE.Group();
  group.position.copy(FLAKE_CENTER);
  group.scale.setScalar(9);
  group.add(lines);
  return { group, material };
}

/* ---------- Mountain range ringing the valley ---------- */
const mountainGlsl = /* glsl */ `
float ridged(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    float n = 1.0 - abs(noise(vec3(p, 2.0 + float(i))) * 2.0 - 1.0);
    s += n * n * a;
    p *= 2.07;
    a *= 0.5;
  }
  return s;
}
float mountainH(vec2 p) {
  float r = length(p - vec2(0.0, -35.0));
  float env = smoothstep(78.0, 125.0, r) * (1.0 - smoothstep(190.0, 215.0, r) * 0.5);
  float massif = fbm(vec3(p * 0.011, 4.0));
  return ridged(p * 0.017) * env * (26.0 + massif * 52.0) - 3.0;
}
`;

export function createMountains() {
  const T = 360;
  const RN = 70;
  const pos = [];
  const idx = [];
  for (let t = 0; t <= T; t++) {
    const a = (t / T) * Math.PI * 2;
    for (let k = 0; k <= RN; k++) {
      const r = 72 + Math.pow(k / RN, 1.3) * 150;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r - 35);
    }
  }
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < RN; k++) {
      const i = t * (RN + 1) + k;
      const j = i + RN + 1;
      idx.push(i, i + 1, j, i + 1, j + 1, j);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const material = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      ${noise}
      ${mountainGlsl}
      varying vec3 vW;
      void main() {
        vec3 p = position;
        p.y = mountainH(p.xz);
        vW = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vW;
      ${noise}
      ${fog}
      ${mountainGlsl}
      const vec3 SUN = normalize(vec3(-0.5, 0.62, 0.6));
      void main() {
        vec2 xz = vW.xz;
        float e = 0.6;
        float h0 = mountainH(xz);
        vec3 N = normalize(vec3(h0 - mountainH(xz + vec2(e, 0.0)), e, h0 - mountainH(xz + vec2(0.0, e))));
        // snow holds on gentle slopes, rock shows through on steep faces and ridges
        float n = fbm(vec3(xz * 0.3, vW.y * 0.2));
        float snow = smoothstep(0.42, 0.62, N.y + (n - 0.5) * 0.4 + smoothstep(10.0, 50.0, vW.y) * 0.12);
        float strata = 0.5 + 0.5 * sin(vW.y * 2.2 + n * 6.0);
        vec3 rock = vec3(0.2, 0.24, 0.3) * (0.7 + strata * 0.3 + n * 0.3);
        // snow streaks clinging inside the rock gullies
        snow = max(snow, smoothstep(0.62, 0.8, fbm(vec3(xz.x * 0.6, vW.y * 0.9, xz.y * 0.6))) * 0.8);
        float wrap = dot(N, SUN) * 0.5 + 0.5;
        vec3 snowCol = mix(vec3(0.32, 0.4, 0.52), vec3(0.8, 0.83, 0.88), smoothstep(0.2, 0.85, wrap));
        vec3 col = mix(rock * (0.55 + wrap * 0.6), snowCol, snow);
        // aerial perspective + valley mist so the peaks rise out of the haze
        float d = distance(vW, cameraPosition);
        float haze = smoothstep(50.0, 240.0, d) * 0.72 + (1.0 - smoothstep(-2.0, 22.0, vW.y)) * 0.55;
        gl_FragColor = vec4(mix(col, FOG, clamp(haze, 0.0, 1.0)), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return mesh;
}

/* ---------- Sky dome: pale horizon, colder zenith, soft sun ---------- */
export function createSky() {
  const material = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      ${fog}
      void main() {
        vec3 d = normalize(vDir);
        vec3 sun = normalize(vec3(-0.5, 0.62, 0.6));
        vec3 col = mix(FOG, vec3(0.22, 0.3, 0.43), smoothstep(0.02, 0.75, d.y));
        col += vec3(1.0, 0.97, 0.92) * (pow(max(dot(d, sun), 0.0), 18.0) * 0.12 + pow(max(dot(d, sun), 0.0), 400.0) * 0.4);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(330, 48, 24), material);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}
