import * as THREE from 'three';
import type { Body } from '../physics/body';
import { AU_M, MSUN_KG } from '../physics/units';
import type { V3 } from '../pixel/sprites';
import { starRGB } from '../pixel/sprites';
import type { View3D } from './view3d';
import type { Mover } from './ship';
import { Ground, frameOf, toWorld, toLocal, quatOf, type SkyState } from './ground';
import { tangent } from './terrain';
import { atmosphereOf, airAt, type Atmosphere } from './science';
import { HATCH_OUT } from './hull';
import { Weather } from './giant';

/**
 * Being near the ground of a world: the terrain and sky (see ground.ts), the
 * ship coming down on its legs and standing on the surface as the world
 * turns, taking off again, and walking about outside in the world's own
 * gravity.
 */

/** the ship's legs: how far below its middle the feet are when they are down, m */
export const LEG_DROP = 6.6;
/** the most the hull can stand: heat (K), pressure (bar), gravity (g) */
export const HULL = { K: 700, bar: 50, g: 2.5 };
const G = 6.674e-11;

/** surface gravity, m/s² */
export const gravity = (b: Body) => G * b.m * MSUN_KG / (b.r * AU_M) ** 2;

/** solid ground to stand on: not a star, a hole, a giant, a craft or a wormhole */
export const solid = (b: Body) => !['star', 'wd', 'ns', 'bh', 'gas', 'gasp'].includes(b.cls) && !['gas', 'icegiant', 'hotjupiter', 'browndwarf'].includes(b.look.style) && !b.look.craft && !b.look.wormhole && !b.look.white;
export const giant = (b: Body) => b.cls === 'gas' || ['gas', 'icegiant', 'hotjupiter', 'browndwarf'].includes(b.look.style);

const NO_SKY: SkyState = { strength: 0, zenith: [0, 0, 0], horizon: [0, 0, 0], sunset: [0, 0, 0], haze: 0, inside: 0, deepTop: [0, 0, 0], deepLow: [0, 0, 0], glow: 1, flash: 0 };

export interface Walker { b: Body; n: V3; yaw: number; pitch: number; h: number; vh: number }

export class Landing {
  readonly ground: Ground;
  /** the weather inside a giant */
  readonly weather: Weather;
  /** a giant the viewer is in (or just over): how far above its 1-bar level (m), and where over it */
  giantBody: Body | null = null;
  giantAlt = Infinity;
  private giantN: V3 = [0, 0, 1];
  private lastT = performance.now();
  /** the world the ground is drawn for, the viewer's direction over it (body frame) and height above the ground, m */
  body: Body | null = null;
  n: V3 = [0, 0, 1];
  agl = Infinity;
  /** the ship's height above the ground there (to its middle, m), and the world under it */
  shipAgl = Infinity;
  shipBody: Body | null = null;
  sky: SkyState = NO_SKY;
  /** the ship standing on a world: where (body frame) and its attitude to the world's frame */
  landed: { b: Body; n: V3; q: THREE.Quaternion } | null = null;
  /** coming down or going up by itself */
  auto: 'land' | 'takeoff' | null = null;
  /** on foot outside */
  walker: Walker | null = null;
  /** the atmosphere of the world below, kept while it is the same world */
  private atmo: { b: Body; a: Atmosphere } | null = null;
  private warned = '';
  private light: THREE.Vector3 | null = null;
  /** how high the star stands where the viewer is, 0 (set) – 1 */
  sunUp = 1;
  private lightCol = new THREE.Vector3(1, 1, 1);

  constructor(private v: View3D) {
    this.ground = new Ground(v.scene);
    this.weather = new Weather(v.scene);
  }

  /** the air of a world (worked out once per world) */
  air(b: Body): Atmosphere {
    if (this.atmo?.b !== b) this.atmo = { b, a: atmosphereOf(b, this.v.stars()) };
    return this.atmo.a;
  }

  /** where a point (AU) is over a world: direction (body frame), distance from the centre (m) */
  over(b: Body, p: V3): { n: V3; r: number } {
    const f = frameOf(b);
    const d = toLocal(f, [(p[0] - b.x) * AU_M, (p[1] - b.y) * AU_M, (p[2] - b.z) * AU_M]);
    const r = Math.hypot(d[0], d[1], d[2]) || 1;
    return { n: [d[0] / r, d[1] / r, d[2] / r], r };
  }

