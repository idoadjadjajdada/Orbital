import * as THREE from 'three';
import { AU_M } from '../physics/units';
import type { V3 } from '../pixel/sprites';
import type { View3D } from './view3d';
import type { Craft } from './fleet';
import { Interior, STATION, BASE, stationInterior, baseInterior } from './interior';
import { HATCH_OUT } from './hull';
import { gravity, atmosphere } from './science';
import { bodyQuat, latLonOf } from './ground';
import { tangent } from './terrain';

/**
 * Being inside a station or a base, and getting there: docking the ship at a
 * station's port, coming in through a base's airlock or its garage, out
 * again through the same doors or a station's own airlock on a spacewalk.
 * Calling the ship to a base's pad. What there is to use inside, and its
 * screens, kept up to date. Two lights follow you round inside, at the
 * fixtures nearest you.
 */
export class Visit {
  /** where you are inside, and what in */
  at: { c: Craft; I: Interior; p: THREE.Vector3; yaw: number; pitch: number; vel: THREE.Vector3; y: number; vy: number; cupola: boolean } | null = null;
  /** the station the ship is docked at */
  docked: Craft | null = null;
  private lamps: THREE.PointLight[] = [];
  private screenT = 0;

  constructor(private v: View3D) {
    // always in the scene, so the count of lights (and every shader) never changes; dark until you are inside
    for (let k = 0; k < 2; k++) { const l = new THREE.PointLight(0xfff4e8, 0, 11, 1.3); v.scene.add(l); this.lamps.push(l); }
  }

  private toast(m: string) { this.v.app.onToast(m); }

  /** a point of a craft's frame, in the sandbox (AU) */
  worldOf(c: Craft, p: THREE.Vector3): V3 {
    const w = p.clone().applyQuaternion(this.v.fleet.quat(c)).add(this.v.fleet.local(c));
    return [c.b.x + w.x / AU_M, c.b.y + w.y / AU_M, c.b.z + w.z / AU_M];
  }

  private ensure(c: Craft) {
    if (!c.inside) { c.inside = c.kind === 'station' ? stationInterior(c.name) : baseInterior(c.name, c.id); c.mesh.add(c.inside.group); }
    c.inside.group.visible = true;
    return c.inside;
  }

  /** in: through a station's docking port or its airlock, a base's airlock or its garage door */
  enter(c: Craft, how: 'dock' | 'airlock' | 'door' | 'gate') {
    const I = this.ensure(c);
    const p = I.spawn.p.clone();
    let yaw = I.spawn.yaw;
    if (how === 'airlock') { p.set(STATION.airlock.x - 1.2, 0, STATION.airlock.z); yaw = Math.PI / 2; }
    if (how === 'gate') { p.set(BASE.gate.x, BASE.floor, BASE.gate.z + 2.5); yaw = Math.PI; }
    this.at = { c, I, p, yaw, pitch: 0, vel: new THREE.Vector3(), y: 0, vy: 0, cupola: false };
    this.v.mode = 'inside';
    this.v.foot.seat = null;
    this.toast(I.zeroG ? `Aboard ${c.name}: you float. W A S D and Space / C to move, F to use` : `Inside ${c.name}`);
  }

