import * as THREE from 'three';
import type { Body } from '../physics/body';
import type { V3 } from '../pixel/sprites';
import type { View3D } from './view3d';
import { atmosphere, composition, gravity, type Atmosphere } from './science';
import { latLonOf } from './ground';
import { tangent } from './terrain';
import { lrvMesh, MAT } from './craftmesh';

/**
 * Your suit, and what you carry and ride on a world.
 *
 * The suit reads what is outside and does what it takes to keep you alive:
 * sealed and pressurised in a vacuum, a hard shell against Venus's 92 bar,
 * cooling at full in its 460 °C and heating on Titan, filters against the
 * poisons in an air (sulphur dioxide, ammonia, hydrogen cyanide), shielding
 * against radiation (the Moon's, Mars's; Jupiter's belts at Io and Europa
 * would kill you in hours without it), the visor open only where the air is
 * fit to breathe. Doing it costs oxygen and power, faster the harsher it is
 * outside; top it up at the ship's airlock, a base's suit room, the
 * station's stowage. When something runs low it warns you, and it carries a
 * reserve.
 *
 * Its kit: the scanner (R), the lamp (N), a jetpack (J, then Space to fire),
 * and a sampler (T) that takes a core of the ground under you into its
 * sample case, for a lab to analyse. And on the ground a vehicle, called
 * with B: a buggy like the Apollo rovers, and B again a hover bike, fast,
 * over rough ground and water alike.
 */

export interface Sample { world: string; where: string; what: string }

/** radiation at the surface, mSv an hour, unshielded */
const RAD: Record<string, number> = {
  Earth: 0.0003, Moon: 0.055, Mars: 0.03, Mercury: 0.2, Venus: 0.0003, Titan: 0.0003,
  Io: 1500, Europa: 225, Ganymede: 3.3, Callisto: 0.004, Enceladus: 0.05, Triton: 0.01, Pluto: 0.01,
};
/** gases that harm you, and the fraction above which they do */
const TOXIC: Record<string, number> = { 'CO₂': 0.02, 'SO₂': 1e-5, 'H₂S': 1e-4, 'NH₃': 3e-4, 'HCN': 1e-5, 'CO': 5e-5, 'Cl₂': 1e-6, 'H₂SO₄': 1e-6, 'CH₄': 0.05, 'H₂': 0.04 };

export interface Env { breathable: boolean; bar: number; T: number; rad: number; hazards: string[] }

/** what is outside, and what of it would harm you */
export function environment(b: Body, a: Atmosphere): Env {
  const T = a.T - 273.15, bar = a.bar, hazards: string[] = [];
  const o2 = a.gases.find(g => g.f === 'O₂')?.x ?? 0;
  const toxic = a.gases.filter(g => TOXIC[g.f] !== undefined && g.x > TOXIC[g.f]).map(g => g.f);
  if (bar < 0.06) hazards.push(bar < 1e-4 ? 'vacuum' : `${bar.toPrecision(2)} bar: too thin`);
  else if (bar > 3) hazards.push(`${bar.toPrecision(3)} bar`);
  if (T > 55) hazards.push(`${Math.round(T)} °C`);
  if (T < -45) hazards.push(`${Math.round(T)} °C`);
  if (bar >= 0.06 && o2 < 0.16) hazards.push('no oxygen');
  if (toxic.length) hazards.push(toxic.join(', '));
  const rad = RAD[b.look.real ?? ''] ?? (bar < 1e-3 ? 0.05 : 0.001);
  if (rad > 0.02) hazards.push(rad > 10 ? 'lethal radiation' : 'radiation');
  return { breathable: hazards.length === 0, bar, T, rad, hazards };
}

export class Suit {
  /** oxygen (hours), power (0–1), radiation dose taken (mSv) */
  o2 = 8;
  power = 1;
  dose = 0;
  reserve = false;
  readonly samples: Sample[] = [];
  /** the jetpack armed */
  jet = false;
  /** riding: a buggy or a hover bike, its speed (m/s) */
  ride: 'buggy' | 'hover' | null = null;
  rideV = 0;
  private env: Env | null = null;
  private envOf: Body | null = null;
  private warned = '';
  private mesh: { buggy: THREE.Group; hover: THREE.Group };