  /** the point (AU) at height `h` (m) above the ground at `n` on a world */
  at(b: Body, n: V3, h: number): V3 {
    const R = b.r * AU_M + this.groundH(b, n) + h;
    const w = toWorld(frameOf(b), [n[0] * R, n[1] * R, n[2] * R]);
    return [b.x + w[0] / AU_M, b.y + w[1] / AU_M, b.z + w[2] / AU_M];
  }

  /** the ground's height above the radius (m) at `n`, if it is the world being drawn */
  groundH(b: Body, n: V3) { return this.ground.body === b && this.ground.src ? this.ground.heightAt(n) : 0; }

  /** a mover riding with a world, placed at a point (AU) */
  moverAt(b: Body, p: V3): Mover { return { anchor: b, off: [p[0] - b.x, p[1] - b.y, p[2] - b.z], vel: [0, 0, 0] }; }

  // ---------------------------------------------------------------- each frame, before anything moves
  /**
   * Pick the world whose ground to draw — the one below the viewer, if it is
   * solid and near enough — and keep its terrain round the viewer.
   */
  survey(P: V3) {
    const v = this.v;
    const { b } = v.nearest(P);
    let take: Body | null = null;
    if (b && solid(b)) {
      const R = b.r * AU_M, d = Math.hypot(P[0] - b.x, P[1] - b.y, P[2] - b.z) * AU_M - R;
      if (d < Math.min(0.3 * R, 3e6)) take = b;
    }
    if (this.landed) take = this.landed.b;
    if (this.walker) take = this.walker.b;
    const map = take ? v.mapOf(take) : null;
    this.ground.setBody(take && map && map.w >= 256 ? take : null, map);
    this.body = this.ground.body;
    if (this.body) {
      const o = this.over(this.body, P);
      this.n = o.n;
      this.agl = o.r - this.body.r * AU_M - this.ground.heightAt(o.n);
      this.ground.follow(o.n, this.agl);
    } else this.agl = Infinity;
    // in (or just over) a giant's air
    this.giantBody = null;
    this.giantAlt = Infinity;
    if (b && giant(b)) {
      const o = this.over(b, P), alt = o.r - b.r * AU_M;
      const top = Math.max(3e5, this.air(b).scaleHeightKm * 1000 * 15);
      if (alt < top) { this.giantBody = b; this.giantAlt = alt; this.giantN = o.n; }
    }
  }

  /** the deepest the ship may go into a giant (m above its 1-bar level, so negative): where the hull's limits are reached */
  giantFloor(b: Body): number {
    const a = this.air(b);
    let h = 0;
    for (; h > -6e5; h -= 2000) {
      const s = airAt(a, b, h);
      if (s.bar > HULL.bar * 0.5 || s.K > HULL.K - 80) break;
    }
    return h + 2000;
  }

  // ---------------------------------------------------------------- the ship
  /** may the ship stand on this world? why not, if not */
  shipBlock(b: Body): string {
    if (!solid(b)) return giant(b) ? 'No surface to land on: a giant is gas all the way down' : 'Nowhere to land';
    const a = this.air(b);
    const g = gravity(b) / 9.81;
    if (g > HULL.g) return `Gravity of ${g.toFixed(1)} g: the ship could not lift off again`;
    if (a.surfaceK > HULL.K) return `The ground is at ${Math.round(a.surfaceK)} K: the hull is rated to ${HULL.K} K`;
    if (a.surfaceBar > HULL.bar) return `${Math.round(a.surfaceBar)} bar at the ground would crush the hull`;
    return '';
  }

  /** the lowest the ship may go over this world (m above the ground): just its legs, or high above air it cannot take */
  private floor(b: Body): number {
    if (!this.shipBlock(b)) return LEG_DROP;
    const a = this.air(b);
    if (gravity(b) / 9.81 > HULL.g) return 5000;
    // climb until the air is cool and thin enough
    for (let h = 0; h < 2e5; h += 500) {
      const s = airAt(a, b, h);
      if (s.K <= HULL.K && s.bar <= HULL.bar) return Math.max(LEG_DROP, h);
    }
    return 2e5;
  }

