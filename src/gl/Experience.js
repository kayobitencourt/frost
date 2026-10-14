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
import { noise } from './glsl.js';

// Half-width of the scroll window in which two scenes are blended, per cut.
const BLENDS = [0.07, 0.05, 0.05];
// 0 = fog bank rolling in from the corner, 1 = camera tilts down past a cloud band,
// 2 = iris: the next scene opens out of the centre of the last portal
const KINDS = [0, 1, 2];
// The journey loops: the last stretch of progress hands the platform back to the igloo
// (3 = the floor ripples, a snow dune rises and the igloo is rebuilt behind it).
const WRAP = 0.06;

// Blends two rendered scenes so a cut reads as one continuous camera move.
const MixShader = {
  uniforms: {
    tA: { value: null },
    tB: { value: null },
    uMix: { value: 0 },
    uKind: { value: 0 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tA, tB;
    uniform float uMix, uKind, uTime, uAspect;
    varying vec2 vUv;
    ${noise}
    const vec3 MIST = vec3(0.8, 0.83, 0.87);
    vec3 split(sampler2D t, vec2 uv, vec2 ab) {
      return vec3(texture2D(t, uv + ab).r, texture2D(t, uv).g, texture2D(t, uv - ab).b);
    }
    void main() {
      float m = uMix;
      if (m <= 0.0) { gl_FragColor = texture2D(tA, vUv); return; }
      if (m >= 1.0) { gl_FragColor = texture2D(tB, vUv); return; }
      vec2 p = vec2(vUv.x * uAspect, vUv.y);
      vec3 col;
      if (uKind < 0.5) {
        // a soft bank of fog pressed against the lens rolls in from the bottom-left
        // corner and swallows the frame; the next scene surfaces as it thins out
        float billow = fbm(vec3(p * 2.2 + vec2(uTime * 0.05, uTime * 0.02), uTime * 0.04));
        float d = dot(vUv, vec2(0.62, 0.78)) + (billow - 0.5) * 0.45;
        float front = m * 3.0 - 0.05;
        float cover = smoothstep(front + 0.05, front - 0.35, d);
        float edge = cover * (1.0 - cover) * 4.0;
        vec2 ab = vec2(0.006, 0.004) * edge;
        vec3 a = split(tA, vUv, ab);
        vec3 b = texture2D(tB, vUv).rgb;
        float lift = fbm(vec3(p * 1.4 - vec2(0.0, uTime * 0.03), 7.0 + uTime * 0.03));
        float thin = smoothstep(0.7, 1.0, m) * 1.5 - 0.25;
        float fogA = cover * smoothstep(thin - 0.25, thin + 0.05, lift);
        vec3 haze = MIST * (0.94 + 0.1 * billow - 0.06 * lift);
        col = mix(mix(a, b, step(0.68, m)), haze, fogA);
      } else if (uKind < 1.5) {
        // the camera tilts down: A leaves through the top, B rises from below a cloud band
        float e = m * m * (3.0 - 2.0 * m);
        float wob = (fbm(vec3(p * vec2(2.0, 4.0) + vec2(uTime * 0.04, 0.0), uTime * 0.05)) - 0.5) * 0.18;
        vec3 a = texture2D(tA, vec2(vUv.x, clamp(vUv.y - e, 0.0, 1.0))).rgb;
        vec3 b = texture2D(tB, vec2(vUv.x, clamp(vUv.y + 1.0 - e, 0.0, 1.0))).rgb;
        float y = vUv.y + wob;
        col = mix(b, a, smoothstep(e - 0.1, e + 0.1, y));
        float band = exp(-pow((y - e) / 0.16, 2.0)) * smoothstep(0.35, 0.75, fbm(vec3(p * 3.0, uTime * 0.06)) + 0.25);
        col = mix(col, MIST * 0.96, clamp(band, 0.0, 1.0) * 0.9 * sin(m * 3.14159));
      } else if (uKind < 2.5) {
        // iris: the last ring grows past the frame while B opens out of its centre
        float e = m * m * (3.0 - 2.0 * m);
        vec2 d = vUv - 0.5;
        vec3 a = texture2D(tA, 0.5 + d / (1.0 + e * 2.5)).rgb;
        vec3 b = texture2D(tB, 0.5 + d * mix(1.4, 1.0, e)).rgb;
        float r = length(d * vec2(uAspect, 1.0)) + (fbm(vec3(d * 6.0, uTime * 0.2)) - 0.5) * 0.06;
        float rad = e * 1.2;
        col = mix(a, b, smoothstep(rad, rad - 0.15, r));
        col += vec3(0.9, 0.95, 1.0) * exp(-pow((r - rad + 0.04) / 0.035, 2.0)) * 0.45 * sin(m * 3.14159);
      } else {
        // the loop closes: the platform floor ripples with a prismatic fringe, then a snow
        // dune rises from below and the valley is revealed behind its crest
        float e = m * m * (3.0 - 2.0 * m);
        float k = sin(m * 3.14159);
        float low = smoothstep(0.65, 0.0, vUv.y);
        vec2 ua = vUv;
        ua.y += sin(vUv.y * 70.0 - uTime * 9.0) * 0.004 * k * low;
        ua.x += sin(vUv.y * 40.0 + uTime * 6.0) * 0.003 * k * low;
        vec3 a = split(tA, ua, vec2(0.008 * k * low, 0.0));
        vec3 b = texture2D(tB, vUv).rgb;
        float wob = (fbm(vec3(p * vec2(3.0, 1.5) + vec2(uTime * 0.1, 0.0), uTime * 0.1)) - 0.5) * 0.2;
        float edge = e * 1.35 - 0.15 + wob;
        col = mix(a, b, smoothstep(edge + 0.04, edge - 0.04, vUv.y));
        col = mix(col, MIST, exp(-pow((vUv.y - edge) / 0.06, 2.0)) * 0.75 * k);
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberr: { value: 0 },
    uZoom: { value: 0 },
    uWarp: { value: 0 },
    uDark: { value: 0 },
    uSwirl: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAberr, uZoom, uWarp, uDark, uSwirl;
    uniform vec2 uRes;
    varying vec2 vUv;
    ${noise}
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      // passing through a ring: a soft lens bulge at the edges of the frame
      d *= 1.0 + dot(d, d) * uWarp * 0.35;
      // inside a portal membrane the view wobbles like water and smears round in streaks
      float sw = abs(uSwirl);
      float rA = length(d * vec2(uRes.x / uRes.y, 1.0));
      float streak = 0.0;
      if (sw > 0.001) {
        d += (vec2(noise(vec3(d * 7.0, uTime * 0.7)), noise(vec3(d * 7.0 + 5.0, uTime * 0.7))) - 0.5) * 0.04 * sw * smoothstep(0.7, 0.1, rA);
        streak = noise(vec3(rA * 26.0, atan(d.y, d.x) * 1.5, uTime * 0.6));
      }
      float spread = uSwirl * (0.25 + 0.75 * streak) * 0.6;
      float r2 = dot(d, d);
      // project view: the frame dissolves through a frosted noise front into the dark
      vec2 q = vUv * vec2(uRes.x / uRes.y, 1.0);
      float n = fbm(vec3(q * 3.5, 1.0)) * 0.8 + noise(vec3(q * 30.0, 2.0)) * 0.2;
      // the dark closes in from the edges; the centre goes last
      n = n * 0.7 + (0.6 - length(vUv - 0.5)) * 0.6;
      float th = uDark * 1.3 - 0.15;
      float dark = smoothstep(th + 0.02, th - 0.02, n);
      float fringe = smoothstep(0.05, 0.0, abs(n - th)) * step(0.001, uDark) * step(uDark, 0.999);
      float ab = 0.0015 + uAberr + uZoom * 0.006 + uWarp * 0.004 + fringe * 0.004;
      vec3 col = vec3(0.0);
      // radial zoom blur for dives, with a little lens fringe at the edges
      float jitter = h(vUv * uRes + uTime);
      const int N = 10;
      for (int i = 0; i < N; i++) {
        float k = (float(i) + jitter) / float(N);
        float s = 1.0 - k * uZoom * 0.12;
        float a = (k - 0.5) * spread;
        vec2 dd = mat2(cos(a), sin(a), -sin(a), cos(a)) * d;
        vec2 uv = 0.5 + dd * s;
        col.r += texture2D(tDiffuse, uv - dd * ab * (1.0 + r2 * 4.0)).r;
        col.g += texture2D(tDiffuse, uv).g;
        col.b += texture2D(tDiffuse, uv + dd * ab * (1.0 + r2 * 4.0)).b;
      }
      col /= float(N);
      // the tunnel walls glow white towards the edges of the frame
      float wall = smoothstep(0.3, 0.62, rA + (streak - 0.5) * 0.14);
      col = mix(col, vec3(0.9, 0.94, 1.0), wall * sw * 0.85);
      col = clamp(col, 0.0, 1.0);
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
      col += vec3(-0.012, 0.0, 0.018) * (1.0 - luma) + vec3(0.008, 0.004, -0.006) * luma;
      // night grade (linear): deep navy around #1c2430, the scene reduced to a low-contrast silhouette
      vec3 night = vec3(0.011, 0.016, 0.028) + pow(luma, 2.0) * vec3(0.05, 0.06, 0.08);
      night += vec3(0.02, 0.025, 0.035) * smoothstep(0.7, 0.0, length(vUv - vec2(0.9, 1.0)));
      col = mix(col, night, dark);
      // the dissolve front carries a prismatic edge: warm just inside, cold just outside
      float live = step(0.001, uDark) * step(uDark, 0.999);
      col += vec3(0.035, 0.012, 0.008) * smoothstep(0.03, 0.0, abs(n - th + 0.02)) * live;
      col += vec3(0.01, 0.03, 0.08) * smoothstep(0.03, 0.0, abs(n - th - 0.02)) * live;
      col *= 1.0 - smoothstep(0.25, 0.9, r2 * 1.6) * (0.2 + dark * 0.25);
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
    // capped at 1.5: the post chain (depth of field, bloom, mix) runs at full resolution
    const dpr = Math.min(window.devicePixelRatio, 1.5);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.rtA.setSize(Math.round(w * dpr), Math.round(h * dpr));
    this.rtB.setSize(Math.round(w * dpr), Math.round(h * dpr));
    this.final.uniforms.uRes.value.set(w * dpr, h * dpr);
    this.mix.uniforms.uAspect.value = w / h;
    for (const s of this.scenes) s.resize(w, h, dpr);
  }

  start() {
    const tl = gsap.timeline();
    this.scenes[0].start(tl);
    tl.add(() => { this.scroll.enabled = true; }, 4.6);
  }

  // Back to the start: the nearest loop boundary, so from the far end it rolls forward.
  home() {
    this.scroll.target = Math.round(this.scroll.target);
  }

  // Open: the camera pushes onto the crystal, the leaders glitch away, the ice frosts and
  // slides out of focus, then the frame dissolves into the night view. Close plays it back.
  setFocus(i) {
    const c = this.scenes[1];
    const open = i >= 0;
    if (open) c.focus.index = i;
    this.scroll.enabled = !open;
    gsap.killTweensOf([c.focus, c.post, c.hud]);
    if (open) {
      gsap.to(c.focus, { v: 1, duration: 1.5, ease: 'power2.inOut' });
      gsap.to(c.hud, { v: 0, duration: 0.3, delay: 0.55, ease: 'none' });
      gsap.to(c.focus, { frost: 1, duration: 0.6, delay: 0.3, ease: 'power2.in' });
      gsap.to(c.focus, { blur: 1, duration: 0.5, delay: 0.75, ease: 'power1.in' });
      gsap.to(c.post, { dark: 1, duration: 0.45, delay: 1.15, ease: 'power1.inOut' });
    } else {
      gsap.to(c.post, { dark: 0, duration: 0.45, ease: 'power1.inOut' });
      gsap.to(c.focus, { blur: 0, duration: 0.6, delay: 0.25, ease: 'power1.out' });
      gsap.to(c.focus, { frost: 0, duration: 0.6, delay: 0.2, ease: 'power2.out' });
      gsap.to(c.focus, { v: 0, duration: 1.3, ease: 'power2.inOut', onComplete: () => { c.focus.index = -1; } });
      gsap.to(c.hud, { v: 1, duration: 0.35, delay: 0.85, ease: 'none' });
    }
  }

  // Scene-local progress: 0 when the scene's slice starts, 1 when it ends (may overshoot in blends).
  local(i, p) {
    // seen across the loop, the igloo sits just before its own slice
    if (i === 0 && p > 0.5) p -= 1;
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
    const p = this.scroll.current - Math.floor(this.scroll.current);
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
    let kind = KINDS[a];
    const cut = CUTS[a];
    if (p >= 1 - WRAP) {
      b = 0;
      m = smooth(1 - WRAP, 1, p);
      kind = 3;
    } else if (cut !== undefined && p > cut - BLENDS[a]) {
      b = a + 1;
      m = smooth(cut - BLENDS[a], cut + BLENDS[a], p);
    }
    const shown = m < 0.5 ? a : b;
    if (shown !== this.active) {
      if (shown + this.active === 3 && shown * this.active === 0) sound.rebuild();
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
    mu.uKind.value = b >= 0 ? kind : 0;
    mu.uTime.value = t;

    const blend = (key) => (b >= 0 ? (this.scenes[a].post[key] || 0) * (1 - m) + (this.scenes[b].post[key] || 0) * m : this.scenes[a].post[key] || 0);
    const fu = this.final.uniforms;
    fu.uZoom.value = blend('zoom');
    fu.uWarp.value = blend('warp');
    fu.uDark.value = blend('dark');
    fu.uSwirl.value = blend('swirl');
    fu.uTime.value = t;
    fu.uAberr.value += (Math.min(vel * 0.004, 0.002) + blend('aberr') - fu.uAberr.value) * dt * 6;

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
