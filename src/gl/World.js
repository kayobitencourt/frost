import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createBrickMaterial, createInstances } from './Brick.js';
import { noise, fog, climate, terrain, sky } from './glsl.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

export const DOME_RADIUS = 4.2;
// the entrance tunnel points to the right of the camera, like a three-quarter view
export const DOOR_ANGLE = 0.62;
export const DOOR = new THREE.Vector3(Math.sin(DOOR_ANGLE) * 4.7, 0.7, Math.cos(DOOR_ANGLE) * 4.7);

/* ---------- Igloo: big rounded snow bricks that assemble, charge with light and burst ---------- */
export function createDome() {
  const rows = 6;
  const blockH = 1.0;
  const items = [];
  const dummy = new THREE.Object3D();
  for (let r = 0; r < rows; r++) {
    const phi = ((r + 0.5) / rows) * (Math.PI / 2) * 0.93;
    const ringR = DOME_RADIUS * Math.cos(phi);
    const y = DOME_RADIUS * Math.sin(phi);
    const circ = Math.PI * 2 * ringR;
    const n = Math.max(4, Math.round(circ / 1.3));
    const width = (circ / n) * 0.975;
    const offset = r % 2 ? 0.5 : 0;
    for (let k = 0; k < n; k++) {
      const theta = ((k + offset) / n) * Math.PI * 2;
      const pos = new THREE.Vector3(ringR * Math.cos(theta), y, ringR * Math.sin(theta));
      if (pos.z > 2.2 && Math.abs(pos.x) < 1.55 && y < 2.3) continue; // doorway
      dummy.position.copy(pos);
      dummy.rotation.set(0, 0, 0);
      dummy.lookAt(pos.clone().multiplyScalar(2));
      // hand-cut: no two bricks sit perfectly square
      dummy.rotateX(rnd(-0.035, 0.035));
      dummy.rotateY(rnd(-0.03, 0.03));
      dummy.rotateZ(rnd(-0.04, 0.04));
      dummy.scale.set(width, blockH * rnd(0.95, 0.98), rnd(0.66, 0.74));
      dummy.updateMatrix();
      const dir = pos.clone().normalize().add(new THREE.Vector3(gauss() * 0.3, gauss() * 0.3, gauss() * 0.3)).normalize();
      items.push({ matrix: dummy.matrix.clone(), dir, row: r / rows });
    }
  }
  dummy.position.set(0, DOME_RADIUS - 0.1, 0);
  dummy.rotation.set(-Math.PI / 2, 0, 0);
  dummy.scale.set(1.5, 1.5, 0.6);
  dummy.updateMatrix();
  items.push({ matrix: dummy.matrix.clone(), dir: new THREE.Vector3(0, 1, 0), row: 1, rand: 0.9 });

  // entrance tunnel: three arches of blocks sticking out of the dome
  const tunnelR = 1.45;
  const per = 6;
  const m = new THREE.Matrix4();
  for (let s = 0; s < 3; s++) {
    const z = 3.75 + s * 0.78;
    for (let k = 0; k < per; k++) {
      const a = ((k + 0.5 + (s % 2) * 0.25) / per) * Math.PI;
      const radial = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
      const tangent = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
      m.makeBasis(tangent, new THREE.Vector3(0, 0, 1), radial);
      m.scale(new THREE.Vector3(((Math.PI * tunnelR) / per) * 0.95, 0.74, rnd(0.6, 0.68)));
      m.setPosition(radial.x * tunnelR, radial.y * tunnelR, z);
      const dir = radial.clone().add(new THREE.Vector3(0, 0, 0.6)).normalize();
      items.push({ matrix: m.clone(), dir, row: 0.05 * s });
    }
  }

  const turn = new THREE.Matrix4().makeRotationY(DOOR_ANGLE);
  const yAxis = new THREE.Vector3(0, 1, 0);
  for (const it of items) {
    it.matrix.premultiply(turn);
    it.dir.applyAxisAngle(yAxis, DOOR_ANGLE);
  }

  const material = createBrickMaterial();
  const mesh = createInstances(new RoundedBoxGeometry(1, 1, 1, 6, 0.11), material, items);
  const rand = mesh.geometry.getAttribute('aRand').array;
  const blocks = items.map((it, i) => ({
    center: new THREE.Vector3().setFromMatrixPosition(it.matrix),
    dir: it.dir.clone(),
    rand: rand[i],
  }));
  return { mesh, material, blocks, matrices: items.map((it) => it.matrix) };
}

