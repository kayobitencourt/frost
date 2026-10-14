import * as THREE from 'three';
import { createIceMaterial, createIceInstances } from './IceMaterial.js';
import { noise, fog } from './glsl.js';

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

  const material = createIceMaterial();
  material.uniforms.uCore.value.copy(CORE);
  material.uniforms.uReveal.value = 0;
  const mesh = createIceInstances(new THREE.BoxGeometry(1, 1, 1), material, items);
  return { mesh, material };
}

/* ---------- Core light inside the dome ---------- */
export function createCore() {
  const group = new THREE.Group();
  group.position.copy(CORE);
  const sphere = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.32, 3),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.6, 3.2) })
  );
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uIntensity: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uIntensity;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float g = exp(-d * 4.0) * 0.9 + exp(-d * 12.0);
        float rays = pow(abs(sin(atan(vUv.y - 0.5, vUv.x - 0.5 + 1e-4) * 3.0 + uTime * 0.2)), 40.0) * exp(-d * 3.0) * 0.4;
        gl_FragColor = vec4(vec3(0.7, 0.85, 1.0) * (g + rays) * uIntensity, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
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
        float settle = mix(1.0, 0.22, smoothstep(0.85, 1.0, uIntro));
        vAlpha = settle * (0.55 + 0.45 * sin(uTime * 2.0 + aRand * 50.0)) * (1.0 - smoothstep(30.0, 80.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vAlpha;
        gl_FragColor = vec4(vec3(0.8, 0.9, 1.0) * 1.6 * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return { points, material };
}

/* ---------- Snow drifting through the whole scene ---------- */
export function createSnow(count = 2500) {
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
    uniforms: { uTime: { value: 0 }, uPixel: { value: 1 }, uWind: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aRand;
      uniform float uTime, uPixel, uWind;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.y = mod(p.y - uTime * (0.4 + aRand * 0.9), 45.0);
        p.x += sin(uTime * 0.3 + aRand * 20.0) * 1.2 + uWind * aRand * 6.0;
        p.z += cos(uTime * 0.25 + aRand * 10.0) * 0.8;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = 0.035 * uPixel * (0.3 + aRand * 0.7) / -mv.z;
        vAlpha = (0.25 + aRand * 0.5) * smoothstep(0.0, 3.0, p.y) * (1.0 - smoothstep(25.0, 60.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.1, d) * vAlpha;
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return { points, material };
}

/* ---------- Distant stars ---------- */
export function createStars(count = 1800) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3(gauss(), Math.abs(gauss()) + 0.05, gauss()).normalize().multiplyScalar(rnd(160, 220));
    pos.set([v.x, v.y, v.z - 40], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x8a96a8, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.7, depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

/* ---------- Ground plane ---------- */
export function createGround() {
  const material = new THREE.ShaderMaterial({
    uniforms: { uCoreIntensity: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uCoreIntensity, uTime;
      varying vec3 vW;
      ${noise}
      ${fog}
      void main() {
        float d = length(vW.xz);
        float n = noise(vec3(vW.xz * 0.18, uTime * 0.02));
        vec3 col = vec3(0.006, 0.007, 0.009) + vec3(0.045, 0.05, 0.06) * n * n;
        float dots = smoothstep(0.07, 0.0, length(fract(vW.xz * 1.25) - 0.5));
        float near = 1.0 - smoothstep(4.0, 32.0, distance(vW, cameraPosition));
        col += vec3(0.55, 0.62, 0.72) * dots * 0.07 * near;
        col += vec3(0.6, 0.8, 1.0) * uCoreIntensity * 0.28 * exp(-d * d * 0.07);
        col += vec3(0.7, 0.85, 1.0) * smoothstep(0.05, 0.0, abs(d - 5.2)) * 0.25 * uCoreIntensity;
        float path = smoothstep(0.04, 0.0, abs(abs(vW.x) - 1.6)) * step(vW.z, -6.0) * step(-56.0, vW.z);
        float dash = step(0.5, fract(vW.z * 0.5 + uTime * 0.4));
        col += vec3(0.5, 0.6, 0.75) * path * dash * 0.12 * near;
        gl_FragColor = vec4(col * fogFactor(vW), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), material);
  mesh.rotation.x = -Math.PI / 2;
  return { mesh, material };
}

/* ---------- Shattered ring of ice shards ---------- */
export function createRing(count = 420) {
  const items = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd(-0.02, 0.02);
    const r = 6.6 + gauss() * 0.7;
    dummy.position.set(Math.cos(a) * r, Math.sin(a) * r, gauss() * 0.8);
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
  group.add(mesh);

  // dust orbiting with the ring
  const n = 3000;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 6.6 + gauss() * 1.6;
    pos.set([Math.cos(a) * r, Math.sin(a) * r, gauss() * 1.5], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0x9fb4cc, size: 0.05, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  group.add(dust);
  return { group, mesh, material, dust };
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
      new THREE.LineBasicMaterial({ color: new THREE.Color(1.6, 1.9, 2.4), transparent: true, opacity: 0.9 })
    );
    const innerCore = new THREE.Mesh(shapeGeo, new THREE.MeshBasicMaterial({ color: 0x05070a }));
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
        vec3 col = vec3(0.75, 0.88, 1.0) * (0.3 + pulse * 0.22) + vec3(1.4) * tip;
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lines = new THREE.LineSegments(geo, material);
  lines.frustumCulled = false;
  const group = new THREE.Group();
  group.position.copy(FLAKE_CENTER);
  group.scale.setScalar(9);
  group.add(lines);
  return { group, material };
}
