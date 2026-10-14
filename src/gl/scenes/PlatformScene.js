import * as THREE from 'three';
import gsap from 'gsap';
import { get } from 'svelte/store';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import fontData from 'three/examples/fonts/helvetiker_bold.typeface.json';
import { createBackdrop, createStoneMaterial } from '../Backdrop.js';
import { noise } from '../glsl.js';
import { LINKS } from '../../content.js';
import { linkIndex } from '../../state.js';
import { sound } from '../../audio/Sound.js';
import { smooth, easeInOut } from '../util.js';

const SHAPE_HEIGHT = 5;
const SHAPE_Y = 3.75;
const TRAIL = 10;
// Arrival: straight down onto the pedestal, then a slow pitch forward to face the figure.
const CAM_FROM = { pos: new THREE.Vector3(0, 21, 0.8), look: new THREE.Vector3(0, 0, 0) };
const CAM_TO = { pos: new THREE.Vector3(0, 3.4, 13.5), look: new THREE.Vector3(0, 3.3, 0) };

function sampleGlyph(font, text, count) {
  const geo = new TextGeometry(text, {
    font, size: 3.4, depth: 0.7, curveSegments: 10,
    bevelEnabled: true, bevelThickness: 0.16, bevelSize: 0.08, bevelSegments: 3,
  });
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const size = bb.getSize(new THREE.Vector3());
  const s = SHAPE_HEIGHT / Math.max(size.y, size.x * 0.75);
  const c = bb.getCenter(new THREE.Vector3());
  geo.translate(-c.x, -c.y, -c.z);
  geo.scale(s, s, s);
  geo.translate(0, SHAPE_Y, 0);
  const sampler = new MeshSurfaceSampler(new THREE.Mesh(geo)).build();
  const out = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    sampler.sample(v);
    out.set([v.x, v.y, v.z], i * 3);
  }
  geo.dispose();
  return out;
}

// The bright cloud handed over by the portal, resting on the pedestal.
function coreCloud(count) {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(Math.pow(Math.random(), 0.7) * 1.5);
    out.set([v.x, v.y * 0.8 + 1.9, v.z], i * 3);
  }
  return out;
}

