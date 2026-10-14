import * as THREE from 'three';
import gsap from 'gsap';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { IglooScene } from './scenes/IglooScene.js';
import { CrystalScene } from './scenes/CrystalScene.js';
import { PortalScene } from './scenes/PortalScene.js';
import { PlatformScene } from './scenes/PlatformScene.js';
import { VirtualScroll } from './VirtualScroll.js';
import { DepthTarget } from './Dof.js';
import { CUTS } from '../content.js';
import { progress, sceneIndex, linkIndex } from '../state.js';
import { sound } from '../audio/Sound.js';
import { smooth, damp } from './util.js';

// Half-width of the scroll window in which two scenes are blended, per cut.
const BLENDS = [0.05, 0.03, 0.035];
// 0 = chromatic glitch, 1 = through the light, 2 = through the cloud deck
const KINDS = [2, 0, 1];

// Blends two rendered scenes: banded RGB-split glitch, a pass through light or through cloud.
const MixShader = {
  uniforms: {
    tA: { value: null },
    tB: { value: null },
    uMix: { value: 0 },
    uKind: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tA, tB;
    uniform float uMix, uKind, uTime;
    varying vec2 vUv;
    float h1(float x) { return fract(sin(x * 91.713) * 43758.5453); }
    float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 split(sampler2D t, vec2 uv, float ab) {
      return vec3(texture2D(t, uv + vec2(ab, 0.0)).r, texture2D(t, uv).g, texture2D(t, uv - vec2(ab, 0.0)).b);
    }
    void main() {
      float m = uMix;
      if (m <= 0.0) { gl_FragColor = texture2D(tA, vUv); return; }
      if (m >= 1.0) { gl_FragColor = texture2D(tB, vUv); return; }
      float k = sin(m * 3.14159);
      if (uKind < 0.5) {
        float tick = floor(uTime * 14.0);
        // horizontal bands torn sideways
        float rows = mix(10.0, 48.0, h1(tick));
        float band = floor(vUv.y * rows);
        float r = h1(band * 1.37 + tick * 7.1);
        float shift = (r - 0.5) * 0.22 * k * step(0.62 - k * 0.45, r);
        vec2 uv = vec2(vUv.x + shift, vUv.y);
        // smear: stretch some bands into streaks
        uv.x = mix(uv.x, floor(uv.x * 24.0) / 24.0, step(0.9, r) * k);
        float ab = 0.004 + 0.02 * k + abs(shift) * 0.25;
        vec3 a = split(tA, uv, ab);
        vec3 b = split(tB, uv, ab);
        // wide strips swap from A to B in a ragged order
        float blk = h2(vec2(floor(vUv.x * 3.0), floor(vUv.y * 34.0)) + floor(uTime * 8.0) * 0.1);
        float sel = smoothstep(blk - 0.15, blk + 0.15, m * 1.3 - 0.15);
        vec3 col = mix(a, b, sel);
        col = mix(col, vec3(0.86, 0.88, 0.92), k * 0.2);
        col += (h2(vUv * 800.0 + uTime) - 0.5) * 0.06 * k;
        gl_FragColor = vec4(col, 1.0);
      } else if (uKind > 1.5) {
        // through the cloud: fringed, washed into fog, the next scene emerges below it
        float ab = 0.018 * k;
        vec3 a = split(tA, vUv, ab);
        vec3 b = split(tB, vUv, ab);
        vec3 col = mix(a, b, smoothstep(0.35, 0.65, m));
        gl_FragColor = vec4(mix(col, vec3(0.8, 0.83, 0.87), k * 0.8), 1.0);
      } else {
        // through the light: zoom-blur A into the glow, then B surfaces from it
        vec2 d = vUv - 0.5;
        vec3 a = vec3(0.0);
        for (int i = 0; i < 8; i++) a += texture2D(tA, 0.5 + d * (1.0 - float(i) * 0.03 * k)).rgb;
        a /= 8.0;
        vec3 b = texture2D(tB, 0.5 + d * (1.0 + (1.0 - m) * 0.25)).rgb;
        vec3 w = mix(a, vec3(1.05, 1.07, 1.1), 0.75);
        vec3 col = m < 0.5 ? mix(a, w, smoothstep(0.0, 0.5, m)) : mix(w, b, smoothstep(0.5, 1.0, m));
        gl_FragColor = vec4(col, 1.0);
      }
    }`,
};

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberr: { value: 0 },
    uZoom: { value: 0 },
    uWarp: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAberr, uZoom, uWarp;
    uniform vec2 uRes;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      // passing through a portal membrane: the image ripples like water
      float rr = length(d);
      d *= 1.0 + sin(rr * 34.0 - uTime * 5.0) * 0.018 * uWarp;
      d = mat2(cos(uWarp * 0.12 * (0.6 - rr)), -sin(uWarp * 0.12 * (0.6 - rr)), sin(uWarp * 0.12 * (0.6 - rr)), cos(uWarp * 0.12 * (0.6 - rr))) * d;
      float r2 = dot(d, d);
      float ab = 0.0018 + uAberr + uZoom * 0.006 + uWarp * 0.01;
      vec3 col = vec3(0.0);
      // radial zoom blur for dives, with a little lens fringe at the edges
      float jitter = h(vUv * uRes + uTime);
      const int N = 10;
      for (int i = 0; i < N; i++) {
        float s = 1.0 - (float(i) + jitter) / float(N) * uZoom * 0.12;
        vec2 uv = 0.5 + d * s;
        col.r += texture2D(tDiffuse, uv - d * ab * (1.0 + r2 * 4.0)).r;
        col.g += texture2D(tDiffuse, uv).g;
        col.b += texture2D(tDiffuse, uv + d * ab * (1.0 + r2 * 4.0)).b;
      }
      col /= float(N);
      col = clamp(col, 0.0, 1.0);
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
      col += vec3(-0.012, 0.0, 0.018) * (1.0 - luma) + vec3(0.008, 0.004, -0.006) * luma;
      col *= 1.0 - smoothstep(0.25, 0.9, r2 * 1.6) * 0.2;
      col += (h(vUv * uRes + fract(uTime) * 100.0) - 0.5) * 0.022;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export class Experience {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setClearColor(0xb4bcc6, 1);
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scenes = [new IglooScene(), new CrystalScene(this.renderer), new PortalScene(), new PlatformScene()];
    this.rtA = new DepthTarget();
    this.rtB = new DepthTarget();

    this.composer = new EffectComposer(this.renderer);
    this.mix = new ShaderPass(MixShader);
    this.composer.addPass(this.mix);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.7, 0.98);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());

    this.scroll = new VirtualScroll(window);
    this.mouse = new THREE.Vector2();
    this.mouseLerp = new THREE.Vector2();
    this.clock = new THREE.Clock();
    this.active = 0;
    this.link = 1;
    this.onCrystalClick = null;
    this.lastProgress = -1;
    this.unsubLink = linkIndex.subscribe((i) => (this.link = i));

    this._onResize = () => this.resize();
    this._onMove = (e) => {
      const p = e.touches ? e.touches[0] : e;
      this.mouse.set((p.clientX / window.innerWidth) * 2 - 1, -(p.clientY / window.innerHeight) * 2 + 1);
    };
    this._onClick = () => {
      const c = this.scenes[1];
      if (this.active === 1 && c.hovered >= 0 && c.focus.index < 0 && this.onCrystalClick) this.onCrystalClick(c.hovered);
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
    const dpr = Math.min(Math.max(window.devicePixelRatio, 1.25), 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.rtA.setSize(Math.round(w * dpr), Math.round(h * dpr));
    this.rtB.setSize(Math.round(w * dpr), Math.round(h * dpr));
    this.final.uniforms.uRes.value.set(w * dpr, h * dpr);
    for (const s of this.scenes) s.resize(w, h, dpr);
  }

  start() {
    const tl = gsap.timeline();
    this.scenes[0].start(tl);
    tl.add(() => { this.scroll.enabled = true; }, 4.6);
  }

  goTo(p) {
    this.scroll.target = p;
  }

  setFocus(i) {
    const c = this.scenes[1];
    if (i >= 0) c.focus.index = i;
    this.scroll.enabled = i < 0;
    gsap.to(c.focus, {
      v: i >= 0 ? 1 : 0,
      duration: 1.4,
      ease: 'power3.inOut',
      onComplete: () => { if (i < 0) c.focus.index = -1; },
    });
  }

  // Scene-local progress: 0 when the scene's slice starts, 1 when it ends (may overshoot in blends).
  local(i, p) {
    const a = i === 0 ? 0 : CUTS[i - 1];
    const b = i === CUTS.length ? 1 : CUTS[i];
    return (p - a) / (b - a);
  }

  render(scene, target) {
    return target.render(this.renderer, scene.scene, scene.camera, { ...scene.post.dof, maxPx: 12 * this.renderer.getPixelRatio() });
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
    this.mouseLerp.lerp(this.mouse, damp(dt, 3));

    // which scenes are on screen, and how far through the cut between them
    let a = CUTS.filter((c, i) => p >= c + BLENDS[i]).length;
    let b = -1;
    let m = 0;
    const cut = CUTS[a];
    if (cut !== undefined && p > cut - BLENDS[a]) {
      b = a + 1;
      m = smooth(cut - BLENDS[a], cut + BLENDS[a], p);
    }
    const shown = m < 0.5 ? a : b;
    if (shown !== this.active) {
      this.active = shown;
      sceneIndex.set(shown);
      sound.whoosh();
      if (shown !== 0) this.scenes[0].clearLabels();
      if (shown !== 1) this.scenes[1].clear();
    }

    const frame = { t, dt, mouse: this.mouse, mouseLerp: this.mouseLerp, vel, link: this.link };
    const run = (i) => this.scenes[i].update({ ...frame, s: this.local(i, p), interactive: i === shown });
    run(a);
    if (b >= 0) run(b);
    if (a !== 0 && b !== 0) sound.setWind(0.12);

    const mu = this.mix.uniforms;
    mu.tA.value = this.render(this.scenes[a], this.rtA);
    if (b >= 0 && m > 0) mu.tB.value = this.render(this.scenes[b], this.rtB);
    this.renderer.setRenderTarget(null);
    mu.uMix.value = b >= 0 ? m : 0;
    mu.uKind.value = b >= 0 ? KINDS[a] : 0;
    mu.uTime.value = t;

    const blend = (key) => (b >= 0 ? (this.scenes[a].post[key] || 0) * (1 - m) + (this.scenes[b].post[key] || 0) * m : this.scenes[a].post[key] || 0);
    const fu = this.final.uniforms;
    fu.uZoom.value = blend('zoom');
    fu.uWarp.value = blend('warp');
    fu.uTime.value = t;
    fu.uAberr.value += (Math.min(vel * 0.012, 0.006) + blend('aberr') - fu.uAberr.value) * dt * 6;

    this.composer.render(dt);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('click', this._onClick);
    this.unsubLink();
    this.scroll.dispose();
    this.rtA.dispose();
    this.rtB.dispose();
    this.renderer.dispose();
  }
}
