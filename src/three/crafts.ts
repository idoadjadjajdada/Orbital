import * as THREE from 'three';
import type { Body } from '../physics/body';
import { AU_M, KM } from '../physics/units';
import { makeBody } from '../physics/catalog';
import { maps } from '../pixel/maps';
import type { View3D } from './view3d';
import type { Mover } from './ship';
import { frameOf, toWorld, toLocal, quatOf } from './ground';
import { terrainSrc, heightAt, tangent, latLon, type TerrainSrc, type V3 } from './terrain';
import { airAt } from './science';
import { gravity, solid, giant } from './landing';
import { probeMesh, orbiterMesh, landerMesh, roverMesh, stationMesh, baseMesh } from './craftmesh';

/**
 * Everything sent out from the ship: probes that fall through an atmosphere
 * reporting as they go (until the pressure crushes them), orbiters and
 * stations that circle a world for real in the simulation, robotic landers,
 * rovers you can drive, bases built on the ground, and the hangar's own
 * crewed lander, which you fly yourself.
 *
 * A craft is in transit from the ship for a few seconds, then in orbit,
 * coming down, on the ground, or lost. Its telemetry goes into its log and,
 * for anything it learns, into the ship's science.
 */

export type CraftKind = 'probe' | 'orbiter' | 'lander' | 'rover' | 'station' | 'base' | 'shuttle';
export type CraftState = 'transit' | 'orbit' | 'descent' | 'landed' | 'flying' | 'building' | 'active' | 'lost' | 'docked';

export interface Craft {
  id: number; kind: CraftKind; name: string; target: Body;
  state: CraftState; t: number;
  /** in transit: where it started, relative to the target (AU), and how long it takes (s) */
  from: V3; dur: number;
  /** over the target: direction (body frame), height above the ground (m), heading (rad from north), speed down (m/s) */
  n: V3; alt: number; heading: number; vdown: number;
  /** a body in the simulation, for what orbits */
  body: Body | null;
  /** free flight (the crewed lander): where, and its attitude */
  nav: Mover | null; quat: THREE.Quaternion;
  log: { t: number; text: string }[];
  /** what a probe has read on the way down */
  profile: { altKm: number; bar: number; K: number }[];
  mesh: THREE.Group;
  /** the camera's angle round it */
  camYaw: number; camPitch: number; camDist: number;
  /** a probe's next reading, as log10 of the pressure; a lander's instruments run once */
  nextBar: number; done: boolean;
  /** the crewed lander bringing itself down */
  autoland?: boolean;
}

const ICON: Record<CraftKind, string> = { probe: '🪂', orbiter: '🛰', lander: '🦿', rover: '🚙', station: '🏗', base: '🏠', shuttle: '🚀' };
const NAMES: Record<CraftKind, string> = { probe: 'Probe', orbiter: 'Orbiter', lander: 'Lander', rover: 'Rover', station: 'Station', base: 'Base', shuttle: 'Lander 1' };
/** what the descent clock runs at, so a fall that took Galileo an hour takes a couple of minutes */
const DESCENT_RATE = 30;

export class Fleet {
  readonly crafts: Craft[] = [];
  /** the craft in hand, and whether you drive it or just watch */
  current: Craft | null = null;
  driving = false;
  /** where you were on the ship before taking a craft's controls */
  private back: { mode: View3D['mode'] } | null = null;
  private seq = 0;
  private counts = new Map<CraftKind, number>();
  private ground = new Map<Body, TerrainSrc>();
  readonly group = new THREE.Group();

  constructor(private v: View3D) {
    v.scene.add(this.group);
    this.group.frustumCulled = false;
  }

  /** the shuttle, if it has left the hangar */
  get shuttle() { return this.crafts.find(c => c.kind === 'shuttle' && c.state !== 'docked') ?? null; }

  icon(c: Craft) { return ICON[c.kind]; }

  // ---------------------------------------------------------------- the ground under a craft
  /** the height of the ground (m) under a direction on a world */
  groundH(b: Body, n: V3): number {
    const L = this.v.landing;
    if (L.ground.body === b && L.ground.src) return L.ground.heightAt(n);
    if (!solid(b)) return 0;
    let t = this.ground.get(b);
    if (!t || t.w < 512) {
      const m = maps.want(b.look, 512);
      if (!t || m.w > t.w) { t = terrainSrc(b, m); this.ground.set(b, t); }
    }
    return heightAt(t, n, 2);
  }

  /** the point (AU) at height `h` over the ground at `n` on a world */
  at(b: Body, n: V3, h: number): V3 {
    const R = b.r * AU_M + (solid(b) ? this.groundH(b, n) : 0) + h;
    const w = toWorld(frameOf(b), [n[0] * R, n[1] * R, n[2] * R]);
    return [b.x + w[0] / AU_M, b.y + w[1] / AU_M, b.z + w[2] / AU_M];
  }

