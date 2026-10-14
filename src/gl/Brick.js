import * as THREE from 'three';
import { noise, fog, sky } from './glsl.js';

const vertexShader = /* glsl */ `
attribute vec3 aDir;
attribute float aRand;
attribute float aRow;
attribute float aLift;
uniform float uTime;
uniform float uReveal;
uniform float uAssemble;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vLocal;
varying float vRand;
varying float vLift;
varying float vReveal;
varying float vFall;

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

  // hover lift: the brick pops off the shell and tips over a little
  mat3 T = rot(vec3(aDir.z, 0.0, -aDir.x) + vec3(0.0, 0.0, 0.001), aLift * (0.35 + aRand * 0.4));
  // rebuild: bricks rain down tumbling and settle into the shell, the bottom rows first
  float fall = 1.0 - clamp(uAssemble * 1.7 - aRow * 0.5 - aRand * 0.2, 0.0, 1.0);
  fall *= fall;
  mat3 R = rot(vec3(sin(aRand * 91.0), cos(aRand * 37.0), sin(aRand * 13.0)), fall * 4.0);
  vec3 p = R * T * position;
  vec3 n = R * T * normal;

  vec3 center = (modelMatrix * im * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 w = (modelMatrix * im * vec4(p, 1.0)).xyz;

  // intro: bricks solidify in place from the ground up, still white-hot
  float r = clamp(uReveal * 1.8 - aRow * 0.8 - aRand * 0.3, 0.0, 1.0);
  r = 1.0 - pow(1.0 - r, 3.0);
  w = center + (w - center) * mix(0.85, 1.0, r);

  w += (aDir + vec3(0.0, 0.35, 0.0)) * aLift;
  w += (aDir * 2.5 + vec3(0.0, 9.0, 0.0)) * fall;

  vN = normalize(mat3(modelMatrix) * mat3(im) * n);
  vWorld = w;
  vLocal = position;
  vRand = aRand;
  vLift = aLift;
  vReveal = r;
  vFall = fall;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uGlow;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vLocal;
varying float vRand;
varying float vLift;
varying float vReveal;
varying float vFall;
const vec3 SUN = normalize(vec3(-0.5, 0.62, 0.6));
${noise}
${fog}
${sky}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);

  vec3 q = abs(vLocal) * 2.0;
  float second = max(max(min(q.x, q.y), min(q.y, q.z)), min(q.x, q.z));

  // packed snow: chipped faces, dense grain, soft shade
  vec3 sp = vLocal * 3.0 + vRand * 17.0;
  vec3 bumpN = vec3(noise(sp * 9.0), noise(sp * 9.0 + 5.1), noise(sp * 9.0 + 9.7)) - 0.5;
  vec3 bumpL = vec3(noise(sp * 2.2), noise(sp * 2.2 + 3.3), noise(sp * 2.2 + 7.7)) - 0.5;
  N = normalize(N + bumpN * 0.32 + bumpL * 0.25);
  float grain = fbm(sp * 2.5);
  float pores = smoothstep(0.66, 0.8, noise(sp * 18.0));
  float fine = hash(floor(vWorld * 180.0));

  float diff = max(dot(N, SUN), 0.0);
  float wrap = dot(N, SUN) * 0.5 + 0.5;
  vec3 lit = vec3(0.54, 0.56, 0.6);
  vec3 shade = vec3(0.14, 0.15, 0.18);
  vec3 col = mix(shade, lit, smoothstep(0.1, 0.9, wrap * 0.75 + diff * 0.35));
  col *= 0.84 + grain * 0.2 + fine * 0.05 - pores * 0.08;
  col = mix(col, skyColor(reflect(-V, N)), pow(1.0 - max(dot(N, V), 0.0), 4.0) * 0.15);

  // light leaking through the joints: faint at rest, white-hot as the igloo charges
  float seam = smoothstep(0.84, 0.99, second);
  float charge = uGlow + (1.0 - vReveal) * 1.2;
  float leak = 0.15 + charge * 1.2;
  col = mix(col, vec3(0.95, 0.97, 1.0) * (0.85 + charge * 0.45), seam * clamp(leak, 0.0, 1.0));
  // whole bricks catching the charge one after another
  float face = smoothstep(0.75, 1.0, charge * 0.85 + (vRand - 0.5) * 0.7);
  col = mix(col, vec3(0.92, 0.94, 0.97), face * (0.45 + 0.3 * second));
  // a brick now and then breathes light even at rest
  float breathe = pow(0.5 + 0.5 * sin(uTime * 0.45 + vRand * 61.0), 40.0);
  col += vec3(0.75, 0.82, 0.9) * breathe * seam * 0.6;

  // crystal sparkle, slightly prismatic
  vec3 cell = floor(vWorld * 85.0);
  float glint = step(0.993, hash(cell + floor(uTime * 4.0 + hash(cell) * 9.0)));
  vec3 tint = 0.75 + 0.25 * cos(6.2831 * (hash(cell + 3.0) + vec3(0.0, 0.33, 0.67)));
  col += glint * tint * pow(max(dot(reflect(-V, N), SUN), 0.0), 2.0) * 0.9;

  // popped bricks light up white, the brightest at their edges
  float lifted = clamp(max(vLift * 1.6, vFall * 2.5), 0.0, 1.0);
  col = mix(col, vec3(1.0, 1.02, 1.05), lifted * (0.55 + 0.45 * seam));

  if (vReveal <= 0.001) discard;
  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}
`;

export function createBrickMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uAssemble: { value: 1 },
      uGlow: { value: 0 },
    },
  });
}

// Builds an InstancedMesh from a list of { matrix, dir, rand, row }.
export function createInstances(geometry, material, items) {
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