export class PlatformScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 150);
    this.backdrop = createBackdrop({ dots: 0, haze: 1.2 });
    this.backdrop.material.uniforms.uTop.value.setRGB(0.66, 0.69, 0.74);
    this.backdrop.material.uniforms.uBottom.value.setRGB(0.5, 0.53, 0.58);
    this.scene.add(this.backdrop.mesh);

    this.count = window.innerWidth < 720 ? 24000 : 52000;
    const font = new FontLoader().parse(fontData);
    this.shapes = LINKS.map((l) => sampleGlyph(font, l.glyph, this.count));
    this.current = get(linkIndex);

    this.buildPlatform();
    this.buildRipples();
    this.buildHologram();
    this.buildRoom();
    this.buildDust();
    this.buildParticles();

    this.morph = { v: 1 };
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.mouseWorld = new THREE.Vector3();
    this.lastTrail = new THREE.Vector3(0, -99, 0);
    this.post = { zoom: 0, aberr: 0, warp: 0, dof: { focus: 13, aperture: 0 } };
    this._look = new THREE.Vector3();
  }

  buildPlatform() {
    const stone = (this.stone = createStoneMaterial({ grooves: 1 }));
    stone.uniforms.uFog.value.setRGB(0.6, 0.63, 0.68);
    stone.uniforms.uFogRange.value.set(12, 34);
    stone.uniforms.uGlowPos.value.set(0, 12, -1);
    stone.uniforms.uGlow.value = 1.6;
    const add = (geo, y) => {
      const m = new THREE.Mesh(geo, stone);
      m.position.y = y;
      this.scene.add(m);
    };
    add(new THREE.CylinderGeometry(18, 18, 0.4, 160), -0.2);
    add(new THREE.CylinderGeometry(9.2, 9.45, 0.3, 140), 0.15);
    add(new THREE.CylinderGeometry(3.6, 3.75, 0.75, 120), 0.375);

    const light = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.55, 1.62) });
    const rim = (r, y, tube) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 200), light);
      m.rotation.x = Math.PI / 2;
      m.position.y = y;
      this.scene.add(m);
      return m;
    };
    rim(3.62, 0.76, 0.025);
    rim(9.25, 0.31, 0.035);
    rim(17.9, 0.01, 0.05);
    // ring light in the ceiling
    const halo = rim(7.5, 12.5, 0.16);
    halo.position.z = -2;
  }

  // Thin circles that ripple out across the platform as the cloud lands.
  buildRipples() {
    this.rippleMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    this.ripples = [1.2, 2.2, 3.4, 5.0, 7.0].map((r) => {
      const pts = Array.from({ length: 161 }, (_, k) => {
        const a = (k / 160) * Math.PI * 2;
        const w = 1 + Math.sin(a * 7 + r) * 0.012;
        return new THREE.Vector3(Math.cos(a) * r * w, 0, Math.sin(a) * r * w);
      });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.rippleMat);
      line.position.y = 0.8;
      this.scene.add(line);
      return line;
    });
  }

  buildHologram() {
    const geo = new THREE.WireframeGeometry(new THREE.CylinderGeometry(3.7, 3.7, 9, 30, 10, true));
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const j = Math.sin(i * 12.9898) * 0.06;
      pos.setX(i, pos.getX(i) * (1 + j));
      pos.setZ(i, pos.getZ(i) * (1 + j));
    }
    this.holoMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vP;
        void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uOpacity;
        varying vec3 vP;
        void main() {
          float a = atan(vP.z, vP.x);
          float w = 0.5 + 0.5 * cos(a - 2.4 + sin(uTime * 0.15) * 0.4);
          float band = pow(w, 6.0);
          float h = smoothstep(-4.5, -2.5, vP.y) * (1.0 - smoothstep(2.0, 4.5, vP.y));
          // a scan line climbs the hologram now and then
          float scan = exp(-pow((vP.y - (mod(uTime * 1.6, 14.0) - 6.0)) / 0.35, 2.0));
          gl_FragColor = vec4(vec3(0.95), (band * h + scan * (0.35 + band)) * uOpacity);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.holo = new THREE.LineSegments(geo, this.holoMat);
    this.holo.position.y = 4.6;
    this.scene.add(this.holo);
  }

  buildParticles() {
    const n = this.count;
    const geo = new THREE.BufferGeometry();
    this.rand = Float32Array.from({ length: n }, Math.random);
    this.from = this.shapes[this.current].slice();
    this.to = this.shapes[this.current].slice();
    geo.setAttribute('position', new THREE.BufferAttribute(this.to, 3));
    geo.setAttribute('aFrom', new THREE.BufferAttribute(this.from, 3));
    geo.setAttribute('aTo', new THREE.BufferAttribute(this.to, 3));
    geo.setAttribute('aCloud', new THREE.BufferAttribute(coreCloud(n), 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(this.rand, 1));
    this.trail = Array.from({ length: TRAIL }, () => new THREE.Vector4(0, -99, 0, 0));
    this.particleMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uMorph: { value: 1 }, uForm: { value: 0 }, uPixel: { value: 1 }, uSpin: { value: 0 },
        uTrail: { value: this.trail },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aFrom, aTo, aCloud;
        attribute float aRand;
        uniform float uTime, uMorph, uForm, uPixel, uSpin;
        uniform vec4 uTrail[${TRAIL}];
        varying float vGlow;
        ${noise}
        vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
        vec3 flow(vec3 q) { return vec3(noise(q), noise(q + 17.1), noise(q + 31.7)) - 0.5; }
        void main() {
          // link change: each grain leaves on its own beat and is carried by the flow
          float t = clamp(uMorph * 1.7 - aRand * 0.7, 0.0, 1.0);
          float te = t * t * (3.0 - 2.0 * t);
          vec3 shape = mix(aFrom, aTo, te);
          float mid = sin(3.14159 * t);
          shape += flow(shape * 0.42 + vec3(0.0, uTime * 0.35, 0.0)) * mid * 5.0 + vec3(0.0, mid * (0.6 + aRand), 0.0);

          // arrival: the cloud on the pedestal swirls up into the figure
          float f = clamp(uForm * 1.6 - aRand * 0.6, 0.0, 1.0);
          float fe = f * f * (3.0 - 2.0 * f);
          vec3 cloud = aCloud + flow(aCloud * 1.3 + uTime * 0.4) * 0.5;
          vec3 p = mix(cloud, shape, fe);
          p += flow(p * 0.5 + 3.0) * sin(3.14159 * f) * 3.0;
          p = rotY(p, uSpin * fe);

          // hover: grains simply step out of the cursor's way and settle back
          vec3 push = vec3(0.0);
          for (int i = 0; i < ${TRAIL}; i++) {
            vec3 d = p - uTrail[i].xyz;
            d.z *= 0.4;
            float w = exp(-dot(d, d) * 1.6) * uTrail[i].w;
            push += normalize(vec3(d.xy, d.z * 0.5) + 1e-4) * w;
          }
          float pl = length(push);
          p += push / max(pl, 1.0) * (0.7 + aRand * 0.4);

          vGlow = clamp(mid * 1.4 + (1.0 - fe) * 1.2, 0.0, 1.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (0.032 + aRand * 0.018) * uPixel / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vGlow;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(c, c);
          if (r2 > 1.0) discard;
          vec3 n = vec3(c.x, -c.y, sqrt(1.0 - r2));
          vec3 L = normalize(vec3(-0.35, 0.65, 0.65));
          float diff = max(dot(n, L), 0.0);
          float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 18.0);
          vec3 base = vec3(0.34, 0.37, 0.42) * (0.3 + 0.9 * diff) + spec * 0.25;
          vec3 hot = vec3(1.0, 1.03, 1.08) * (0.75 + 0.45 * diff);
          gl_FragColor = vec4(mix(base, hot, vGlow), 1.0);
        }`,
    });
    this.points = new THREE.Points(geo, this.particleMat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  // Hand the current (possibly mid-flight) layout to aFrom and fly to a new shape.
  morphTo(index) {
    if (index === this.current) return;
    const m = this.morph.v;
    const { from, to, rand } = this;
    for (let i = 0; i < this.count; i++) {
      let t = Math.min(Math.max(m * 1.7 - rand[i] * 0.7, 0), 1);
      t = t * t * (3 - 2 * t);
      for (let k = 0; k < 3; k++) {
        const j = i * 3 + k;
        from[j] += (to[j] - from[j]) * t;
      }
    }
    to.set(this.shapes[index]);
    const geo = this.points.geometry;
    geo.getAttribute('aFrom').needsUpdate = true;
    geo.getAttribute('aTo').needsUpdate = true;
    this.current = index;
    this.morph.v = 0;
    gsap.killTweensOf(this.morph);
    gsap.to(this.morph, { v: 1, duration: 2.6, ease: 'power1.inOut' });
    sound.whoosh();
  }

  resize(w, h, pixel) {
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1 ? 60 : 38;
    this.camera.updateProjectionMatrix();
    this.particleMat.uniforms.uPixel.value = (h * pixel * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.backdrop.material.uniforms.uRes.value.set(w, h);
    this.dust.material.uniforms.uPixel.value = this.particleMat.uniforms.uPixel.value;
  }

  update({ t, dt, s, mouse, mouseLerp, interactive, link }) {
    if (link !== this.current) this.morphTo(link);

    // arrival is long and scroll-driven: ripples spread from the landed cloud,
    // the cloud rises into the figure and the camera pitches forward to face it
    const form = smooth(0.08, 0.62, s);
    const e = easeInOut(smooth(0.12, 0.72, s));
    const cam = this.camera;
    cam.position.lerpVectors(CAM_FROM.pos, CAM_TO.pos, e);
    this._look.lerpVectors(CAM_FROM.look, CAM_TO.look, e);
    cam.position.x += mouseLerp.x * 0.8 * e;
    cam.position.y += mouseLerp.y * 0.4 * e;
    cam.lookAt(this._look);
    cam.updateMatrixWorld();

    // landing ripples, then a slow pulse rolling out from the pedestal every few seconds
    const ripple = smooth(-0.1, 0.45, s);
    const settled = smooth(0.6, 0.8, s);
    const beat = (t % 6.5) / 6.5;
    this.ripples.forEach((r, i) => r.scale.setScalar(1 + ripple * (0.5 + i * 0.12) * (1 - settled) + settled * beat * (0.4 + i * 0.1)));
    this.rippleMat.opacity = 0.75 * (1 - smooth(0.25, 0.5, s)) + settled * 0.3 * Math.pow(1 - beat, 2) * smooth(0, 0.08, beat);

    // cursor trail: a new stamp whenever the pointer has moved, all stamps fade out
    const decay = Math.exp(-dt * 2.4);
    for (const p of this.trail) p.w *= decay;
    if (interactive && form > 0.95) {
      this.raycaster.setFromCamera(mouse, cam);
      if (this.raycaster.ray.intersectPlane(this.plane, this.mouseWorld) && this.mouseWorld.distanceTo(this.lastTrail) > 0.15) {
        this.lastTrail.copy(this.mouseWorld);
        const slot = this.trail.reduce((a, b) => (b.w < a.w ? b : a));
        slot.set(this.mouseWorld.x, this.mouseWorld.y, this.mouseWorld.z, 1);
      }
    }

    const u = this.particleMat.uniforms;
    u.uTime.value = t;
    u.uMorph.value = this.morph.v;
    u.uForm.value = form;
    u.uSpin.value = Math.sin(t * 0.3) * 0.75;
    this.holoMat.uniforms.uTime.value = t;
    this.holoMat.uniforms.uOpacity.value = 0.3 * e;
    this.stone.uniforms.uTime.value = t;
    this.backdrop.material.uniforms.uTime.value = t;
    this.room.material.uniforms.uTime.value = t;
    this.dust.material.uniforms.uTime.value = t;
    this.haloGlow.material.uniforms.uTime.value = t;
    this.post.zoom = (1 - smooth(0, 0.2, s)) * 0.4;
    this.post.dof.focus = cam.position.distanceTo(this._look.set(0, SHAPE_Y * (0.4 + 0.6 * e), 0));
    this.post.dof.aperture = 0.55 * e;
  }

  // The chamber: a tall drum of grey panels with a band of light and blurred readouts.
  buildRoom() {
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vP;
        varying vec2 vUv;
        void main() { vP = position; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vP;
        varying vec2 vUv;
        ${noise}
        void main() {
          float u = vUv.x * 48.0;
          float seam = smoothstep(0.03, 0.0, abs(fract(u) - 0.5) - 0.47);
          float row = smoothstep(0.02, 0.0, abs(fract(vP.y * 0.25) - 0.5) - 0.48);
          vec3 col = mix(vec3(0.5, 0.53, 0.58), vec3(0.62, 0.65, 0.7), smoothstep(-2.0, 20.0, vP.y));
          col *= 1.0 - seam * 0.12 - row * 0.08;
          col *= 0.94 + 0.06 * noise(vec3(floor(u), floor(vP.y * 0.25), 1.0));
          // the light band running round the chamber
          col += vec3(0.5, 0.53, 0.56) * exp(-pow((vP.y - 6.5) / 0.45, 2.0));
          col += vec3(0.12) * exp(-pow((vP.y - 6.5) / 2.5, 2.0));
          // blocks of readout text glowing faintly on some panels
          vec2 cell = vec2(floor(u * 3.0), floor(vP.y * 2.2));
          float txt = step(0.72, noise(vec3(cell * 0.9, 3.0))) * step(0.5, noise(vec3(cell * 3.1, floor(uTime * 0.5 + cell.x * 0.1))));
          float zone = step(2.0, vP.y) * step(vP.y, 11.0) * step(0.55, noise(vec3(floor(u / 4.0), floor(vP.y / 3.0), 7.0)));
          col += vec3(0.16) * txt * zone;
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide,
    });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 40, 128, 1, true), material);
    mesh.position.y = 14;
    this.room = mesh;
    this.scene.add(mesh);

    // soft glow pooled under the ceiling ring light
    this.haloGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 26),
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            float r = length(vUv - 0.5) * 26.0;
            float a = exp(-pow((r - 7.5) / 1.6, 2.0)) * (0.45 + 0.05 * sin(uTime * 1.3));
            gl_FragColor = vec4(vec3(1.0) * a, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.haloGlow.rotation.x = Math.PI / 2;
    this.haloGlow.position.set(0, 12.3, -2);
    this.scene.add(this.haloGlow);
  }

  // Specks of ice hanging in the chamber; opaque so depth of field turns them to bokeh.
  buildDust(count = 3500) {
    const pos = new Float32Array(count * 3);
    const rand = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 22;
      pos.set([Math.cos(a) * r, Math.random() * 16, Math.sin(a) * r], i * 3);
      rand[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixel: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aRand;
        uniform float uTime, uPixel;
        void main() {
          vec3 p = position;
          p.y = mod(p.y + uTime * (0.05 + aRand * 0.1), 16.0);
          p.x += sin(uTime * 0.3 + aRand * 40.0) * 0.4;
          p.z += cos(uTime * 0.27 + aRand * 25.0) * 0.4;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (0.012 + aRand * aRand * 0.03) * uPixel / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        void main() {
          if (length(gl_PointCoord - 0.5) > 0.5) discard;
          gl_FragColor = vec4(0.95, 0.97, 1.0, 1.0);
        }`,
    });
    this.dust = new THREE.Points(geo, material);
    this.dust.frustumCulled = false;
    this.dust.material = material;
    this.scene.add(this.dust);
  }
}
