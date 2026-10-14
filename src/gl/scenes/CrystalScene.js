import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import fontData from 'three/examples/fonts/helvetiker_bold.typeface.json';
import { createBackdrop } from '../Backdrop.js';
import { VENTURES } from '../../content.js';
import { callouts, hoverCrystal } from '../../state.js';
import { sound } from '../../audio/Sound.js';
import { smooth, damp } from '../util.js';

const SPACING = 11;
const COUNT = 3;
const X_OFF = [-0.45, 0.6, -0.25];
const TILT = [0.22, -0.3, 0.18];
// HUD anchor points on each crystal (local space) and which way their label leans
const ANCHORS = [
  { p: [-0.5, 0.95, 0.45], side: 'tl' },
  { p: [0.62, 0.5, 0.35], side: 'r' },
  { p: [0.42, -0.8, 0.4], side: 'br' },
];

const rnd = (a, b) => a + Math.random() * (b - a);

// Tileable value noise, used to bake the frost normal and roughness maps.
function valueNoise(period) {
  const table = Float32Array.from({ length: period * period }, Math.random);
  const at = (x, y) => table[(((y % period) + period) % period) * period + (((x % period) + period) % period)];
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let fx = x - xi;
    let fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx;
    return a + (b - a) * fy;
  };
}

function frostTextures(size = 512) {
  const octaves = [4, 8, 16, 32, 64].map((p) => ({ p, n: valueNoise(p) }));
  const crackN = valueNoise(12);
  const frostN = valueNoise(6);
  const H = new Float32Array(size * size);
  const F = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let h = 0;
      let amp = 0.5;
      for (const o of octaves) {
        h += o.n(u * o.p, v * o.p) * amp;
        amp *= 0.55;
      }
      // fracture lines: thin ridges where the noise crosses its midpoint
      const c = Math.abs(crackN(u * 12, v * 12) - 0.5);
      h -= Math.max(0, 0.04 - c) * 6;
      H[y * size + x] = h;
      F[y * size + x] = frostN(u * 6, v * 6) * 0.7 + octaves[3].n(u * 32, v * 32) * 0.3;
    }
  }
  const make = (fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    fill(img.data);
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  };
  const idx = (x, y) => ((y + size) % size) * size + ((x + size) % size);
  const normal = make((d) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (H[idx(x + 1, y)] - H[idx(x - 1, y)]) * 6;
        const dy = (H[idx(x, y + 1)] - H[idx(x, y - 1)]) * 6;
        const l = Math.hypot(dx, dy, 1);
        const i = (y * size + x) * 4;
        d[i] = (-dx / l * 0.5 + 0.5) * 255;
        d[i + 1] = (-dy / l * 0.5 + 0.5) * 255;
        d[i + 2] = (1 / l * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    }
  });
  const rough = make((d) => {
    for (let i = 0; i < size * size; i++) {
      const f = F[i];
      const t = Math.min(Math.max((f - 0.42) / 0.25, 0), 1);
      const g = (0.06 + t * t * (3 - 2 * t) * 0.5) * 255;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g;
      d[i * 4 + 3] = 255;
    }
  });
  return { normal, rough };
}

// Rough ice chunk: convex hull of jittered points on a stretched ellipsoid, box-projected uvs.
// The hull's face planes are kept so whatever is frozen inside can be fitted to it.
function crystalGeometry() {
  const pts = [];
  while (pts.length < 90) {
    const v = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1));
    if (v.lengthSq() > 1 || v.lengthSq() < 0.05) continue;
    v.normalize().multiply(new THREE.Vector3(0.82, 1.4, 0.8)).multiplyScalar(rnd(0.9, 1));
    pts.push(v);
  }
  const geo = new ConvexGeometry(pts);
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const planes = [];
  for (let i = 0; i < pos.count; i += 3) {
    const n = new THREE.Vector3().fromBufferAttribute(nor, i);
    const d = n.dot(new THREE.Vector3().fromBufferAttribute(pos, i));
    planes.push(d < 0 ? { n: n.negate(), d: -d } : { n, d });
  }
  geo.userData.planes = planes;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    const [a, b] = nx > ny && nx > nz ? [pos.getZ(i), pos.getY(i)] : ny > nz ? [pos.getX(i), pos.getZ(i)] : [pos.getX(i), pos.getY(i)];
    uv[i * 2] = a * 0.7;
    uv[i * 2 + 1] = b * 0.7;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

