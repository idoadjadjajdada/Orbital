import * as THREE from 'three';
import type { Body } from '../physics/body';
import { AU_M } from '../physics/units';
import type { V3 } from '../pixel/sprites';
import type { View3D } from './view3d';
import type { Mover } from './ship';
import { bodyQuat, latLonOf, arc } from './ground';
import { tangent } from './terrain';
import { gravity, airAt } from './science';

/**
 * Lander 1, the crewed lander in the hangar, flown by hand. It drops out of
 * the bay doors under the ship and flies on thrust against the gravity of
 * whatever is nearest, holding a hover when you let go of the controls and
 * levelling itself near the ground; L brings it straight down and sets it on
 * its legs. On the ground you can step out and walk, board it again, lift
 * off, and dock back in the hangar by flying within a hundred metres of the
 * ship.
 */

const DOCK_M = 120;
const GIANT = (b: Body) => b.cls === 'gas' || ['gas', 'icegiant', 'hotjupiter', 'browndwarf'].includes(b.look.style);
const SOLID = (b: Body) => !GIANT(b) && !['star', 'wd', 'ns', 'bh', 'gasp'].includes(b.cls) && !b.look.craft && !b.look.wormhole && !b.look.white;

export class Shuttle {
  state: 'docked' | 'flying' | 'landed' = 'docked';
  /** in flight: where, riding with what pulls hardest; its attitude */
  nav: Mover = { anchor: null, off: [0, 0, 0], vel: [0, 0, 0] };
  readonly quat = new THREE.Quaternion();
  /** on the ground: the world, where (body frame), heading (rad from north) */
  b: Body | null = null;
  n: V3 = [0, 0, 1];
  head = 0;
  /** coming straight down by itself */
  autoland = false;
  /** the camera round it */
  camYaw = 0;
  camPitch = 0.3;
  readonly mesh: THREE.Group;
  private toasted = '';

  constructor(private v: View3D) {
    this.mesh = v.ship.hull.lander.clone();
    this.mesh.traverse(o => { o.frustumCulled = false; });
    this.mesh.visible = false;
    v.scene.add(this.mesh);
  }

  get out() { return this.state !== 'docked'; }

  /** out of the bay doors, with you aboard */
  launch() {
    const v = this.v, sh = v.ship;
    if (this.out) { v.app.onToast('Lander 1 is already out'); return; }
    if (sh.worm) { v.app.onToast('Not during a wormhole transit'); return; }
    if (v.landing) { v.app.onToast('The bay doors open onto the ground: lift off first, then launch the lander'); return; }
    const drop = new THREE.Vector3(0.6, -9, 12.5).applyQuaternion(sh.quat), n = sh.nav;
    this.nav = { anchor: n.anchor, off: [n.off[0] + drop.x / AU_M, n.off[1] + drop.y / AU_M, n.off[2] + drop.z / AU_M], vel: [...n.vel] as V3 };
    this.quat.copy(sh.quat);
    this.state = 'flying';
    this.autoland = false;
    sh.hull.lander.visible = false;
    this.v.mode = 'shuttle';
    v.panels.close();
    v.app.onToast('Lander 1 away. WASD and Space/C fly it, the mouse steers, L comes down, F docks back by the ship');
  }

  /** where it is, AU */
  pos(): V3 {
    if (this.state === 'landed' && this.b) return this.at(this.b, this.n, 1.2);
    const a = this.nav.anchor;
    return [(a?.x ?? 0) + this.nav.off[0], (a?.y ?? 0) + this.nav.off[1], (a?.z ?? 0) + this.nav.off[2]];
  }

  /** the point (AU) `h` m above the ground at `n` on a world */
  at(b: Body, n: V3, h: number): V3 {
    const r = b.r * AU_M + (SOLID(b) ? this.v.fleet.heightAt(b, n, 1) : 0) + h;
    const p = new THREE.Vector3(n[0] * r, n[1] * r, n[2] * r).applyQuaternion(bodyQuat(b));
    return [b.x + p.x / AU_M, b.y + p.y / AU_M, b.z + p.z / AU_M];
  }

  /** over a world: direction (body frame) and distance from its centre, m */
  over(b: Body, p: V3) {
    const d = new THREE.Vector3((p[0] - b.x) * AU_M, (p[1] - b.y) * AU_M, (p[2] - b.z) * AU_M).applyQuaternion(bodyQuat(b).invert());
    const r = d.length() || 1;
    return { n: [d.x / r, d.y / r, d.z / r] as V3, r };
  }

  /** the world below and the height over its ground, m */
  agl(): { b: Body | null; h: number } {
    const P = this.pos(), { b } = this.v.nearest(P);
    if (!b) return { b: null, h: Infinity };
    const o = this.over(b, P);
    return { b, h: o.r - b.r * AU_M - (SOLID(b) ? this.v.fleet.heightAt(b, o.n, 1) : 0) };
  }

