import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createBackdrop, createStoneMaterial } from '../Backdrop.js';
import { noise, voronoi } from '../glsl.js';
import { sound } from '../../audio/Sound.js';
import { smooth } from '../util.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const GAP = 26;

// Annulus sector with bevelled edges, pivoted on its own centre.
function arcPiece(rIn, rOut, a0, a1, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(Math.cos(a0) * rOut, Math.sin(a0) * rOut);
  shape.absarc(0, 0, rOut, a0, a1, false);
  shape.lineTo(Math.cos(a1) * rIn, Math.sin(a1) * rIn);
  shape.absarc(0, 0, rIn, a1, a0, true);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, curveSegments: 72, bevelEnabled: true, bevelThickness: 0.13, bevelSize: 0.1, bevelSegments: 7,
  });
  const mid = (a0 + a1) / 2;
  const rm = (rIn + rOut) / 2;
  const c = new THREE.Vector3(Math.cos(mid) * rm, Math.sin(mid) * rm, depth / 2);
  geo.translate(-c.x, -c.y, -c.z);
  geo.computeVertexNormals();
  return { geo, center: c.setZ(0), radial: new THREE.Vector3(Math.cos(mid), Math.sin(mid), 0) };
}

const OUTER = Array.from({ length: 8 }, (_, k) => [3.1, 4.25, (k / 8) * Math.PI * 2 + 0.03, ((k + 1) / 8) * Math.PI * 2 - 0.03, 1.0, 0]);
// Each portal carries less of the mark than the one before it: the full glyph,
// then a broken ring with a hook, then nothing but the rim around the core.
const GLYPHS = [
  {
    arcs: [
      [1.75, 2.3, 0.2, 1.35, 0.7, 0.25], [1.75, 2.3, 1.55, 2.45, 0.7, 0.25], [1.75, 2.3, 2.7, 4.3, 0.7, 0.25],
      [1.75, 2.3, 4.55, 5.75, 0.7, 0.25],
      [0.9, 1.32, 0.7, 2.95, 0.6, 0.45], [0.9, 1.32, 3.25, 3.8, 0.6, 0.45], [0.9, 1.32, 4.1, 6.0, 0.6, 0.45],
    ],
    blocks: [[2.0, 6.1], [2.6, 5.95], [1.55, 0.3]],
  },
  {
    arcs: [
      [2.2, 2.65, 0.15, 0.85, 0.6, 0.2], [2.2, 2.65, 1.05, 1.75, 0.6, 0.2], [2.2, 2.65, 1.95, 2.65, 0.6, 0.2],
      [2.2, 2.65, 3.6, 4.3, 0.6, 0.2], [2.2, 2.65, 4.5, 5.2, 0.6, 0.2], [2.2, 2.65, 5.4, 6.05, 0.6, 0.2],
      [1.35, 1.7, 1.4, 4.9, 0.5, 0.35],
    ],
    blocks: [[2.42, 3.1]],
  },
  { arcs: [], blocks: [] },
];

