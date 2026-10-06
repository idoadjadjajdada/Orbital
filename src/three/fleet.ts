import * as THREE from 'three';
import type { Body } from '../physics/body';
import { AU_M, MSUN_KG } from '../physics/units';
import type { V3 } from '../pixel/sprites';
import { groundSpec, groundAt, tangent, type GroundSpec, type GroundSample } from './terrain';
import { atmosphere, composition, interior, life, gravity, airAt, giantPressure, giantTemp, cloudDecks, rng, type Atmosphere } from './science';
import { bodyQuat, dirOf, latLonOf, arc } from './ground';
import { probeMesh, orbiterMesh, landerMesh, roverMesh, stationMesh, baseMesh, padMesh, PAD } from './craftmesh';
import { ROCKETS, HOLD_DAYS, TURNAROUND, plan, phase, rocketMesh, setDoors, type RocketModel, type RocketState } from './rocketry';
import { sitesOn } from './sites';
import { Interior, stationInterior } from './interior';
import { baseLayer, baseGround, BASE } from './basecamp';

/**
 * The craft the ship can send out, and what they find.
 *
 * - A **probe** falls into an atmosphere on a parachute, reading pressure,
 *   temperature and the make-up of the air all the way down, until it lands
 *   or is crushed (in a giant, as Galileo was, below 20 bar); with no air it
 *   is an impactor.
 * - An **orbiter** circles a world on a polar orbit and maps it: the gravity
 *   field gives the layers inside, spectrometers the make-up of the ground
 *   and the air.
 * - A **lander** comes down on a world's ground — below the ship, or at a
 *   named site — and analyses the air and soil and runs the life experiments.
 * - A **rover** drives off a lander (or is dropped by the ship) and samples
 *   the ground as it goes; take its controls and drive it.
 * - A **station** goes into orbit, as the ISS does; a **base** is built on the
 *   ground beside the landed ship.
 *
 * Craft on a world's ground ride round with it; craft in orbit keep their
 * orbit while the world turns under them.
 */

export type CraftKind = 'probe' | 'orbiter' | 'lander' | 'rover' | 'station' | 'base' | 'pad' | 'rocket';
export const KINDS: { k: CraftKind; name: string; about: string }[] = [
  { k: 'probe', name: 'Probe', about: 'Falls through the atmosphere reading it, to the ground or until it is crushed' },
  { k: 'orbiter', name: 'Orbiter', about: 'Maps the world from a polar orbit: what it is made of, inside and out' },
  { k: 'lander', name: 'Lander', about: 'Sets down and analyses the air and soil; runs the life experiments' },
  { k: 'rover', name: 'Rover', about: 'Drives the ground and samples it; you can drive it' },
  { k: 'station', name: 'Station', about: 'An ISS-sized outpost in orbit' },
  { k: 'base', name: 'Base', about: 'Habitats, a lab, a garage and a pad for the ship: you choose where' },
  { k: 'pad', name: 'Launch pad', about: 'Needed to launch craft up from the ground; Lander 1 flies from it to the ship and back' },
];

export interface Reading { t: number; msg: string }
export interface Craft {
  id: number; kind: CraftKind; name: string; b: Body;
  state: 'cruise' | 'orbit' | 'descent' | 'surface' | 'lost' | 'flight';
  /** seconds in this state, and in all */
  t: number; age: number;
  /** cruise: where it set off from (m, from the world's centre, the sandbox's axes) and how long the trip takes */
  from: THREE.Vector3; cruiseT: number;
  /** orbit: radius (m), the orbit's plane (a rotation from the equator) and where along it, angular speed (rad/s) */
  orbit: { r: number; plane: THREE.Quaternion; ph: number; w: number } | null;
  /** on or over the ground: unit direction (body frame), heading (rad from north), height above the ground (m), falling speed */
  n: V3; head: number; alt: number; vz: number;
  /** what it has found */
  log: Reading[];
  /** a probe's readings on the way down: height (km), pressure (bar), temperature (K) */
  profile: { z: number; bar: number; T: number; note?: string }[];
  /** a rover's distance driven (m), an orbiter's map coverage (0–1), a base's construction (0–1) */
  odo: number; cover: number; build: number;
  status: string;
  mesh: THREE.Object3D;
  /** the craft it came from (a rover off a lander) */
  parent?: number;
  /** the controls, while you drive it: forward and turn (−1–1) */
  drive: { f: number; s: number };
  /** there from the start (the ISS, the spaceports' bases), not sent by you */
  fixed?: boolean;
  /** its inside, once you have come near enough to see in */
  inside?: Interior;
  /** where a base stands: level, at the highest ground under it (m over the datum), worked out once */
  h0?: number;
  /** a rocket's: where it stands, what it carries, its flight */
  rocket?: RocketState;
  /** a base's or a station's crew, and the supplies it has (days, for a crew of six) */
  crew?: number; stores?: number;
  /** days it has been out of supplies; the warnings given (stores low, out) */
  short?: number; warned?: number;
}

/** a crew of six, and three months' stores: what a base or station starts with */
export const CREW0 = 6, STORES0 = 90;
/** stores low: a warning when this many days are left */
const LOW = 15;
/** days a crew holds out on emergency rations before it leaves */
const RATIONS = 10;

let nextId = 1;
const NAMES: Record<CraftKind, string> = { probe: 'Probe', orbiter: 'Orbiter', lander: 'Lander', rover: 'Rover', station: 'Station', base: 'Base', pad: 'Launch pad', rocket: 'Rocket' };
/** how much pressure a probe stands, bar, and heat, K */
const PROBE_BAR = 120, PROBE_K = 900;

const isGiant = (b: Body) => b.cls === 'gas' || ['gas', 'icegiant', 'hotjupiter', 'browndwarf'].includes(b.look.style);

export class Fleet {
  /** called when a craft's inside (or a base's consoles) is first built: its monitors to register */
  onInterior: (c: Craft) => void = () => {};
  readonly root = new THREE.Group();
  readonly crafts: Craft[] = [];
  private specs = new Map<Body, GroundSpec>();
  private atmos = new Map<Body, Atmosphere>();
  private smp: GroundSample = { h: 0, r: 0, g: 0, b: 0, sea: false, rock: 0 };
  /** news from the craft, for a toast */
  onNews: (msg: string) => void = () => {};

  constructor(scene: THREE.Scene, private stars: () => Body[]) {
    this.root.name = 'fleet';
    scene.add(this.root);
  }

