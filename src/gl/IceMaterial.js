import * as THREE from 'three';
import { noise, fog, voronoi, sky } from './glsl.js';

const vertexShader = /* glsl */ `
attribute vec3 aDir;
attribute float aRand;
attribute float aRow;
attribute float aLift;
uniform float uTime;
uniform float uExplode;
uniform float uReveal;
uniform float uSpin;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vLocal;
varying float vRand;
varying float vLift;

mat3 rot(vec3 a, float g) {
  a = normalize(a);
  float s = sin(g), c = cos(g), oc = 1.0 - c;
  return mat3(
    oc * a.x * a.x + c,       oc * a.x * a.y + a.z * s, oc * a.z * a.x - a.y * s,
    oc * a.x * a.y - a.z * s, oc * a.y * a.y + c,       oc * a.y * a.z + a.x * s,
    oc * a.z * a.x + a.y * s, oc * a.y * a.z - a.x * s, oc * a.z * a.z + c);
}

void main() {
  mat4 im = mat4(1.0);
  #ifdef USE_INSTANCING
  im = instanceMatrix;
  #endif

  float e = clamp(uExplode * 1.5 - aRand * 0.5, 0.0, 1.0);
  e = e * e * (3.0 - 2.0 * e);
  vec3 axis = normalize(vec3(aRand - 0.5, 0.7, 0.3) + aDir);
  mat3 R = rot(axis, e * (1.5 + aRand * 3.0) + uSpin * uTime * (0.2 + aRand * 0.8));
  // hover lift: the block pops off the shell and tips over a little
  mat3 T = rot(vec3(aDir.z, 0.0, -aDir.x) + vec3(0.0, 0.0, 0.001), aLift * (0.25 + aRand * 0.3));
  vec3 p = R * (T * position);
  vec3 n = R * (T * normal);

  vec3 center = (modelMatrix * im * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 w = (modelMatrix * im * vec4(p, 1.0)).xyz;

  float r = clamp(uReveal * 1.8 - aRow * 0.8 - aRand * 0.3, 0.0, 1.0);
  r = 1.0 - pow(1.0 - r, 3.0);
  w = center + (w - center) * r;
  w.y += (1.0 - r) * 5.0;

  w += aDir * e * (3.0 + aRand * 7.0) + vec3(0.0, e * (1.0 + aRand * 3.0), 0.0);
  w += aDir * e * sin(uTime * 0.6 + aRand * 6.28) * 0.35;
  w += (aDir + vec3(0.0, 0.6, 0.0)) * aLift;

  vN = normalize(mat3(modelMatrix) * mat3(im) * n);
  vWorld = w;
  vLocal = position;
  vRand = aRand;
  vLift = aLift;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uHover;
uniform float uEdge;
uniform float uCoreIntensity;
uniform float uSnow;
uniform vec3 uCore;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vLocal;
varying float vRand;
varying float vLift;
const vec3 SUN = normalize(vec3(-0.5, 0.62, 0.6));
${noise}
${fog}
${voronoi}
${sky}

// Packed snow brick: saw-cut faces, chipped bevels, dense grain and soft blue shade.
vec3 snowBlock(vec3 N, vec3 V, float second, float coreLit) {
  vec3 lp = vLocal * 2.0;
  vec3 sp = vLocal * 3.0 + vRand * 17.0;
  // tool marks: shallow parallel scrapes cut across each face
  float scrape = sin(dot(lp, vec3(7.0, 11.0, 5.0)) * 3.0 + noise(sp * 2.0) * 4.0) * 0.5 + 0.5;
  vec3 bumpN = vec3(noise(sp * 9.0), noise(sp * 9.0 + 5.1), noise(sp * 9.0 + 9.7)) - 0.5;
  N = normalize(N + bumpN * 0.35 + (scrape - 0.5) * 0.08);

  float grain = fbm(sp * 2.5);
  float pores = smoothstep(0.66, 0.8, noise(sp * 18.0));
  float fine = hash(floor(vWorld * 180.0));
  float layer = smoothstep(0.4, 0.6, noise(vec3(vLocal.y * 14.0 + vRand * 5.0, vRand, 0.0))) * 0.06;
  float chip = smoothstep(0.45, 0.85, noise(sp * 4.0)) * smoothstep(0.8, 0.98, second);

  float diff = max(dot(N, SUN), 0.0);
  float wrap = max(dot(N, SUN) * 0.5 + 0.5, 0.0);
  vec3 lit = vec3(0.8, 0.83, 0.88);
  vec3 shade = vec3(0.34, 0.43, 0.56);
  vec3 col = mix(shade, lit, smoothstep(0.1, 0.9, wrap * 0.75 + diff * 0.35));
  col *= 0.86 + grain * 0.16 + fine * 0.05 - pores * 0.07 - layer - chip * 0.12;
  col = mix(col, skyColor(reflect(-V, N)), pow(1.0 - max(dot(N, V), 0.0), 4.0) * 0.25);

  // seams between bricks fall into deep blue shadow
  float seam = smoothstep(0.9, 0.995, second);
  col = mix(col, vec3(0.14, 0.22, 0.32), seam * 0.7);
  // light from the core glows through the snow walls
  col += vec3(0.25, 0.6, 0.95) * coreLit * (0.45 + grain * 0.3);
  // crystal sparkle, slightly prismatic
  vec3 cell = floor(vWorld * 85.0);
  float glint = step(0.993, hash(cell + floor(uTime * 4.0 + hash(cell) * 9.0)));
  vec3 tint = 0.75 + 0.25 * cos(6.2831 * (hash(cell + 3.0) + vec3(0.0, 0.33, 0.67)));
  col += glint * tint * pow(max(dot(reflect(-V, N), SUN), 0.0), 2.0) * 0.9;
  return col;
}

// Glacial ice: Beer-Lambert absorption, parallax fractures and bubbles, sky reflection.
vec3 iceBlock(vec3 N, vec3 V, float ndv, float edge, float coreLit) {
  vec3 rd = refract(-V, N, 0.76);
  float thick = 0.35 / max(ndv, 0.18);
  vec3 base = vWorld * 1.3 + vRand * 11.0;
  float veils = 0.0;
  float bub = 0.0;
  for (int k = 0; k < 3; k++) {
    float dpt = 0.1 + float(k) * 0.22;
    vec3 sp = base + rd * dpt * 2.0;
    vec2 vo = voronoi(sp * 1.8);
    veils += smoothstep(0.05, 0.0, vo.y) * (0.6 - float(k) * 0.16);
    bub += step(0.982, hash(floor(sp * 26.0))) * (0.7 - float(k) * 0.2);
  }
  float cloud = fbm(base * 1.5 + rd);
  vec3 trans = skyColor(rd) * exp(-vec3(1.7, 0.62, 0.36) * thick * (0.7 + cloud * 0.6));
  vec3 col = trans + vec3(0.85, 0.94, 1.0) * (veils * 0.45 + bub * 0.5 + cloud * 0.08);

  vec3 R = reflect(-V, N);
  float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  col = mix(col, skyColor(R), clamp(F * 1.4, 0.0, 1.0));
  col += vec3(1.0, 0.98, 0.94) * (pow(max(dot(R, SUN), 0.0), 140.0) * 2.0 + pow(max(dot(R, SUN), 0.0), 10.0) * 0.12);

  float rime = smoothstep(0.5, 0.8, fbm(vWorld * 3.0 + vRand * 5.0)) * 0.35;
  col = mix(col, vec3(0.9, 0.95, 0.98), rime + edge * 0.5);
  col += vec3(0.2, 0.55, 0.85) * coreLit * 0.5;
  return col;
}

void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fr = pow(1.0 - ndv, 3.0);

  vec3 q = abs(vLocal) * 2.0;
  float second = max(max(min(q.x, q.y), min(q.y, q.z)), min(q.x, q.z));
  float edge = smoothstep(0.86, 0.985, second) * uEdge;

  vec3 Lc = uCore - vWorld;
  float dc = length(Lc);
  float coreLit = max(dot(N, Lc / dc), 0.0) * uCoreIntensity / (1.0 + dc * dc * 0.15);

  vec3 col = uSnow > 0.5 ? snowBlock(N, V, second, coreLit) : iceBlock(N, V, ndv, edge, coreLit);

  // lifted blocks get an inked outline so they read against the white
  float lifted = clamp(vLift * 1.5, 0.0, 1.0);
  col = mix(col, vec3(0.05, 0.2, 0.32), smoothstep(0.9, 0.99, second) * lifted * 0.85);
  col = mix(col, vec3(0.7, 0.88, 1.0), lifted * 0.15);

  col = mix(col, vec3(0.5, 0.78, 1.0), uHover * 0.25);
  col = applyFog(col, vWorld);

  float a = uAlpha;
  if (uAlpha < 1.0) a = clamp(uAlpha + fr * 0.75 + edge * 0.7 + uHover * 0.15, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export function createIceMaterial({ alpha = 1, edge = 1, spin = 0, snow = 0 } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uExplode: { value: 0 },
      uReveal: { value: 1 },
      uSpin: { value: spin },
      uAlpha: { value: alpha },
      uHover: { value: 0 },
      uEdge: { value: edge },
      uCoreIntensity: { value: 0 },
      uSnow: { value: snow },
      uCore: { value: new THREE.Vector3(0, 1.6, 0) },
    },
    transparent: alpha < 1,
    depthWrite: alpha >= 1,
    side: alpha < 1 ? THREE.DoubleSide : THREE.FrontSide,
  });
}

// Builds an InstancedMesh from a list of { matrix, dir, rand, row }.
export function createIceInstances(geometry, material, items) {
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const dir = new Float32Array(items.length * 3);
  const rand = new Float32Array(items.length);
  const row = new Float32Array(items.length);
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.matrix);
    dir.set([it.dir.x, it.dir.y, it.dir.z], i * 3);
    rand[i] = it.rand ?? Math.random();
    row[i] = it.row ?? 0;
  });
  geometry.setAttribute('aDir', new THREE.InstancedBufferAttribute(dir, 3));
  geometry.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 1));
  geometry.setAttribute('aRow', new THREE.InstancedBufferAttribute(row, 1));
  const lift = new THREE.InstancedBufferAttribute(new Float32Array(items.length), 1);
  lift.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aLift', lift);
  mesh.frustumCulled = false;
  return mesh;
}