  /** where a craft is (AU) */
  pos(c: Craft): V3 {
    const b = c.target;
    if (c.body && c.body.alive) return [c.body.x, c.body.y, c.body.z];
    if (c.nav) { const a = c.nav.anchor; return [(a?.x ?? 0) + c.nav.off[0], (a?.y ?? 0) + c.nav.off[1], (a?.z ?? 0) + c.nav.off[2]]; }
    if (c.state === 'transit') {
      const end = this.at(b, c.n, c.alt);
      const u = Math.min(1, c.t / c.dur), e = u * u * (3 - 2 * u);
      return [b.x + c.from[0] + (end[0] - b.x - c.from[0]) * e, b.y + c.from[1] + (end[1] - b.y - c.from[1]) * e, b.z + c.from[2] + (end[2] - b.z - c.from[2]) * e];
    }
    return this.at(b, c.n, c.alt);
  }

  // ---------------------------------------------------------------- sending things out
  /** why a kind of craft cannot go to a world now, or '' */
  block(kind: CraftKind, b: Body | null): string {
    const v = this.v;
    if (!b || !b.alive) return 'Pick a target';
    if (b.look.craft) return 'That is a spacecraft';
    const S = v.shipPos();
    const d = Math.hypot(S[0] - b.x, S[1] - b.y, S[2] - b.z);
    if (d > 3) return `Too far: get within 3 AU (${d.toFixed(1)} AU)`;
    if (v.ship.worm) return 'Not during a wormhole transit';
    const star = ['star', 'wd', 'ns'].includes(b.cls), hole = b.cls === 'bh' || !!b.look.wormhole || !!b.look.white;
    switch (kind) {
      case 'probe': return '';
      case 'orbiter': case 'station': return star ? 'Too hot to orbit close' : hole ? 'Nothing stays in orbit that close to a hole' : '';
      case 'lander': case 'rover': case 'base':
        if (!solid(b)) return giant(b) ? 'A giant has no ground: send a probe instead' : 'Nothing to land on';
        if (kind === 'base') {
          const L = v.landing;
          if (!(L.landed?.b === b || (L.shipBody === b && L.shipAgl < 50000))) return `Fly down within 50 km of ${b.name}’s ground (or land) to choose the site`;
        }
        return '';
      default: return '';
    }
  }

  /** send a craft to a world */
  deploy(kind: CraftKind, b: Body): Craft | null {
    const v = this.v, why = this.block(kind, b);
    if (why) { v.app.onToast(why); return null; }
    const S = v.shipPos();
    const from: V3 = [S[0] - b.x, S[1] - b.y, S[2] - b.z];
    const R = b.r * AU_M;
    // where it is going: under the ship if it is low over the ground, otherwise the side facing the ship
    const L = v.landing;
    const low = (L.landed?.b === b || L.shipBody === b) && L.shipAgl < 2e5;
    let n: V3 = L.landed?.b === b ? [...L.landed.n] as V3 : L.over(b, S).n;
    if (kind === 'lander' || kind === 'rover' || kind === 'base') {
      // a little way off: next to the ship if it is down here, a few km off otherwise
      const off = (low ? (kind === 'base' ? 140 : 60) : 3000 + Math.random() * 4000) / R;
      const [e, nn] = tangent(n);
      const a = Math.random() * Math.PI * 2;
      n = [n[0] + (e[0] * Math.cos(a) + nn[0] * Math.sin(a)) * off, n[1] + (e[1] * Math.cos(a) + nn[1] * Math.sin(a)) * off, n[2] + (e[2] * Math.cos(a) + nn[2] * Math.sin(a)) * off];
      const l = Math.hypot(...n);
      n = [n[0] / l, n[1] / l, n[2] / l];
    }
    const air = v.science.atmosphere(b);
    const top = air.exists ? Math.max(air.scaleHeightKm * 1000 * 12, 5e4) : 2e4;
    const alt = kind === 'probe' ? top : kind === 'orbiter' || kind === 'station' ? Math.max(kind === 'station' ? 4e5 : 2.5e5, R * (kind === 'station' ? 0.06 : 0.12)) : kind === 'base' ? 1500 : Math.min(top, 2.5e4);
    const dist = Math.max(0, Math.hypot(...from) * AU_M - R);
    const k = (this.counts.get(kind) ?? 0) + 1;
    this.counts.set(kind, k);
    const c: Craft = {
      id: ++this.seq, kind, name: `${NAMES[kind]} ${k} · ${b.name}`, target: b, state: 'transit', t: 0, from, dur: Math.max(4, Math.min(25, 3 + dist / 4e6)),
      n, alt, heading: Math.random() * Math.PI * 2, vdown: 0, body: null, nav: null, quat: new THREE.Quaternion(),
      log: [], profile: [], mesh: this.meshFor(kind), camYaw: 0, camPitch: 0.35, camDist: CAM[kind], nextBar: -4, done: false,
    };
    this.crafts.push(c);
    this.group.add(c.mesh);
    this.say(c, `Launched for ${b.name}: arriving in ${Math.round(c.dur)} s`);
    v.app.onToast(`${c.name} launched`);
    return c;
  }

  private meshFor(kind: CraftKind) {
    const m = kind === 'probe' ? probeMesh() : kind === 'orbiter' ? orbiterMesh() : kind === 'lander' ? landerMesh() : kind === 'rover' ? roverMesh() : kind === 'station' ? stationMesh() : kind === 'base' ? baseMesh() : this.v.ship.hull.lander.clone();
    m.traverse(o => { o.frustumCulled = false; });
    return m;
  }