  spec(b: Body) {
    let s = this.specs.get(b);
    if (!s) { s = groundSpec(b.look, b.r * AU_M, gravity(b), this.air(b).bar); this.specs.set(b, s); }
    return s;
  }
  air(b: Body) {
    let a = this.atmos.get(b);
    if (!a) { a = atmosphere(b, this.stars()); this.atmos.set(b, a); }
    return a;
  }
  /** ground height (m over the datum, sea level for a sea): the top of a pad or a base's terrace where one stands */
  heightAt(b: Body, n: V3, fine = 1) {
    const h = this.terrainAt(b, n, fine);
    return Math.max(h, this.platformAt(b, n));
  }
  /** the ground itself, without what is built on it */
  terrainAt(b: Body, n: V3, fine = 1) {
    if (isGiant(b)) return 0;
    const h = groundAt(this.spec(b), n, fine, this.smp);
    return this.smp.sea ? 0 : h;
  }

  /** the flat tops of what is built on a world: a launch pad's apron, a base's terrace and its landing pad */
  private platCache = new Map<Body, { n: V3; r: number; top: number }[]>();
  platforms(b: Body): { n: V3; r: number; top: number }[] {
    const had = this.platCache.get(b);
    if (had) return had;
    const out: { n: V3; r: number; top: number }[] = [];
    this.platCache.set(b, out);
    for (const c of this.crafts) {
      if (c.b !== b || c.state !== 'surface' || (c.kind !== 'base' && c.kind !== 'pad') || c.build < 0.5) continue;
      const top = this.level(c);
      if (c.kind === 'pad') out.push({ n: c.n, r: 17, top: top + 0.3 });
      else { out.push({ n: this.onBase(c, 0, -15), r: 44, top }); out.push({ n: this.onBase(c, BASE.pad.x, BASE.pad.z), r: BASE.padR, top: top + 0.12 }); }
    }
    return out;
  }
  /** the height of a platform at n, or −∞ */
  platformAt(b: Body, n: V3) {
    let h = -Infinity;
    const R = b.r * AU_M;
    for (const p of this.platforms(b)) if (arc(p.n, n) * R < p.r) h = Math.max(h, p.top);
    return h;
  }

  /**
   * why a craft cannot be sent to a world from where the ship is, or ''.
   * `shipAlt` is the ship's height over that world (m), `landed` whether it is standing on it.
   */
  why(kind: CraftKind, b: Body | null, shipAlt: number, landed: boolean): string {
    if (!b || !b.alive) return 'No target: select a world, or fly near one';
    if (['star', 'wd', 'ns', 'bh'].includes(b.cls) || b.look.wormhole || b.look.white) return `${b.name}: nothing could survive there`;
    if (b.look.craft) return `${b.name} is a spacecraft`;
    const R = b.r * AU_M;
    // the ship has to be close: within a few dozen radii (or a million km of a small world)
    if (shipAlt > Math.max(R * 40, 2e9)) return `Too far from ${b.name}: get within ${(Math.max(R * 40, 2e9) / 1e9).toFixed(1)} million km`;
    const giant = isGiant(b), a = this.air(b);
    if (kind === 'lander' || kind === 'rover' || kind === 'base' || kind === 'pad') {
      if (giant) return `${b.name} has no surface: send a probe into it`;
      if (R < 2000) return `${b.name} is too small to land on`;
      const T = a.T;
      if (T > 900) return `Too hot for it: ${Math.round(T)} K`;
      if ((kind === 'base' || kind === 'pad') && !landed && shipAlt > 3000) return `Come down near the ground to choose where the ${kind === 'pad' ? 'pad' : 'base'} goes`;
    }
    if (kind === 'probe' && a.bar <= 0 && !giant) return '';
    return '';
  }