export class PortalScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 160);
    this.backdrop = createBackdrop({ dots: 0, haze: 1.6 });
    this.scene.add(this.backdrop.mesh);

    this.stone = createStoneMaterial();
    this.portals = GLYPHS.map((g, i) => this.createPortal(g, i));
    this.core = this.createCore();
    this.core.group.position.z = -GAP * 2 - 0.5;
    this.scene.add(this.core.group);
    this.dust = this.createDust();
    this.scene.add(this.dust.points);

    this.spin = 0;
    this.lit = [false, false, false];
    this.post = { zoom: 0, aberr: 0, warp: 0, dof: { focus: 16, aperture: 0.55 } };
    this._q = new THREE.Quaternion();
  }

  createPortal(glyph, index) {
    const ring = new THREE.Group();
    ring.position.z = -index * GAP;
    const inner = new THREE.Group();
    ring.add(inner);
    this.scene.add(ring);
    const pieces = [];
    const add = (geo, home, radial, parent, isInner) => {
      const mesh = new THREE.Mesh(geo, this.stone);
      const start = home.clone()
        .addScaledVector(radial, rnd(4, 9))
        .add(new THREE.Vector3(rnd(-3, 3), rnd(-9, -4), rnd(-6, 5)));
      const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(-2, 2), rnd(-2, 2), rnd(-2, 2)));
      parent.add(mesh);
      mesh.position.copy(home);
      pieces.push({ mesh, home, radial, start, q0, delay: rnd(0, 0.45), inner: isInner });
    };
    for (const [ri, ro, a0, a1, d, z] of OUTER) {
      const p = arcPiece(ri, ro, a0, a1, d);
      add(p.geo, p.center.setZ(z), p.radial, ring, false);
    }
    for (const [ri, ro, a0, a1, d, z] of glyph.arcs) {
      const p = arcPiece(ri, ro, a0, a1, d);
      add(p.geo, p.center.setZ(z), p.radial, inner, true);
    }
    for (const [r, a] of glyph.blocks) {
      const radial = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
      add(new RoundedBoxGeometry(0.42, 0.42, 0.5, 6, 0.08), radial.clone().multiplyScalar(r).setZ(0.45), radial, inner, true);
    }
    const disc = this.createDisc();
    disc.position.z = -0.45;
    const rays = this.createRays();
    rays.position.z = -0.6;
    ring.add(disc, rays);
    pieces.forEach((pc, k) => (pc.phase = k * 1.7 + index * 3.1));
    return { ring, inner, pieces, disc, rays, z: ring.position.z };
  }

  // Light shafts fanning out from a lit portal, slowly turning.
  createRays() {
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uGlow: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uGlow;
        varying vec2 vUv;
        ${noise}
        void main() {
          vec2 p = (vUv - 0.5) * 30.0;
          float r = length(p);
          float a = atan(p.y, p.x);
          float beams = pow(noise(vec3(a * 6.0, uTime * 0.12, 0.0)), 3.0) + pow(noise(vec3(a * 17.0 + 4.0, uTime * 0.2, 1.0)), 6.0) * 0.6;
          float fall = smoothstep(3.6, 4.6, r) * exp(-(r - 4.2) * 0.22);
          float v = beams * fall * uGlow * 0.55;
          gl_FragColor = vec4(vec3(0.9, 0.95, 1.0) * v, v);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), material);
    mesh.renderOrder = 1;
    return mesh;
  }

  // Ice dust hanging in the passage; opaque specks so depth of field turns them to bokeh.
  createDust(count = 6000) {
    const pos = new Float32Array(count * 3);
    const rand = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.pow(Math.random(), 0.6) * 12;
      pos.set([Math.cos(a) * r, Math.sin(a) * r, rnd(-62, 22)], i * 3);
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
          float a = uTime * (0.03 + aRand * 0.05) * (aRand > 0.5 ? 1.0 : -1.0);
          p.xy = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xy;
          p.y += sin(uTime * 0.4 + aRand * 30.0) * 0.2;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (0.014 + aRand * aRand * 0.03) * uPixel / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        void main() {
          if (length(gl_PointCoord - 0.5) > 0.5) discard;
          gl_FragColor = vec4(0.96, 0.97, 1.0, 1.0);
        }`,
    });
    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    return { points, material };
  }

  // Glowing membrane inside the ring: hot rim with flares, a living web of cracks.
  createDisc() {
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uGlow: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uGlow;
        varying vec2 vUv;
        ${noise}
        ${voronoi}
        void main() {
          vec2 p = (vUv - 0.5) * 9.0;
          float r = length(p);
          float rim = exp(-pow((r - 3.05) / 0.12, 2.0)) * 1.4 + exp(-pow((r - 3.0) / 0.5, 2.0)) * 0.35;
          float inside = 1.0 - smoothstep(2.8, 3.2, r);
          vec2 vo = voronoi(vec3(p * 3.0, uTime * 0.15));
          float web = smoothstep(0.035, 0.0, vo.y) * inside * (0.25 + 0.75 * smoothstep(1.2, 3.0, r));
          vec2 vo2 = voronoi(vec3(p * 6.5 + 7.0, uTime * 0.25));
          web += smoothstep(0.03, 0.0, vo2.y) * inside * 0.3 * smoothstep(0.8, 2.8, r);
          float haze = inside * (0.06 + 0.1 * fbm(vec3(p * 0.8, uTime * 0.1)));
          // flares licking off the rim over the stone
          float ang = atan(p.y, p.x);
          float flare = pow(max(noise(vec3(ang * 3.0, uTime * 0.6, 0.0)) - 0.35, 0.0), 2.0) * exp(-pow((r - 3.6) / 0.6, 2.0)) * 2.0;
          float a = (rim + web * 0.55 + haze + flare) * uGlow;
          gl_FragColor = vec4(vec3(0.9, 0.95, 1.0) * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 9.5), material);
    mesh.renderOrder = 2;
    return mesh;
  }

  // Bright particle cloud beyond the last portal, ringed by thin light circles.
  createCore() {
    const group = new THREE.Group();
    const n = 3000;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(Math.pow(Math.random(), 1.6) * 0.9);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pointMat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.05, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const glowMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        ${noise}
        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p) + (fbm(vec3(p * 3.0, uTime * 0.3)) - 0.5) * 0.35;
          float a = smoothstep(0.55, 0.1, r);
          gl_FragColor = vec4(vec3(1.0, 1.03, 1.08) * a * 1.3, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), glowMat);
    const ringMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    const rings = [1.3, 1.9, 2.7, 3.6].map((r) => {
      const pts = Array.from({ length: 129 }, (_, k) => {
        const a = (k / 128) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0);
      });
      return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat);
    });
    group.add(new THREE.Points(geo, pointMat), glow, ...rings);
    return { group, glowMat, ringMat };
  }

  resize(w, h, pixel) {
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1 ? 64 : 40;
    this.camera.updateProjectionMatrix();
    this.backdrop.material.uniforms.uRes.value.set(w, h);
    this.dust.material.uniforms.uPixel.value = (h * pixel * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
  }

  // Camera depth along the passage: it lingers in front of each portal, then dives through.
  cameraZ(s) {
    const KEYS = [
      [0.0, 16], [0.2, 16], [0.3, 11], [0.44, -GAP + 9], [0.52, -GAP + 9],
      [0.66, -GAP * 2 + 9], [0.76, -GAP * 2 + 9], [1.0, -GAP * 2 - 0.2],
    ];
    if (s <= KEYS[0][0]) return KEYS[0][1];
    for (let i = 1; i < KEYS.length; i++) {
      const [s1, z1] = KEYS[i];
      const [s0, z0] = KEYS[i - 1];
      if (s <= s1) return z0 + (z1 - z0) * smooth(s0, s1, s);
    }
    return KEYS[KEYS.length - 1][1];
  }

  update({ t, dt, s, mouseLerp }) {
    // first portal: pieces fly in as it rises into frame, then the membrane lights
    const assemble = smooth(-0.12, 0.2, s);
    const glow1 = smooth(0.18, 0.28, s);
    const P1 = this.portals[0];
    P1.ring.position.y = -5.2 * (1 - smooth(0, 0.2, s));
    P1.ring.rotation.x = -0.7 * (1 - smooth(0.02, 0.22, s));
    P1.ring.rotation.y = 0.25 * (1 - assemble) + mouseLerp.x * 0.05;
    for (const pc of P1.pieces) {
      if (pc.inner) continue;
      const k = smooth(pc.delay, pc.delay + 0.55, assemble);
      const e = 1 - Math.pow(1 - k, 3);
      pc.mesh.position.lerpVectors(pc.start, pc.home, e);
      pc.mesh.quaternion.slerpQuaternions(pc.q0, this._q.identity(), e);
      pc.mesh.visible = k > 0.001;
    }

    const z = this.cameraZ(s);
    this.spin += dt * 0.12;

    let roll = 0;
    let warp = 0;
    let zoom = 0;
    this.portals.forEach((P, i) => {
      const d = z - P.z;
      // the glyph opens up and spins as the camera closes in, then the membrane
      // ripples like water while the camera passes through it
      const near = smooth(12, 2, d) * (d > -2 ? 1 : 0);
      const glow = i === 0 ? glow1 : smooth(GAP - 2, 12, d);
      P.inner.rotation.z = this.spin * (i % 2 ? -1 : 1) + near * 2.2;
      for (const pc of P.pieces) {
        if (!pc.inner) continue;
        if (i === 0) {
          const k = smooth(pc.delay, pc.delay + 0.55, assemble);
          const e = 1 - Math.pow(1 - k, 3);
          pc.mesh.position.lerpVectors(pc.start, pc.home, e);
          pc.mesh.quaternion.slerpQuaternions(pc.q0, this._q.identity(), e);
          pc.mesh.visible = k > 0.001;
        } else pc.mesh.position.copy(pc.home);
        pc.mesh.position.addScaledVector(pc.radial, near * 0.7);
        pc.mesh.position.z += Math.sin(t * 0.9 + pc.phase) * 0.06;
      }
      // every stone breathes a little on its own, so the ring never reads as one rigid object
      for (const pc of P.pieces) {
        if (pc.inner) continue;
        if (i > 0) pc.mesh.position.copy(pc.home);
        pc.mesh.position.z += Math.sin(t * 0.7 + pc.phase) * 0.035 * (i === 0 ? assemble : 1);
        pc.mesh.position.addScaledVector(pc.radial, (0.5 + 0.5 * Math.sin(t * 0.5 + pc.phase)) * 0.025);
      }
      if (i > 0) P.ring.rotation.z = Math.sin(t * 0.2 + i) * 0.05;
      P.disc.material.uniforms.uTime.value = t;
      P.disc.material.uniforms.uGlow.value = glow * (1 - smooth(1, -3, d) * 0.7);
      P.rays.material.uniforms.uTime.value = t + i * 7;
      P.rays.material.uniforms.uGlow.value = glow * smooth(-1, 4, d);
      if (glow > 0.5 && !this.lit[i]) {
        this.lit[i] = true;
        sound.enter();
      } else if (glow < 0.1) this.lit[i] = false;
      const pass = Math.exp(-(d * d) / 6);
      warp = Math.max(warp, pass);
      zoom = Math.max(zoom, near * 0.25 + pass * 0.35);
      roll += smooth(10, -4, d) * 0.6;
    });

    const cam = this.camera;
    cam.position.set(mouseLerp.x * 0.4, 1.2 * (1 - assemble) + mouseLerp.y * 0.25, z);
    cam.lookAt(0, z > 0 ? P1.ring.position.y * 0.4 : 0, z - 20);
    cam.rotateZ(roll);
    cam.updateMatrixWorld();

    const ahead = this.portals.find((P) => P.z < z - 0.5) || this.portals[2];
    this.stone.uniforms.uGlowPos.value.set(0, 0, ahead.z - 0.45);
    this.dust.material.uniforms.uTime.value = t;
    this.post.dof.focus = Math.max(z - ahead.z, 2.5);
    this.stone.uniforms.uGlow.value = 1.6 * (ahead === P1 ? glow1 : 1);
    this.stone.uniforms.uTime.value = t;

    this.core.glowMat.uniforms.uTime.value = t;
    this.core.group.rotation.z = t * 0.2;
    this.core.ringMat.opacity = smooth(0.8, 1, s) * 0.8;
    this.backdrop.material.uniforms.uTime.value = t;
    this.backdrop.material.uniforms.uOffset.value.set(mouseLerp.x * 0.01, s * 0.6);
    this.post.zoom = zoom;
    this.post.warp = warp;
  }
}
