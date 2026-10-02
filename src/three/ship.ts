import * as THREE from 'three';
import type { Body } from '../physics/body';
import { AU_M, C } from '../physics/units';

/** the speed of light, m/s */
export const C_MS = (C * AU_M) / (365.25 * 86400);
/** top speed on the ordinary drive, m/s */
export const CRUISE = 0.05 * C_MS;
/** top speed in overdrive, m/s */
export const OD_MAX = 1e4 * C_MS;
/** seconds to charge a jump, and to refill the jump capacitor after one */
export const JUMP_CHARGE = 2.5, JUMP_REFILL = 40;

/**
 * The ship: its drives and how it looks.
 *
 * The ordinary drive tops out at 5% of light speed, enough to cross from a
 * world to its moons in under a minute. Overdrive is a warp: it spools up
 * over a few seconds towards ten thousand times light speed, but is held back
 * near anything massive (never faster than three times the height above the
 * nearest surface per second), so it carries you across a system and slows
 * by itself on the way in. The jump drive folds space to the selected body
 * outright, but needs time to recharge between jumps.
 */
export class Ship {
  /** overdrive engaged, and how far it has spooled (0–1) */
  od = false;
  odLevel = 0;
  /** jump capacitor, 0–1; a jump needs it full */
  charge = 1;
  /** a jump being charged */
  jump: { b: Body; t: number } | null = null;
  /** seconds of the arrival flash left */
  flash = 0;
  view: 'chase' | 'cockpit' = 'chase';
  /** how hard the engines push, 0–1, for the exhaust */
  thrust = 0;

  readonly mesh: THREE.Group;
  private flame: THREE.Sprite;
  private light = new THREE.DirectionalLight(0xffffff, 2.2);
  private ambient = new THREE.AmbientLight(0x404858, 1.2);
  private streaks: THREE.LineSegments;
  private seeds: Float32Array;

  constructor(camera: THREE.PerspectiveCamera, scene: THREE.Scene, glow: THREE.Texture) {
    this.mesh = buildShip();
    this.flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0x7fb4ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flame.position.set(0, 0, 6);
    this.mesh.add(this.flame);
    this.mesh.position.set(0, -3.6, -17);
    camera.add(this.mesh);
    camera.add(this.light);
    camera.add(this.light.target);
    scene.add(this.ambient);
    scene.add(camera);

    // streaks: short lines around the viewer, swept past along the motion
    const n = 400;
    this.seeds = new Float32Array(n * 3);
    for (let k = 0; k < n * 3; k++) this.seeds[k] = (Math.random() * 2 - 1) * 400;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    this.streaks = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc8d8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.streaks.frustumCulled = false;
    scene.add(this.streaks);
  }

  /** the speed the drive allows here, m/s, given the height above the nearest surface */
  cap(alt: number) {
    const a = Math.max(1, isFinite(alt) ? alt : 1e16);
    if (this.odLevel <= 0) return CRUISE;
    const top = CRUISE * Math.pow(OD_MAX / CRUISE, this.odLevel);
    return Math.max(CRUISE, Math.min(top, 3 * a * this.odLevel));
  }

  /** whether a jump can start now */
  ready() { return this.charge >= 1 && !this.jump; }

  startJump(b: Body) {
    if (!this.ready() || !b.alive) return false;
    this.jump = { b, t: 0 };
    this.od = false;
    return true;
  }

  /** advance the drives; returns the body to arrive at if a jump completes this frame */
  update(dt: number): Body | null {
    const spool = this.od ? Math.min(1, this.odLevel + dt / 3) : Math.max(0, this.odLevel - dt / 0.8);
    this.odLevel = spool;
    this.flash = Math.max(0, this.flash - dt);
    if (!this.jump) { this.charge = Math.min(1, this.charge + dt / JUMP_REFILL); return null; }
    this.jump.t += dt;
    if (!this.jump.b.alive) { this.jump = null; return null; }
    if (this.jump.t < JUMP_CHARGE) return null;
    const b = this.jump.b;
    this.jump = null;
    this.charge = 0;
    this.flash = 1.2;
    return b;
  }

