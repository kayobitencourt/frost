export const noise = /* glsl */ `
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}
`;

// Distance fades into a cold grey-blue whiteout (linear #aeb8c5).
export const fog = /* glsl */ `
const vec3 FOG = vec3(0.42, 0.48, 0.56);
float fogFactor(vec3 w) {
  return 1.0 - smoothstep(30.0, 90.0, length(cameraPosition - w));
}
vec3 applyFog(vec3 col, vec3 w) {
  return mix(FOG, col, fogFactor(w));
}
`;

// Shared light + wind direction for every snow surface.
export const climate = /* glsl */ `
const vec3 MOON = normalize(vec3(-0.5, 0.62, 0.6));
const vec2 WIND = normalize(vec2(0.96, -0.28));
uniform float uWindT;
uniform float uGust;

// Gust fronts travel downwind; 0 = calm air, 1 = snow being pushed.
float gustAt(vec2 p) {
  vec2 q = vec2(dot(p, WIND) - uWindT, dot(p, vec2(-WIND.y, WIND.x)));
  return smoothstep(0.38, 0.78, noise(vec3(q * vec2(0.045, 0.09), uWindT * 0.01))) * uGust;
}
`;

// Snow field height: soft dunes, a packed pad round the igloo, a flat lane
// for the camera and wind ripples that creep downwind.
export const terrain = /* glsl */ `
float snowHeight(vec2 p) {
  float dunes = fbm(vec3(p * 0.05, 0.0)) * 2.4 - 1.0;
  float pad = smoothstep(5.5, 13.0, length(p));
  float lane = mix(1.0, smoothstep(2.5, 8.0, abs(p.x)), step(p.y, 4.0) * step(-68.0, p.y));
  float along = dot(p, WIND);
  float across = dot(p, vec2(-WIND.y, WIND.x));
  float ripple = sin(along * 3.4 - uWindT * 0.6 + noise(vec3(p * 0.45, 0.0)) * 5.0);
  // sastrugi: sharp wind-carved ridges stretched along the wind
  float sas = pow(1.0 - abs(noise(vec3(along * 0.3, across * 1.5, 3.0)) * 2.0 - 1.0), 5.0);
  return dunes * pad * lane * 1.15 + ripple * 0.03 * (0.4 + pad * 0.6) + sas * 0.12 * (0.3 + pad * 0.7);
}
`;

// Cellular noise: x = distance to nearest cell, y = distance to the cell border.
export const voronoi = /* glsl */ `
vec2 voronoi(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(hash(i + g), hash(i + g + 19.1), hash(i + g + 47.3));
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return vec2(sqrt(d1), sqrt(d2) - sqrt(d1));
}
`;

// Bright overcast sky with a mountain band on the horizon, used for reflections.
export const sky = /* glsl */ `
vec3 skyColor(vec3 d) {
  vec3 sun = normalize(vec3(-0.5, 0.62, 0.6));
  vec3 zenith = vec3(0.26, 0.35, 0.48);
  vec3 horizon = vec3(0.46, 0.52, 0.6);
  vec3 c = mix(horizon, zenith, smoothstep(0.0, 0.7, d.y));
  float az = atan(d.z, d.x);
  float ridge = 0.05 + 0.06 * (sin(az * 3.0) * 0.5 + 0.5) * (0.6 + 0.4 * sin(az * 11.0 + 1.3));
  c = mix(c, vec3(0.24, 0.29, 0.36), smoothstep(0.004, -0.004, d.y - ridge) * step(-0.02, d.y));
  c = mix(c, vec3(0.55, 0.6, 0.68), step(d.y, -0.02));
  c += vec3(1.0, 0.97, 0.9) * pow(max(dot(d, sun), 0.0), 64.0) * 0.5;
  return c;
}
`;