  /** the ship's up there, and its attitude levelled under it keeping its heading */
  private levelled(b: Body, n: V3) {
    const sh = this.v.ship, f = frameOf(b);
    const up = new THREE.Vector3(...toWorld(f, n));
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(sh.quat);
    fwd.addScaledVector(up, -fwd.dot(up));
    if (fwd.lengthSq() < 1e-6) fwd.copy(new THREE.Vector3(1, 0, 0).applyQuaternion(sh.quat)).addScaledVector(up, -up.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(sh.quat)));
    fwd.normalize();
    const x = new THREE.Vector3().crossVectors(fwd, up), z = fwd.clone().negate();
    return { up, q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z)) };
  }

  /** a landed ship: where it stands, as the world turns under it */
  pinShip() {
    const L = this.landed!, sh = this.v.ship;
    if (!L.b.alive) { this.landed = null; return; }
    const p = this.at(L.b, L.n, LEG_DROP);
    sh.nav.anchor = L.b;
    sh.nav.off = [p[0] - L.b.x, p[1] - L.b.y, p[2] - L.b.z];
    sh.nav.vel = [0, 0, 0];
    sh.quat.copy(quatOf(frameOf(L.b))).multiply(L.q);
    sh.thrust = 0;
    this.shipAgl = LEG_DROP;
    this.shipBody = L.b;
  }

  /** land where the ship is, or take off if it is down */
  toggle() {
    const v = this.v, sh = v.ship;
    if (this.landed) { this.takeOff(); return; }
    const b = this.ground.body;
    if (!b || !this.ground.ready || this.shipBody !== b || this.shipAgl > 40000) { v.app.onToast('Get within about 40 km of a world’s surface to land'); return; }
    const why = this.shipBlock(b);
    if (why) { v.app.onToast(why); return; }
    if (sh.worm) return;
    v.travel = null;
    sh.od = false;
    this.auto = 'land';
    v.app.onToast(`Landing on ${b.name}`);
  }

  takeOff() {
    if (!this.landed) return;
    const L = this.landed;
    this.landed = null;
    this.auto = 'takeoff';
    this.v.ship.hull.setLadder(false);
    this.v.app.onToast(`Lifting off from ${L.b.name}`);
  }

  /**
   * After the ship has moved: keep it off the ground (on its legs at the
   * lowest), steer the landing or take-off, and settle it when it touches.
   */
  shipStep(dt: number) {
    const v = this.v, sh = v.ship, n = sh.nav;
    const b = this.ground.body;
    this.shipAgl = Infinity;
    this.shipBody = null;
    if (!b || !this.ground.src) { sh.hull.setLegs(0); if (this.auto) this.auto = null; return; }
    const S = v.shipPos();
    const o = this.over(b, S);
    const gh = this.ground.heightAt(o.n);
    const R = b.r * AU_M;
    let agl = o.r - R - gh;
    this.shipAgl = agl;
    this.shipBody = b;
    const { up, q } = this.levelled(b, o.n);
    const vel = new THREE.Vector3(...n.vel);
    const vUp = vel.dot(up);
    // below a couple of kilometres the ship levels itself, the way a pilot would
    const lvl = this.auto ? 2.5 : agl < 1500 ? 0.8 : 0;
    if (lvl) sh.quat.slerp(q, Math.min(1, dt * lvl));
    if (this.auto === 'land') {
      const down = Math.max(1.5, Math.min(900, (agl - LEG_DROP) * 0.4));
      const want = up.clone().multiplyScalar(-down);
      vel.lerp(want, Math.min(1, dt * 2));
      sh.thrust = 0.4;
    } else if (this.auto === 'takeoff') {
      vel.lerp(up.clone().multiplyScalar(Math.min(120, 8 + agl * 0.5)), Math.min(1, dt * 1.5));
      sh.thrust = 1;
      if (agl > 400) this.auto = null;
    }
    // the floor: the legs on the ground, or as low as the air allows
    const floor = this.floor(b);
    if (agl < floor) {
      const lift = floor - agl;
      const p = this.at(b, o.n, floor);
      n.anchor = b;
      n.off = [p[0] - b.x, p[1] - b.y, p[2] - b.z];
      if (vel.dot(up) < 0) vel.addScaledVector(up, -vel.dot(up));
      agl = floor;
      if (floor > LEG_DROP && lift > 0.5 && this.warned !== b.name) { this.warned = b.name; v.app.onToast(this.shipBlock(b)); }
      if (this.auto === 'land' && floor > LEG_DROP) this.auto = null;
    }
    n.vel = [vel.x, vel.y, vel.z];
    // the legs come down for the last few hundred metres
    sh.hull.setLegs(Math.max(0, Math.min(1, (500 - agl) / 400)));
    // down: touching, slow, and allowed
    const touching = agl <= LEG_DROP + 0.4 && floor <= LEG_DROP;
    if (touching && (this.auto === 'land' || (Math.abs(vUp) < 4 && vel.length() < 6 && v.mode === 'pilot' && !v.controls.moving()))) {
      this.auto = null;
      sh.quat.copy(q);
      this.landed = { b, n: o.n, q: quatOf(frameOf(b)).invert().multiply(sh.quat) };
      sh.hull.setLadder(true);
      this.pinShip();
      v.app.onToast(`Down on ${b.name}. ${v.mode === 'pilot' ? 'Space or L lifts off; the airlock opens onto the ground' : ''}`);
    }
    this.shipAgl = agl;
  }

  // ---------------------------------------------------------------- on foot
  /** out of the airlock onto the ground, at the foot of the ladder */
  stepOut() {
    const L = this.landed!, v = this.v, sh = v.ship;
    const foot = HATCH_OUT.clone().setY(-LEG_DROP).setX(HATCH_OUT.x - 0.8).applyQuaternion(sh.quat);
    const S = v.shipPos();
    const p: V3 = [S[0] + foot.x / AU_M, S[1] + foot.y / AU_M, S[2] + foot.z / AU_M];
    const o = this.over(L.b, p);
    // facing away from the ship, to port
    const away = new THREE.Vector3(-1, 0, 0).applyQuaternion(sh.quat);
    this.walker = { b: L.b, n: o.n, yaw: this.heading(L.b, o.n, away), pitch: 0, h: 0, vh: 0 };
  }

  /** the compass heading (rad, from north towards east) of a world direction at `n` */
  heading(b: Body, n: V3, w: THREE.Vector3) {
    const d = toLocal(frameOf(b), [w.x, w.y, w.z]);
    const [e, nn] = tangent(n);
    return Math.atan2(d[0] * e[0] + d[1] * e[1] + d[2] * e[2], d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2]);
  }

  /** down from a spacewalk onto the ground below */
  touchDown(b: Body, p: V3, look: THREE.Vector3) {
    const o = this.over(b, p);
    this.walker = { b, n: o.n, yaw: this.heading(b, o.n, look), pitch: 0, h: 0, vh: 0 };
  }

  /** walking on the ground in the world's own gravity, swimming in its seas */
  walk(dt: number) {
    const w = this.walker!, v = this.v;
    const inp = v.controls.walkInput();
    const R = w.b.r * AU_M, g = gravity(w.b);
    const [e, nn] = tangent(w.n);
    const fwd: V3 = [nn[0] * Math.cos(w.yaw) + e[0] * Math.sin(w.yaw), nn[1] * Math.cos(w.yaw) + e[1] * Math.sin(w.yaw), nn[2] * Math.cos(w.yaw) + e[2] * Math.sin(w.yaw)];
    const right: V3 = [e[0] * Math.cos(w.yaw) - nn[0] * Math.sin(w.yaw), e[1] * Math.cos(w.yaw) - nn[1] * Math.sin(w.yaw), e[2] * Math.cos(w.yaw) - nn[2] * Math.sin(w.yaw)];
    const gh = this.ground.heightAt(w.n);
    const wet = this.ground.src?.seas && gh <= 0.01;
    // a stride in low gravity carries you further; in high gravity it is a trudge
    const sp = (inp.run ? 4.5 : 1.6) * (wet ? 0.5 : 1) * Math.min(1.6, Math.max(0.5, Math.pow(9.81 / Math.max(0.1, g), 0.15)));
    const air = w.h > 0.05;
    const k = (air ? 0.25 : 1) * sp * dt;
    const step: V3 = [(fwd[0] * inp.f + right[0] * inp.s) * k, (fwd[1] * inp.f + right[1] * inp.s) * k, (fwd[2] * inp.f + right[2] * inp.s) * k];
    let n: V3 = [w.n[0] * R + step[0], w.n[1] * R + step[1], w.n[2] * R + step[2]];
    const l = Math.hypot(n[0], n[1], n[2]);
    n = [n[0] / l, n[1] / l, n[2] / l];
    // not up anything too steep for a person: a 45° slope at most
    const gh2 = this.ground.heightAt(n);
    const run = Math.hypot(step[0], step[1], step[2]);
    if (run > 0 && (gh2 - gh) / run < 1 || air) w.n = n;
    // not through the ship's legs and hull
    if (this.landed && this.landed.b === w.b) this.pushFromShip(w);
    // jumping: a push of a couple of metres a second, however strong the gravity
    if (inp.jump && !air && !wet) w.vh = 2.6;
    w.vh -= g * dt;
    w.h = Math.max(0, w.h + w.vh * dt);
    if (w.h <= 0) w.vh = 0;
  }

  private pushFromShip(w: Walker) {
    const v = this.v, sh = v.ship, S = v.shipPos();
    const p = this.at(w.b, w.n, w.h + 0.9);
    const loc = new THREE.Vector3((p[0] - S[0]) * AU_M, (p[1] - S[1]) * AU_M, (p[2] - S[2]) * AU_M).applyQuaternion(sh.quat.clone().invert());
    if (loc.length() > 60) return;
    if (sh.hull.pushOut(loc, 0.4)) {
      const back = loc.applyQuaternion(sh.quat);
      const q: V3 = [S[0] + back.x / AU_M, S[1] + back.y / AU_M, S[2] + back.z / AU_M];
      w.n = this.over(w.b, q).n;
    }
  }

  /** the walker's eye (AU) and the camera's attitude */
  walkerView(cam: THREE.Camera): Mover {
    const w = this.walker!, f = frameOf(w.b);
    const p = this.at(w.b, w.n, w.h + 1.65);
    const [e, nn] = tangent(w.n);
    const cy = Math.cos(w.yaw), sy = Math.sin(w.yaw), cp = Math.cos(w.pitch), sp = Math.sin(w.pitch);
    const F: V3 = [(nn[0] * cy + e[0] * sy) * cp + w.n[0] * sp, (nn[1] * cy + e[1] * sy) * cp + w.n[1] * sp, (nn[2] * cy + e[2] * sy) * cp + w.n[2] * sp];
    const Rt: V3 = [e[0] * cy - nn[0] * sy, e[1] * cy - nn[1] * sy, e[2] * cy - nn[2] * sy];
    const x = new THREE.Vector3(...toWorld(f, Rt)), z = new THREE.Vector3(...toWorld(f, F)).negate();
    const y = new THREE.Vector3().crossVectors(z, x);
    cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    return this.moverAt(w.b, p);
  }

  /** is the walker at the foot of the ship's ladder? */
  atLadder(): boolean {
    const w = this.walker, L = this.landed;
    if (!w || !L || L.b !== w.b) return false;
    const v = this.v, sh = v.ship, S = v.shipPos();
    const p = this.at(w.b, w.n, 1);
    const loc = new THREE.Vector3((p[0] - S[0]) * AU_M, (p[1] - S[1]) * AU_M, (p[2] - S[2]) * AU_M).applyQuaternion(sh.quat.clone().invert());
    return Math.hypot(loc.x - (HATCH_OUT.x - 0.8), loc.z - HATCH_OUT.z) < 3.5;
  }

  // ---------------------------------------------------------------- drawing
  /**
   * Draw the ground and the sky for a viewer at `P` (AU), with the world's
   * centre at `centre` from the camera (m).
   */
  draw(P: V3) {
    const b = this.body, v = this.v;
    let sky = NO_SKY, upDir = new THREE.Vector3(0, 0, 1);
    this.light = null;
    if (b) {
      // the star that lights it
      let best: Body | null = null, bf = 0;
      for (const s of v.stars()) {
        if (s === b) continue;
        const fl = (s.star?.L ?? 0) / ((s.x - b.x) ** 2 + (s.y - b.y) ** 2 + (s.z - b.z) ** 2);
        if (fl > bf) { bf = fl; best = s; }
      }
      if (best) {
        this.light = new THREE.Vector3(best.x - P[0], best.y - P[1], best.z - P[2]).normalize();
        const c = starRGB(best.star?.teff ?? 5772);
        this.lightCol.set(0.55 + 0.6 * c[0], 0.55 + 0.6 * c[1], 0.55 + 0.6 * c[2]);
      }
      upDir = new THREE.Vector3(...toWorld(frameOf(b), this.n));
      sky = this.skyAt(b, Math.max(0, this.agl));
    }
    const now = performance.now(), dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    const gb = this.giantBody;
    let gCentre = new THREE.Vector3();
    if (gb && !b) {
      // light and sky inside a giant
      let best: Body | null = null, bf = 0;
      for (const s of v.stars()) {
        const fl = (s.star?.L ?? 0) / ((s.x - gb.x) ** 2 + (s.y - gb.y) ** 2 + (s.z - gb.z) ** 2);
        if (fl > bf) { bf = fl; best = s; }
      }
      upDir = new THREE.Vector3(...toWorld(frameOf(gb), this.giantN));
      if (best) {
        this.light = new THREE.Vector3(best.x - P[0], best.y - P[1], best.z - P[2]).normalize();
        const c = starRGB(best.star?.teff ?? 5772);
        this.lightCol.set(0.55 + 0.6 * c[0], 0.55 + 0.6 * c[1], 0.55 + 0.6 * c[2]);
      }
      const sunUp = this.light ? Math.max(0, Math.min(1, (this.light.dot(upDir) + 0.1) / 0.3)) : 0;
      sky = this.weather.sky(gb, this.air(gb), this.giantAlt, this.giantN, sunUp, dt);
      gCentre = new THREE.Vector3((gb.x - P[0]) * AU_M, (gb.y - P[1]) * AU_M, (gb.z - P[2]) * AU_M);
    }
    this.weather.update(gb && !b ? gb : null, this.giantN, this.giantAlt, gCentre, sky, dt);
    this.sunUp = this.light ? Math.max(0, Math.min(1, (this.light.dot(upDir) + 0.06) / 0.16)) : 0;
    this.sky = sky;
    const centre = b ? new THREE.Vector3((b.x - P[0]) * AU_M, (b.y - P[1]) * AU_M, (b.z - P[2]) * AU_M) : new THREE.Vector3();
    if (b) this.ground.place(centre, frameOf(b), this.light, this.lightCol, upDir, sky);
    else this.ground.place(centre, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], null, this.lightCol, upDir, sky);
    return this.ground.dayLight(this.light, upDir, sky);
  }

  /** the sky over a world at a height above its ground */
  skyAt(b: Body, alt: number): SkyState {
    const a = this.air(b);
    if (!a.exists || a.kind === 'exosphere') return NO_SKY;
    const here = airAt(a, b, alt);
    const strength = Math.pow(Math.max(0, Math.min(1, (Math.log10(Math.max(1e-12, here.bar)) + 4.5) / 4.5)), 0.4);
    return { ...NO_SKY, strength, zenith: a.sky, horizon: a.horizon, sunset: a.sunset, haze: a.haze * Math.min(1, here.bar / Math.max(1e-9, a.surfaceBar)) };
  }

  /** the world below and how high above its ground, for the readout */
  status(): string {
    const b = this.body;
    if (!b || !isFinite(this.agl)) return '';
    const a = this.agl;
    return `${b.name} · ${a < 1000 ? `${a.toFixed(0)} m` : `${(a / 1000).toFixed(a < 1e4 ? 1 : 0)} km`} above the ground`;
  }
}
