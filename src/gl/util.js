export const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
export const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const damp = (dt, k) => 1 - Math.exp(-dt * k);

// World position -> CSS pixels.
export function toScreen(v, camera, out = {}) {
  const p = v.clone().project(camera);
  out.x = (p.x * 0.5 + 0.5) * window.innerWidth;
  out.y = (-p.y * 0.5 + 0.5) * window.innerHeight;
  out.visible = p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2;
  return out;
}