  constructor(private v: View3D) {
    this.mesh = { buggy: lrvMesh(), hover: hoverBike() };
    for (const m of Object.values(this.mesh)) { m.visible = false; m.traverse(o => { o.frustumCulled = false; }); }
    v.ground.root.add(this.mesh.buggy, this.mesh.hover);
  }

  private toast(m: string) { this.v.app.onToast(m); }

  /** what is outside, where you are (on foot on a world, or in space) */
  here(): Env | null {
    const v = this.v;
    if (v.mode === 'eva') return { breathable: false, bar: 0, T: -270, rad: 0.05, hazards: ['vacuum', 'radiation'] };
    if (v.mode !== 'surface' || !v.surf.b) return null;
    if (this.envOf !== v.surf.b) { this.envOf = v.surf.b; this.env = environment(v.surf.b, atmosphere(v.surf.b, v.stars())); this.announce(); }
    return this.env;
  }

  private announce() {
    const e = this.env!, b = this.envOf!;
    if (e.breathable) { this.toast(`Suit: the air of ${b.name} is fit to breathe. Visor open`); return; }
    const does: string[] = [];
    if (e.hazards.some(h => h === 'vacuum' || h.includes('too thin'))) does.push('sealed and pressurised');
    if (e.bar > 3) does.push(`hard shell against ${e.bar.toPrecision(3)} bar`);
    if (e.T > 55) does.push('cooling at full');
    if (e.T < -45) does.push('heaters on');
    if (e.hazards.some(h => h.includes(','))  || e.hazards.some(h => TOXIC[h] !== undefined)) does.push('filters closed');
    if (e.rad > 0.02) does.push(e.rad > 10 ? 'storm shielding up: Jupiter’s radiation here would kill you in hours' : 'shielding on');
    this.toast(`Suit on ${b.name}: ${e.hazards.join(' · ')} — ${does.join(', ') || 'sealed'}`);
  }

  /** each frame: breathing and power, and the warnings */
  frame(dt: number) {
    const e = this.here();
    if (!e) { this.syncRide(); return; }
    const harsh = (e.bar > 3 ? 1.5 : 0) + (e.T > 55 ? Math.min(3, (e.T - 55) / 120) : 0) + (e.T < -45 ? Math.min(1.5, (-45 - e.T) / 120) : 0) + (e.rad > 10 ? 1 : 0);
    // a working day of oxygen in a quarter of an hour of play: half an hour of it a minute
    if (!e.breathable) this.o2 = Math.max(0, this.o2 - dt / 120);
    this.power = Math.max(0, this.power - dt * (0.0006 + 0.0012 * harsh + (this.jet && this.v.controls.walkInput().jump ? 0.004 : 0) + (this.ride === 'hover' ? 0.001 : 0)));
    this.dose += (e.rad / Math.max(1, e.rad > 10 ? 400 : 20)) * dt / 60;
    const low = this.o2 <= 0 ? 'o2-out' : this.o2 < 1 ? 'o2-low' : this.power <= 0 ? 'p-out' : this.power < 0.15 ? 'p-low' : '';
    if (low && low !== this.warned) {
      this.warned = low;
      this.toast(low === 'o2-out' ? 'Suit oxygen out: on the reserve tank, thirty minutes. Get back to the ship or a base' : low === 'o2-low' ? 'Suit oxygen under an hour' : low === 'p-out' ? 'Suit power out: on the backup cell. Get back to the ship or a base' : 'Suit power low');
      if (low === 'o2-out' || low === 'p-out') this.reserve = true;
    }
    this.syncRide();
  }

  /** topped up: at an airlock, a suit room, the station's stowage */
  refill() { this.o2 = 8; this.power = 1; this.reserve = false; this.warned = ''; }