const roundedRect = (w, h, r) => {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
};

// What is frozen inside each venture's crystal: a plaque with its mark in relief.
function plaque(glyph, font, plate, relief) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new RoundedBoxGeometry(1.0, 1.2, 0.16, 4, 0.05), plate));
  const ring = roundedRect(0.86, 1.06, 0.14);
  ring.holes.push(roundedRect(0.68, 0.88, 0.08));
  const bevel = { bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2, curveSegments: 6 };
  const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: 0.05, ...bevel }), relief);
  frame.position.z = 0.07;
  const text = new TextGeometry(glyph, { font, size: 0.46, depth: 0.05, ...bevel });
  text.computeBoundingBox();
  const c = text.boundingBox.getCenter(new THREE.Vector3());
  text.translate(-c.x, -c.y, 0);
  const mark = new THREE.Mesh(text, relief);
  mark.position.z = 0.07;
  g.add(frame, mark);
  return g;
}

// Largest uniform scale at which every corner of `box` stays inside the hull, with a margin.
function fitInside(box, planes, margin = 0.85) {
  let k = Infinity;
  const p = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    for (const { n, d } of planes) {
      const reach = n.dot(p);
      if (reach > 1e-6) k = Math.min(k, (d * margin) / reach);
    }
  }
  return k;
}

// Fine triangulated skin laid over the hull, drawn while the crystal is hovered.
function hullWire(planes) {
  const geo = new THREE.IcosahedronGeometry(1, 6);
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let reach = Infinity;
    for (const { n, d } of planes) {
      const k = n.dot(v);
      if (k > 1e-6) reach = Math.min(reach, d / k);
    }
    v.multiplyScalar(reach * 1.004);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  return new THREE.LineSegments(new THREE.WireframeGeometry(geo), material);
}

const inside = (v, planes, margin) => planes.every(({ n, d }) => n.dot(v) < d * margin);

// Air bubbles and specks trapped in the ice; refracted through the crystal's faces.
function inclusions(planes) {
  const n = 260;
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: 0xf4f8ff }), n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1));
    if (v.lengthSq() > 1) { i--; continue; }
    v.multiply(new THREE.Vector3(0.55, 1.05, 0.5));
    if (!inside(v, planes, 0.88)) { i--; continue; }
    const s = Math.pow(Math.random(), 3) * 0.035 + 0.006;
    m.makeScale(s, s * rnd(0.8, 1.6), s).setPosition(v);
    mesh.setMatrixAt(i, m);
  }
  return mesh;
}

