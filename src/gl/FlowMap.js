import * as THREE from 'three';

// Ping-pong velocity field painted by the cursor. RG = flow direction, B = intensity.
export class FlowMap {
  constructor(renderer, size = 128) {
    this.renderer = renderer;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.read = new THREE.WebGLRenderTarget(size, size, opts);
    this.write = new THREE.WebGLRenderTarget(size, size, opts);
    this.mouse = new THREE.Vector2(-1, -1);
    this.last = new THREE.Vector2(-1, -1);
    this.vel = new THREE.Vector2();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tPrev: { value: null },
        uMouse: { value: this.mouse },
        uVel: { value: this.vel },
        uAspect: { value: 1 },
        uFalloff: { value: 0.18 },
        uDissipation: { value: 0.95 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tPrev;
        uniform vec2 uMouse, uVel;
        uniform float uAspect, uFalloff, uDissipation;
        varying vec2 vUv;
        void main() {
          vec4 prev = texture2D(tPrev, vUv) * uDissipation;
          vec2 c = vUv - uMouse;
          c.x *= uAspect;
          float stamp = smoothstep(uFalloff, 0.0, length(c)) * min(length(uVel) * 1.5, 1.0);
          vec3 next = mix(prev.rgb, vec3(clamp(uVel * 0.6, -1.0, 1.0), 1.0), stamp);
          gl_FragColor = vec4(next, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  get texture() {
    return this.read.texture;
  }

  // ndc: pointer in -1..1 space.
  update(ndc, aspect, dt) {
    this.mouse.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
    if (this.last.x < 0) this.last.copy(this.mouse);
    // velocity in screen-widths per second
    const target = this.mouse.clone().sub(this.last).divideScalar(Math.max(dt, 1e-3));
    this.vel.lerp(target, 0.5);
    this.last.copy(this.mouse);
    this.material.uniforms.tPrev.value = this.read.texture;
    this.material.uniforms.uAspect.value = aspect;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.write);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prev);
    [this.read, this.write] = [this.write, this.read];
  }

  dispose() {
    this.read.dispose();
    this.write.dispose();
    this.material.dispose();
  }
}