  /** the line on the visor */
  line(): string {
    const e = this.here();
    if (!e) return '';
    const o2 = e.breathable ? 'visor open' : `O₂ ${this.o2.toFixed(1)} h${this.reserve ? ' (reserve)' : ''}`;
    return `suit ${o2} · ${Math.round(this.power * 100)}% power${this.dose > 0.01 ? ` · ${this.dose.toFixed(2)} mSv` : ''}${this.jet ? ' · jetpack' : ''}${this.samples.length ? ` · ${this.samples.length} samples` : ''}`;
  }

  // ---------------------------------------------------------------- tools
  toggleJet() {
    this.jet = !this.jet;
    if (this.jet && this.ride) this.ride = null;
    this.toast(this.jet ? 'Jetpack armed: Space fires it' : 'Jetpack off');
  }

  /** T: a core of the ground under your feet into the sample case */
  sample() {
    const v = this.v, b = v.surf.b;
    if (v.mode !== 'surface' || !b) return;
    if (this.samples.length >= 10) { this.toast('The sample case is full: analyse them in a lab (a base, or the ship’s)'); return; }
    const st = v.ground.standAt(v.surf.n, v.surf.foot + 0.6), [la, lo] = latLonOf(v.surf.n);
    const form = v.ground.forms.near(v.ground.spec!, v.surf.n, 40)[0];
    const what = form ? `${form.rock} from ${form.name.toLowerCase()}` : rockOf(b, v.ground.last_sample);
    this.samples.push({ world: b.name, where: `${Math.abs(la).toFixed(3)}°${la >= 0 ? 'N' : 'S'} ${Math.abs(lo).toFixed(3)}°${lo >= 0 ? 'E' : 'W'}`, what });
    this.toast(`Sample ${this.samples.length} of 10: ${what}${st.inside ? `, inside ${st.inside.name.toLowerCase()}` : ''}`);
  }

  /** at a lab: what the samples are made of, into the log */
  analyse() {
    const v = this.v;
    if (!this.samples.length) { this.toast('No samples to analyse: take some with T, out on the ground'); return; }
    for (const s of this.samples) {
      const b = v.app.world.sources.find(x => x.name === s.world);
      const cp = b ? composition(b) : null;
      const top = cp?.rows.slice(0, 3).map(([k, x]) => `${k} ${x}%`).join(', ') ?? '';
      v.logbook.finds.push({ what: `Sample: ${s.what}`, note: top ? `Made of ${top}` : 'Analysed', where: `${s.world} · ${s.where}` });
    }
    this.toast(`${this.samples.length} sample${this.samples.length > 1 ? 's' : ''} analysed and logged: ${this.samples.map(s => s.what).slice(0, 3).join('; ')}${this.samples.length > 3 ? '…' : ''}`);
    this.samples.length = 0;
  }

  // ---------------------------------------------------------------- riding
  /** B: the buggy, then the hover bike, then on foot again */
  cycleRide() {
    const v = this.v, b = v.surf.b;
    if (v.mode !== 'surface' || !b) return;
    const g = gravity(b);
    const next = this.ride === null ? (g < 30 ? 'buggy' : 'hover') : this.ride === 'buggy' ? 'hover' : null;
    this.ride = next;
    this.rideV = 0;
    this.jet = false;
    this.toast(next === 'buggy' ? 'The buggy, unfolded from its stowage: W S drive, A D steer, B for the hover bike, F to get off'
      : next === 'hover' ? 'The hover bike: it rides a metre over rock, sand and water alike. B to get off'
      : 'On foot');
  }