  private say(c: Craft, text: string) {
    c.log.unshift({ t: this.v.app.world.time, text });
    if (c.log.length > 40) c.log.pop();
  }

  /** lose a craft (signal gone, crushed, ...) */
  private lose(c: Craft, why: string) {
    c.state = 'lost';
    this.say(c, why);
    this.v.app.onToast(`${c.name}: ${why}`);
    this.v.science.note(`${c.name}: ${why}`);
    if (this.current === c) this.release();
  }

  /** take the crewed lander out of the hangar, with you aboard */
  launchShuttle() {
    const v = this.v, sh = v.ship;
    let c = this.crafts.find(x => x.kind === 'shuttle');
    if (c && c.state !== 'docked') { v.app.onToast('Lander 1 is already out'); return; }
    if (sh.worm) { v.app.onToast('Not during a wormhole transit'); return; }
    if (!c) {
      c = { id: ++this.seq, kind: 'shuttle', name: 'Lander 1', target: sh.nav.anchor ?? v.app.world.sources[0], state: 'flying', t: 0, from: [0, 0, 0], dur: 0,
        n: [0, 0, 1], alt: 0, heading: 0, vdown: 0, body: null, nav: null, quat: new THREE.Quaternion(), log: [], profile: [], mesh: this.meshFor('shuttle'),
        camYaw: 0, camPitch: 0.3, camDist: CAM.shuttle, nextBar: 0, done: false };
      this.crafts.push(c);
      this.group.add(c.mesh);
    }
    // out of the bay doors, below the ship, with the ship's heading
    const drop = new THREE.Vector3(0.6, -9, 12.5).applyQuaternion(sh.quat);
    const n = sh.nav;
    c.nav = { anchor: n.anchor, off: [n.off[0] + drop.x / AU_M, n.off[1] + drop.y / AU_M, n.off[2] + drop.z / AU_M], vel: [...n.vel] as V3 };
    c.quat.copy(sh.quat);
    c.state = 'flying';
    c.target = n.anchor ?? c.target;
    sh.hull.lander.visible = false;
    sh.hull.setBay(1);
    this.say(c, 'Undocked from the ship');
    this.take(c, true);
    v.app.onToast('Lander 1 away. WASD and Space/C fly it, L lands, F docks when you are back by the ship');
  }

  /** take a craft's camera, and its controls if it can be driven */
  take(c: Craft, drive = false) {
    const v = this.v;
    if (c.state === 'lost') { v.app.onToast(`${c.name} is lost`); return; }
    if (!this.back && v.mode !== 'craft') this.back = { mode: v.mode };
    this.current = c;
    this.driving = drive && (c.kind === 'rover' || c.kind === 'shuttle');
    v.panels.close();
    v.mode = 'craft';
    v.onCraftStep = dt => this.drive(dt);
    v.onCraftTurn = (y, p) => this.turnCam(y, p);
    v.onLeaveCraft = () => this.release();
    v.craftLand = () => this.landShuttle();
    v.onScan = () => this.scanHere();
  }

  /** back to the ship */
  release() {
    const v = this.v, c = this.current;
    if (c?.kind === 'shuttle' && c.state !== 'docked' && this.driving) { v.app.onToast('You are aboard Lander 1: land it and step out, or fly back to the ship and dock (F)'); return; }
    this.current = null;
    this.driving = false;
    v.onCraftStep = null; v.onCraftTurn = null; v.onLeaveCraft = null; v.craftLand = null;
    v.onScan = () => v.scanOnFoot();
    if (v.mode === 'craft') v.mode = this.back?.mode && this.back.mode !== 'craft' ? this.back.mode : 'walk';
    this.back = null;
  }

  scrap(c: Craft) {
    if (this.current === c) this.release();
    if (c.kind === 'shuttle') { this.v.app.onToast('Lander 1 is the ship’s own: fly it home instead'); return; }
    if (c.body?.alive) { this.v.app.world.kill(c.body); this.v.app.world.structural(); }
    this.group.remove(c.mesh);
    this.crafts.splice(this.crafts.indexOf(c), 1);
  }

  // ---------------------------------------------------------------- each frame
  update(dt: number) {
    for (const c of this.crafts) {
      if (!c.target.alive && c.state !== 'lost' && c.kind !== 'shuttle') this.lose(c, `${c.target.name} is gone`);
      if (c.state === 'lost' || c.state === 'docked') continue;
      c.t += dt;
      switch (c.state) {
        case 'transit': if (c.t >= c.dur) this.arrive(c); break;
        case 'orbit': if (c.body && !c.body.alive) this.lose(c, 'Signal lost: it hit something'); break;
        case 'descent': this.descend(c, dt); break;
        case 'building': if (c.t > 12) { c.state = 'active'; c.t = 0; this.say(c, 'Built: habitat pressurised, solar field and antenna up, crew of 6 moving in'); this.v.app.onToast(`${c.name} is built`); } break;
        case 'landed': this.surface(c); break;
      }
    }
  }