  /** out of a base onto the ground, at a point of its layout, facing away from it */
  private outside(x: number, z: number, away: number) {
    const a = this.at!, c = a.c, f = this.v.fleet;
    const n = f.onBase(c, x, z), n2 = f.onBase(c, x + Math.sin(away) * 5, z + Math.cos(away) * 5);
    // the way out, as a compass heading at n
    const [e, nn] = tangent(n), d = [n2[0] - n[0], n2[1] - n[1], n2[2] - n[2]];
    const yaw = Math.atan2(-(d[0] * e[0] + d[1] * e[1] + d[2] * e[2]), d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2]);
    this.at = null;
    this.lamps.forEach(l => { l.intensity = 0; });
    this.v.toSurface(n, yaw);
  }

  leave() {
    const a = this.at;
    if (!a) return;
    if (a.c.kind === 'base') this.outside(BASE.door.x, BASE.door.z + 1.5, 0);
    else if (this.docked === a.c) this.backAboard();
    else this.spacewalk();
  }

  private backAboard() { this.at = null; this.lamps.forEach(l => { l.intensity = 0; }); this.v.board(); }

  /** out through the station's airlock, into space beside it */
  private spacewalk() {
    const a = this.at!, c = a.c, v = this.v;
    const p = this.worldOf(c, STATION.airlock.clone().add(new THREE.Vector3(2.5, 0, 0)));
    v.suit.nav = { anchor: c.b, off: [p[0] - c.b.x, p[1] - c.b.y, p[2] - c.b.z], vel: [0, 0, 0] };
    v.suit.quat.copy(v.fleet.quat(c)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2));
    this.at = null;
    this.lamps.forEach(l => { l.intensity = 0; });
    v.mode = 'eva';
    v.logbook.walks++;
    this.toast(`Outside ${c.name}. Its airlock is marked; F takes you back in`);
  }

  /** each frame, inside: moving about */
  step(dt: number) {
    const a = this.at, v = this.v;
    if (!a) return;
    if (!a.c.b.alive || a.c.state === 'lost') { this.at = null; v.mode = 'eva'; return; }
    const I = a.I;
    if (a.cupola) return;
    if (I.zeroG) {
      // floating: you go the way you look, pulling along the handrails
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(a.pitch, a.yaw, 0, 'YXZ'));
      const w = v.controls.thrust(1.6, q), want = new THREE.Vector3(...w);
      if (want.length() > 3.5) want.setLength(3.5);
      a.vel.lerp(want, Math.min(1, dt * 2.5));
      for (const k of ['x', 'y', 'z'] as const) {
        const next = a.p.clone();
        next[k] += a.vel[k] * dt;
        if (I.canBe(next, 0.3)) a.p.copy(next); else a.vel[k] *= -0.2;
      }
    } else {
      const inp = v.controls.walkInput(), sp = inp.run ? 4.5 : 2.2;
      const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw), rx = Math.cos(a.yaw), rz = -Math.sin(a.yaw);
      const dx = (fx * inp.f + rx * inp.s) * sp * dt, dz = (fz * inp.f + rz * inp.s) * sp * dt;
      const mid = (x: number, z: number) => new THREE.Vector3(x, I.floor + 1, z);
      if (I.canBe(mid(a.p.x + dx, a.p.z), 0.3)) a.p.x += dx;
      if (I.canBe(mid(a.p.x, a.p.z + dz), 0.3)) a.p.z += dz;
      const g = gravity(a.c.b);
      if (inp.jump && a.y <= 0) a.vy = Math.min(4, Math.sqrt(2 * g * 0.5) + 0.5);
      a.vy -= g * dt;
      a.y = Math.max(0, Math.min(0.8, a.y + a.vy * dt));
      if (a.y <= 0) a.vy = 0;
    }
  }

  /** the eye (craft frame) */
  eye() {
    const a = this.at!;
    if (a.cupola) return new THREE.Vector3(STATION.cupola.x, STATION.cupola.y - 0.45, STATION.cupola.z);
    return a.I.zeroG ? a.p.clone() : new THREE.Vector3(a.p.x, a.I.floor + 1.65 + a.y, a.p.z);
  }

  /** where the viewer is: called by the view's place() */
  place(cam: THREE.PerspectiveCamera) {
    const a = this.at!, v = this.v, f = v.fleet;
    const loc = f.local(a.c), q = f.quat(a.c);
    v.base = { anchor: a.c.b, off: [loc.x / AU_M, loc.y / AU_M, loc.z / AU_M], vel: [0, 0, 0] };
    v.eye.copy(this.eye()).applyQuaternion(q);
    cam.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(a.pitch, a.yaw, 0, 'YXZ')));
    // the lights inside: at the two fixtures nearest you
    const e = this.eye(), near = a.I.lamps.map(p => ({ p, d: p.distanceToSquared(e) })).sort((x, y) => x.d - y.d).slice(0, 2);
    this.lamps.forEach((l, k) => {
      const n = near[k];
      if (!n) { l.intensity = 0; return; }
      l.intensity = a.I.zeroG ? 7 : 12;
      l.distance = a.I.zeroG ? 8 : 14;
      l.position.copy(n.p).sub(e).applyQuaternion(q);
    });
  }

  turn(yaw: number, pitch: number) {
    const a = this.at;
    if (!a) return;
    a.yaw += yaw;
    a.pitch = Math.max(-1.5, Math.min(1.5, a.pitch + pitch));
  }

  /** what is in reach, inside */
  prompt(): { label: string; act: () => void } | null {
    const a = this.at;
    if (!a) return null;
    if (a.cupola) return { label: 'Back into the station', act: () => { a.cupola = false; a.pitch = 0; } };
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(a.pitch, a.yaw, 0, 'YXZ'));
    const s = a.I.facing(this.eye(), dir);
    return s ? { label: s.label, act: () => this.use(s.id) } : null;
  }

  /** the part you are in, for the readout */
  room() { const a = this.at; return a ? (a.cupola ? 'The Cupola' : a.I.where(a.p.clone().setY(a.I.zeroG ? a.p.y : a.I.floor + 1))) : ''; }

  private use(id: string) {
    const a = this.at!, c = a.c, v = this.v, b = c.b;
    const pick = (l: string[]) => l[Math.floor(Math.random() * l.length)];
    const air = atmosphere(b, v.stars()), R = b.r * AU_M;
    switch (id) {
      // ---- the station
      case 'dock':
        if (this.docked === c) this.backAboard();
        else this.toast('No ship at this port. Fly the ship here and dock it (from the helm), or leave by the Kibo airlock');
        break;
      case 'eva': this.spacewalk(); break;
      case 'cupola': a.cupola = true; a.pitch = -1.25; this.toast('The Cupola: seven windows, the world below. Look round; F to come back in'); break;
      case 'galley': this.toast(pick(c.kind === 'station'
        ? ['Rehydrated shrimp cocktail, eaten floating. The horseradish is the only thing you can taste up here.', 'A tortilla wrap: no crumbs to float into the filters.', 'Thermostabilised beef stew, warmed in the food warmer. Not bad.']
        : ['Hot soup from the galley. The base cook is proud of it.', 'Fresh salad from the hydroponics, with real tomatoes.', 'Coffee, brewed properly in real gravity.'])); break;
      case 'sleep': v.goToSleep(); break;
      case 'treadmill': this.toast('Strapped to the treadmill by bungees: two hours of exercise a day keep your bones and muscles from wasting away in weightlessness'); break;
      case 'life': this.toast('Life support: oxygen split from water, carbon dioxide scrubbed and its oxygen recovered, 98% of the water — urine included — recycled'); break;
      case 'status': this.toast(`${c.name}: ${this.orbitLine(c)}`); break;
      case 'comms': this.toast(pick([`Mission Control: "${c.name}, we see you aboard. Enjoy the view."`, 'Ground: "Copy, station. Next supply ship docks in eleven days."', 'Ham radio: a school class asks what it is like to sleep floating. "Like a hug from nothing," you tell them.'])); break;
      case 'experiment': this.toast(pick(['Protein crystals grown without gravity: larger and more perfect than any on the ground', 'Flames in microgravity: round, blue, and they burn on after you think they are out', 'Cold atoms: a Bose–Einstein condensate, colder than anywhere in nature, held for seconds', 'Your own blood pressure and eyes: fluid shifts upward without gravity, and it shows'])); break;
      case 'veggie': this.toast('Red romaine lettuce, grown under pink LEDs. You are allowed one leaf'); break;
      case 'arm': this.toast('The robotic arm walks end over end along the station to wherever it is needed, and catches visiting cargo ships out of the sky'); break;
      case 'suit': v.suitRefill?.(); this.toast('Suit topped up: oxygen, battery, coolant water. Ready to go outside'); break;
      // ---- the base
      case 'out': this.outside(BASE.door.x, BASE.door.z + 1.5, 0); break;
      case 'gate': this.outside(BASE.gate.x, BASE.gate.z - 3, Math.PI); break;
      case 'vehicle': this.roverOut(); break;
      case 'callship': this.callToPad(c); break;
      case 'holo': v.openMap(); break;
      case 'command': this.toast(`${c.name}: crew of six, power ${air.bar > 0.5 ? 'solar and fuel cells' : 'solar, 140 kW'}, oxygen for 90 days, water recycling at 94%`); break;
      case 'weather': {
        const [la, lo] = latLonOf(c.n);
        this.toast(air.bar > 1e-4 ? `Outside: ${air.bar.toPrecision(3)} bar of ${air.gases[0]?.name ?? 'air'}, ${Math.round(air.T - 273.15)} °C, ${gravity(b).toFixed(2)} m/s² · ${la.toFixed(2)}°, ${lo.toFixed(2)}°` : `Outside: vacuum, ${Math.round(air.T - 273.15)} °C in the sun, ${gravity(b).toFixed(2)} m/s²`);
        break;
      }
      case 'greens': this.toast('Hydroponics: lettuce, tomatoes, peppers and wheat under grow lights; they make some of the base’s oxygen and a lot of its morale'); break;
      case 'analyse': v.analyseSamples?.(); break;
      case 'rocks': this.toast(`The sample collection: ${v.logbook.finds.length} finds logged so far`); break;
      case 'med': this.toast('Check-up: heart, lungs and bone density fine. Radiation dose this mission logged'); break;
      default: this.toast(id);
    }
    void R;
  }

  private orbitLine(c: Craft) {
    if (!c.orbit) return 'standing on the ground';
    const alt = (c.orbit.r - c.b.r * AU_M) / 1000, sp = c.orbit.w * c.orbit.r / 1000, per = 2 * Math.PI / c.orbit.w / 60;
    return `${alt.toFixed(0)} km up, ${sp.toFixed(2)} km/s, an orbit every ${per.toFixed(0)} minutes`;
  }

  /** the base's rover out through the garage door, and you at its controls */
  private roverOut() {
    const a = this.at!, c = a.c, f = this.v.fleet;
    const n = f.onBase(c, BASE.gate.x, BASE.gate.z - 6);
    const r = f.launch('rover', c.b, new THREE.Vector3(), n);
    r.state = 'surface'; r.n = n; r.head = c.head + Math.PI; r.status = 'driving'; r.name = `${c.name} rover`;
    this.at = null;
    this.lamps.forEach(l => { l.intensity = 0; });
    this.v.viewCraft(r.id);
    this.toast('Out through the big door. W S to drive, A D to steer; F to get out');
  }

  /** the ship flies over and lands on a base's pad */
  callToPad(c: Craft) {
    const v = this.v;
    if (v.landing?.phase === 'landed' && v.landing.b === c.b && this.distToPad(c) < 30) { this.toast('The ship is on the pad already'); return; }
    if (v.landing) { this.toast('Lift off first'); return; }
    v.travel = { b: null, stop: 5 / AU_M, name: `${c.name}'s pad`, land: true, at: () => this.worldOf(c, BASE.pad.clone().setY(250)) };
    this.docked = null;
    this.toast(`The ship is on its way to land on ${c.name}'s pad`);
  }

  private distToPad(c: Craft) {
    const p = this.worldOf(c, BASE.pad), s = this.v.shipPos();
    return Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]) * AU_M;
  }

  // ---------------------------------------------------------------- docking
  /** the ship's pose docked at a station: its airlock against the port, upright with the station */
  holdDocked() {
    const c = this.docked, v = this.v, sh = v.ship;
    if (!c) return;
    if (!c.b.alive || c.state === 'lost') { this.docked = null; return; }
    if (v.mode === 'pilot' && v.controls.moving()) { this.undock(); return; }
    const q = v.fleet.quat(c);
    // the ship's x is the station's −z (its airlock, on the ship's port side, faces the station), its y the station's
    const local = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)));
    sh.quat.copy(q).multiply(local);
    const at = STATION.port.clone().add(new THREE.Vector3(0, 0, -0.6)).applyQuaternion(q).add(v.fleet.local(c)).sub(HATCH_OUT.clone().applyQuaternion(sh.quat));
    sh.nav.anchor = c.b;
    sh.nav.off = [at.x / AU_M, at.y / AU_M, at.z / AU_M];
    sh.nav.vel = [0, 0, 0];
  }

  /** dock with a station: fly to it if it is far, then hold at its port */
  dock(c: Craft) {
    const v = this.v;
    if (v.landing) { this.toast('Lift off first'); return; }
    const p = this.worldOf(c, STATION.port), s = v.shipPos(), d = Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]) * AU_M;
    if (d > 3000) {
      v.travel = { b: null, stop: 400 / AU_M, name: c.name, at: () => this.worldOf(c, STATION.port.clone().add(new THREE.Vector3(0, 0, -60))), dock: c };
      this.toast(`Flying to ${c.name} to dock`);
      return;
    }
    this.docked = c;
    v.travel = null;
    this.toast(`Docked at ${c.name}. Its hatch is the ship's airlock: walk through to go aboard`);
  }

  undock() {
    if (!this.docked) return;
    const c = this.docked, sh = this.v.ship;
    this.docked = null;
    // a gentle push away from the port
    const away = new THREE.Vector3(1, 0, 0).applyQuaternion(sh.quat).multiplyScalar(2);
    sh.nav.vel = [away.x, away.y, away.z];
    this.toast(`Undocked from ${c.name}`);
  }

  /** a station near the ship, to dock with (within 50 km) */
  stationNear(): Craft | null {
    const s = this.v.shipPos();
    let best: Craft | null = null, bd = 50e3;
    for (const c of this.v.fleet.crafts) {
      if (c.kind !== 'station' || c.state !== 'orbit') continue;
      const p = this.worldOf(c, STATION.port), d = Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]) * AU_M;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /** on the ground near a base's doors, or outside a station's airlock: the way in */
  wayIn(): { label: string; act: () => void } | null {
    const v = this.v, f = v.fleet;
    if (v.mode === 'surface' && v.surf.b && v.ground.spec) {
      const R = v.ground.spec.R;
      for (const c of f.crafts) {
        if (c.kind !== 'base' || c.b !== v.surf.b || c.build < 1) continue;
        const dd = (n: V3) => Math.acos(Math.min(1, n[0] * v.surf.n[0] + n[1] * v.surf.n[1] + n[2] * v.surf.n[2])) * R;
        if (dd(c.n) > 120) continue;
        if (dd(f.onBase(c, BASE.door.x, BASE.door.z + 1)) < 4) return { label: `Through the airlock into ${c.name}`, act: () => this.enter(c, 'door') };
        if (dd(f.onBase(c, BASE.gate.x, BASE.gate.z - 2)) < 6) return { label: `Into ${c.name}'s garage`, act: () => this.enter(c, 'gate') };
      }
    }
    if (v.mode === 'eva') {
      for (const c of f.crafts) {
        if (c.kind !== 'station' || c.state !== 'orbit') continue;
        const p = this.worldOf(c, STATION.airlock.clone().add(new THREE.Vector3(1.5, 0, 0))), s = posOfSuit(v);
        if (Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]) * AU_M < 8) return { label: `Into ${c.name} through its airlock`, act: () => this.enter(c, 'airlock') };
      }
    }
    return null;
  }

  /** the screens inside, a few times a second */
  screens(dt: number) {
    const a = this.at;
    if (!a) return;
    this.screenT -= dt;
    a.I.update(performance.now() / 1000);
    if (this.screenT > 0) return;
    this.screenT = 0.5;
    const c = a.c, v = this.v, I = a.I, b = c.b;
    const t = new Date();
    const hhmm = `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')} UTC`;
    if (c.kind === 'station') {
      const loc = v.fleet.local(c).applyQuaternion(bodyQuat(b).invert()).normalize(), [la, lo] = latLonOf([loc.x, loc.y, loc.z]);
      I.drawScreen('status', [c.name.toUpperCase(), this.orbitLine(c), `over ${Math.abs(la).toFixed(1)}°${la >= 0 ? 'N' : 'S'} ${Math.abs(lo).toFixed(1)}°${lo >= 0 ? 'E' : 'W'}`, `crew 6 + you · ${hhmm}`, this.docked === c ? 'ship docked at the forward port' : 'forward port free']);
      I.drawScreen('orbit', ['GROUND TRACK', `${b.name} below`, `inclination ${c.name === 'ISS' ? '51.6' : '51.6'}°`, `${(c.orbit ? 86400 / (2 * Math.PI / c.orbit.w) : 0).toFixed(1)} orbits a day`, 'next reboost: in 12 days']);
      I.drawScreen('life', ['LIFE SUPPORT', 'O₂ 21.2 %  CO₂ 0.31 %', 'cabin 101.3 kPa · 22.4 °C', 'humidity 48 %', 'water recovered 98 %']);
      I.drawScreen('comms', ['COMMS', 'Ku band: link up', 'S band: link up', 'ground: Houston / Moscow', 'next pass: 4 min']);
      I.drawScreen('lab', ['EXPERIMENTS', 'fluids rack: running', 'combustion: idle', 'cold atoms: 132 nK', 'glovebox: sealed']);
      I.drawScreen('arm', ['ROBOTIC ARM', `shoulder ${(Math.sin(t.getTime() / 9e3) * 40).toFixed(1)}°`, `elbow ${(60 + Math.cos(t.getTime() / 7e3) * 30).toFixed(1)}°`, 'wrist 12.0°', 'mode: walking']);
      I.drawScreen('cam', ['CAMERA 3', `${b.name} below`, 'the truss, the wings', 'and the stars']);
      I.drawScreen('zvezda', ['TODAY', 'breakfast 06:30', 'exercise 2 h', 'science 6 h', 'Earth photos 19:00']);
    } else {
      const air = atmosphere(b, v.stars());
      const ship = v.landing?.phase === 'landed' && v.landing.b === b ? (this.distToPad(c) < 30 ? 'on the pad' : 'landed nearby') : v.travel?.name.endsWith('pad') ? 'on its way to the pad' : 'away';
      I.drawScreen('base', [c.name.toUpperCase(), 'crew 6 · power 140 kW', 'O₂ reserve 90 days', 'water 94 % recycled', hhmm]);
      I.drawScreen('ship', ['THE SHIP', ship, 'F at the console calls', 'it to the pad']);
      I.drawScreen('weather', ['OUTSIDE', air.bar > 1e-4 ? `${air.bar.toPrecision(3)} bar` : 'vacuum', `${Math.round(air.T - 273.15)} °C`, `${(gravity(b) / 9.81).toFixed(2)} g`]);
      I.drawScreen('spec', ['SPECTROMETER', `${v.logbook.finds.length} finds logged`, 'ready for samples']);
    }
  }
}

function posOfSuit(v: View3D): V3 {
  const m = v.suit.nav, a = m.anchor;
  return [(a?.x ?? 0) + m.off[0], (a?.y ?? 0) + m.off[1], (a?.z ?? 0) + m.off[2]];
}