  /** riding, instead of walking: returns how far up you sit */
  rideStep(dt: number, inp: { f: number; s: number; run: boolean }, R: number): number {
    const v = this.v, S = v.surf, hover = this.ride === 'hover';
    const top = (hover ? 45 : 12) * (inp.run ? 1.4 : 1), acc = hover ? 14 : 4;
    // throttle and brakes; steering, tighter when slow
    const want = inp.f * top;
    this.rideV += Math.max(-acc * dt * 2, Math.min(acc * dt, want - this.rideV));
    if (inp.f === 0) this.rideV *= Math.max(0, 1 - dt * (hover ? 0.4 : 1.2));
    S.yaw -= inp.s * dt * (hover ? 1.3 : 0.9) * Math.min(1, Math.abs(this.rideV) / 3 + 0.3) * Math.sign(this.rideV || 1);
    const [e, nn] = tangent(S.n), sy = Math.sin(S.yaw), cy = Math.cos(S.yaw);
    const fwd: V3 = [-sy * e[0] + cy * nn[0], -sy * e[1] + cy * nn[1], -sy * e[2] + cy * nn[2]];
    const k = this.rideV * dt / R;
    const m: V3 = [S.n[0] + fwd[0] * k, S.n[1] + fwd[1] * k, S.n[2] + fwd[2] * k], l = Math.hypot(...m);
    const next: V3 = [m[0] / l, m[1] / l, m[2] / l];
    const st = v.ground.standAt(next, S.foot + 1);
    if (st.solid || (st.sea && !hover)) { this.rideV *= -0.2; if (st.sea) this.toast('Water: the buggy stops here (the hover bike would not)'); }
    else S.n = next;
    S.speed = Math.abs(this.rideV);
    return hover ? 1.3 : 0.55;
  }

  /** the vehicle drawn under you */
  private syncRide() {
    const v = this.v, S = v.surf, on = v.mode === 'surface' && !!this.ride && !!S.b && v.ground.body === S.b;
    this.mesh.buggy.visible = on && this.ride === 'buggy';
    this.mesh.hover.visible = on && this.ride === 'hover';
    if (!on || !v.ground.spec) return;
    const m = this.ride === 'hover' ? this.mesh.hover : this.mesh.buggy, n = S.n;
    const [e, nn] = tangent(n), sy = Math.sin(S.yaw), cy = Math.cos(S.yaw);
    const fwd = new THREE.Vector3(-sy * e[0] + cy * nn[0], -sy * e[1] + cy * nn[1], -sy * e[2] + cy * nn[2]);
    const up = new THREE.Vector3(...n), right = new THREE.Vector3().crossVectors(fwd, up);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd.clone().negate()));
    const r = v.ground.spec.R + S.foot + (this.ride === 'hover' ? 0.7 + Math.sin(performance.now() / 300) * 0.05 : 0);
    m.position.set(n[0] * r, n[1] * r, n[2] * r).addScaledVector(fwd, this.ride === 'hover' ? 0.3 : 0.6);
  }
}

/** what the ground under you is, roughly, from its world and its colour */
function rockOf(b: Body, g: { r: number; g: number; b: number; rock: number }) {
  const real = b.look.real, dark = (g.r + g.g + g.b) / 3 < 0.35;
  const list: Record<string, [string, string]> = {
    Moon: ['mare basalt', 'anorthosite regolith'], Mars: ['basaltic sand, rusty with iron oxide', 'clay-rich mudstone'],
    Earth: ['soil over granite', 'sandstone'], Venus: ['weathered basalt', 'basalt'], Titan: ['water-ice cobbles', 'organic sand'],
    Mercury: ['dark, carbon-rich regolith', 'volcanic plains rock'], Europa: ['salty water ice', 'clean water ice'],
  };
  const pair = list[real ?? ''] ?? ['dark rock', g.rock > 0.5 ? 'fractured bedrock' : 'fine regolith'];
  return dark ? pair[0] : pair[1];
}

/** a hover bike: a long low body on two glowing lift pads, a windscreen, handlebars */
function hoverBike() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.8, 4, 10), MAT.orange);
  body.rotation.x = Math.PI / 2;
  body.position.y = 0.55;
  g.add(body);
  for (const z of [-0.85, 0.85]) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.18, 16), MAT.dark);
    pad.position.set(0, 0.2, z);
    g.add(pad);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), MAT.cyan);
    glow.rotation.x = Math.PI / 2;
    glow.position.set(0, 0.1, z);
    g.add(glow);
  }
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.04), MAT.glass);
  screen.position.set(0, 0.95, -0.75);
  screen.rotation.x = -0.5;
  g.add(screen);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.05), MAT.dark);
  bar.position.set(0, 0.95, -0.45);
  g.add(bar);
  return g;
}