  /** the end of the transit: into orbit, into the air, or down */
  private arrive(c: Craft) {
    const v = this.v, b = c.target;
    c.t = 0;
    if (c.kind === 'orbiter' || c.kind === 'station') {
      // a circular orbit over the equator, prograde, at the chosen height
      const r = b.r + c.alt / AU_M;
      const f = frameOf(b);
      const S = this.at(b, c.n, c.alt);
      let p = new THREE.Vector3(S[0] - b.x, S[1] - b.y, S[2] - b.z);
      const ax = new THREE.Vector3(...f[2]);
      p.addScaledVector(ax, -p.dot(ax));
      if (p.lengthSq() < 1e-30) p = new THREE.Vector3(...f[0]);
      p.normalize().multiplyScalar(r);
      const vc = Math.sqrt(4 * Math.PI * Math.PI * b.m / r);
      const t = new THREE.Vector3().crossVectors(ax, p).normalize().multiplyScalar(vc);
      const body = makeBody(c.kind === 'station' ? 'iss' : 'starlink', Math.floor(Math.random() * 1e9), c.name);
      body.setPos(b.x + p.x, b.y + p.y, b.z + p.z);
      body.setVel(b.vx + t.x, b.vy + t.y, b.vz + t.z);
      v.app.world.add(body);
      c.body = body;
      c.state = 'orbit';
      const km = c.alt / 1000;
      const period = 2 * Math.PI * Math.sqrt(r ** 3 / (4 * Math.PI * Math.PI * b.m)) * 365.25 * 24;
      this.say(c, `In orbit ${km.toFixed(0)} km up, one lap every ${period < 48 ? `${period.toFixed(1)} h` : `${(period / 24).toFixed(1)} d`}`);
      if (c.kind === 'orbiter') {
        v.science.learn(b, 'spectra');
        v.science.learn(b, 'mapped');
        const a = v.science.atmosphere(b);
        this.say(c, a.exists ? `Spectrometer: ${a.gases.slice(0, 3).map(g => `${g.formula} ${(g.frac * 100).toFixed(1)}%`).join(', ')}` : 'Spectrometer: no atmosphere');
        this.say(c, `Mapping ${b.name} from pole to pole`);
      } else this.say(c, 'Station on station: crew of 7, docking ports open');
      v.app.onToast(`${c.name} is in orbit`);
      return;
    }
    c.state = 'descent';
    const a = v.science.atmosphere(b);
    c.vdown = a.exists ? 6000 : c.kind === 'probe' ? 1700 : 400;
    this.say(c, a.exists ? `Entry interface, ${(c.alt / 1000).toFixed(0)} km up: heat shield glowing` : `Falling from ${(c.alt / 1000).toFixed(0)} km`);
  }

  /** coming down: through the air (a probe reporting all the way), or under rockets */
  private descend(c: Craft, dt: number) {
    const v = this.v, b = c.target, a = v.science.atmosphere(b);
    const g = gravity(b) * Math.pow(b.r * AU_M / (b.r * AU_M + Math.max(0, c.alt)), 2);
    const k = c.kind === 'probe' ? DESCENT_RATE : 6;
    if (a.exists) {
      const s = airAt(a, b, c.alt);
      // falling at the speed the air allows: a heat shield, then a parachute
      const chute = c.kind === 'probe' ? (s.bar > 0.02 || c.vdown < 250) : s.bar > 0.005;
      const area = chute ? 40 : 1.4, mass = c.kind === 'probe' ? 340 : 900;
      const term = Math.sqrt(2 * mass * g / Math.max(1e-9, s.rho * 1.2 * area));
      c.vdown += (Math.min(term, 7000) - c.vdown) * Math.min(1, dt * 0.8);
      const chuteMesh = c.mesh.getObjectByName('chute');
      if (chuteMesh) chuteMesh.visible = chute;
      // a probe reports every half a decade of pressure
      if (c.kind === 'probe' && s.bar > 1e-6 && Math.log10(s.bar) >= c.nextBar) {
        c.nextBar = Math.floor(Math.log10(s.bar) * 2) / 2 + 0.5;
        c.profile.push({ altKm: c.alt / 1000, bar: s.bar, K: s.K });
        this.say(c, `${(c.alt / 1000).toFixed(1)} km · ${s.bar < 0.01 ? s.bar.toExponential(1) : s.bar.toFixed(s.bar < 1 ? 3 : 1)} bar · ${Math.round(s.K)} K`);
        v.science.learn(b, 'sampled');
        if (c.profile.length === 1) this.say(c, `Mass spectrometer: ${a.gases.slice(0, 4).map(x => `${x.formula} ${(x.frac * 100).toFixed(x.frac < 0.01 ? 2 : 1)}%`).join(', ')}`);
      }
      // the air crushes or cooks it
      if (c.kind === 'probe' && (s.bar > 120 || s.K > 1100)) { this.lose(c, `Signal lost ${(c.alt / 1000).toFixed(0)} km down, at ${s.bar.toFixed(0)} bar and ${Math.round(s.K)} K: crushed and melted`); return; }
    } else {
      // no air: rockets for a lander, a free fall for an impactor
      c.vdown = c.kind === 'probe' ? c.vdown + g * dt * k : Math.max(2, Math.min(c.vdown, c.alt * 0.1));
    }
    if (c.kind !== 'probe' && !a.exists) c.vdown = Math.max(2, Math.min(c.vdown, c.alt * 0.1 + 2));
    if (c.kind !== 'probe' && a.exists && c.alt < 2000) c.vdown = Math.max(1.5, Math.min(c.vdown, c.alt * 0.08 + 1.5));
    c.alt -= c.vdown * dt * (c.kind === 'probe' ? k : 1);
    if (c.alt > 0) return;
    c.alt = 0;
    if (!solid(b)) { this.lose(c, 'Gone into the deep'); return; }
    if (c.kind === 'probe' && (!a.exists || c.vdown > 30)) {
      // an impact: a crater, and a flash of the ground's spectrum
      const D = Math.max(8, 0.02 * c.vdown);
      b.craters.push({ x: c.n[0], y: c.n[1], z: c.n[2], a: D / 2 / (b.r * AU_M), t: v.app.world.time });
      const comp = v.science.composition(b);
      this.lose(c, `Impact at ${(c.vdown / 1000).toFixed(1)} km/s, leaving a ${D.toFixed(0)} m crater. Ejecta spectrum: ${comp.surface.slice(0, 3).map(s => s.name).join(', ')}`);
      return;
    }
    c.state = c.kind === 'base' ? 'building' : 'landed';
    c.t = 0;
    const [la, lo] = latLon(c.n);
    this.say(c, `Down at ${Math.abs(la).toFixed(2)}°${la >= 0 ? 'N' : 'S'} ${Math.abs(lo).toFixed(2)}°${lo >= 0 ? 'E' : 'W'}`);
    v.app.onToast(`${c.name} has landed`);
    if (c.kind === 'base') this.say(c, 'Unpacking: inflating the habitats, unrolling the solar field');
  }