/* ---------- Cloud banks the camera rises through when leaving the valley ---------- */
export function createClouds() {
  const group = new THREE.Group();
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDensity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uDensity;
      varying vec3 vW;
      ${noise}
      void main() {
        vec3 p = vec3(vW.xz * 0.06 + vec2(uTime * 0.02, 0.0), vW.y * 0.1 + uTime * 0.03);
        float c = fbm(p) + fbm(p * 2.7 + 4.0) * 0.5;
        float a = smoothstep(0.45, 1.0, c) * uDensity;
        // soften near the lens so the layers never read as flat planes
        float d = distance(vW, cameraPosition);
        a *= smoothstep(0.5, 6.0, d) * (1.0 - smoothstep(40.0, 80.0, d));
        gl_FragColor = vec4(vec3(0.8, 0.83, 0.87), a * 0.9);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < 6; i++) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), material);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, 1.5 + i * 2.4, -10);
    plane.renderOrder = 5;
    group.add(plane);
  }
  return { group, material };
}

/* ---------- Intro: the igloo drawn as a wireframe of brick edges ---------- */
export function createWireIgloo(matrices) {
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const src = edges.getAttribute('position');
  const pos = new Float32Array(matrices.length * src.count * 3);
  const v = new THREE.Vector3();
  matrices.forEach((m, i) => {
    for (let k = 0; k < src.count; k++) {
      v.fromBufferAttribute(src, k).applyMatrix4(m);
      pos.set([v.x, v.y, v.z], (i * src.count + k) * 3);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { uShow: { value: 0 }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vY = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uShow, uAlpha;
      varying float vY;
      void main() {
        // drawn from the crown down, like the scan of a structure
        float a = smoothstep(${DOME_RADIUS.toFixed(1)} + 0.5 - uShow * 6.0, ${DOME_RADIUS.toFixed(1)} + 1.5 - uShow * 6.0, vY);
        gl_FragColor = vec4(vec3(1.0), a * min(uShow * 2.0, 1.0) * 0.85 * uAlpha);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, material);
  lines.frustumCulled = false;
  return { lines, material };
}

/* ---------- Intro: a plexus of nodes and links spreading out from the igloo ---------- */
export function createPlexus() {
  const pts = [];
  for (let x = -30; x <= 30; x += 2.4) {
    for (let z = -30; z <= 30; z += 2.4) {
      const p = new THREE.Vector3(x + rnd(-1.2, 1.2), rnd(-0.5, 5.5), z + rnd(-1.2, 1.2));
      if (Math.hypot(p.x, p.z) < 32 && Math.random() < 0.75) pts.push(p);
    }
  }
  const seg = [];
  pts.forEach((p, i) => {
    const near = [];
    pts.forEach((q, j) => {
      if (j <= i) return;
      const d = p.distanceTo(q);
      if (d < 3.8) near.push([d, q]);
    });
    near.sort((a, b) => a[0] - b[0]);
    for (const [, q] of near.slice(0, 4)) seg.push(p.x, p.y, p.z, q.x, q.y, q.z);
  });
  const material = new THREE.ShaderMaterial({
    uniforms: { uRadius: { value: 0 }, uFade: { value: 0 }, uPoint: { value: 3 } },
    vertexShader: /* glsl */ `
      uniform float uPoint;
      varying float vR;
      void main() {
        vR = length(position.xz);
        gl_PointSize = uPoint;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uRadius, uFade;
      varying float vR;
      void main() {
        float a = smoothstep(uRadius, uRadius - 5.0, vR) * (1.0 - uFade);
        gl_FragColor = vec4(vec3(1.0), a * 0.75);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  const group = new THREE.Group();
  group.add(new THREE.LineSegments(lg, material), new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), material));
  group.children.forEach((c) => (c.frustumCulled = false));
  return { group, material };
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
    uniforms: { uCoreIntensity: { value: 0 }, uTime: { value: 0 }, uWindT: { value: 0 }, uGust: { value: 0 }, uRevealR: { value: 999 } },
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
      uniform float uCoreIntensity, uTime, uRevealR;
      varying vec3 vW;
      ${noise}
      ${fog}
      ${climate}
      ${terrain}
      ${sky}
      void main() {
        vec2 xz = vW.xz;
        // intro: the snow field grows out from the igloo behind a ragged frost front
        float rr = length(xz) + (noise(vec3(xz * 0.22, 1.0)) - 0.5) * 4.0 + (noise(vec3(xz * 1.4, 2.0)) - 0.5) * 1.6;
        if (rr > uRevealR) discard;
        float front = smoothstep(uRevealR - 1.4, uRevealR, rr) * (0.6 + 0.4 * noise(vec3(xz * 3.0, 4.0)));
        float camD = distance(vW, cameraPosition);
        float near = 1.0 - smoothstep(12.0, 70.0, camD);

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
        vec3 shade = vec3(0.13, 0.14, 0.17);
        vec3 lit = vec3(0.54, 0.56, 0.6);
        vec3 col = mix(shade, lit, smoothstep(0.15, 0.9, wrap * 0.7 + diff * 0.4)) * tex;
        col += vec3(0.04, 0.05, 0.07) * (1.0 - wrap) * grain;
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

        // light spilling out of the charged igloo onto the snow around it
        float d = length(xz);
        col += vec3(0.9, 0.93, 1.0) * uCoreIntensity * 0.35 * exp(-d * d * 0.05);
        // contact shadow where the walls meet the snow, and a packed, darker ring of trodden snow
        col *= 1.0 - 0.45 * exp(-pow((d - 4.25) / 0.45, 2.0)) - 0.12 * exp(-pow((d - 5.4) / 1.4, 2.0));
        col = mix(col, vec3(0.95, 0.97, 1.0), front * 0.85);
        gl_FragColor = vec4(applyFog(col, vW), 1.0);
      }`,
  });
  const geo = new THREE.PlaneGeometry(240, 240, 700, 700);
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

/* ---------- Mountain range ringing the valley ---------- */
const mountainGlsl = /* glsl */ `
float ridged(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) {
    float n = 1.0 - abs(noise(vec3(p, 2.0 + float(i))) * 2.0 - 1.0);
    s += n * n * a;
    p *= 2.07;
    a *= 0.5;
  }
  return s;
}
float mountainH(vec2 p) {
  float r = length(p - vec2(0.0, -35.0));
  float env = smoothstep(70.0, 120.0, r) * (1.0 - smoothstep(190.0, 215.0, r) * 0.5);
  float massif = fbm(vec3(p * 0.009, 4.0));
  float soft = fbm(vec3(p * 0.018, 1.0));
  return (soft * 0.75 + ridged(p * 0.012) * 0.3) * env * (34.0 + massif * 60.0) - 3.0;
}
`;

export function createMountains() {
  const T = 720;
  const RN = 150;
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
    uniforms: { uRevealR: { value: 999 } },
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
      uniform float uRevealR;
      void main() {
        vec2 xz = vW.xz;
        if (length(xz) + (noise(vec3(xz * 0.05, 2.0)) - 0.5) * 30.0 > uRevealR) discard;
        float e = 0.6;
        float h0 = mountainH(xz);
        vec3 N = normalize(vec3(h0 - mountainH(xz + vec2(e, 0.0)), e, h0 - mountainH(xz + vec2(0.0, e))));
        // snow holds on gentle slopes, rock shows through on steep faces and ridges
        float n = fbm(vec3(xz * 0.3, vW.y * 0.2));
        float snow = smoothstep(0.42, 0.62, N.y + (n - 0.5) * 0.4 + smoothstep(10.0, 50.0, vW.y) * 0.12);
        float strata = 0.5 + 0.5 * sin(vW.y * 2.2 + n * 6.0);
        vec3 rock = vec3(0.2, 0.21, 0.24) * (0.7 + strata * 0.3 + n * 0.3);
        // snow streaks clinging inside the rock gullies
        snow = max(snow, smoothstep(0.62, 0.8, fbm(vec3(xz.x * 0.6, vW.y * 0.9, xz.y * 0.6))) * 0.8);
        float wrap = dot(N, SUN) * 0.5 + 0.5;
        vec3 snowCol = mix(vec3(0.17, 0.18, 0.21), vec3(0.72, 0.74, 0.78), smoothstep(0.2, 0.85, wrap));
        vec3 col = mix(rock * (0.55 + wrap * 0.6), snowCol, snow);
        // aerial perspective + valley mist so the peaks rise out of the haze
        float d = distance(vW, cameraPosition);
        float haze = smoothstep(50.0, 280.0, d) * 0.48 + (1.0 - smoothstep(-2.0, 22.0, vW.y)) * 0.55;
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
        vec3 col = mix(FOG, vec3(0.4, 0.43, 0.49), smoothstep(0.02, 0.75, d.y));
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

/* ---------- Valley mist: low banks drifting between the hills, clear around the igloo ---------- */
export function createMist() {
  const group = new THREE.Group();
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uShow: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uShow;
      varying vec3 vW;
      ${noise}
      void main() {
        vec2 q = vW.xz * 0.035 + vec2(uTime * 0.012, uTime * 0.004);
        float c = fbm(vec3(q, vW.y * 0.2 + uTime * 0.01)) + 0.5 * fbm(vec3(q * 3.1 + 7.0, uTime * 0.02));
        float a = smoothstep(0.55, 1.1, c);
        a *= smoothstep(12.0, 30.0, length(vW.xz));
        float d = distance(vW, cameraPosition);
        a *= smoothstep(2.0, 14.0, d) * (1.0 - smoothstep(120.0, 200.0, d));
        gl_FragColor = vec4(vec3(0.78, 0.81, 0.85), a * 0.55 * uShow);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < 4; i++) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), material);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, -1.5 + i * 1.3, -30);
    plane.renderOrder = 4;
    group.add(plane);
  }
  return { group, material };
}

/* ---------- Big out-of-focus flakes drifting right in front of the lens ---------- */
export function createLensFlakes(count = 140) {
  const pos = new Float32Array(count * 3);
  const rand = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([rnd(-6, 6), rnd(-4, 4), -rnd(1.5, 7)], i * 3);
    rand[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixel: { value: 1 }, uShow: { value: 0 }, uWind: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aRand;
      uniform float uTime, uPixel, uWind;
      varying float vA;
      void main() {
        vec3 p = position;
        p.y = mod(p.y - uTime * (0.25 + aRand * 0.35) + 4.0, 8.0) - 4.0;
        p.x = mod(p.x + uTime * (0.3 + aRand * 0.4) * (0.4 + uWind) + sin(uTime * 0.7 + aRand * 30.0) * 0.4 + 6.0, 12.0) - 6.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.06 + aRand * 0.1) * uPixel / -mv.z;
        vA = (0.12 + aRand * 0.18) * smoothstep(4.0, 2.5, abs(p.y)) * smoothstep(6.0, 4.5, abs(p.x));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uShow;
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        // soft bokeh disc with a slightly brighter rim
        float a = smoothstep(1.0, 0.75, d) * (0.7 + 0.3 * smoothstep(0.5, 0.95, d));
        gl_FragColor = vec4(vec3(0.95, 0.97, 1.0), a * vA * uShow);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = 20;
  return { points, material };
}
