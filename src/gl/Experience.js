import * as THREE from 'three';
import gsap from 'gsap';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  createDome, createCore, createIntroParticles, createSnow, createStars,
  createGround, createRing, createCubes, createSnowflake, FLAKE_CENTER,
} from './World.js';
import { VirtualScroll } from './VirtualScroll.js';
import { progress, cubeScreen, hoverCube } from '../state.js';
import { sound } from '../audio/Sound.js';

// Camera rail: positions / look targets sampled uniformly by index.
const RAIL = [
  { pos: [0, 2.6, 15.5], look: [0, 2.2, 0] },
  { pos: [7, 3.4, 11], look: [0, 2.4, 0] },
  { pos: [11.5, 5.5, 1], look: [0, 2.8, -2] },
  { pos: [6, 4.5, -8], look: [0, 3, -30] },
  { pos: [0, 3.4, -14], look: [0, 3, -30] },
  { pos: [0, 3, -37], look: [0, 3, -60] },
  { pos: [0, 3.2, -50.5], look: [0, 3, -60] },
  { pos: [0, 3.2, -50.5], look: [0, 3, -60] },
  { pos: [0, 6, -58], look: [0, 22, -82] },
  { pos: [0, 9, -63], look: [0, 26, -84] },
];
export const CUBE_RANGE = [0.66, 0.8];

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberr: { value: 0 },
    uFlash: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAberr, uFlash;
    uniform vec2 uRes;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      float k = 0.004 + uAberr;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - d * k * (1.0 + r2 * 4.0)).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + d * k * (1.0 + r2 * 4.0)).b;
      col *= 1.0 - smoothstep(0.18, 0.75, r2 * 1.6);
      col += (h(vUv * uRes + fract(uTime) * 100.0) - 0.5) * 0.03;
      col *= 0.97 + 0.03 * sin(vUv.y * uRes.y * 1.4);
      col += uFlash * vec3(0.8, 0.9, 1.0);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class Experience {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);

    this.posCurve = new THREE.CatmullRomCurve3(RAIL.map((k) => new THREE.Vector3(...k.pos)));
    this.lookCurve = new THREE.CatmullRomCurve3(RAIL.map((k) => new THREE.Vector3(...k.look)));

    this.dome = createDome();
    this.core = createCore();
    this.particles = createIntroParticles();
    this.snow = createSnow();
    this.stars = createStars();
    this.ground = createGround();
    this.ring = createRing();
    this.cubes = createCubes();
    this.flake = createSnowflake();
    this.scene.add(
      this.dome.mesh, this.core.group, this.particles.points, this.snow.points, this.stars,
      this.ground.mesh, this.ring.group, this.flake.group, ...this.cubes.map((c) => c.group)
    );

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.72);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());

    this.scroll = new VirtualScroll(window);
    this.mouse = new THREE.Vector2();
    this.mouseLerp = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.hovered = -1;
    this.focusIndex = -1;
    this.focus = { v: 0 };
    this.intro = { cam: 1, core: 0 };
    this.lastSection = -1;
    this.onCubeClick = null;
    this.clock = new THREE.Clock();
    this._tmp = new THREE.Vector3();

    this.quality = 1;
    this.frameTimes = [];
    this.lastProgress = -1;
    this.cubesVisible = false;
    this._onResize = () => this.resize();
    this._onMove = (e) => {
      const p = e.touches ? e.touches[0] : e;
      this.mouse.set((p.clientX / window.innerWidth) * 2 - 1, -(p.clientY / window.innerHeight) * 2 + 1);
    };
    this._onClick = () => {
      if (this.hovered >= 0 && this.focusIndex < 0 && this.onCubeClick) this.onCubeClick(this.hovered);
    };
    window.addEventListener('resize', this._onResize);
    window.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('click', this._onClick);

    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio, 1.5) * this.quality;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1 ? 62 : 40;
    this.camera.updateProjectionMatrix();
    this.final.uniforms.uRes.value.set(w * dpr, h * dpr);
    const pixel = (h * dpr * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    for (const m of [this.particles.material, this.snow.material]) m.uniforms.uPixel.value = pixel;
  }

  // Drops render resolution when the average frame time stays high.
  adaptQuality(dt) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    const next = avg > 1 / 45 ? Math.max(0.5, this.quality - 0.15) : avg < 1 / 58 ? Math.min(1, this.quality + 0.05) : this.quality;
    if (next !== this.quality) {
      this.quality = next;
      this.resize();
    }
  }

  start() {
    const tl = gsap.timeline();
    tl.to(this.particles.material.uniforms.uIntro, { value: 1, duration: 4.2, ease: 'power2.inOut' }, 0)
      .to(this.intro, { cam: 0, duration: 5.5, ease: 'power3.inOut' }, 0)
      .to(this.dome.material.uniforms.uReveal, { value: 1, duration: 3.2, ease: 'power2.out' }, 1.9)
      .to(this.intro, { core: 1, duration: 2.5, ease: 'power2.out' }, 2.8)
      .to(this.final.uniforms.uFlash, { value: 0.25, duration: 0.08 }, 2.8)
      .to(this.final.uniforms.uFlash, { value: 0, duration: 1.2, ease: 'power2.out' }, 2.88)
      .add(() => { this.scroll.enabled = true; }, 3.5);
  }

  goTo(p) {
    this.scroll.target = p;
  }

  setFocus(i) {
    if (i >= 0) this.focusIndex = i;
    this.scroll.enabled = i < 0;
    gsap.to(this.focus, {
      v: i >= 0 ? 1 : 0,
      duration: 1.4,
      ease: 'power3.inOut',
      onComplete: () => { if (i < 0) this.focusIndex = -1; },
    });
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    this.scroll.update(dt);
    const p = this.scroll.current;
    const vel = Math.abs(this.scroll.velocity);
    if (Math.abs(p - this.lastProgress) > 1e-4) {
      this.lastProgress = p;
      progress.set(p);
    }
    this.adaptQuality(dt);

    // ---- camera on rail + intro offset + mouse parallax
    const u = p;
    const pos = this.posCurve.getPoint(u);
    const look = this.lookCurve.getPoint(u);
    pos.z += this.intro.cam * 18;
    pos.y += this.intro.cam * 9;
    this.mouseLerp.lerp(this.mouse, 1 - Math.exp(-dt * 3));

    if (this.focusIndex >= 0) {
      const c = this.cubes[this.focusIndex].group.position;
      pos.lerp(this._tmp.set(c.x - 0.9, c.y + 0.2, c.z + 3.4), this.focus.v);
      look.lerp(this._tmp.set(c.x - 0.9, c.y, c.z), this.focus.v);
    }

    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    this.camera.translateX(this.mouseLerp.x * 0.5);
    this.camera.translateY(this.mouseLerp.y * 0.3);
    this.camera.rotateZ(-this.mouseLerp.x * 0.012);

    // ---- dome / core
    const explode = smooth(0.1, 0.3, p);
    const coreI = this.intro.core * (0.75 + explode * 1.4 + Math.sin(t * 1.7) * 0.08);
    for (const m of [this.dome.material]) {
      m.uniforms.uTime.value = t;
      m.uniforms.uExplode.value = explode;
      m.uniforms.uCoreIntensity.value = coreI;
    }
    this.core.glowMat.uniforms.uIntensity.value = coreI;
    this.core.glowMat.uniforms.uTime.value = t;
    this.core.sphere.scale.setScalar(this.intro.core * (1 + explode * 0.6 + Math.sin(t * 2.3) * 0.05));
    this.ground.material.uniforms.uCoreIntensity.value = coreI;
    this.ground.material.uniforms.uTime.value = t;
    this.particles.material.uniforms.uTime.value = t;
    this.particles.material.uniforms.uExplode.value = explode;

    // ---- ring
    this.ring.group.rotation.z = t * 0.06 + p * 2;
    this.ring.dust.rotation.z = -t * 0.03;
    this.ring.material.uniforms.uTime.value = t;
    this.ring.material.uniforms.uExplode.value = smooth(0.4, 0.52, p) * 0.25;

    // ---- snow / wind
    this.snow.material.uniforms.uTime.value = t;
    this.snow.material.uniforms.uWind.value += (Math.min(vel * 2, 2) - this.snow.material.uniforms.uWind.value) * dt;
    sound.setWind(Math.min(vel * 3, 1));

    // ---- cubes
    const inCubes = p > CUBE_RANGE[0] - 0.02 && p < CUBE_RANGE[1] + 0.02;
    let hit = -1;
    if (inCubes && this.focusIndex < 0) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const hits = this.raycaster.intersectObjects(this.cubes.map((c) => c.mesh), false);
      if (hits.length) hit = hits[0].object.userData.index;
    }
    if (hit !== this.hovered) {
      this.hovered = hit;
      hoverCube.set(hit);
      this.canvas.style.cursor = hit >= 0 ? 'pointer' : '';
      if (hit >= 0) sound.shard();
    }
    const screen = [];
    this.cubes.forEach((c, i) => {
      const target = i === this.hovered || i === this.focusIndex ? 1 : 0;
      c.hover += (target - c.hover) * (1 - Math.exp(-dt * 8));
      c.material.uniforms.uHover.value = c.hover;
      c.material.uniforms.uTime.value = t;
      c.group.position.y = 3 + Math.sin(t * 0.8 + i * 2) * 0.12;
      c.group.rotation.y = Math.sin(t * 0.3 + i) * 0.25 + c.hover * 0.35;
      c.group.scale.setScalar(1 + c.hover * 0.08);
      c.holder.rotation.x = t * 0.4 + i;
      c.holder.rotation.y = t * 0.6 * (i % 2 ? -1 : 1);
      c.inner.material.opacity = 0.6 + c.hover * 0.4;
      if (inCubes) {
        const v = this._tmp.copy(c.group.position);
        v.y -= 1.45;
        v.project(this.camera);
        screen.push({ x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight });
      }
    });
    if (inCubes || this.cubesVisible) cubeScreen.set(screen);
    this.cubesVisible = inCubes;

    // ---- snowflake
    const draw = smooth(0.84, 0.98, p);
    this.flake.material.uniforms.uDraw.value = draw;
    this.flake.material.uniforms.uTime.value = t;
    this.flake.group.rotation.z = t * 0.03;
    this.flake.group.lookAt(this.camera.position);
    this.flake.group.position.set(FLAKE_CENTER.x, FLAKE_CENTER.y + Math.sin(t * 0.4) * 0.3, FLAKE_CENTER.z);

    // ---- section-change whoosh
    const section = [0.08, 0.32, 0.56, 0.84].filter((s) => p > s).length;
    if (section !== this.lastSection) {
      if (this.lastSection >= 0) sound.whoosh();
      this.lastSection = section;
    }

    // ---- post
    this.final.uniforms.uTime.value = t;
    this.final.uniforms.uAberr.value += (Math.min(vel * 0.03, 0.02) - this.final.uniforms.uAberr.value) * dt * 6;

    this.composer.render(dt);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('click', this._onClick);
    this.scroll.dispose();
    this.renderer.dispose();
  }
}