// Ice dust drifting through the whole column: opaque specks, so depth of field turns
// the near and far ones into soft bokeh discs.
function iceDust(count = 2600) {
  const pos = new Float32Array(count * 3);
  const rand = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([rnd(-9, 9), rnd(-32, 12), rnd(-7, 5.5)], i * 3);
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
      varying float vB;
      void main() {
        vec3 p = position;
        p.y += uTime * (0.08 + aRand * 0.12);
        p.y = mod(p.y + 32.0, 44.0) - 32.0;
        p.x += sin(uTime * 0.3 + aRand * 40.0) * 0.35;
        p.z += cos(uTime * 0.25 + aRand * 20.0) * 0.25;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (0.012 + aRand * aRand * 0.03) * uPixel / -mv.z;
        vB = 0.75 + 0.25 * sin(uTime * 2.0 + aRand * 60.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vB;
      void main() {
        if (length(gl_PointCoord - 0.5) > 0.5) discard;
        gl_FragColor = vec4(vec3(0.97, 0.98, 1.0) * vB, 1.0);
      }`,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return { points, material };
}

// Thin constellation of nodes and links floating around a crystal.
function constellation() {
  const pts = [];
  for (let i = 0; i < 14; i++) {
    const v = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-0.6, 0.6)).normalize();
    pts.push(v.multiply(new THREE.Vector3(1.5, 1.9, 1.0)).multiplyScalar(rnd(0.85, 1.15)));
  }
  const seg = [];
  pts.forEach((p, i) => {
    const near = pts.map((q, j) => [p.distanceToSquared(q), j]).filter(([, j]) => j !== i).sort((a, b) => a[0] - b[0]);
    for (const [, j] of near.slice(0, 2)) if (j > i) seg.push(p.x, p.y, p.z, pts[j].x, pts[j].y, pts[j].z);
  });
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
  const pg = new THREE.BufferGeometry().setFromPoints(pts);
  // nodes are drawn as small + crosshairs
  const pointMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uSize: { value: 10 } },
    vertexShader: /* glsl */ `
      uniform float uSize;
      void main() { gl_PointSize = uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      void main() {
        vec2 c = abs(gl_PointCoord - 0.5);
        if (min(c.x, c.y) > 0.05) discard;
        gl_FragColor = vec4(vec3(1.0), uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const g = new THREE.Group();
  g.add(new THREE.LineSegments(lg, lineMat), new THREE.Points(pg, pointMat));
  return { group: g, lineMat, pointMat };
}

export class CrystalScene {
  constructor(renderer) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.backdrop = createBackdrop({ dots: 1 });
    this.scene.add(this.backdrop.mesh);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-3, 5, 4);
    this.scene.add(key);

    const { normal, rough } = frostTextures();
    const plate = new THREE.MeshStandardMaterial({ color: 0x6d7886, roughness: 0.6, metalness: 0.05 });
    const relief = new THREE.MeshStandardMaterial({ color: 0xdfe5ec, roughness: 0.45, metalness: 0.05 });
    const font = new FontLoader().parse(fontData);
    this.crystals = [];
    for (let i = 0; i < COUNT; i++) {
      const material = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 1,
        roughnessMap: rough,
        normalMap: normal,
        normalScale: new THREE.Vector2(0.9, 0.9),
        transmission: 1,
        thickness: 1.5,
        ior: 1.31,
        dispersion: 4,
        iridescence: 0.35,
        iridescenceIOR: 1.3,
        attenuationColor: new THREE.Color(0.56, 0.63, 0.72),
        attenuationDistance: 1.3,
        clearcoat: 0.6,
        clearcoatRoughness: 0.2,
        specularIntensity: 1,
      });
      const geo = crystalGeometry();
      const { planes } = geo.userData;
      const mesh = new THREE.Mesh(geo, material);
      mesh.userData.index = i;
      // the plaque is sized to the hull it is frozen in, so no corner ever breaks the surface
      const art = plaque(VENTURES[i].name[0], font, plate, relief);
      art.scale.setScalar(Math.min(1.2, fitInside(new THREE.Box3().setFromObject(art), planes)));
      const bubbles = inclusions(planes);
      const wire = hullWire(planes);
      const net = constellation();
      const group = new THREE.Group();
      const spin = new THREE.Group();
      spin.add(mesh, art, bubbles, wire);
      group.add(spin, net.group);
      group.position.set(X_OFF[i], -i * SPACING, 0);
      group.scale.setScalar(1.25);
      this.scene.add(group);
      this.crystals.push({ group, spin, mesh, art, wire, net, material, hover: 0, seen: false, angle: i * 2.1 });
    }

    this.dust = iceDust();
    this.scene.add(this.dust.points);
    this.raycaster = new THREE.Raycaster();
    this.hovered = -1;
    // v: camera push onto the opened crystal, frost: its surface icing over before the cut,
    // blur: the crystal drifting out of focus; hud: the leaders (they glitch out towards 0)
    this.focus = { v: 0, frost: 0, blur: 0, index: -1 };
    this.hud = { v: 1 };
    this.calloutsVisible = false;
    this.post = { zoom: 0, aberr: 0, warp: 0, dark: 0, dof: { focus: 8.4, aperture: 0.9 } };
    this._v = new THREE.Vector3();
  }

  resize(w, h, pixel) {
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1 ? 58 : 36;
    this.camera.updateProjectionMatrix();
    this.backdrop.material.uniforms.uRes.value.set(w, h);
    this.dust.material.uniforms.uPixel.value = (h * pixel * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    for (const c of this.crystals) c.net.pointMat.uniforms.uSize.value = 10 * pixel;
  }

  // Camera height for scroll s: keeps moving, but lingers while a crystal is centred.
  cameraY(s) {
    // the first crystal rises out of the fog; the last one leaves through the top of the
    // frame while the camera tilts down to the portal
    const u = THREE.MathUtils.clamp(s, -0.3, 1.2) * (COUNT + 1) - 0.66;
    const k = Math.floor(u);
    const f = u - k;
    const g = k + f + 0.1 * Math.sin(Math.PI * 2 * f);
    return 5.5 - g * SPACING;
  }

  clear() {
    if (this.calloutsVisible) callouts.set([]);
    this.calloutsVisible = false;
    if (this.hovered >= 0) {
      this.hovered = -1;
      hoverCrystal.set(-1);
    }
  }

  update({ t, dt, s, mouse, mouseLerp, interactive }) {
    const cam = this.camera;
    let y = this.cameraY(s);
    if (this.focus.index >= 0) y += (-this.focus.index * SPACING - y) * this.focus.v;
    // opened: the crystal is centred behind the project text
    const fv = this.focus.v;
    cam.position.set(mouseLerp.x * 0.4 * (1 - fv), y + mouseLerp.y * 0.25 * (1 - fv), 8.4 - fv * 3.4);
    cam.lookAt(0, y, 0);
    cam.updateMatrixWorld();

    const bu = this.backdrop.material.uniforms;
    bu.uTime.value = t;
    bu.uOffset.value.set(mouseLerp.x * 0.01, -y * 0.045);
    this.dust.material.uniforms.uTime.value = t;
    // pushing in, the crystal itself slides out of focus
    const blur = this.focus.blur;
    this.post.dof.focus = cam.position.distanceTo(this._v.set(0, y, 0)) * (1 + blur * 0.9);
    this.post.dof.aperture = 0.9 + blur * 2.2;
    // the frosting crystal splits into a prismatic fringe just before the cut to dark
    this.post.aberr = this.focus.frost * 0.012 * (1 - this.post.dark);

    // hover
    let hit = -1;
    if (interactive && this.focus.index < 0) {
      this.raycaster.setFromCamera(mouse, cam);
      const hits = this.raycaster.intersectObjects(this.crystals.map((c) => c.mesh), false);
      if (hits.length) hit = hits[0].object.userData.index;
    }
    if (hit !== this.hovered) {
      this.hovered = hit;
      hoverCrystal.set(hit);
      if (hit >= 0) sound.shard();
    }

    const list = [];
    this.crystals.forEach((c, i) => {
      const target = i === this.hovered || i === this.focus.index ? 1 : 0;
      c.hover += (target - c.hover) * damp(dt, 6);
      const cy = -i * SPACING + Math.sin(t * 0.6 + i * 2) * 0.12;
      const rel = cy - y;
      const open = i === this.focus.index ? fv : 0;
      const frost = i === this.focus.index ? this.focus.frost : 0;
      c.group.position.set(X_OFF[i] * (1 - open), cy, 0);
      c.group.rotation.z = TILT[i] + rel * 0.03;
      // the opened crystal all but stops turning
      c.angle += dt * 0.18 * (1 - open * 0.85);
      c.spin.rotation.y = c.angle + mouseLerp.x * 0.35 * (1 - open) + c.hover * 0.6;
      c.spin.rotation.x = rel * 0.05 + mouseLerp.y * 0.15 * (1 - open);
      c.net.group.rotation.y = -t * 0.05 + i;
      c.group.scale.setScalar(1.25 * (1 + c.hover * 0.06 + frost * 0.04));
      c.mesh.material.roughness = 1 - c.hover * 0.25 * (1 - frost);
      c.mesh.material.normalScale.setScalar(0.9 + frost * 2.6);
      c.mesh.material.iridescence = 0.35 + c.hover * 0.4;
      c.wire.material.opacity = c.hover * 0.28 * (1 - open);
      c.wire.visible = c.wire.material.opacity > 0.002;

      // the crystal nearest the centre carries the HUD
      const near = 1 - smooth(2.2, 3.6, Math.abs(rel));
      const hud = this.hud.v;
      c.net.lineMat.opacity = (0.35 + 0.15 * Math.sin(t * 2.2 + i)) * near * hud;
      c.net.pointMat.uniforms.uOpacity.value = 0.9 * near * hud;
      if (near > 0.5 && !c.seen) {
        c.seen = true;
        sound.beeps(5);
      } else if (near < 0.1) c.seen = false;
      if (near > 0.5 && hud > 0.01) {
        ANCHORS.forEach((a, k) => {
          const v = c.group.localToWorld(this._v.set(...a.p)).project(cam);
          // each label only comes up once its anchor is well inside the frame
          if (v.y < -0.86 || v.y > 0.84) return;
          list.push({
            fx: 1 - hud,
            key: `${i}-${k}`,
            crystal: i,
            side: a.side,
            x: (v.x * 0.5 + 0.5) * window.innerWidth,
            y: (-v.y * 0.5 + 0.5) * window.innerHeight,
          });
        });
      }
    });
    if (list.length || this.calloutsVisible) callouts.set(list);
    this.calloutsVisible = list.length > 0;
  }
}
