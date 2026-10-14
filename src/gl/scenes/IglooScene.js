import * as THREE from 'three';
import {
  createDome, createWireIgloo, createPlexus, createSnow, createGround, createDrift,
  createMountains, createSky, createClouds, createMist, createLensFlakes, DOME_RADIUS, DOOR,
} from '../World.js';
import { domeLabels } from '../../state.js';
import { sound } from '../../audio/Sound.js';
import { smooth, damp } from '../util.js';

const LIFT_LABELS = 4;
const UP = new THREE.Vector3(0, 0.6, 0);
// Three-quarter view from a low ridge: igloo a little left of centre, door to the right.
const BASE_POS = new THREE.Vector3(-4.6, 8.2, 25.5);
const BASE_LOOK = new THREE.Vector3(0.9, 2.4, 0);
// Intro: the structure is first seen from high above, then the camera swoops down.
const HIGH_POS = new THREE.Vector3(3, 34, 24);
const HIGH_LOOK = new THREE.Vector3(0, 0.5, 0);

export class IglooScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);

    this.dome = createDome();
    this.wire = createWireIgloo(this.dome.matrices);
    this.plexus = createPlexus();
    this.snow = createSnow(22000);
    this.ground = createGround();
    this.drift = createDrift(22000);
    this.mountains = createMountains();
    this.sky = createSky();
    this.clouds = createClouds();
    this.mist = createMist();
    this.flakes = createLensFlakes();
    this.camera.add(this.flakes.points);
    this.measure = this.createMeasureLines();
    this.scene.add(
      this.sky, this.mountains, this.ground.mesh, this.dome.mesh, this.wire.lines, this.plexus.group,
      this.snow.points, this.drift.points, this.mist.group, this.clouds.group, this.measure, this.camera
    );

    // before the intro runs nothing but the grey void is on screen
    this.ground.material.uniforms.uRevealR.value = -20;
    this.mountains.material.uniforms.uRevealR.value = -60;
    this.snow.points.visible = this.drift.points.visible = false;

    this.intro = { cam: 1, push: 1, pulse: 0, done: false };
    this.raycaster = new THREE.Raycaster();
    const n = this.dome.blocks.length;
    this.lift = { value: new Float32Array(n), vel: new Float32Array(n), up: new Uint8Array(n) };
    this.liftAttr = this.dome.mesh.geometry.getAttribute('aLift');
    this.domeHit = new THREE.Vector3();
    this.domeHover = 0;
    this.domeShell = new THREE.Sphere(new THREE.Vector3(0, 0, 0), DOME_RADIUS + 0.4);
    this.domeDoor = new THREE.Sphere(DOOR.clone(), 1.9);
    this.lastShard = 0;
    this.labelsVisible = false;
    this.wind = { t: 0, gust: 0 };
    this.post = { zoom: 0, aberr: 0, warp: 0, dof: { focus: 26, aperture: 0.45 } };
    this.reveal = { env: 0 };
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._look = new THREE.Vector3();
  }

  // Lines drawn from each lifted brick back to its seat, with cross ticks at both ends.
  createMeasureLines() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LIFT_LABELS * 6 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false,
    }));
    lines.frustumCulled = false;
    lines.renderOrder = 10;
    return lines;
  }

  // Grey void -> wireframe scan -> plexus spreads -> bricks solidify -> snow field
  // grows out -> camera swoops down -> the joints flare.
  start(tl) {
    const wire = this.wire.material.uniforms;
    const plex = this.plexus.material.uniforms;
    tl.to(wire.uShow, { value: 1, duration: 0.9, ease: 'power1.out' }, 0.4)
      .to(plex.uRadius, { value: 36, duration: 1.6, ease: 'power1.out' }, 0.7)
      .to(this.dome.material.uniforms.uReveal, { value: 1, duration: 1.1, ease: 'power2.out' }, 1.2)
      .to(wire.uAlpha, { value: 0, duration: 0.8 }, 1.9)
      .to(this.intro, { push: 0, duration: 2.4, ease: 'none' }, 0)
      .to(this.ground.material.uniforms.uRevealR, { value: 60, duration: 1.0, ease: 'power1.in' }, 2.0)
      .to(this.ground.material.uniforms.uRevealR, { value: 400, duration: 1.0, ease: 'power2.in' }, 3.0)
      .to(this.mountains.material.uniforms.uRevealR, { value: 420, duration: 1.6, ease: 'power2.in' }, 2.6)
      .add(() => { this.snow.points.visible = this.drift.points.visible = true; }, 3.0)
      .to(this.reveal, { env: 1, duration: 1.8, ease: 'power1.inOut' }, 3.0)
      .to(plex.uFade, { value: 1, duration: 1.0 }, 2.6)
      .to(this.intro, { cam: 0, duration: 2.6, ease: 'power2.inOut' }, 2.2)
      .to(this.intro, { pulse: 1, duration: 0.7, ease: 'power2.out' }, 3.8)
      .to(this.intro, { pulse: 0, duration: 1.6, ease: 'power2.inOut' }, 4.6)
      .add(() => {
        this.intro.done = true;
        this.plexus.group.visible = this.wire.lines.visible = false;
      }, 4.8);
  }

  resize(w, h, pixel) {
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1 ? 58 : 36;
    this.camera.updateProjectionMatrix();
    const px = (h * pixel * 0.5) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    for (const m of [this.snow.material, this.drift.material, this.flakes.material]) m.uniforms.uPixel.value = px;
    this.plexus.material.uniforms.uPoint.value = 3 * pixel;
  }

  updateDome(dt, mouse, active) {
    const { blocks } = this.dome;
    const { value, vel, up } = this.lift;
    let hit = null;
    if (active) {
      this.raycaster.setFromCamera(mouse, this.camera);
      const ray = this.raycaster.ray;
      const a = ray.intersectSphere(this.domeShell, this._a);
      const b = ray.intersectSphere(this.domeDoor, this._b);
      hit = a && b ? (a.distanceToSquared(ray.origin) < b.distanceToSquared(ray.origin) ? a : b) : a || b;
      if (hit && hit.y < -0.2) hit = null;
    }
    if (hit) {
      if (this.domeHover < 0.05) this.domeHit.copy(hit);
      else this.domeHit.lerp(hit, damp(dt, 14));
    }
    this.domeHover += ((hit ? 1 : 0) - this.domeHover) * damp(dt, 4);

    // bricks around the cursor pop out of the shell and hang there, glowing
    let moving = false;
    for (let i = 0; i < blocks.length; i++) {
      const bl = blocks[i];
      const d = bl.center.distanceTo(this.domeHit);
      const target = this.domeHover * smooth(2.6, 0.4, d) * (0.5 + bl.rand * 0.9);
      vel[i] += ((target - value[i]) * 90 - vel[i] * 11) * dt;
      value[i] += vel[i] * dt;
      if (Math.abs(value[i]) > 1e-4 || Math.abs(vel[i]) > 1e-4) moving = true;
      else value[i] = vel[i] = 0;
      if (target > 0.4 && !up[i]) {
        up[i] = 1;
        const now = performance.now();
        if (now - this.lastShard > 160) {
          this.lastShard = now;
          sound.shard();
        }
      } else if (target < 0.15) up[i] = 0;
    }
    if (moving || this.labelsVisible) {
      this.liftAttr.array.set(value);
      this.liftAttr.needsUpdate = true;
    }

    const top = [];
    for (let i = 0; i < blocks.length; i++) if (value[i] > 0.12) top.push(i);
    top.sort((x, y) => value[y] - value[x]);
    top.length = Math.min(top.length, LIFT_LABELS);
    const pos = this.measure.geometry.getAttribute('position');
    const labels = [];
    top.forEach((i, k) => {
      const bl = blocks[i];
      const offset = this._a.copy(bl.dir).add(UP).multiplyScalar(value[i]);
      const end = this._b.copy(bl.center).add(offset);
      const side = new THREE.Vector3().crossVectors(bl.dir, UP).normalize().multiplyScalar(0.16);
      pos.array.set([
        bl.center.x, bl.center.y, bl.center.z, end.x, end.y, end.z,
        bl.center.x - side.x, bl.center.y - side.y, bl.center.z - side.z, bl.center.x + side.x, bl.center.y + side.y, bl.center.z + side.z,
        end.x - side.x, end.y - side.y, end.z - side.z, end.x + side.x, end.y + side.y, end.z + side.z,
      ], k * 18);
      const a = bl.center.clone().project(this.camera);
      const v = end.project(this.camera);
      labels.push({
        id: i,
        d: Math.round(offset.length() * 40 + bl.rand * 9),
        x: (v.x * 0.5 + 0.5) * window.innerWidth,
        y: (-v.y * 0.5 + 0.5) * window.innerHeight,
        ax: (a.x * 0.5 + 0.5) * window.innerWidth,
        ay: (-a.y * 0.5 + 0.5) * window.innerHeight,
      });
    });
    pos.needsUpdate = true;
    this.measure.geometry.setDrawRange(0, top.length * 6);
    if (labels.length || this.labelsVisible) domeLabels.set(labels);
    this.labelsVisible = labels.length > 0;
  }

  clearLabels() {
    if (this.labelsVisible) domeLabels.set([]);
    this.labelsVisible = false;
  }

  update({ t, dt, s, mouse, mouseLerp, vel, interactive }) {
    // scroll: a cloud deck rises out of the valley and swallows the igloo
    const rise = smooth(0, 1, s);

    const cam = this.camera;
    const e = this.intro.cam;
    const pos = cam.position.lerpVectors(BASE_POS, HIGH_POS, e);
    const look = this._look.lerpVectors(BASE_LOOK, HIGH_LOOK, e);
    // while the structure is drawn the camera creeps in from further out
    pos.lerp(HIGH_LOOK, -this.intro.push * 0.25);
    // slow idle drift, like a held handheld shot
    const idle = 1 - e;
    pos.x += Math.sin(t * 0.07) * 0.7 * idle;
    pos.y += Math.sin(t * 0.11) * 0.15 * idle;
    pos.z += Math.cos(t * 0.05) * 0.5 * idle;
    // faint handheld breathing
    pos.x += (Math.sin(t * 1.31) * 0.6 + Math.sin(t * 2.17) * 0.4) * 0.02 * idle;
    pos.y += (Math.sin(t * 1.73) * 0.6 + Math.sin(t * 2.91) * 0.4) * 0.015 * idle;
    pos.z -= rise * 6;
    pos.y -= rise * 1.5;
    look.y -= rise * 1.2;
    cam.lookAt(look);
    cam.translateX(mouseLerp.x * 0.6 * idle);
    cam.translateY(mouseLerp.y * 0.3 * idle);
    cam.rotateZ(-mouseLerp.x * 0.01 * idle);
    cam.updateMatrixWorld();
    this.sky.position.copy(cam.position);

    const live = interactive && this.intro.done && s < 0.05;
    this.updateDome(dt, mouse, live);

    const dm = this.dome.material.uniforms;
    dm.uTime.value = t;
    dm.uGlow.value = Math.max(this.intro.pulse, 0.12 + this.domeHover * 0.55);
    this.ground.material.uniforms.uCoreIntensity.value = dm.uGlow.value * 0.6;
    this.ground.material.uniforms.uTime.value = t;
    this.clouds.material.uniforms.uTime.value = t;
    this.clouds.material.uniforms.uDensity.value = smooth(0.0, 0.35, s);
    this.clouds.group.position.y = -14 + rise * 17;
    this.clouds.group.visible = s > 0.001;
    this.post.aberr = smooth(0.12, 0.8, s) * 0.012;
    this.post.dof.focus = cam.position.distanceTo(this._a.set(0, 2, 0));
    this.post.dof.aperture = 0.45 * idle;
    this.mist.material.uniforms.uTime.value = t;
    this.mist.material.uniforms.uShow.value = this.reveal.env * (1 - rise);
    this.flakes.material.uniforms.uTime.value = t;
    this.flakes.material.uniforms.uShow.value = this.reveal.env;
    this.flakes.material.uniforms.uWind.value = this.wind.gust;

    // wind: slow gust cycle, pushed harder by scrolling
    const cycle = Math.pow(0.5 + 0.5 * Math.sin(t * 0.32 + Math.sin(t * 0.11) * 2.5), 3);
    const gust = Math.min(1, cycle + Math.min(vel * 2, 0.8));
    this.wind.gust += (gust - this.wind.gust) * damp(dt, 2);
    this.wind.t += dt * (0.5 + this.wind.gust * 2.5);
    for (const m of [this.ground.material, this.drift.material, this.snow.material]) {
      m.uniforms.uWindT.value = this.wind.t;
      m.uniforms.uGust.value = this.wind.gust;
    }
    const fwd = cam.getWorldDirection(this._a);
    this.drift.material.uniforms.uCenter.value.set(pos.x + fwd.x * 14, pos.z + fwd.z * 14);
    this.drift.material.uniforms.uTime.value = t;
    this.snow.material.uniforms.uTime.value = t;
    this.snow.material.uniforms.uWind.value += (Math.min(vel * 2, 2) - this.snow.material.uniforms.uWind.value) * dt;
    sound.setWind(Math.max(this.wind.gust * 0.6, Math.min(vel * 3, 1)));
  }
}