  /** on the ground: a lander's instruments; and anything there that the heat will kill */
  private surface(c: Craft) {
    const v = this.v, b = c.target;
    if (!c.done && c.t > 2 && (c.kind === 'lander' || c.kind === 'probe')) {
      c.done = true;
      for (const f of v.science.scan(b, c.n, 0, c.name, c.id)) this.say(c, f.text);
    }
    const a = v.science.atmosphere(b);
    if (a.surfaceK > 650 && c.t > 90 && c.state === 'landed') this.lose(c, `Overheated after ${Math.round(c.t / 60 * 60)} minutes on the surface at ${Math.round(a.surfaceK)} K (Venera 13 lasted 127)`);
  }

  // ---------------------------------------------------------------- in hand
  private turnCam(yaw: number, pitch: number) {
    const c = this.current;
    if (!c) return;
    if (this.driving && c.kind === 'shuttle') {
      const t = new THREE.Quaternion();
      t.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw); c.quat.multiply(t);
      t.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch); c.quat.multiply(t);
      c.quat.normalize();
      return;
    }
    c.camYaw -= yaw;
    c.camPitch = Math.max(-0.2, Math.min(1.45, c.camPitch + pitch));
  }

  /** driving a rover, flying the lander */
  private drive(dt: number) {
    const c = this.current;
    if (!c || !this.driving) return;
    if (c.kind === 'rover') this.roverStep(c, dt);
    else if (c.kind === 'shuttle') this.shuttleStep(c, dt);
  }

  private roverStep(c: Craft, dt: number) {
    if (c.state !== 'landed') return;
    const inp = this.v.controls.walkInput();
    const b = c.target, R = b.r * AU_M;
    const sp = (inp.run ? 20 : 6) * inp.f;
    c.heading += inp.s * dt * 0.9 * (inp.f < 0 ? -1 : 1);
    const [e, nn] = tangent(c.n);
    const step = sp * dt;
    const fwd: V3 = [nn[0] * Math.cos(c.heading) + e[0] * Math.sin(c.heading), nn[1] * Math.cos(c.heading) + e[1] * Math.sin(c.heading), nn[2] * Math.cos(c.heading) + e[2] * Math.sin(c.heading)];
    let n: V3 = [c.n[0] * R + fwd[0] * step, c.n[1] * R + fwd[1] * step, c.n[2] * R + fwd[2] * step];
    const l = Math.hypot(...n);
    n = [n[0] / l, n[1] / l, n[2] / l];
    const rise = this.groundH(b, n) - this.groundH(b, c.n);
    if (Math.abs(step) < 1e-6 || rise / Math.abs(step) < 0.7) c.n = n;
    for (const w of c.mesh.children) if (w.name === 'wheel') w.rotation.x += step / 0.3;
  }

  /** the crewed lander: thrust against gravity, a hover hold when you let go, and a touchdown */
  private shuttleStep(c: Craft, dt: number) {
    const v = this.v, L = v.landing;
    if (c.state === 'landed') {
      if (v.controls.moving()) { c.state = 'flying'; c.nav = { anchor: c.target, off: this.offOf(c.target, this.at(c.target, c.n, 1.5)), vel: [0, 0, 0] }; this.say(c, `Lifted off from ${c.target.name}`); }
      else return;
    }
    const nav = c.nav!;
    // ride with what pulls hardest
    const P = this.pos(c);
    const near = v.nearest(P).b;
    if (near && near !== nav.anchor) { nav.off = [P[0] - near.x, P[1] - near.y, P[2] - near.z]; nav.anchor = near; }
    const b = nav.anchor;
    const vel = new THREE.Vector3(...nav.vel);
    const want = v.controls.thrust(1, c.quat);
    const acc = new THREE.Vector3(...want).multiplyScalar(12);
    let up = new THREE.Vector3(0, 1, 0);
    let agl = Infinity;
    if (b) {
      const o = L.over(b, P);
      const gh = solid(b) ? this.groundH(b, o.n) : 0;
      agl = o.r - b.r * AU_M - gh;
      up = new THREE.Vector3(...toWorld(frameOf(b), o.n));
      const g = gravity(b) * Math.pow(b.r * AU_M / o.r, 2);
      // gravity, and the hover hold that cancels it while near the ground
      acc.addScaledVector(up, -g);
      const idle = Math.abs(want[0]) + Math.abs(want[1]) + Math.abs(want[2]) < 1e-3;
      if (!idle) c.autoland = false;
      if (c.autoland && solid(b)) {
        // straight down, slowing as the ground comes up
        acc.addScaledVector(up, g);
        const target = up.clone().multiplyScalar(-Math.max(1.2, Math.min(120, agl * 0.18)));
        vel.lerp(target, Math.min(1, dt * 1.5));
      } else if (agl < 5e4 && idle) { acc.addScaledVector(up, g); vel.multiplyScalar(Math.max(0, 1 - dt * 0.6)); }
      else if (agl < 5e4) acc.addScaledVector(up, g);
      // level itself low down
      if (agl < 3000) {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quat);
        fwd.addScaledVector(up, -fwd.dot(up)).normalize();
        const x = new THREE.Vector3().crossVectors(fwd, up);
        c.quat.slerp(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, fwd.clone().negate())), Math.min(1, dt * 1.5));
      }
      // atmospheric drag
      const a = v.science.atmosphere(b);
      if (a.exists && solid(b)) { const s = airAt(a, b, Math.max(0, agl)); vel.multiplyScalar(Math.max(0, 1 - dt * Math.min(2, s.rho * 0.02))); }
    }
    vel.addScaledVector(acc, dt);
    nav.vel = [vel.x, vel.y, vel.z];
    for (let k = 0; k < 3; k++) nav.off[k] += (nav.vel[k] * dt) / AU_M;
    if (b && solid(b) && agl < 1.5) {
      const P2 = this.pos(c);
      const o = L.over(b, P2);
      const hard = vel.length();
      if (vel.dot(up) < 0 || agl < 1.2) {
        c.n = o.n; c.alt = 0; c.target = b;
        if (hard > 4) this.say(c, `Hard landing at ${hard.toFixed(0)} m/s: legs held`);
        c.state = 'landed'; c.nav = null; c.autoland = false;
        c.heading = L.heading(b, o.n, new THREE.Vector3(0, 0, -1).applyQuaternion(c.quat));
        this.say(c, `Down on ${b.name}`);
        v.app.onToast(`Lander 1 down on ${b.name}. F steps out; Space lifts off`);
      }
    }
    v.ship.thrust = 0;
  }

  private offOf(b: Body, p: V3): V3 { return [p[0] - b.x, p[1] - b.y, p[2] - b.z]; }

  /** L in the lander: straight down, gently */
  landShuttle() {
    const c = this.current;
    if (!c || c.kind !== 'shuttle') { this.v.app.onToast('Only Lander 1 lands under your hand'); return; }
    if (c.state === 'landed') { c.state = 'flying'; c.nav = { anchor: c.target, off: this.offOf(c.target, this.at(c.target, c.n, 2)), vel: [0, 0, 0] }; const up = toWorld(frameOf(c.target), c.n); c.nav.vel = [up[0] * 6, up[1] * 6, up[2] * 6]; return; }
    const b = c.nav?.anchor;
    if (!b || !solid(b)) { this.v.app.onToast('Nothing below to land on'); return; }
    c.autoland = true;
    this.v.app.onToast('Lander 1 coming down');
  }

  /** the scanner, wherever you are in charge */
  private scanHere() {
    const c = this.current, v = this.v;
    if (!c) return;
    if (c.state !== 'landed' && c.state !== 'active') { v.app.onToast(`${c.name} can scan once it is on the ground`); return; }
    const fs = v.science.scan(c.target, c.n, 0, c.name, Math.floor(performance.now()));
    for (const f of fs) this.say(c, f.text);
    v.showFindings(fs);
  }

  /** what a walker or a craft's driver can do near a craft on the ground */
  near(b: Body, n: V3, R: number): Craft | null {
    let best: Craft | null = null, bd = 6;
    for (const c of this.crafts) {
      if (c.target !== b || (c.state !== 'landed' && c.state !== 'active' && c.state !== 'building')) continue;
      const d = Math.acos(Math.min(1, c.n[0] * n[0] + c.n[1] * n[1] + c.n[2] * n[2])) * R;
      const reach = c.kind === 'base' ? 30 : 6;
      if (d < reach && d < bd + (c.kind === 'base' ? 30 : 0)) { bd = d; best = c; }
    }
    return best;
  }

  /** step out of the landed lander onto the ground */
  stepOut() {
    const c = this.current, v = this.v;
    if (!c || c.kind !== 'shuttle' || c.state !== 'landed') return;
    const b = c.target, R = b.r * AU_M;
    const [e, nn] = tangent(c.n);
    const off = 4 / R;
    const side: V3 = [e[0] * Math.cos(c.heading) - nn[0] * Math.sin(c.heading), e[1] * Math.cos(c.heading) - nn[1] * Math.sin(c.heading), e[2] * Math.cos(c.heading) - nn[2] * Math.sin(c.heading)];
    let n: V3 = [c.n[0] + side[0] * off, c.n[1] + side[1] * off, c.n[2] + side[2] * off];
    const l = Math.hypot(...n);
    n = [n[0] / l, n[1] / l, n[2] / l];
    this.current = null; this.driving = false;
    v.onCraftStep = null; v.onCraftTurn = null; v.onLeaveCraft = null; v.craftLand = null;
    v.onScan = () => v.scanOnFoot();
    this.back = null;
    v.landing.walker = { b, n, yaw: c.heading + Math.PI / 2, pitch: 0, h: 0, vh: 0 };
    v.mode = 'ground';
    v.logbook.walks++;
    v.app.onToast(`On ${b.name}. Walk back to Lander 1 to board it`);
  }

  /** back aboard the landed lander, from the ground */
  board(c: Craft) {
    this.v.landing.walker = null;
    this.take(c, true);
  }

  /** dock with the ship */
  dock() {
    const c = this.current, v = this.v;
    if (!c || c.kind !== 'shuttle') return;
    c.state = 'docked';
    c.nav = null;
    v.ship.hull.lander.visible = true;
    v.ship.hull.setBay(0);
    this.current = null; this.driving = false;
    v.onCraftStep = null; v.onCraftTurn = null; v.onLeaveCraft = null; v.craftLand = null;
    v.onScan = () => v.scanOnFoot();
    this.back = null;
    v.mode = 'walk';
    v.foot.deck = 1;
    v.foot.p.set(-2.6, 0, 12.5);
    v.foot.yaw = -Math.PI / 2; v.foot.pitch = 0;
    v.app.onToast('Docked. Lander 1 is back in the hangar');
  }

  /** what the craft in hand lets you do now */
  prompt(): { label: string; act: () => void } | null {
    const c = this.current, v = this.v;
    if (!c) return null;
    if (c.kind === 'shuttle' && this.driving) {
      if (c.state === 'landed') return { label: 'Step out', act: () => this.stepOut() };
      const S = v.shipPos(), P = this.pos(c);
      if (Math.hypot(S[0] - P[0], S[1] - P[1], S[2] - P[2]) * AU_M < 120) return { label: 'Dock with the ship', act: () => this.dock() };
    }
    if (c.kind === 'rover' && c.state === 'landed' && this.driving) return { label: 'Scan here', act: () => this.scanHere() };
    return null;
  }

  // ---------------------------------------------------------------- drawing
  /** place the craft for this frame, from the viewer at `P` (AU) */
  draw(P: V3, light: THREE.Vector3 | null) {
    const t = performance.now() / 1000;
    for (const c of this.crafts) {
      const m = c.mesh;
      if (c.state === 'docked' || c.state === 'lost' && c.kind !== 'base') { m.visible = false; continue; }
      const p = this.pos(c);
      const d = new THREE.Vector3((p[0] - P[0]) * AU_M, (p[1] - P[1]) * AU_M, (p[2] - P[2]) * AU_M);
      m.visible = d.length() < 3e5 * (c.kind === 'station' ? 5 : 1);
      if (!m.visible) continue;
      m.position.copy(d);
      const b = c.target;
      if (c.nav) m.quaternion.copy(c.quat);
      else if (c.body) {
        // along its orbit, panels to the light
        const vv = new THREE.Vector3(c.body.vx - b.vx, c.body.vy - b.vy, c.body.vz - b.vz).normalize();
        const up = new THREE.Vector3(c.body.x - b.x, c.body.y - b.y, c.body.z - b.z).normalize();
        const x = new THREE.Vector3().crossVectors(vv, up).normalize();
        m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, new THREE.Vector3().crossVectors(x.clone().negate(), vv).negate(), vv.clone().negate()));
        if (c.kind === 'orbiter' && light) for (const w of m.children) if (w.name === 'wing') w.lookAt(light);
      } else {
        // standing (or falling) upright over the ground, facing its heading
        const f = frameOf(b);
        const [e, nn] = tangent(c.n);
        const fwd: V3 = [nn[0] * Math.cos(c.heading) + e[0] * Math.sin(c.heading), nn[1] * Math.cos(c.heading) + e[1] * Math.sin(c.heading), nn[2] * Math.cos(c.heading) + e[2] * Math.sin(c.heading)];
        const up = new THREE.Vector3(...toWorld(f, c.n)), z = new THREE.Vector3(...toWorld(f, fwd)).negate();
        const x = new THREE.Vector3().crossVectors(up, z);
        m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z));
        if (c.state === 'transit' || c.state === 'descent') m.rotateZ(Math.sin(t * 2 + c.id) * 0.05);
      }
      for (const o of m.children) if (o.name === 'blink') o.visible = Math.sin(t * 3 + c.id) > 0;
      if (c.state === 'building') m.scale.setScalar(0.2 + 0.8 * Math.min(1, c.t / 12)); else m.scale.setScalar(1);
    }
  }

  /**
   * The camera for the craft in hand: behind a vehicle you drive, or circling
   * one you watch. Sets the camera's attitude; returns where it is.
   */
  view(cam: THREE.Camera): Mover {
    const c = this.current!, v = this.v;
    const P = this.pos(c), b = c.nav?.anchor ?? c.target;
    let up = new THREE.Vector3(0, 0, 1), north = new THREE.Vector3(0, 1, 0), east = new THREE.Vector3(1, 0, 0);
    if (b) {
      const o = v.landing.over(b, P), f = frameOf(b);
      const [e, nn] = tangent(o.n);
      up = new THREE.Vector3(...toWorld(f, o.n)); north = new THREE.Vector3(...toWorld(f, nn)); east = new THREE.Vector3(...toWorld(f, e));
    }
    let yaw = c.camYaw, heading = c.heading;
    if (c.nav) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quat);
      heading = Math.atan2(fwd.dot(east), fwd.dot(north));
    }
    if (this.driving) yaw += heading + Math.PI;
    else if (c.state === 'orbit') yaw += heading + Math.PI;
    const D = c.camDist, cp = Math.cos(c.camPitch), sp = Math.sin(c.camPitch);
    const off = north.clone().multiplyScalar(Math.cos(yaw) * cp * D).addScaledVector(east, Math.sin(yaw) * cp * D).addScaledVector(up, sp * D);
    // look at the craft (a little above it), keeping the world's up
    const look = off.clone().negate().addScaledVector(up, D * 0.12).normalize();
    const x = new THREE.Vector3().crossVectors(look, up);
    if (x.lengthSq() < 1e-8) x.copy(east);
    x.normalize();
    const y = new THREE.Vector3().crossVectors(x, look);
    cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, look.clone().negate()));
    // never under the ground
    const eye: V3 = [P[0] + off.x / AU_M, P[1] + off.y / AU_M, P[2] + off.z / AU_M];
    if (b && solid(b)) {
      const o = v.landing.over(b, eye), gh = this.groundH(b, o.n);
      const min = b.r * AU_M + gh + 1.5;
      if (o.r < min) {
        const w = toWorld(frameOf(b), [o.n[0] * min, o.n[1] * min, o.n[2] * min]);
        eye[0] = b.x + w[0] / AU_M; eye[1] = b.y + w[1] / AU_M; eye[2] = b.z + w[2] / AU_M;
      }
    }
    const a = b ?? null;
    return { anchor: a, off: [eye[0] - (a?.x ?? 0), eye[1] - (a?.y ?? 0), eye[2] - (a?.z ?? 0)], vel: [0, 0, 0] };
  }

  /** a line of telemetry for the readout */
  status(c: Craft): string {
    const b = c.target;
    switch (c.state) {
      case 'transit': return `on the way to ${b.name} · ${Math.max(0, c.dur - c.t).toFixed(0)} s`;
      case 'orbit': return `in orbit round ${b.name}, ${(c.alt / 1000).toFixed(0)} km up`;
      case 'descent': {
        const a = this.v.science.atmosphere(b);
        const s = a.exists ? airAt(a, b, c.alt) : null;
        return `descending · ${(c.alt / 1000).toFixed(1)} km · ${c.vdown.toFixed(0)} m/s${s ? ` · ${s.bar < 0.01 ? s.bar.toExponential(1) : s.bar.toFixed(2)} bar · ${Math.round(s.K)} K` : ''}`;
      }
      case 'landed': return c.kind === 'rover' ? `on the ground · ${this.where(c)}` : `on the ground · ${this.where(c)}`;
      case 'flying': return 'flying';
      case 'building': return `building · ${Math.round(Math.min(1, c.t / 12) * 100)}%`;
      case 'active': return `active · crew 6 · ${this.where(c)}`;
      case 'docked': return 'in the hangar';
      default: return c.log[0]?.text ?? 'lost';
    }
  }

  private where(c: Craft) {
    const [la, lo] = latLon(c.n);
    return `${Math.abs(la).toFixed(2)}°${la >= 0 ? 'N' : 'S'} ${Math.abs(lo).toFixed(2)}°${lo >= 0 ? 'E' : 'W'}`;
  }

  /** labels for the craft in view */
  labels(): { key: string; name: string; p: V3 }[] {
    return this.crafts.filter(c => c.state !== 'docked' && c.state !== 'lost' && !c.body).map(c => ({ key: `craft${c.id}`, name: `${ICON[c.kind]} ${c.name}`, p: this.pos(c) }));
  }

  /** the bodies the fleet owns, so the 3D view does not draw them twice */
  owns(b: Body) { return this.crafts.some(c => c.body === b); }
}

/** how far the camera stands from each kind, m */
const CAM: Record<CraftKind, number> = { probe: 14, orbiter: 26, lander: 9, rover: 9, station: 260, base: 110, shuttle: 18 };

export const kmOf = (au: number) => au / KM;
export { quatOf, toLocal };
