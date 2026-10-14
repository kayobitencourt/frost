import * as THREE from 'three';
import { noise, fog } from './glsl.js';

const vertexShader = /* glsl */ `
attribute vec3 aDir;
attribute float aRand;
attribute float aRow;
uniform float uTime;
uniform float uExplode;
uniform float uReveal;
uniform float uSpin;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vLocal;
varying float vRand;

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
  vec3 p = R * position;
  vec3 n = R * normal;

  vec3 center = (modelMatrix * im * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 w = (modelMatrix * im * vec4(p, 1.0)).xyz;

  float r = clamp(uReveal * 1.8 - aRow * 0.8 - aRand * 0.3, 0.0, 1.0);
  r = 1.0 - pow(1.0 - r, 3.0);
  w = center + (w - center) * r;
  w.y += (1.0 - r) * 5.0;

  w += aDir * e * (3.0 + aRand * 7.0) + vec3(0.0, e * (1.0 + aRand * 3.0), 0.0);
  w += aDir * e * sin(uTime * 0.6 + aRand * 6.28) * 0.35;

  vN = normalize(mat3(modelMatrix) * mat3(im) * n);
  vWorld = w;
  vLocal = position;
  vRand = aRand;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uHover;
uniform float uEdge;
uniform float uCoreIntensity;
uniform vec3 uCore;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vLocal;
varying float vRand;
${noise}
${fog}

void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fr = pow(1.0 - ndv, 3.0);
  vec3 R = reflect(-V, N);
  float env = smoothstep(-0.1, 0.9, R.y) * 0.22 + pow(clamp(R.y, 0.0, 1.0), 14.0) * 0.9;

  vec3 q = abs(vLocal) * 2.0;
  float second = max(max(min(q.x, q.y), min(q.y, q.z)), min(q.x, q.z));
  float edge = smoothstep(0.86, 0.985, second) * uEdge;

  float frost = noise(vWorld * 3.0 + vRand * 10.0) * 0.65 + noise(vWorld * 7.0) * 0.35;
  vec3 Lc = uCore - vWorld;
  float dc = length(Lc);
  float coreLit = max(dot(N, Lc / dc), 0.0) * uCoreIntensity / (1.0 + dc * dc * 0.15);

  vec3 ice = vec3(0.78, 0.88, 1.0);
  vec3 col = vec3(0.035, 0.042, 0.055) + vec3(0.05, 0.06, 0.075) * frost;
  col += ice * fr * (0.45 + frost * 0.45);
  col += vec3(env) * (0.35 + frost * 0.35);
  col += ice * edge * (0.3 + 0.6 * fr);
  col += ice * coreLit * 0.9;

  float spark = step(0.992, hash(floor(vWorld * 55.0) + floor(uTime * 3.0)));
  col += spark * frost * (0.4 + fr) * 1.5;

  col *= 1.0 + uHover * 0.9;
  col *= fogFactor(vWorld);

  float a = uAlpha;
  if (uAlpha < 1.0) a = clamp(uAlpha + fr * 0.75 + edge * 0.7 + uHover * 0.15, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export function createIceMaterial({ alpha = 1, edge = 1, spin = 0 } = {}) {
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
  mesh.frustumCulled = false;
  return mesh;
}