  /** send a craft to a world: from the ship at `shipAt` (m from the world's centre, sandbox axes). `site` picks a place on the ground (body frame) */
  launch(kind: CraftKind, b: Body, shipAt: THREE.Vector3, site: V3 | null = null, parent?: Craft): Craft {
    const R = b.r * AU_M, a = this.air(b);
    const n = this.crafts.filter(c => c.kind === kind).length + 1;
    const qb = bodyQuat(b);
    // where on the ground: the given site, or under the ship, or (from far off) the point facing the ship
    const below = shipAt.clone().applyQuaternion(qb.clone().invert()).normalize();
    const where: V3 = site ?? [below.x, below.y, below.z];
    const c: Craft = {
      id: nextId++, kind, name: `${NAMES[kind]} ${n}`, b, state: 'cruise', t: 0, age: 0,
      from: shipAt.clone(), cruiseT: 0, orbit: null, n: where, head: rng(nextId, 2)() * 6.28, alt: 0, vz: 0,
      log: [], profile: [], odo: 0, cover: 0, build: 0, status: 'on its way', mesh: this.model(kind), drive: { f: 0, s: 0 },
      parent: parent?.id,
    };
    const dist = shipAt.length() - R;
    // a short hop from close by, longer from far off: a few seconds to half a minute
    c.cruiseT = Math.max(2.5, Math.min(30, 3 + 4 * Math.log10(Math.max(1, dist / 1e5))));
    if (kind === 'orbiter' || kind === 'station') {
      const alt = kind === 'station' ? Math.max(400e3, R * 0.06) : Math.max(150e3, R * 0.12);
      const inc = kind === 'station' ? 51.6 * Math.PI / 180 : 88 * Math.PI / 180;
      const r = R + (isGiant(b) ? Math.max(alt, R * 0.25) : alt);
      // the plane: tilted from the equator, its node toward the ship
      const plane = qb.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(below.y, below.x))).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), inc));
      const GM = 6.674e-11 * b.m * MSUN_KG;
      c.orbit = { r, plane, ph: 0, w: Math.sqrt(GM / r ** 3) };
    }
    if (kind === 'rover' && parent && parent.state === 'surface') {
      // straight off the lander's ramp
      c.state = 'surface';
      c.n = this.offset(parent.n, 6, parent.head, R);
      c.head = parent.head;
      c.status = 'driving';
      this.note(c, `Rolled off ${parent.name}`);
    } else if (kind === 'base') {
      c.state = 'surface';
      c.n = this.offset(where, 180, c.head, R);
      c.status = 'under construction';
      this.note(c, 'Construction started');
    }
    // descent starts high in the air, or a little way up on an airless world
    c.alt = kind === 'probe' || kind === 'lander' || kind === 'rover' ? Math.max(isGiant(b) ? 300e3 : 0, a.bar > 0 ? Math.min(a.H * 1000 * 12, 400e3) : 30e3) : 0;
    this.crafts.push(c);
    this.root.add(c.mesh);
    if (c.state === 'cruise') this.note(c, `Released toward ${b.name}`);
    return c;
  }

  /** a point `d` m along the ground from n, heading `head` */
  offset(n: V3, d: number, head: number, R: number): V3 {
    const [e, nn] = tangent(n), th = d / R, sh = Math.sin(head), ch = Math.cos(head);
    const t: V3 = [ch * nn[0] - sh * e[0], ch * nn[1] - sh * e[1], ch * nn[2] - sh * e[2]];
    const m: V3 = [Math.cos(th) * n[0] + Math.sin(th) * t[0], Math.cos(th) * n[1] + Math.sin(th) * t[1], Math.cos(th) * n[2] + Math.sin(th) * t[2]];
    const l = Math.hypot(...m);
    return [m[0] / l, m[1] / l, m[2] / l];
  }

  private model(k: CraftKind): THREE.Object3D {
    const g = new THREE.Group();
    // (a rocket's model goes in when it is stacked: which one depends on the rocket)
    if (k === 'rocket') return g;
    g.add(k === 'probe' ? probeMesh(true) : k === 'orbiter' ? orbiterMesh() : k === 'lander' ? landerMesh() : k === 'rover' ? roverMesh() : k === 'station' ? stationMesh() : k === 'pad' ? padMesh() : baseMesh(nextId));
    g.traverse(o => { o.frustumCulled = false; });
    return g;
  }

  private note(c: Craft, msg: string, news = false) {
    c.log.push({ t: c.age, msg });
    if (news) this.onNews(`${c.name}: ${msg}`);
  }

  // ---------------------------------------------------------------- where
  /** where a craft is, m from its world's centre, sandbox axes */
  local(c: Craft, out = new THREE.Vector3()): THREE.Vector3 {
    const b = c.b, R = b.r * AU_M;
    if (c.rocket && (c.state === 'flight' || c.rocket.docked)) { const P = this.rocketPos(c); return out.set((P.x - b.x) * AU_M, (P.y - b.y) * AU_M, (P.z - b.z) * AU_M); }
    if (c.state === 'cruise') {
      const end = this.arrival(c);
      const k = smooth(Math.min(1, c.t / c.cruiseT));
      return out.copy(c.from).lerp(end, k);
    }
    if (c.state === 'orbit' && c.orbit) return out.set(Math.cos(c.orbit.ph) * c.orbit.r, Math.sin(c.orbit.ph) * c.orbit.r, 0).applyQuaternion(c.orbit.plane);
    const h = ((c.kind === 'base' || c.kind === 'pad') && c.state === 'surface' ? this.level(c) : this.heightAt(b, c.n, 0.5)) + (c.state === 'surface' ? 0 : c.alt);
    const r = R + h;
    return out.set(c.n[0] * r, c.n[1] * r, c.n[2] * r).applyQuaternion(bodyQuat(b));
  }

  /** where the cruise ends: the orbit's start, or the top of the descent */
  private arrival(c: Craft) {
    if (c.orbit) return new THREE.Vector3(c.orbit.r, 0, 0).applyQuaternion(c.orbit.plane);
    const R = c.b.r * AU_M, r = R + c.alt;
    return new THREE.Vector3(c.n[0] * r, c.n[1] * r, c.n[2] * r).applyQuaternion(bodyQuat(c.b));
  }

  /** where a craft is in the sandbox, AU */
  pos(c: Craft): V3 {
    const p = this.local(c);
    return [c.b.x + p.x / AU_M, c.b.y + p.y / AU_M, c.b.z + p.z / AU_M];
  }

  /** the local up at a craft (world) */
  up(c: Craft) { return this.local(c).normalize(); }

  // ---------------------------------------------------------------- each frame
  /** move them all on: before the viewer is placed, so what you are inside is where you are */
  step(dt: number) {
    this.platCache.clear();
    for (const c of this.crafts) {
      if (!c.b.alive && c.state !== 'lost') { c.state = 'lost'; c.status = `${c.b.name} is gone`; this.note(c, `Lost: ${c.b.name} no longer exists`, true); }
      c.t += dt; c.age += dt;
      if (c.rocket) { this.rocketStep(c, dt); continue; }
      if (c.state === 'cruise' && c.t >= c.cruiseT) this.arrive(c);
      else if (c.state === 'orbit') this.orbitStep(c, dt);
      else if (c.state === 'descent') this.descend(c, dt);
      else if (c.state === 'surface') this.surface(c, dt);
    }
  }

  /** the way a craft is turned (world): along its orbit with its top away from the world, or standing on the ground */
  quat(c: Craft, q = new THREE.Quaternion()): THREE.Quaternion {
    if (c.rocket && (c.state === 'flight' || c.rocket.docked)) return this.rocketQuat(c, q);
    const p = this.local(c), up = p.clone().normalize();
    if (c.state === 'orbit' || c.state === 'cruise') {
      const fwd = c.orbit && c.state === 'orbit' ? new THREE.Vector3(-Math.sin(c.orbit.ph), Math.cos(c.orbit.ph), 0).applyQuaternion(c.orbit.plane) : this.arrival(c).sub(c.from).normalize();
      // a station flies with its cupola to the world; anything else with its instruments down
      return q.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd, c.kind === 'station' ? up : up.clone().negate()));
    }
    const n = new THREE.Vector3(...c.n);
    return q.copy(bodyQuat(c.b)).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -c.head));
  }

  /** draw them where they are, from the viewer at P */
  frame(dt: number, P: V3, camFov: number) {
    for (const c of this.crafts) {
      // drawn where it is, from the viewer
      const m = c.mesh;
      if (c.state === 'lost' && c.kind !== 'base') { m.visible = false; continue; }
      const p = this.local(c);
      const rel = new THREE.Vector3(c.b.x - P[0], c.b.y - P[1], c.b.z - P[2]).multiplyScalar(AU_M).add(p);
      const d = rel.length();
      // far off, it is a dot on the labels; near, a model
      m.visible = d < 2e5 * (c.kind === 'station' ? 20 : 1) || d / Math.tan(camFov * Math.PI / 360) < 4e6;
      m.position.copy(rel);
      this.quat(c, m.quaternion);
      // near enough to look in at the windows (or to go in): its inside, built the first time
      const near = (c.kind === 'station' || (c.kind === 'base' && c.build >= 1)) && d < 900;
      if (near && !c.inside) { c.inside = c.kind === 'station' ? stationInterior(c.name) : baseLayer(c.name); m.add(c.inside.group); this.onInterior(c); }
      if (c.inside) c.inside.group.visible = near;
      const chute = m.getObjectByName('chute');
      if (chute) chute.visible = c.state === 'descent' && this.air(c.b).bar > 0.005 && c.vz < 200;
      if (c.kind === 'base' || c.kind === 'pad') m.scale.setScalar(0.05 + 0.95 * c.build);
      if (c.rocket) {
        const tr = c.rocket.trip, ph = tr ? phase(tr) : null;
        const burn = !!ph && (ph.part !== 'cruise' || (tr!.hop ? ph.u < 0.08 || ph.u > 0.92 : tr!.t - tr!.Ta < 4));
        const plume = m.getObjectByName('plume');
        if (plume) { plume.visible = burn; if (burn) plume.scale.set(1, 0.85 + 0.3 * Math.random(), 1); }
        const body = m.getObjectByName('rocket-body');
        if (body) body.scale.y = 0.05 + 0.95 * c.build;
        // its doors and hatches open when someone comes up to it on the ground (to load it, to board, to climb out),
        // and shut for flight, in a couple of seconds
        const r = c.rocket, want = !tr && !r.docked && c.build >= 1 && d < 25 ? 1 : 0;
        r.doors = want > r.doors ? Math.min(want, r.doors + dt / 2) : Math.max(want, r.doors - dt / 1.5);
        const rm = m.getObjectByName('rocket-model');
        if (rm) setDoors(rm, r.doors);
      }
      // a pad's rocket is gone for a while after it launches, until the next is stacked
      if (c.kind === 'pad') { const r = m.getObjectByName('rocket'); if (r) r.visible = c.age >= c.odo; }
    }
  }

  private arrive(c: Craft) {
    c.t = 0;
    if (c.orbit) {
      c.state = 'orbit';
      c.status = c.kind === 'station' ? 'in orbit, crewed' : 'mapping';
      const alt = (c.orbit.r - c.b.r * AU_M) / 1000;
      this.note(c, `In orbit round ${c.b.name}, ${alt.toFixed(0)} km up, ${(2 * Math.PI / c.orbit.w / 60).toFixed(0)} minutes an orbit`, true);
    } else {
      c.state = 'descent';
      c.status = 'descending';
      const a = this.air(c.b);
      this.note(c, a.bar > 0 ? `Entry interface: ${(c.alt / 1000).toFixed(0)} km up, heat shield first` : `Descent burn: ${(c.alt / 1000).toFixed(0)} km up`, true);
      c.vz = a.bar > 0 ? 6000 : 1500;
    }
  }

  private orbitStep(c: Craft, dt: number) {
    const o = c.orbit!;
    // the real angular speed, sped up so a map fills in a minute or so
    o.ph = (o.ph + o.w * dt * (c.kind === 'orbiter' ? Math.max(1, 40 / (2 * Math.PI / o.w / 60)) : 1)) % (2 * Math.PI);
    if (c.kind !== 'orbiter' || c.cover >= 1) return;
    const was = c.cover;
    c.cover = Math.min(1, c.cover + dt / 60);
    const b = c.b, a = this.air(b);
    if (was < 0.25 && c.cover >= 0.25) this.note(c, a.bar > 0 ? `Atmosphere sounded: ${a.gases.slice(0, 3).map(g => `${g.f} ${pct(g.x)}`).join(', ')}` : 'No atmosphere detected, to the limit of the instruments', true);
    if (was < 0.6 && c.cover >= 0.6) {
      const it = interior(b);
      this.note(c, `Gravity field mapped: ${it.layers.map(l => l.name.toLowerCase()).join(', ')}`, true);
    }
    if (was < 1 && c.cover >= 1) {
      const cp = composition(b);
      this.note(c, cp.rows.length ? `Surface mapped: ${cp.rows.slice(0, 3).map(([k, v]) => `${k} ${v}%`).join(', ')}` : 'Cloud tops mapped: no solid surface', true);
    }
  }

  private descend(c: Craft, dt: number) {
    const b = c.b, a = this.air(b), g = gravity(b), giant = isGiant(b);
    // falling: an entry that sheds most of the speed, then a parachute (in air) or rockets
    const thick = a.bar > 0 ? airAt(a, g, Math.max(0, c.alt) / 1000).bar : 0;
    let terminal = thick > 0 ? Math.max(25, 120 / Math.sqrt(Math.max(thick, 1e-4))) : Math.max(2, c.alt * 0.05);
    // the last few kilometres on rockets (or airbags), down to a few m/s at touchdown
    if (!giant && c.alt < 3000) terminal = Math.min(terminal, Math.max(c.kind === 'probe' && a.bar <= 0 ? 1500 : 2.5, c.alt * 0.4));
    if (c.vz > terminal) c.vz = Math.max(terminal, c.vz - (thick > 0 ? 400 : 60) * dt);
    else c.vz = Math.min(terminal, c.vz + g * dt);
    // shown faster than real, so a descent takes a minute or two
    const speedUp = giant ? (c.alt > 0 ? 25 : 10) : c.alt > 20e3 ? 25 : c.alt > 2e3 ? 8 : 1;
    c.alt -= c.vz * dt * speedUp;
    // a probe reads the air every few kilometres
    const zKm = c.alt / 1000;
    const last = c.profile[c.profile.length - 1];
    if (c.kind === 'probe' && (!last || last.z - zKm > Math.max(2, Math.abs(zKm) * 0.08))) {
      const air = giant && zKm < 0 ? { bar: giantPressure(a, -zKm), T: giantTemp(a, -zKm) } : a.bar > 0 ? airAt(a, g, Math.max(0, zKm)) : { bar: 0, T: a.T };
      const deck = giant ? cloudDecks(b, a).find(d => last && last.z > -d.depth && zKm <= -d.depth) : undefined;
      c.profile.push({ z: zKm, bar: air.bar, T: air.T, note: deck ? `${deck.what} clouds` : undefined });
      if (deck) this.note(c, `Through the ${deck.what} cloud deck at ${air.bar.toPrecision(2)} bar`);
      if (air.bar > PROBE_BAR || air.T > PROBE_K) {
        c.state = 'lost';
        c.status = `crushed at ${air.bar.toPrecision(3)} bar, ${Math.round(air.T)} K`;
        this.note(c, `Signal lost ${Math.abs(zKm).toFixed(0)} km ${zKm < 0 ? 'below the cloud tops' : 'up'}: ${c.status}`, true);
        return;
      }
    }
    if (giant) return;
    const h = c.alt;
    if (h <= 0) {
      c.alt = 0;
      c.state = 'surface';
      c.t = 0;
      const hard = a.bar <= 0 && c.kind === 'probe';
      c.status = hard ? 'impacted' : c.kind === 'rover' ? 'driving' : 'on the ground';
      if (hard) { this.note(c, `Impact at ${c.vz.toFixed(0)} m/s: it made a fresh crater`, true); c.state = 'lost'; return; }
      const [la, lo] = latLonOf(c.n);
      this.note(c, `Touchdown at ${fmtLL(la, lo)}`, true);
      this.surfaceReport(c);
    }
  }

  /** what a craft on the ground finds as it lands */
  private surfaceReport(c: Craft) {
    const b = c.b, a = this.air(b), g = gravity(b);
    const z = this.heightAt(b, c.n, 1) / 1000;
    const air = airAt(a, g, Math.max(0, z));
    this.note(c, a.bar > 0 ? `Air at the surface: ${air.bar.toPrecision(3)} bar, ${Math.round(air.T)} K (${Math.round(air.T - 273.15)} °C); ${a.gases.slice(0, 4).map(x => `${x.f} ${pct(x.x)}`).join(', ')}` : `Vacuum, ${Math.round(a.T)} K`);
    if (c.kind === 'probe') return;
    const cp = composition(b), r = rng(Math.floor(c.n[0] * 1e6), 4);
    if (cp.rows.length) this.note(c, `Soil: ${cp.rows.slice(0, 5).map(([k, v]) => `${k} ${(v * (0.85 + 0.3 * r())).toFixed(1)}%`).join(', ')}`);
    const L = life(b, this.stars());
    const res = L.tier === 'earth' ? 'Life experiments: positive. Microbes in every gram of soil; the air is full of pollen and spores'
      : b.look.real === 'Mars' ? 'Life experiments: labelled release shows gas given off, but no organics to go with it — inconclusive, as with Viking'
      : L.tier === 'microbial' || L.tier === 'plants' || L.tier === 'animals' || L.tier === 'intelligent' ? `Life experiments: positive. ${L.forms.find(f => f.kind === 'microbe')?.name ?? 'Microbes'} in the soil`
      : L.tier === 'candidate' ? 'Life experiments: inconclusive'
      : 'Life experiments: negative';
    this.note(c, res, true);
    if (c.kind === 'lander' && (b.look.real === 'Mars' || b.look.real === 'Moon')) this.note(c, b.look.real === 'Mars' ? 'Seismometer: a marsquake every few days (InSight heard 1,319)' : 'Seismometer: deep moonquakes, ringing for an hour each');
  }

  private surface(c: Craft, dt: number) {
    const b = c.b, R = b.r * AU_M;
    if (c.kind === 'base' || c.kind === 'pad') {
      if (c.build < 1) { c.build = Math.min(1, c.build + dt / 20); if (c.build >= 1) { c.status = c.kind === 'pad' ? 'ready' : 'crewed'; this.note(c, c.kind === 'pad' ? 'Built: ready to launch from' : 'Built and crewed', true); } }
      return;
    }
    if (c.kind !== 'rover') return;
    // the rover drives: under your hand, or on its own between waypoints
    const auto = c.drive.f === 0 && c.drive.s === 0;
    let f = c.drive.f, turn = c.drive.s;
    if (auto) { f = 0.6; turn = Math.sin(c.age * 0.13 + c.id) * 0.25; }
    c.head += turn * dt * 0.8;
    const next = this.offset(c.n, f * 3 * dt, c.head, R);
    this.heightAt(b, next, 0.5);
    if (this.smp.sea) { c.head += Math.PI * 0.5; return; }
    c.n = next;
    const before = Math.floor(c.odo / 60);
    c.odo += Math.abs(f) * 3 * dt;
    if (Math.floor(c.odo / 60) > before) this.sampleStop(c);
  }

  /** a rover's stop: a sample of the rock here, and anything interesting */
  private sampleStop(c: Craft) {
    const b = c.b, r = rng(Math.floor(c.odo) + c.id * 1000, 8);
    const cp = composition(b);
    const real = b.look.real;
    const finds: Record<string, string[]> = {
      Mars: ['a mudstone with clay minerals: this was a lake bed', 'haematite “blueberries”: they formed in water', 'a vein of gypsum, laid down by groundwater', 'organic molecules in a drilled sample', 'a nickel-iron meteorite', 'wind-sculpted ventifacts'],
      Moon: ['anorthosite: the Moon’s original crust', 'orange volcanic glass beads', 'a breccia of shattered and welded rock', 'regolith a few metres deep, fine as flour', 'ice in the shadow of a crater rim'],
      Venus: ['basalt, its surface weathered by sulphur', 'a tessera ridge of folded rock'],
      Titan: ['water-ice cobbles, rounded by flowing methane', 'organic sand of the dunes', 'a damp patch: methane evaporating from the soil'],
      Earth: ['granite', 'limestone full of fossils', 'basalt', 'sandstone', 'a quartz vein'],
    };
    const list = (real && finds[real]) || ['basaltic rock', 'fine dust', 'a fractured boulder', 'impact glass', cp.rows[0] ? `rock rich in ${cp.rows[0][0]}` : 'bare rock'];
    const L = life(b, this.stars());
    let msg = `Stop at ${(c.odo / 1000).toFixed(2)} km: ${list[Math.floor(r() * list.length)]}`;
    if ((L.tier === 'animals' || L.tier === 'plants' || L.tier === 'intelligent' || L.tier === 'earth') && r() < 0.5) {
      const f = L.tier === 'earth' ? null : L.forms[Math.floor(r() * L.forms.length)];
      msg += f ? `; nearby, ${f.name}, a ${f.about}` : '; lichens and insects on the rock';
    }
    this.note(c, msg, r() < 0.3);
  }

  /**
   * What is already out there: round the Earth, the International Space
   * Station in its real orbit (420 km, 51.6°); on its ground, bases beside
   * the spaceports at Cape Canaveral and Baikonur. Made once per Earth.
   */
  fixtures(worlds: Body[]) {
    for (const b of worlds) {
      if (b.look.real !== 'Earth' || !b.alive || this.crafts.some(c => c.fixed && c.b === b)) continue;
      const R = b.r * AU_M, qb = bodyQuat(b);
      const iss = this.make('station', b, 'ISS');
      const GM = 6.674e-11 * b.m * MSUN_KG, r = R + 420e3;
      iss.orbit = { r, plane: qb.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 51.6 * Math.PI / 180)), ph: 1.1, w: Math.sqrt(GM / r ** 3) };
      iss.state = 'orbit'; iss.status = 'in orbit, crewed';
      this.note(iss, 'In orbit since 1998: 420 km up, an orbit every 93 minutes, crewed without a break since 2000');
      for (const [name, lat, lon, head] of [['Canaveral Base', 28.585, -80.65, 0.6], ['Baikonur Base', 45.94, 63.35, 2.1]] as const) {
        const c = this.make('base', b, name);
        c.state = 'surface'; c.n = dirOf(lat, lon); c.head = head; c.build = 1; c.status = 'crewed';
        this.note(c, 'A base beside the spaceport: habitats, a lab, a garage, a pad for the ship');
        const pad = this.make('pad', b, name.replace('Base', 'Launch Pad'));
        pad.state = 'surface'; pad.n = this.offset(c.n, 260, head + 1.2, R); pad.head = head; pad.build = 1; pad.status = 'ready';
        this.note(pad, 'A launch pad, with a rocket on the stand');
        // and a rocket of the fleet on each pad's landing circle, ready to fly
        this.stack(name.startsWith('Canaveral') ? 'wayfarer' : 'mammoth', pad, true);
      }
    }
  }

  /** build a base or a launch pad where you chose: it goes up over twenty seconds */
  build(kind: 'base' | 'pad', b: Body, n: V3, head: number): Craft {
    const k = this.crafts.filter(c => c.kind === kind && !c.fixed).length + 1;
    const c = this.make(kind, b, `${NAMES[kind]} ${k}`);
    c.fixed = false;
    c.n = n; c.head = head; c.build = 0; c.state = 'surface'; c.status = 'under construction';
    this.note(c, 'Construction started');
    return c;
  }

  /** the built launch pads on a world */
  pads(b: Body) { return this.crafts.filter(c => c.kind === 'pad' && c.b === b && c.build >= 1); }

  /** a craft that is simply there (no launch) */
  private make(kind: CraftKind, b: Body, name: string): Craft {
    const c: Craft = {
      id: nextId++, kind, name, b, state: 'surface', t: 0, age: 0, from: new THREE.Vector3(), cruiseT: 0, orbit: null, n: [0, 0, 1], head: 0, alt: 0, vz: 0,
      log: [], profile: [], odo: 0, cover: 0, build: 1, status: '', mesh: this.model(kind), drive: { f: 0, s: 0 }, fixed: true,
    };
    this.crafts.push(c);
    this.root.add(c.mesh);
    return c;
  }

  /**
   * a base is built level: its floor at the highest ground under its domes,
   * garage and airlock, with its foundation going down into the ground where
   * the ground falls away (so nothing pokes up through a floor, and no corner
   * hangs in the air)
   */
  level(c: Craft) {
    if (c.h0 !== undefined) return c.h0;
    const R = c.b.r * AU_M, [e, nn] = tangent(c.n);
    let hi = -Infinity;
    // (rings over all of it, whichever way it faces)
    const pts: [number, number][] = [[0, 0]];
    for (const rr of c.kind === 'pad' ? [8, 16] : [10, 20, 30, 40]) for (let k = 0; k < 12; k++) pts.push([Math.cos(k * Math.PI / 6) * rr, Math.sin(k * Math.PI / 6) * rr]);
    for (const [x, z] of pts) {
      const m: V3 = [c.n[0] + (e[0] * x + nn[0] * z) / R, c.n[1] + (e[1] * x + nn[1] * z) / R, c.n[2] + (e[2] * x + nn[2] * z) / R], l = Math.hypot(...m);
      hi = Math.max(hi, this.terrainAt(c.b, [m[0] / l, m[1] / l, m[2] / l], 0.5));
    }
    c.h0 = hi;
    return hi;
  }

  // ---------------------------------------------------------------- rockets
  /** where a rocket stands at a site (body-frame direction): a pad's landing circle, a base's pad */
  spot(site: Craft): V3 { return site.kind === 'pad' ? this.onBase(site, PAD.land.x, PAD.land.z) : this.onBase(site, BASE.pad.x, BASE.pad.z); }
  /** the rocket standing at a pad or base (or docked at a station), if one is */
  rocketAt(site: Craft) { return this.crafts.find(c => c.rocket && c.rocket.at === site.id && !c.rocket.trip) ?? null; }
  /** where rockets can go: built pads and bases, and stations in orbit */
  sites(): Craft[] { return this.crafts.filter(c => ((c.kind === 'pad' || c.kind === 'base') && c.state === 'surface' && c.build >= 1) || (c.kind === 'station' && c.state === 'orbit')); }

  /** stack a rocket on a pad or base: it goes up over fifteen seconds */
  stack(kind: RocketModel, site: Craft, fixed = false): Craft | string {
    if (site.kind !== 'pad' && site.kind !== 'base') return 'Rockets are stacked on a launch pad or a base’s pad';
    if (site.build < 1) return `${site.name} is still being built`;
    if (this.rocketAt(site)) return `There is a rocket on ${site.name} already`;
    const k = this.crafts.filter(c => c.rocket?.kind === kind).length + 1;
    const c = this.make('rocket', site.b, `${ROCKETS[kind].name.split(' ')[1]} ${k}`);
    c.mesh.add(rocketMesh(kind));
    c.fixed = fixed;
    c.rocket = { kind, at: site.id, docked: false, load: { crew: 0, supplies: 0, rover: false }, trip: null, aboard: false, flights: 0, doors: 0, home: null, route: null };
    c.n = this.spot(site); c.head = site.head; c.state = 'surface';
    c.build = fixed ? 1 : 0;
    c.status = fixed ? `on ${site.name}` : 'stacking';
    this.note(c, fixed ? `${ROCKETS[kind].name}, on ${site.name}` : `Stacking on ${site.name}`);
    return c;
  }

  /** send a rocket to a pad, base or station: '' if it goes, or why not */
  fly(c: Craft, dest: Craft): string {
    const r = c.rocket;
    if (!r) return 'Not a rocket';
    if (r.trip) return `${c.name} is in flight`;
    if (c.build < 1) return `${c.name} is still being stacked`;
    if (r.at === dest.id) return `${c.name} is there already`;
    if (dest.kind !== 'station' && this.rocketAt(dest)) return `${dest.name} has a rocket on it`;
    const from = r.at !== null ? this.byId(r.at) : null;
    if (!from) return `${c.name} has nowhere to fly from`;
    // what it carries comes out of where it is loaded: a base's or a station's stores and crew (a spaceport's are endless)
    if (from.kind === 'base' || from.kind === 'station') {
      const L = r.load, crew = from.crew ?? CREW0, stores = from.stores ?? STORES0;
      L.crew = Math.min(L.crew, crew);
      L.supplies = Math.min(L.supplies, Math.floor(stores / HOLD_DAYS));
      from.crew = crew - L.crew; from.stores = stores - L.supplies * HOLD_DAYS;
    }
    const fromGround = !r.docked, toGround = dest.kind !== 'station', hop = fromGround && toGround && from.b === dest.b;
    const dist = hop ? arc(c.n, this.spot(dest)) * c.b.r * AU_M : this.rocketPos(c).distanceTo(toGround ? this.spotPos(dest, 0) : this.dockPos(dest)) * AU_M;
    r.trip = { from: { site: from.id }, to: { site: dest.id }, t: 0, ...plan(hop, dist, fromGround, toGround) };
    r.home = from.id; r.at = null; r.docked = false; r.flights++;
    c.state = 'flight'; c.t = 0;
    c.status = `flying to ${dest.name}`;
    const L = r.load, what = [L.crew ? `${L.crew} crew` : '', L.supplies ? `${L.supplies * HOLD_DAYS} days of supplies` : '', L.rover ? 'a rover' : ''].filter(Boolean).join(', ');
    this.note(c, `Lift-off from ${from.name} for ${dest.name}${dest.b !== from.b ? `, on ${dest.b.name}` : ''}${what ? `, carrying ${what}` : ''}`, true);
    return '';
  }

  /** a site's rocket spot in the sandbox (AU), `up` m over it */
  private spotPos(site: Craft, up: number) {
    const b = site.b, n = this.spot(site), r = b.r * AU_M + this.heightAt(b, n, 0.5) + up;
    return new THREE.Vector3(n[0] * r, n[1] * r, n[2] * r).applyQuaternion(bodyQuat(b)).divideScalar(AU_M).add(new THREE.Vector3(b.x, b.y, b.z));
  }
  /** where a rocket docks at a station: alongside it (sandbox, AU) */
  private dockPos(st: Craft, k = 0) {
    const off = new THREE.Vector3(0, -30, 70 + 25 * k).applyQuaternion(this.quat(st)).divideScalar(AU_M);
    return new THREE.Vector3(...this.pos(st)).add(off);
  }

  /** where a rocket is in the sandbox (AU): on its pad, docked, or along its flight */
  private rocketPos(c: Craft): THREE.Vector3 {
    const r = c.rocket!, tr = r.trip;
    if (!tr) {
      const st = r.at !== null ? this.byId(r.at) : null;
      if (r.docked && st) return this.dockPos(st, this.crafts.filter(x => x.rocket?.docked && x.rocket.at === st.id && x.id < c.id).length);
      const p = this.localGround(c);
      return p.divideScalar(AU_M).add(new THREE.Vector3(c.b.x, c.b.y, c.b.z));
    }
    const from = this.byId(tr.from.site), to = this.byId(tr.to.site);
    if (!from || !to) return new THREE.Vector3(c.b.x, c.b.y, c.b.z);
    const ph = phase(tr);
    if (ph.part === 'climb') return from.kind === 'station' ? this.dockPos(from) : this.spotPos(from, ph.alt);
    if (ph.part === 'descent') return to.kind === 'station' ? this.dockPos(to) : this.spotPos(to, ph.alt);
    if (tr.hop) {
      // over the ground, along the great circle, the arc rising over the climb's top and falling to the descent's
      const n1 = this.spot(from), n2 = this.spot(to), u = ph.u, th = Math.max(1e-9, arc(n1, n2));
      const k1 = Math.sin((1 - u) * th) / Math.sin(th), k2 = Math.sin(u * th) / Math.sin(th);
      const n = new THREE.Vector3(n1[0] * k1 + n2[0] * k2, n1[1] * k1 + n2[1] * k2, n1[2] * k1 + n2[2] * k2).normalize();
      const b = from.b, h = (1 - u) * (this.heightAt(b, n1, 2) + tr.A1) + u * (this.heightAt(b, n2, 2) + tr.A2) + tr.apex * Math.sin(Math.PI * u);
      return n.multiplyScalar(b.r * AU_M + h).applyQuaternion(bodyQuat(b)).divideScalar(AU_M).add(new THREE.Vector3(b.x, b.y, b.z));
    }
    const a = from.kind === 'station' ? this.dockPos(from) : this.spotPos(from, tr.A1);
    const z = to.kind === 'station' ? this.dockPos(to) : this.spotPos(to, tr.A2);
    return a.lerp(z, ph.u);
  }
  /** on the ground: the plain way (m from its world's centre) */
  private localGround(c: Craft) {
    const R = c.b.r * AU_M + this.heightAt(c.b, c.n, 0.5);
    return new THREE.Vector3(c.n[0] * R, c.n[1] * R, c.n[2] * R).applyQuaternion(bodyQuat(c.b));
  }

  /** a rocket's attitude: nose up off the pad and down onto it, along its way between */
  private rocketQuat(c: Craft, q: THREE.Quaternion): THREE.Quaternion {
    const r = c.rocket!, tr = r.trip;
    if (!tr) { const st = r.at !== null ? this.byId(r.at) : null; return st ? this.quat(st, q) : q.identity(); }
    const ph = phase(tr), up = this.local(c).normalize();
    let dir = up;
    if (ph.part === 'cruise') {
      const t0 = tr.t;
      const a = this.rocketPos(c); tr.t = t0 + 0.25; const b = this.rocketPos(c); tr.t = t0;
      const v = b.sub(a);
      // (tipping over from the climb, and back upright for the descent)
      const w = Math.min(1, Math.min(ph.u, 1 - ph.u) / 0.12);
      if (v.lengthSq() > 0) dir = up.clone().lerp(v.normalize(), w).normalize();
    }
    return q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }

  /** keep a rocket flying a load from where it is to `dest` and coming back empty, until it is stopped: '' or why not */
  runRoute(c: Craft, dest: Craft): string {
    const r = c.rocket;
    if (!r || r.at === null) return 'Not a rocket on a pad';
    const route = { a: r.at, b: dest.id, load: { ...r.load }, runs: 1, wait: 0 };
    const why = this.fly(c, dest);
    if (why) return why;
    r.route = route;
    this.note(c, `On a supply route to ${dest.name} and back`, true);
    return '';
  }
  stopRoute(c: Craft) {
    const r = c.rocket;
    if (!r?.route) return;
    r.route = null;
    this.note(c, 'Off its supply route', true);
  }

  /** a rocket's frame: stacking, or along its flight; at the end, landed (or docked) and unloaded */
  private rocketStep(c: Craft, dt: number) {
    const r = c.rocket!;
    if (!r.trip) {
      if (c.build < 1) { c.build = Math.min(1, c.build + dt / 15); if (c.build >= 1) { const st = r.at !== null ? this.byId(r.at) : null; c.status = `on ${st?.name ?? 'the pad'}`; this.note(c, 'Stacked: ready to fly', true); } }
      // on a supply route: after the turnaround, the next leg (loaded at its home end, empty back to it)
      const rt = r.route;
      if (rt && c.build >= 1 && !r.aboard && (rt.wait -= dt) <= 0) {
        const home = r.at === rt.a, dest = this.byId(home ? rt.b : rt.a);
        if (!dest || !this.sites().includes(dest)) { this.stopRoute(c); return; }
        if (home) r.load = { ...rt.load };
        if (this.fly(c, dest)) { rt.wait = 10; return; }
        if (home) rt.runs++;
      }
      return;
    }
    const tr = r.trip, from = this.byId(tr.from.site), to = this.byId(tr.to.site);
    if (!from || !to) { r.trip = null; c.state = 'lost'; c.status = 'lost'; return; }
    tr.t += dt;
    // its world: where it left until half way, then where it is going
    const T = tr.Ta + tr.Tc + tr.Td;
    c.b = tr.t < tr.Ta + tr.Tc / 2 ? from.b : to.b;
    if (tr.t < T) return;
    // there
    r.trip = null; r.at = to.id; c.t = 0;
    if (to.kind === 'station') { r.docked = true; c.state = 'orbit'; c.status = `docked at ${to.name}`; }
    else { r.docked = false; c.state = 'surface'; c.b = to.b; c.n = this.spot(to); c.head = to.head; c.status = `on ${to.name}`; }
    const L = r.load, got: string[] = [];
    if (L.crew) { to.crew = (to.crew ?? CREW0) + L.crew; got.push(`${L.crew} crew aboard ${to.name} (now ${to.crew})`); }
    if (L.supplies) { to.stores = Math.round(((to.stores ?? STORES0) + L.supplies * HOLD_DAYS) * 10) / 10; got.push(`${L.supplies * HOLD_DAYS} days of supplies unloaded (${to.stores} in store)`); }
    if (L.rover && c.state === 'surface') { const rv = this.launch('rover', to.b, new THREE.Vector3(), null, c); rv.name = `${to.name} rover`; got.push(`${rv.name} rolled out`); }
    r.load = { crew: 0, supplies: 0, rover: false };
    if (r.route) r.route.wait = TURNAROUND;
    if (L.crew || L.supplies) { to.short = 0; to.warned = 0; }
    if (L.crew && /empty/.test(to.status)) to.status = to.kind === 'station' ? 'in orbit, crewed' : 'crewed';
    this.note(c, `${to.kind === 'station' ? 'Docked at' : 'Landed on'} ${to.name}${to.b !== from.b ? `, on ${to.b.name}` : ''}${got.length ? `: ${got.join('; ')}` : ''}`, true);
    this.onRocket(c, to);
  }
  /**
   * `days` go by for the crews of the bases and stations (on their own clock, a day a minute, as the growth
   * lab's): each eats into its stores, a crew of six a day a day. Short of stores, a warning; out of them, the
   * crew goes on emergency rations, and after ten days of those it leaves.
   */
  live(days: number) {
    if (!(days > 0)) return;
    for (const c of this.crafts) {
      if (!((c.kind === 'base' && c.state === 'surface' && c.build >= 1) || (c.kind === 'station' && c.state === 'orbit'))) continue;
      const crew = c.crew ?? CREW0;
      if (crew <= 0) continue;
      const left = Math.max(0, (c.stores ?? STORES0) - days * crew / CREW0);
      c.stores = Math.round(left * 1000) / 1000;
      c.crew = crew;
      if (left > 0) {
        if (left < LOW && !(c.warned ?? 0)) { c.warned = 1; this.note(c, `Stores low: ${Math.ceil(left)} days left for a crew of ${crew}. A supply flight is due`, true); }
        if (left >= LOW) c.warned = 0;
        c.status = `${c.kind === 'station' ? 'in orbit, crewed' : 'crewed'}${left < LOW ? ', stores low' : ''}`;
        continue;
      }
      c.short = (c.short ?? 0) + days;
      if ((c.warned ?? 0) < 2) { c.warned = 2; this.note(c, 'Out of supplies: the crew is on emergency rations', true); }
      c.status = `${c.kind === 'station' ? 'in orbit, crewed' : 'crewed'}, on emergency rations`;
      if (c.short >= RATIONS) {
        c.crew = 0; c.short = 0; c.warned = 0;
        c.status = c.kind === 'station' ? 'in orbit, empty' : 'empty';
        this.note(c, `The crew has left ${c.name}: ${RATIONS} days without supplies`, true);
      }
    }
  }

  /** a rocket has arrived (for the view: you step out of it, if you were aboard) */
  onRocket: (c: Craft, at: Craft) => void = () => {};

  /** the nearest base on a world to a point on it (body frame), and how far, m */
  nearestBase(b: Body, n: V3) {
    let best: Craft | null = null, bd = Infinity;
    for (const c of this.crafts) {
      if (c.kind !== 'base' || c.b !== b || c.build < 1) continue;
      const d = arc(c.n, n) * b.r * AU_M;
      if (d < bd) { bd = d; best = c; }
    }
    return best ? { c: best, d: bd } : null;
  }

  /** a point of a craft's own frame (m, as its model is built) in its world's frame (body frame, m from the centre) */
  bodyPoint(c: Craft, p: THREE.Vector3) {
    const w = p.clone().applyQuaternion(this.quat(c)).add(this.local(c));
    return w.applyQuaternion(bodyQuat(c.b).invert());
  }
  /** a direction on the ground (body frame) in a craft's own frame: x and z, m */
  toLocal(c: Craft, n: V3): { x: number; z: number } {
    const R = c.b.r * AU_M + this.level(c);
    const w = new THREE.Vector3(n[0] * R, n[1] * R, n[2] * R).applyQuaternion(bodyQuat(c.b)).sub(this.local(c)).applyQuaternion(this.quat(c).invert());
    return { x: w.x, z: w.z };
  }

  /** what is underfoot among a world's bases' buildings at n: a floor (m over the datum) or a wall */
  structureAt(b: Body, n: V3): { floor: number | null; solid: boolean } | null {
    const R = b.r * AU_M;
    for (const c of this.crafts) {
      if (c.kind !== 'base' || c.b !== b || c.state !== 'surface' || c.build < 1 || arc(c.n, n) * R > 60) continue;
      const l = this.toLocal(c, n), g = baseGround(l.x, l.z);
      if (g.building) return { floor: g.floor === null ? null : this.level(c) + g.floor, solid: g.solid };
    }
    return null;
  }

  /** the same, as a direction on the ground */
  onBase(c: Craft, x: number, z: number): V3 {
    const w = this.bodyPoint(c, new THREE.Vector3(x, 0, z)).normalize();
    return [w.x, w.y, w.z];
  }

  remove(c: Craft) {
    const k = this.crafts.indexOf(c);
    if (k >= 0) this.crafts.splice(k, 1);
    this.root.remove(c.mesh);
  }

  byId(id: number) { return this.crafts.find(c => c.id === id) ?? null; }
  on(b: Body) { return this.crafts.filter(c => c.b === b); }

  /** a landing site for a world: a real one by name, else a seeded spot on dry land */
  siteFor(b: Body, name?: string): V3 | null {
    const s = sitesOn(b.look.real).find(x => x.name === name);
    if (s) return dirOf(s.lat, s.lon);
    return null;
  }

  /** the labels for craft near enough to see: their world position from the viewer */
  labels(P: V3): { key: string; text: string; at: THREE.Vector3 }[] {
    const out: { key: string; text: string; at: THREE.Vector3 }[] = [];
    for (const c of this.crafts) {
      if (c.state === 'lost' && c.kind !== 'base') continue;
      const p = this.local(c);
      const at = new THREE.Vector3(c.b.x - P[0], c.b.y - P[1], c.b.z - P[2]).multiplyScalar(AU_M).add(p);
      if (at.length() > (c.state === 'surface' ? 2e5 : Math.max(5e7, c.b.r * AU_M * 20))) continue;
      out.push({ key: `craft:${c.id}`, text: `${c.name} · ${c.status}`, at });
    }
    return out;
  }

  /** for a rover the ground it is near: arc distance to another craft, m */
  dist(a: Craft, b: Craft) { return a.b === b.b ? arc(a.n, b.n) * a.b.r * AU_M : Infinity; }
}

const smooth = (t: number) => t * t * (3 - 2 * t);
export const pct = (x: number) => x >= 0.001 ? `${(x * 100).toPrecision(x >= 0.1 ? 4 : 3)}%` : `${(x * 1e6).toPrecision(3)} ppm`;
export const fmtLL = (la: number, lo: number) => `${Math.abs(la).toFixed(2)}°${la >= 0 ? 'N' : 'S'} ${Math.abs(lo).toFixed(2)}°${lo >= 0 ? 'E' : 'W'}`;
