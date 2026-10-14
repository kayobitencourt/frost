import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// Cinematic depth of field: a 40-tap Vogel-disk gather where every sample only counts
// if its own circle of confusion reaches the pixel, so sharp foreground never smears
// and out-of-focus highlights bloom into soft discs. Empty sky (cleared depth) stays sharp.
const material = new THREE.ShaderMaterial({
  uniforms: {
    tColor: { value: null },
    tDepth: { value: null },
    uNear: { value: 0.1 },
    uFar: { value: 100 },
    uFocus: { value: 10 },
    uAperture: { value: 0 },
    uMaxPx: { value: 12 },
    uTexel: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor, tDepth;
    uniform float uNear, uFar, uFocus, uAperture, uMaxPx;
    uniform vec2 uTexel;
    varying vec2 vUv;
    float linearZ(float d) {
      float z = d * 2.0 - 1.0;
      return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
    }
    // circle of confusion in pixels, plus the view distance
    vec2 coc(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      if (d >= 0.99999) return vec2(0.0, 1e6);
      float z = linearZ(d);
      return vec2(clamp(abs(z - uFocus) / z * uAperture, 0.0, 1.0) * uMaxPx, z);
    }
    void main() {
      vec4 base = texture2D(tColor, vUv);
      if (uAperture <= 0.0) { gl_FragColor = base; return; }
      vec2 c0 = coc(vUv);
      vec3 acc = base.rgb;
      float wsum = 1.0;
      float spin = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
      const int N = 40;
      for (int i = 0; i < N; i++) {
        float r = sqrt((float(i) + 0.5) / float(N));
        float a = float(i) * 2.39996 + spin;
        float dist = r * uMaxPx;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * dist * uTexel;
        vec2 cs = coc(uv);
        // background behind a sharper pixel may not bleed over it
        float size = cs.y > c0.y ? min(cs.x, c0.x * 2.0) : cs.x;
        float w = smoothstep(dist - 1.0, dist + 1.0, size);
        acc += texture2D(tColor, uv).rgb * w;
        wsum += w;
      }
      gl_FragColor = vec4(acc / wsum, base.a);
    }`,
  depthTest: false,
  depthWrite: false,
});
const quad = new FullScreenQuad(material);

export class DepthTarget {
  constructor() {
    this.scene = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 8 });
    this.scene.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.out = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  }

  setSize(w, h) {
    this.scene.setSize(w, h);
    this.out.setSize(w, h);
    this.w = w;
    this.h = h;
  }

  // Renders the scene with depth, then resolves its depth of field into `out`.
  render(renderer, scene, camera, { focus = 10, aperture = 0, maxPx = 12 } = {}) {
    renderer.setRenderTarget(this.scene);
    renderer.render(scene, camera);
    const u = material.uniforms;
    u.tColor.value = this.scene.texture;
    u.tDepth.value = this.scene.depthTexture;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uFocus.value = focus;
    u.uAperture.value = aperture;
    u.uMaxPx.value = maxPx;
    u.uTexel.value.set(1 / this.w, 1 / this.h);
    renderer.setRenderTarget(this.out);
    quad.render(renderer);
    return this.out.texture;
  }

  dispose() {
    this.scene.dispose();
    this.out.dispose();
  }
}