  /** draw: the hull in chase view, exhaust, warp streaks; `vel` is the viewer's velocity (m/s), `sun` the direction to the main light */
  draw(dt: number, camera: THREE.PerspectiveCamera, vel: [number, number, number], sun: THREE.Vector3 | null) {
    this.mesh.visible = this.view === 'chase';
    const warp = Math.max(this.odLevel, this.jump ? this.jump.t / JUMP_CHARGE : 0);
    this.flame.scale.setScalar(1.2 + 2.5 * this.thrust + 2.5 * warp);
    (this.flame.material as THREE.SpriteMaterial).color.setHex(this.jump ? 0xc890ff : warp > 0.05 ? 0xe0e8ff : 0x7fb4ff);
    // a little wobble to the hull as it flies
    const t = performance.now() / 1000;
    this.mesh.rotation.z = Math.sin(t * 0.7) * 0.02;
    this.mesh.position.y = -3.6 + Math.sin(t * 1.1) * 0.06;

    if (sun) {
      const l = sun.clone().applyQuaternion(camera.quaternion.clone().invert());
      this.light.position.copy(l.multiplyScalar(-50));
      this.light.target.position.set(0, 0, 0);
      this.light.intensity = 2.2;
    } else this.light.intensity = 0.4;

    // field of view widens with the warp
    const fov = 70 + 30 * warp;
    if (Math.abs(camera.fov - fov) > 0.1) { camera.fov = fov; camera.updateProjectionMatrix(); }

    // streaks along the motion
    const sp = Math.hypot(vel[0], vel[1], vel[2]);
    const show = Math.max(warp, Math.min(1, Math.max(0, Math.log10(sp / 1e5) / 4)));
    const mat = this.streaks.material as THREE.LineBasicMaterial;
    mat.opacity = Math.min(0.9, show);
    mat.color.setHex(this.jump ? 0xc890ff : 0xc8d8ff);
    this.streaks.visible = show > 0.02;
    if (!this.streaks.visible) return;
    const dir = sp > 0 ? [vel[0] / sp, vel[1] / sp, vel[2] / sp] : (() => { const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); return [f.x, f.y, f.z]; })();
    const visSp = 60 + 3000 * show, len = 2 + 160 * show * show;
    const s = this.seeds, a = (this.streaks.geometry.getAttribute('position') as THREE.BufferAttribute);
    const out = a.array as Float32Array;
    for (let k = 0; k < s.length; k += 3) {
      for (let j = 0; j < 3; j++) {
        s[k + j] -= dir[j] * visSp * dt;
        if (s[k + j] > 400) s[k + j] -= 800; else if (s[k + j] < -400) s[k + j] += 800;
      }
      out[k * 2] = s[k]; out[k * 2 + 1] = s[k + 1]; out[k * 2 + 2] = s[k + 2];
      out[k * 2 + 3] = s[k] + dir[0] * len; out[k * 2 + 4] = s[k + 1] + dir[1] * len; out[k * 2 + 5] = s[k + 2] + dir[2] * len;
    }
    a.needsUpdate = true;
  }
}

/** a small, chunky ship: a hull, swept wings, a cockpit, two engines; faces −z */
function buildShip() {
  const g = new THREE.Group();
  const hullM = new THREE.MeshLambertMaterial({ color: 0xc9ccd4, flatShading: true });
  const darkM = new THREE.MeshLambertMaterial({ color: 0x4a5162, flatShading: true });
  const accent = new THREE.MeshLambertMaterial({ color: 0xd8643a, flatShading: true });
  const glass = new THREE.MeshBasicMaterial({ color: 0x5fd0ff });
  const wingM = new THREE.MeshLambertMaterial({ color: 0xb4b8c2, flatShading: true, side: THREE.DoubleSide });

  const hull = new THREE.Mesh(new THREE.ConeGeometry(1.1, 7, 6), hullM);
  hull.rotation.x = -Math.PI / 2;
  g.add(hull);
  const back = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 2.4, 6), darkM);
  back.rotation.x = Math.PI / 2;
  back.position.z = 4.6;
  g.add(back);
  const cock = new THREE.Mesh(new THREE.SphereGeometry(0.62, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  cock.scale.set(1, 0.8, 2);
  cock.position.set(0, 0.55, 0.2);
  g.add(cock);
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, -1.5); wingShape.lineTo(4.6, 2.8); wingShape.lineTo(4.6, 3.8); wingShape.lineTo(0, 3.2);
  const wingG = new THREE.ExtrudeGeometry(wingShape, { depth: 0.18, bevelEnabled: false });
  for (const s of [1, -1]) {
    const w = new THREE.Mesh(wingG, wingM);
    w.rotation.x = Math.PI / 2;
    w.scale.x = s;
    w.position.set(s * 0.5, -0.1, 0);
    g.add(w);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 1.4), accent);
    tip.position.set(s * 5.0, 0.2, 3.1);
    g.add(tip);
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 2.2, 6), darkM);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(s * 1.6, -0.25, 3.9);
    g.add(eng);
  }
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.6, 2.2), accent);
  fin.position.set(0, 1.2, 4.1);
  g.add(fin);
  g.scale.setScalar(0.75);
  return g;
}
