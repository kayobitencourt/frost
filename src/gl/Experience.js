import * as THREE from 'three';
import gsap from 'gsap';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  createDome, createCore, createIntroParticles, createSnow, createGround, createDrift,
  createRings, createCubes, createSnowflake, createMountains, createSky, FLAKE_CENTER, DOME_RADIUS,
} from './World.js';
import { FlowMap } from './FlowMap.js';
import { VirtualScroll } from './VirtualScroll.js';
import { progress, cubeScreen, hoverCube, domeLabels, ringLabels } from '../state.js';
import { sound } from '../audio/Sound.js';

// Camera rail, sampled uniformly by index: front of the igloo, through its door and
// heart while it breaks apart, up over the valley, down onto the halo axis, through
// the three portals, to the ventures and finally up to the snowflake.
const RAIL = [
  { pos: [0, 2.6, 15.5], look: [0, 2.2, 0] },
  { pos: [0, 1.25, 8], look: [0, 1.4, 0] },
  { pos: [1.5, 2.7, 0.4], look: [0, 5, -8] },
  { pos: [0, 9, -4], look: [0, 3, -18] },
  { pos: [0, 16, -9], look: [0, 3, -30] },
  { pos: [0, 5.5, -15], look: [0, 3, -30] },
  { pos: [0, 3, -40], look: [0, 3, -60] },
  { pos: [0, 3.2, -50.5], look: [0, 3, -60] },
  { pos: [0, 3.2, -50.5], look: [0, 3, -60] },
  { pos: [0, 6, -58], look: [0, 22, -82] },
  { pos: [0, 9, -63], look: [0, 26, -84] },
];
export const CUBE_RANGE = [0.68, 0.82];
const RING_RANGE = [0.38, 0.6];
const SECTION_CUTS = [0.1, 0.4, 0.63, 0.86];
const LIFT_LABELS = 4;
const UP = new THREE.Vector3(0, 0.6, 0);

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    tFlow: { value: null },
    uTime: { value: 0 },
    uAberr: { value: 0 },
    uFlash: { value: 0 },
    uFlowAmt: { value: 0 },
    uPortal: { value: new THREE.Vector4(0.5, 0.5, 0.3, 0) },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tFlow;
    uniform float uTime, uAberr, uFlash, uFlowAmt;
    uniform vec4 uPortal;
    uniform vec2 uRes;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      float aspect = uRes.x / uRes.y;
      vec2 uv = vUv;

      // portal: inside a halo the image swirls, lenses towards the centre and ripples
      vec2 pd = uv - uPortal.xy;
      pd.x *= aspect;
      float r = length(pd);
      float R = max(uPortal.z, 1e-3);
      float s = uPortal.w;
      float inside = 1.0 - smoothstep(R * 0.8, R * 1.08, r);
      float k = clamp(r / R, 0.0, 1.0);
      float ang = s * inside * (1.0 - k) * 2.6;
      pd = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * pd;
      pd *= 1.0 - s * inside * (1.0 - k * k) * 0.38;
      pd += normalize(pd + 1e-5) * sin(r * 70.0 / max(R, 0.25) - uTime * 9.0) * 0.007 * s * inside;
      float rim = smoothstep(0.035, 0.0, abs(r - R)) * s;
      pd.x /= aspect;
      uv = uPortal.xy + pd;

      // cursor flow: liquid smear that trails the pointer
      vec3 fl = texture2D(tFlow, vUv).rgb;
      vec2 flow = fl.rg * fl.b * uFlowAmt;
      uv -= flow * 0.07;

      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      float ab = 0.0025 + uAberr + s * inside * 0.006 + length(flow) * 0.02;
      vec3 col;
      col.r = texture2D(tDiffuse, uv - d * ab * (1.0 + r2 * 4.0) - flow * 0.012).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + d * ab * (1.0 + r2 * 4.0) + flow * 0.012).b;
      col = mix(col, vec3(0.78, 0.9, 1.0), rim * 0.45);
      col += vec3(0.6, 0.8, 1.0) * length(flow) * 0.6;

      col *= 1.0 - smoothstep(0.3, 0.9, r2 * 1.6) * 0.18;
      col += (h(vUv * uRes + fract(uTime) * 100.0) - 0.5) * 0.025;
      col *= 0.985 + 0.015 * sin(vUv.y * uRes.y * 1.4);
      col += uFlash * vec3(0.8, 0.9, 1.0);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export class Experience {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setClearColor(0xaeb8c5, 1);
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);

    this.posCurve = new THREE.CatmullRomCurve3(RAIL.map((k) => new THREE.Vector3(...k.pos)));
    this.lookCurve = new THREE.CatmullRomCurve3(RAIL.map((k) => new THREE.Vector3(...k.look)));

    this.dome = createDome();
    this.core = createCore();
    this.particles = createIntroParticles();
    this.snow = createSnow();
    this.ground = createGround();
    this.drift = createDrift();
    this.rings = createRings();
    this.cubes = createCubes();
    this.flake = createSnowflake();
    this.measure = this.createMeasureLines();
    this.mountains = createMountains();
    this.sky = createSky();
    this.scene.add(
      this.sky, this.mountains,
      this.dome.mesh, this.core.group, this.particles.points, this.snow.points,
      this.ground.mesh, this.drift.points, this.flake.group, this.measure,
      ...this.rings.map((r) => r.group), ...this.cubes.map((c) => c.group)
    );
    this.flow = new FlowMap(this.renderer);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.18, 0.4, 0.97);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.final.uniforms.tFlow.value = this.flow.texture;
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
    this._tmp2 = new THREE.Vector3();

    // igloo hover: per-block spring that lifts blocks near the cursor
    const n = this.dome.blocks.length;
    this.lift = { value: new Float32Array(n), vel: new Float32Array(n), up: new Uint8Array(n) };
    this.liftAttr = this.dome.mesh.geometry.getAttribute('aLift');
    this.domeHit = new THREE.Vector3();
    this.domeHover = 0;
    this.domeShell = new THREE.Sphere(new THREE.Vector3(0, 0, 0), DOME_RADIUS + 0.3);
    this.domeDoor = new THREE.Sphere(new THREE.Vector3(0, 0.6, 4.4), 1.9);
    this.lastShard = 0;
    this.labelsVisible = false;
    this.ringsVisible = false;

    this.wind = { t: 0, gust: 0 };

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

  // Measuring lines drawn from each lifted block back to its seat in the shell.
  createMeasureLines() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LIFT_LABELS * 6 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false,
    }));
    lines.frustumCulled = false;
    lines.renderOrder = 10;
    return lines;
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
    for (const m of [this.particles.material, this.snow.material, this.drift.material]) m.uniforms.uPixel.value = pixel;
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

  updateDome(dt, explode, active) {
    const { blocks } = this.dome;
    const { value, vel, up } = this.lift;
    let hit = null;
    if (active) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const ray = this.raycaster.ray;
      const a = ray.intersectSphere(this.domeShell, this._tmp);
      const b = ray.intersectSphere(this.domeDoor, this._tmp2);
      hit = a && b ? (a.distanceToSquared(ray.origin) < b.distanceToSquared(ray.origin) ? a : b) : a || b;
      if (hit && hit.y < -0.2) hit = null;
    }
    if (hit) {
      if (this.domeHover < 0.05) this.domeHit.copy(hit);
      else this.domeHit.lerp(hit, 1 - Math.exp(-dt * 14));
    }
    this.domeHover += ((hit ? 1 : 0) - this.domeHover) * (1 - Math.exp(-dt * 6));

    const fade = this.domeHover * (1 - explode);
    let moving = false;
    for (let i = 0; i < blocks.length; i++) {
      const bl = blocks[i];
      const d = bl.center.distanceTo(this.domeHit);
      const target = fade * smooth(2.1, 0.2, d) * (0.45 + bl.rand * 0.75);
      vel[i] += ((target - value[i]) * 110 - vel[i] * 12) * dt;
      value[i] += vel[i] * dt;
      if (Math.abs(value[i]) > 1e-4 || Math.abs(vel[i]) > 1e-4) moving = true;
      else value[i] = vel[i] = 0;
      if (target > 0.4 && !up[i]) {
        up[i] = 1;
        const now = performance.now();
        if (now - this.lastShard > 160) {
          this.lastShard = now;
          sound.shard();
        }
      } else if (target < 0.15) up[i] = 0;
    }
    if (moving || this.labelsVisible) {
      this.liftAttr.array.set(value);
      this.liftAttr.needsUpdate = true;
    }

    // measuring lines + labels on the highest blocks
    const top = [];
    for (let i = 0; i < blocks.length; i++) if (value[i] > 0.12) top.push(i);
    top.sort((x, y) => value[y] - value[x]);
    top.length = Math.min(top.length, LIFT_LABELS);
    const pos = this.measure.geometry.getAttribute('position');
    const labels = [];
    top.forEach((i, k) => {
      const bl = blocks[i];
      const offset = this._tmp.copy(bl.dir).add(UP).multiplyScalar(value[i]);
      const end = this._tmp2.copy(bl.center).add(offset);
      const side = new THREE.Vector3().crossVectors(bl.dir, UP).normalize().multiplyScalar(0.18);
      const o = k * 18;
      pos.array.set([
        bl.center.x, bl.center.y, bl.center.z, end.x, end.y, end.z,
        bl.center.x - side.x, bl.center.y - side.y, bl.center.z - side.z, bl.center.x + side.x, bl.center.y + side.y, bl.center.z + side.z,
        end.x - side.x, end.y - side.y, end.z - side.z, end.x + side.x, end.y + side.y, end.z + side.z,
      ], o);
      const v = end.project(this.camera);
      labels.push({
        id: `B.${String(i).padStart(3, '0')}`,
        d: offset.length().toFixed(2),
        x: (v.x * 0.5 + 0.5) * window.innerWidth,
        y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      });
    });
    pos.needsUpdate = true;
    this.measure.geometry.setDrawRange(0, top.length * 6);
    if (labels.length || this.labelsVisible) domeLabels.set(labels);
    this.labelsVisible = labels.length > 0;
  }

  updateRings(t, p) {
    const cam = this.camera.position;
    let portal = null;
    const pulses = this.rings.map((r, i) => {
      // halos snap 60° in a cascade, like the six arms of the mark ticking over
      const local = (t - i * 0.35) / 4.8;
      const f = local - Math.floor(local);
      const snap = Math.floor(local) + easeInOut(Math.min(f / 0.28, 1));
      const pulse = f < 0.35 ? Math.sin((f / 0.35) * Math.PI) : 0;

      // portal: approaching, the halo winds up two arms and tightens; once crossed
      // its shards burst outward like the igloo shell
      const d = cam.z - r.group.position.z;
      const approach = d > 0 ? smooth(16, 0, d) : 0;
      const after = d < 0 ? smooth(0, -9, d) : 0;
      const wind = easeInOut(approach) * ((2 * Math.PI) / 3) + after * (Math.PI / 3);
      r.spin.rotation.z = r.dir * ((snap * Math.PI) / 3 + t * 0.04 + wind) + (i * Math.PI) / 3;
      r.group.scale.setScalar(1 - approach * 0.12 + after * 0.25);
      r.dust.rotation.z = -r.dir * (t * 0.03 + approach * 1.5);

      const u = r.material.uniforms;
      // shards fall into place as the camera nears, one halo after another
      const reveal = smooth(0.26 + i * 0.04, 0.4 + i * 0.04, p);
      u.uReveal.value = reveal;
      r.group.visible = reveal > 0.001;
      r.dust.material.opacity = 0.45 * reveal * (1 - after);
      u.uTime.value = t;
      u.uExplode.value = after * 0.9 + approach * 0.05 + 0.03 * (0.5 + 0.5 * Math.sin(t * 0.9 - i * 1.1));
      u.uCoreIntensity.value = 0.6 + pulse * 0.7 + approach * 1.2;
      r.tickMat.opacity = (0.2 + pulse * 0.7 + approach * 0.5) * reveal * (1 - after);

      const strength = Math.exp(-(d * d) / 22) * reveal;
      if (!portal || strength > portal.strength) portal = { r, d, strength };
      return pulse;
    });

    // screen-space warp centred on the strongest halo
    const pu = this.final.uniforms.uPortal.value;
    if (portal && portal.strength > 0.002) {
      const { r, d, strength } = portal;
      const c = this._tmp.copy(r.group.position);
      if (d > 0.4) {
        const edge = this._tmp2.copy(c).addScaledVector(this.camera.up, r.radius * r.group.scale.x);
        c.project(this.camera);
        edge.project(this.camera);
        pu.x = c.x * 0.5 + 0.5;
        pu.y = c.y * 0.5 + 0.5;
        pu.z = Math.min(Math.abs(edge.y - c.y) * 0.5, 2.5);
      } else {
        pu.x += (0.5 - pu.x) * 0.2;
        pu.y += (0.5 - pu.y) * 0.2;
        pu.z = 2.5;
      }
      pu.w = strength;
    } else pu.w = 0;

    const show = p > RING_RANGE[0] && p < RING_RANGE[1];
    if (!show && !this.ringsVisible) return;
    this.ringsVisible = show;
    const fwd = this.camera.getWorldDirection(this._tmp2);
    const labels = show
      ? this.rings.map((r, i) => {
          const dist = this.camera.position.distanceTo(r.group.position);
          const ahead = this._tmp.copy(r.group.position).sub(this.camera.position).dot(fwd);
          const a = [0.75, 0.3, -0.25][i] * Math.PI;
          const anchor = r.group.localToWorld(this._tmp.set(Math.cos(a) * (r.radius + 1.9), Math.sin(a) * (r.radius + 1.9), 0));
          const v = anchor.project(this.camera);
          const next = this.rings[i + 1];
          return {
            id: `HALO · ${["INNER", "CORE", "OUTER"][i]}`,
            diam: (r.radius * 2).toFixed(1),
            dist: dist.toFixed(1),
            gap: next ? Math.abs(r.z - next.z).toFixed(1) : null,
            pulse: pulses[i] > 0.2,
            visible: ahead > 1.5 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1,
            x: (v.x * 0.5 + 0.5) * window.innerWidth,
            y: (-v.y * 0.5 + 0.5) * window.innerHeight,
          };
        })
      : [];
    ringLabels.set(labels);
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
    // calmer parallax while threading the igloo door
    const sway = 1 - smooth(0.04, 0.1, p) * (1 - smooth(0.2, 0.28, p)) * 0.8;
    this.camera.translateX(this.mouseLerp.x * 0.5 * sway);
    this.camera.translateY(this.mouseLerp.y * 0.3 * sway);
    this.camera.rotateZ(-this.mouseLerp.x * 0.012);
    this.camera.updateMatrixWorld();
    this.sky.position.copy(this.camera.position);

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
    const coreNear = smooth(0.8, 3, this.camera.position.distanceTo(this.core.group.position));
    this.core.sphere.scale.setScalar(this.intro.core * coreNear * (1 + explode * 0.6 + Math.sin(t * 2.3) * 0.05));
    this.ground.material.uniforms.uCoreIntensity.value = coreI;
    this.ground.material.uniforms.uTime.value = t;
    this.particles.material.uniforms.uTime.value = t;
    this.particles.material.uniforms.uExplode.value = explode;
    this.updateDome(dt, explode, this.intro.cam < 0.05 && p < 0.06 && this.focusIndex < 0);

    // ---- halos
    this.updateRings(t, p);

    // ---- wind: slow gust cycle, pushed harder by scrolling
    const cycle = Math.pow(0.5 + 0.5 * Math.sin(t * 0.32 + Math.sin(t * 0.11) * 2.5), 3);
    const gust = Math.min(1, cycle + Math.min(vel * 2, 0.8));
    this.wind.gust += (gust - this.wind.gust) * (1 - Math.exp(-dt * 2));
    this.wind.t += dt * (0.5 + this.wind.gust * 2.5);
    for (const m of [this.ground.material, this.drift.material, this.snow.material]) {
      m.uniforms.uWindT.value = this.wind.t;
      m.uniforms.uGust.value = this.wind.gust;
    }
    const fwd = this.camera.getWorldDirection(this._tmp);
    this.drift.material.uniforms.uCenter.value.set(pos.x + fwd.x * 14, pos.z + fwd.z * 14);
    this.drift.material.uniforms.uTime.value = t;
    this.snow.material.uniforms.uTime.value = t;
    this.snow.material.uniforms.uWind.value += (Math.min(vel * 2, 2) - this.snow.material.uniforms.uWind.value) * dt;
    sound.setWind(Math.max(this.wind.gust * 0.6, Math.min(vel * 3, 1)));

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
    const draw = smooth(0.86, 0.98, p);
    const flakeOn = smooth(0.86, 0.94, p);
    this.flake.material.uniforms.uDraw.value = draw;
    this.flake.material.uniforms.uTime.value = t;
    this.flake.group.position.set(FLAKE_CENTER.x, FLAKE_CENTER.y + Math.sin(t * 0.4) * 0.3, FLAKE_CENTER.z);
    this.flake.group.lookAt(this.camera.position);
    // the flake leans towards the cursor
    this.flake.group.rotateY(this.mouseLerp.x * 0.25 * flakeOn);
    this.flake.group.rotateX(-this.mouseLerp.y * 0.25 * flakeOn);
    this.flake.group.rotateZ(t * 0.03);

    // ---- section change whoosh
    const section = SECTION_CUTS.filter((s) => p > s).length;
    if (section !== this.lastSection) {
      if (this.lastSection >= 0) sound.whoosh();
      this.lastSection = section;
    }

    // ---- post: cursor flow (snowflake hover distortion)
    this.flow.update(this.mouse, this.camera.aspect, dt);
    this.final.uniforms.tFlow.value = this.flow.texture;
    this.final.uniforms.uFlowAmt.value = flakeOn;
    this.final.uniforms.uTime.value = t;
    this.final.uniforms.uAberr.value += (Math.min(vel * 0.01, 0.005) - this.final.uniforms.uAberr.value) * dt * 6;

    this.composer.render(dt);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('click', this._onClick);
    this.scroll.dispose();
    this.flow.dispose();
    this.renderer.dispose();
  }
}