  /** each frame; `hand` is whether you are at its controls */
  step(dt: number, hand: boolean) {
    if (this.state !== 'flying') return;
    const v = this.v, nav = this.nav;
    // ride with what pulls hardest
    const P = this.pos(), near = v.nearest(P).b;
    if (near && near !== nav.anchor) { nav.off = [P[0] - near.x, P[1] - near.y, P[2] - near.z]; nav.anchor = near; }
    const b = nav.anchor;
    const vel = new THREE.Vector3(...nav.vel);
    const want = hand ? v.controls.thrust(1, this.quat) : [0, 0, 0] as V3;
    const idle = Math.abs(want[0]) + Math.abs(want[1]) + Math.abs(want[2]) < 1e-3;
    if (!idle) this.autoland = false;
    const acc = new THREE.Vector3(...want).multiplyScalar(12);
    let up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat), agl = Infinity;
    if (b) {
      const o = this.over(b, P), solid = SOLID(b);
      agl = o.r - b.r * AU_M - (solid ? v.fleet.heightAt(b, o.n, 1) : 0);
      up = new THREE.Vector3(...o.n).applyQuaternion(bodyQuat(b));
      const g = gravity(b) * Math.pow(b.r * AU_M / o.r, 2);
      acc.addScaledVector(up, -g);
      if (this.autoland && solid) {
        // straight down, slowing as the ground comes up
        acc.addScaledVector(up, g);
        vel.lerp(up.clone().multiplyScalar(-Math.max(1.2, Math.min(120, agl * 0.18))), Math.min(1, dt * 1.5));
      } else if (agl < 5e4) {
        // the hover hold: the engines cancel gravity near a world, and with nothing asked for it settles to a stop
        acc.addScaledVector(up, g);
        if (idle) vel.multiplyScalar(Math.max(0, 1 - dt * 0.6));
      }
      // level itself low down
      if (agl < 3000) {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
        fwd.addScaledVector(up, -fwd.dot(up));
        if (fwd.lengthSq() > 1e-8) {
          fwd.normalize();
          const x = new THREE.Vector3().crossVectors(fwd, up);
          this.quat.slerp(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, fwd.clone().negate())), Math.min(1, dt * 1.5));
        }
      }
      // air drag
      const a = v.fleet.air(b);
      if (solid && a.bar > 0) { const s = airAt(a, gravity(b), Math.max(0, agl) / 1000); vel.multiplyScalar(Math.max(0, 1 - dt * Math.min(2, s.bar * 0.3))); }
      // a giant has no ground, and its depths crush the lander
      if (GIANT(b) && agl < -60000 && this.toasted !== 'deep') { this.toasted = 'deep'; v.app.onToast('Lander 1: hull groaning. Climb!'); }
    }
    vel.addScaledVector(acc, dt);
    nav.vel = [vel.x, vel.y, vel.z];
    for (let k = 0; k < 3; k++) nav.off[k] += (nav.vel[k] * dt) / AU_M;
    // touching down
    if (b && SOLID(b) && agl < 1.3) {
      const o = this.over(b, this.pos());
      const speed = vel.length();
      this.b = b; this.n = o.n; this.state = 'landed'; this.autoland = false;
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
      this.head = this.heading(b, o.n, f);
      nav.vel = [0, 0, 0];
      v.app.onToast(speed > 5 ? `Hard landing on ${b.name}, ${speed.toFixed(0)} m/s: the legs held` : `Lander 1 down on ${b.name}. F steps out; Space lifts off`);
    }
  }

  /** the compass heading (rad, from north towards east) of a world direction at `n` */
  private heading(b: Body, n: V3, w: THREE.Vector3) {
    const d = w.clone().applyQuaternion(bodyQuat(b).invert());
    const [e, nn] = tangent(n);
    return Math.atan2(d.x * e[0] + d.y * e[1] + d.z * e[2], d.x * nn[0] + d.y * nn[1] + d.z * nn[2]);
  }

  /** L: come down, or lift off if down */
  land() {
    const v = this.v;
    if (this.state === 'landed') { this.liftOff(); return; }
    const { b } = this.agl();
    if (!b || !SOLID(b)) { v.app.onToast(b && GIANT(b) ? 'No ground in a giant: the lander would sink until it was crushed' : 'Nothing below to land on'); return; }
    this.autoland = true;
    v.app.onToast(`Lander 1 coming down on ${b.name}`);
  }

  private liftOff() {
    const b = this.b!;
    const p = this.at(b, this.n, 2), up = new THREE.Vector3(...this.n).applyQuaternion(bodyQuat(b));
    this.nav = { anchor: b, off: [p[0] - b.x, p[1] - b.y, p[2] - b.z], vel: [up.x * 6, up.y * 6, up.z * 6] };
    this.state = 'flying';
    this.v.app.onToast('Lifting off');
  }

  /** at the controls: what F does */
  prompt(): { label: string; act: () => void } | null {
    if (this.state === 'landed') return { label: 'Step out', act: () => this.stepOut() };
    if (this.state === 'flying') {
      const S = this.v.shipPos(), P = this.pos();
      if (Math.hypot(S[0] - P[0], S[1] - P[1], S[2] - P[2]) * AU_M < DOCK_M) return { label: 'Dock with the ship', act: () => this.dock() };
    }
    return null;
  }

  /** onto the ground beside it */
  stepOut() {
    const v = this.v, b = this.b;
    if (!b || this.state !== 'landed') return;
    const R = b.r * AU_M, [e, nn] = tangent(this.n);
    // four metres off to its side
    const side: V3 = [e[0] * Math.cos(this.head) - nn[0] * Math.sin(this.head), e[1] * Math.cos(this.head) - nn[1] * Math.sin(this.head), e[2] * Math.cos(this.head) - nn[2] * Math.sin(this.head)];
    let n: V3 = [this.n[0] + side[0] * 4 / R, this.n[1] + side[1] * 4 / R, this.n[2] + side[2] * 4 / R];
    const l = Math.hypot(...n);
    n = [n[0] / l, n[1] / l, n[2] / l];
    v.toSurface(n, -(this.head + Math.PI / 2));
    v.app.onToast(`On ${b.name}. Walk back to Lander 1 to board it`);
  }

  /** a walker close enough to board it? */
  near(b: Body | null, n: V3) {
    return this.state === 'landed' && !!b && b === this.b && arc(n, this.n) * b.r * AU_M < 6;
  }

  board() {
    this.v.mode = 'shuttle';
    this.v.app.onToast('Aboard Lander 1. Space lifts off');
  }

  /** back into the hangar */
  dock() {
    const v = this.v;
    this.state = 'docked';
    this.autoland = false;
    v.ship.hull.lander.visible = true;
    v.mode = 'walk';
    v.foot.deck = 1;
    v.foot.p.set(-2.6, 0, 12.5);
    v.foot.yaw = -Math.PI / 2; v.foot.pitch = 0;
    v.app.onToast('Docked. Lander 1 is back in the hangar');
  }

  turn(yaw: number, pitch: number) {
    if (this.state === 'flying') {
      const t = new THREE.Quaternion();
      t.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw); this.quat.multiply(t);
      t.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch); this.quat.multiply(t);
      this.quat.normalize();
    } else {
      this.camYaw -= yaw;
      this.camPitch = Math.max(-0.2, Math.min(1.4, this.camPitch + pitch));
    }
  }

  /** draw it from a viewer at `P` (AU) */
  draw(P: V3) {
    const m = this.mesh;
    m.visible = this.out;
    if (!this.out) return;
    const p = this.pos();
    m.position.set((p[0] - P[0]) * AU_M, (p[1] - P[1]) * AU_M, (p[2] - P[2]) * AU_M - 0);
    if (this.state === 'landed' && this.b) {
      const b = this.b, base = this.at(b, this.n, 0);
      m.position.set((base[0] - P[0]) * AU_M, (base[1] - P[1]) * AU_M, (base[2] - P[2]) * AU_M);
      const [e, nn] = tangent(this.n), q = bodyQuat(b);
      const fwd = new THREE.Vector3(nn[0] * Math.cos(this.head) + e[0] * Math.sin(this.head), nn[1] * Math.cos(this.head) + e[1] * Math.sin(this.head), nn[2] * Math.cos(this.head) + e[2] * Math.sin(this.head)).applyQuaternion(q);
      const up = new THREE.Vector3(...this.n).applyQuaternion(q), z = fwd.negate(), x = new THREE.Vector3().crossVectors(up, z);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z));
    } else m.quaternion.copy(this.quat);
  }

  /** the camera behind and above it; sets its attitude, returns where it is */
  view(cam: THREE.Camera): Mover {
    const P = this.pos();
    const q = this.state === 'landed' && this.b ? this.mesh.quaternion : this.quat;
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const off = back.clone().applyAxisAngle(up, this.camYaw).multiplyScalar(Math.cos(this.camPitch) * 18).addScaledVector(up, Math.sin(this.camPitch) * 18 + 2);
    const eye = off.clone();
    cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, new THREE.Vector3(0, 1.5, 0).applyQuaternion(q), up));
    const a = this.state === 'landed' ? this.b : this.nav.anchor;
    return { anchor: a, off: [P[0] + off.x / AU_M - (a?.x ?? 0), P[1] + off.y / AU_M - (a?.y ?? 0), P[2] + off.z / AU_M - (a?.z ?? 0)], vel: [0, 0, 0] };
  }

  /** a line for the readout */
  status(): string {
    if (this.state === 'docked') return 'in the hangar';
    if (this.state === 'landed' && this.b) { const [la, lo] = latLonOf(this.n); return `on ${this.b.name} · ${Math.abs(la).toFixed(2)}°${la >= 0 ? 'N' : 'S'} ${Math.abs(lo).toFixed(2)}°${lo >= 0 ? 'E' : 'W'}`; }
    const { b, h } = this.agl();
    return b ? `${this.autoland ? 'coming down' : 'flying'} · ${h < 1000 ? `${h.toFixed(0)} m` : `${(h / 1000).toFixed(1)} km`} over ${b.name}` : 'flying';
  }
}
