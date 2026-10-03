import * as THREE from 'three';
import { plating } from './hull';

/**
 * Places to be that are not the ship: a surface base and an orbital station,
 * each built outside and in.
 *
 * The **base** is three domes joined by tunnels. The command dome has the
 * mission control console, the survey and a window band all the way round;
 * the quarters have bunks and a galley; the greenhouse has a glass roof and
 * racks of plants under grow lights. You go in and out by the airlock on the
 * command dome, and walk inside in the world's own gravity.
 *
 * The **station** is laid out like the ISS: a habitation module (sleeping
 * pods, galley), a node with a cupola under it looking down at the world, a
 * laboratory, a greenhouse module, an airlock for spacewalks and a docking
 * port the ship can dock at. Inside there is no up: you float, along the
 * modules, wherever you look.
 *
 * Coordinates are metres in the habitat's own frame, y up, the base's door
 * and the station's docking port along −z and +z.
 */

export type HabKind = 'base' | 'station';
export type HabAct = 'mission' | 'survey' | 'sleep' | 'galley' | 'greenhouse' | 'exit' | 'board' | 'cupola' | 'log' | 'gym';
export interface HabStation { at: THREE.Vector3; label: string; reach: number; act: HabAct }

interface Circle { x: number; z: number; r: number }
interface Rect { x0: number; x1: number; z0: number; z1: number }
interface Capsule { a: THREE.Vector3; b: THREE.Vector3; r: number; name: string }

const lam = (color: number, o: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...o });

export class Habitat {
  readonly group = new THREE.Group();
  readonly stations: HabStation[] = [];
  /** where you come in, and which way you face (base: on the floor; station: floating) */
  readonly entry = new THREE.Vector3();
  entryYaw = 0;
  /** the outside of the door (base), or where the ship's hatch meets the docking port, and the port's outward direction (station) */
  readonly door = new THREE.Vector3();
  readonly dock = new THREE.Vector3();
  readonly dockDir = new THREE.Vector3(0, 0, 1);
  /** the spacewalk hatch (station) */
  readonly hatch = new THREE.Vector3();
  /** where you float to look out of the cupola */
  readonly cupola = new THREE.Vector3();
  private floor: Circle[] = [];
  private halls: Rect[] = [];
  private blocks: (Circle | Rect)[] = [];
  private caps: Capsule[] = [];
  private rooms: { name: string; test: (p: THREE.Vector3) => boolean }[] = [];
  private lamps: THREE.MeshBasicMaterial[] = [];
  private beacons: THREE.Mesh[] = [];
  private glow: THREE.MeshLambertMaterial[] = [];
  private t = 0;
  private M = {
    white: lam(0xeef0f2, { flatShading: true }),
    hull: lam(0xd8dadf, { map: tile(plating('hull'), 4, 2) }),
    wall: lam(0xc8ccd4, { map: tile(plating('wall'), 6, 2), side: THREE.BackSide }),
    floor: lam(0x8a909c, { map: tile(plating('floor'), 8, 8) }),
    trim: lam(0x2a303c, { flatShading: true }),
    steel: lam(0x9aa2ae, { flatShading: true }),
    accent: lam(0xd8643a, { flatShading: true }),
    panel: lam(0x1c2e5a, { emissive: 0x050a18 }),
    gold: lam(0xd8a830, { emissive: 0x1a1000 }),
    cloth: lam(0x3f6a8a), blanket: lam(0x8a3f4f), wood: lam(0x8a6440), leaf: lam(0x3f9a46, { flatShading: true }), soil: lam(0x4a3426),
    glass: new THREE.MeshLambertMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
    screen: new THREE.MeshBasicMaterial({ color: 0x5fd0ff }),
    grow: new THREE.MeshBasicMaterial({ color: 0xff5ad8 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff1d0 }),
    red: new THREE.MeshBasicMaterial({ color: 0xff3020 }),
  };

  constructor(readonly kind: HabKind, readonly seed = 1) {
    if (kind === 'base') this.buildBase(); else this.buildStation();
    this.group.traverse(o => { o.frustumCulled = false; });
  }

  // ---------------------------------------------------------------- pieces
  private add(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.rotation.set(rx, ry, rz);
    this.group.add(o);
    return o;
  }
  private box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material) {
    return this.add(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  }
  private station(act: HabAct, label: string, x: number, y: number, z: number, reach = 2.4) {
    this.stations.push({ act, label, at: new THREE.Vector3(x, y, z), reach });
  }
  private lights: THREE.PointLight[] = [];
  private light(x: number, y: number, z: number, color = 0xfff1d8, k = 1.2, d = 18) {
    const l = new THREE.PointLight(color, k, d, 1.6);
    l.position.set(x, y, z);
    l.visible = false;
    this.group.add(l);
    this.lights.push(l);
  }

  /** the lights inside, only while someone is near enough to see them: every light costs every lit surface in the scene */
  setLights(on: boolean) {
    if (this.lights[0]?.visible === on) return;
    for (const l of this.lights) l.visible = on;
  }

  // ---------------------------------------------------------------- the base
  /** a dome: an outer white shell and an inner panelled one, with a window band (or glass all the way up) */
  private dome(cx: number, cz: number, r: number, glassRoof = false) {
    const H = r * 0.78, sink = r - H;
    // profile: a circle of radius r centred `sink` below the floor
    const prof = (rr: number, y0: number, y1: number) => {
      const pts: THREE.Vector2[] = [];
      for (let k = 0; k <= 12; k++) {
        const y = y0 + ((y1 - y0) * k) / 12;
        pts.push(new THREE.Vector2(Math.sqrt(Math.max(0, rr * rr - (y + sink) ** 2)), y));
      }
      return pts;
    };
    const win0 = 1.9, win1 = 3.1;
    const parts: [number, number, boolean][] = glassRoof ? [[0, win0, false], [win0, H, true]] : [[0, win0, false], [win0, win1, true], [win1, H, false]];
    for (const [y0, y1, glass] of parts) {
      if (glass) { this.add(new THREE.LatheGeometry(prof(r - 0.08, y0, y1), 40), this.M.glass, cx, 0, cz); continue; }
      this.add(new THREE.LatheGeometry(prof(r, y0, y1), 40), this.M.hull, cx, 0, cz);
      this.add(new THREE.LatheGeometry(prof(r - 0.15, y0, y1), 40), this.M.wall, cx, 0, cz);
    }
    // the window frames, and a ring of orange at the foot
    if (!glassRoof) for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2, rr = Math.sqrt(r * r - (2.5 + sink) ** 2); this.add(new THREE.BoxGeometry(0.12, win1 - win0, 0.2), this.M.trim, cx + Math.cos(a) * rr, 2.5, cz + Math.sin(a) * rr, 0, -a, 0); }
    this.add(new THREE.CylinderGeometry(r * 0.99 + 0.1, r * 0.99 + 0.15, 0.5, 40, 1, true), this.M.accent, cx, 0.25, cz);
    this.add(new THREE.CircleGeometry(Math.sqrt(r * r - sink * sink) - 0.1, 40).rotateX(-Math.PI / 2), this.M.floor, cx, 0.02, cz);
    this.floor.push({ x: cx, z: cz, r: Math.sqrt(r * r - (sink + 1) ** 2) - 0.4 });
    this.light(cx, H - 1.2, cz, 0xfff1d8, 1.4, r * 2.6);
    // a ring of lamps under the roof
    const lampM = new THREE.MeshBasicMaterial({ color: 0xfff1d0 });
    this.lamps.push(lampM);
    this.add(new THREE.TorusGeometry(r * 0.45, 0.06, 4, 32), lampM, cx, H - 1.0, cz, Math.PI / 2, 0, 0);
    // window glow at night, from outside
    const g = lam(0xffe0a0, { emissive: 0x000000, transparent: true, opacity: 0.35, side: THREE.FrontSide });
    this.glow.push(g);
    if (!glassRoof) this.add(new THREE.LatheGeometry(prof(r + 0.02, win0 + 0.1, win1 - 0.1), 40), g, cx, 0, cz);
  }

  /** a tunnel between domes, along x from x0 to x1 at z (or along z, at x = z) */
  private tunnel(x0: number, x1: number, z = 0, alongZ = false) {
    const L = Math.abs(x1 - x0), m = (x0 + x1) / 2;
    for (const [r, mat] of [[1.7, this.M.hull], [1.55, this.M.wall]] as const) {
      const t = this.add(new THREE.CylinderGeometry(r, r, L, 18, 1, true), mat, alongZ ? z : m, 0.5, alongZ ? m : z);
      if (alongZ) t.rotation.x = Math.PI / 2; else t.rotation.z = Math.PI / 2;
    }
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    if (alongZ) { this.box(z - 1.3, z + 1.3, 0, 0.04, lo, hi, this.M.floor); this.halls.push({ x0: z - 1.0, x1: z + 1.0, z0: lo, z1: hi }); }
    else { this.box(lo, hi, 0, 0.04, z - 1.3, z + 1.3, this.M.floor); this.halls.push({ x0: lo, x1: hi, z0: z - 1.0, z1: z + 1.0 }); }
    // ribs round it, and a lamp along its roof
    const n = Math.max(1, Math.floor(L / 2));
    for (let k = 0; k <= n; k++) {
      const p = lo + (k * L) / n;
      const ring = new THREE.TorusGeometry(1.72, 0.08, 4, 18);
      if (alongZ) this.add(ring, this.M.steel, z, 0.5, p); else this.add(ring, this.M.steel, p, 0.5, z, 0, Math.PI / 2, 0);
    }
    if (alongZ) this.box(z - 0.12, z + 0.12, 2.05, 2.1, lo + 0.3, hi - 0.3, this.M.lamp); else this.box(lo + 0.3, hi - 0.3, 2.05, 2.1, z - 0.12, z + 0.12, this.M.lamp);
  }

  private buildBase() {
    const M = this.M;
    // command dome in the middle, quarters to the east, greenhouse to the west
    this.dome(0, 0, 9);
    this.dome(22, 0, 7);
    this.dome(-22, 0, 7.5, true);
    this.tunnel(8.6, 15.6);
    this.tunnel(-8.6, -15.2);
    // the airlock: a short tunnel south to an outer door
    this.tunnel(-8.6, -13.5, 0, true);
    this.box(-1.6, 1.6, 0, 3.1, -13.7, -13.5, M.accent);
    this.box(-0.7, 0.7, 0.05, 2.2, -13.78, -13.72, M.trim);
    this.add(new THREE.SphereGeometry(0.12, 8, 6), M.red, 0, 2.6, -13.85);
    this.station('exit', 'Airlock: step outside', 0, 1.3, -12.6, 2.2);
    this.door.set(0, 0, -15.5);
    this.entry.set(0, 0, -11.5);
    this.entryYaw = 0;
    this.rooms.push({ name: 'airlock', test: p => p.z < -8.4 && Math.abs(p.x) < 1.6 });
    // ---- command: the round mission console, the survey desk, a hologram table, a captain's log
    this.rooms.push({ name: 'command dome', test: p => Math.hypot(p.x, p.z) < 9 });
    this.add(new THREE.CylinderGeometry(2.2, 2.4, 0.95, 24), M.trim, 0, 0.48, 0);
    this.add(new THREE.CylinderGeometry(2.25, 2.25, 0.05, 24), M.steel, 0, 0.98, 0);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; this.add(new THREE.PlaneGeometry(1.1, 0.6), M.screen, Math.cos(a) * 2.0, 1.45, Math.sin(a) * 2.0, -0.25, -a + Math.PI / 2, 0).lookAt(Math.cos(a) * 4, 1.6, Math.sin(a) * 4); }
    this.add(new THREE.SphereGeometry(0.7, 20, 12), new THREE.MeshBasicMaterial({ color: 0x40a0ff, transparent: true, opacity: 0.35, depthWrite: false }), 0, 2.2, 0);
    this.blocks.push({ x: 0, z: 0, r: 2.6 });
    this.station('mission', 'Mission control', 0, 1.2, -2.4, 2.6);
    this.box(4.6, 6.6, 0, 0.85, -5.6, -4.0, M.trim);
    this.add(new THREE.PlaneGeometry(1.8, 1.0), M.screen, 5.6, 1.5, -5.95, 0, -0.6, 0);
    this.blocks.push({ x0: 4.4, x1: 6.8, z0: -5.8, z1: -3.8 });
    this.station('survey', 'Survey the target', 5.0, 1.0, -3.4, 2.4);
    this.box(-6.8, -4.6, 0, 0.78, 3.6, 5.6, M.wood);
    this.blocks.push({ x0: -7, x1: -4.4, z0: 3.4, z1: 5.8 });
    this.station('log', "The base's log", -5.2, 1.0, 3.3, 2.2);
    // ---- quarters: four bunks, a galley, a table
    this.rooms.push({ name: 'quarters', test: p => Math.hypot(p.x - 22, p.z) < 7 });
    for (const [x, z] of [[25.2, -3.2], [25.2, 3.2]] as const) {
      for (const y of [0.3, 1.5]) { this.box(x - 1, x + 1, y, y + 0.25, z - 1.0, z + 1.0, M.steel); this.box(x - 0.95, x + 0.95, y + 0.25, y + 0.42, z - 0.95, z + 0.95, M.blanket); }
      this.blocks.push({ x0: x - 1.1, x1: x + 1.1, z0: z - 1.1, z1: z + 1.1 });
    }
    this.station('sleep', 'Sleep in a bunk', 24.0, 1.0, 0, 2.6);
    this.box(18.6, 20.2, 0, 0.95, -4.6, -2.6, M.white);
    this.box(18.5, 20.3, 0.95, 1.0, -4.7, -2.5, M.steel);
    this.blocks.push({ x0: 18.4, x1: 20.4, z0: -4.8, z1: -2.4 });
    this.station('galley', 'The galley', 20.6, 1.0, -3.0, 2.2);
    this.add(new THREE.CylinderGeometry(0.9, 0.9, 0.06, 20), M.wood, 21, 0.78, 3.0);
    this.add(new THREE.CylinderGeometry(0.08, 0.08, 0.78, 6), M.steel, 21, 0.39, 3.0);
    this.blocks.push({ x: 21, z: 3, r: 1.0 });
    // ---- greenhouse: racks of plants under pink grow lights, a little tree in the middle
    this.rooms.push({ name: 'greenhouse', test: p => Math.hypot(p.x + 22, p.z) < 7.5 });
    for (const z of [-3.6, -1.2, 1.2, 3.6]) {
      if (Math.abs(z) < 2) continue;
      for (const y of [0.5, 1.4]) {
        this.box(-26, -18.5, y, y + 0.08, z - 0.45, z + 0.45, M.steel);
        this.box(-25.9, -18.6, y + 0.08, y + 0.2, z - 0.4, z + 0.4, M.soil);
        for (let k = 0; k < 9; k++) this.add(new THREE.IcosahedronGeometry(0.22 + 0.06 * ((k * 7 + this.seed) % 3), 0), M.leaf, -25.5 + k * 0.85, y + 0.38, z);
        this.box(-26, -18.5, y + 0.78, y + 0.82, z - 0.1, z + 0.1, M.grow);
      }
      this.blocks.push({ x0: -26.2, x1: -18.3, z0: z - 0.6, z1: z + 0.6 });
    }
    this.add(new THREE.CylinderGeometry(0.12, 0.18, 2.2, 6), M.wood, -22, 1.1, 0);
    this.add(new THREE.IcosahedronGeometry(1.2, 1), M.leaf, -22, 2.8, 0);
    this.blocks.push({ x: -22, z: 0, r: 0.6 });
    this.station('greenhouse', 'Tend the greenhouse', -20, 1.0, 0, 3);
    this.light(-22, 4.5, 0, 0xff80e0, 1.2, 16);
    // ---- outside: a solar field, a mast with a beacon, a landing pad, a rover shed
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
      const x = -14 + i * 6, z = 16 + j * 4;
      this.add(new THREE.BoxGeometry(5, 0.05, 2.4), M.panel, x, 1.3, z, -0.45, 0, 0);
      this.add(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 5), M.steel, x, 0.65, z);
    }
    this.add(new THREE.CylinderGeometry(0.12, 0.22, 16, 6), M.steel, 12, 8, 12);
    this.add(new THREE.SphereGeometry(1.4, 14, 6, 0, Math.PI * 2, 0, Math.PI / 3), M.white, 12, 15.5, 12, Math.PI * 0.75, 0, 0);
    const beacon = this.add(new THREE.SphereGeometry(0.3, 8, 6), M.red, 12, 16.4, 12);
    this.beacons.push(beacon);
    this.add(new THREE.CylinderGeometry(10, 10, 0.2, 32), M.trim, 38, 0.1, -10);
    this.add(new THREE.TorusGeometry(8, 0.25, 4, 32), M.accent, 38, 0.25, -10, Math.PI / 2, 0, 0);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, b = this.add(new THREE.SphereGeometry(0.2, 6, 4), M.lamp, 38 + Math.cos(a) * 9.4, 0.3, -10 + Math.sin(a) * 9.4); this.beacons.push(b); }
    this.box(-40, -32, 0, 4, -6, 2, M.hull);
    this.box(-39.5, -32.5, 0.02, 3.4, 2.0, 2.05, M.trim);
  }

  // ---------------------------------------------------------------- the station
  /** a module: a pressurised cylinder from a to b, white outside, panelled inside, its racks along the walls */
  private module(name: string, a: THREE.Vector3, b: THREE.Vector3, r: number, racks = true, lit = racks) {
    const d = b.clone().sub(a), L = d.length(), mid = a.clone().add(b).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    const put = (geo: THREE.BufferGeometry, m: THREE.Material) => { const o = new THREE.Mesh(geo, m); o.position.copy(mid); o.quaternion.copy(q); this.group.add(o); return o; };
    put(new THREE.CylinderGeometry(r, r, L, 20, 1, true), this.M.hull);
    put(new THREE.CylinderGeometry(r - 0.12, r - 0.12, L, 20, 1, true), this.M.wall);
    // the ribs outside, and end caps with their hatch rings
    for (let k = 0; k <= Math.floor(L / 1.6); k++) {
      const p = a.clone().addScaledVector(d, k / Math.max(1, Math.floor(L / 1.6)));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.03, 0.06, 4, 20), this.M.steel);
      ring.position.copy(p); ring.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
      this.group.add(ring);
    }
    if (racks) {
      // four walls of racks, white and grey, with screens and handrails, and a lamp strip on the "ceiling"
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q), up = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * Math.PI * 2;
        const nrm = side.clone().multiplyScalar(Math.cos(ang)).addScaledVector(up, Math.sin(ang));
        const n = Math.max(1, Math.floor(L / 1.1));
        for (let j = 0; j < n; j++) {
          const p = a.clone().addScaledVector(d, (j + 0.5) / n).addScaledVector(nrm, r - 0.45);
          const m = (j + k + this.seed) % 5 === 0 ? this.M.screen : (j + k) % 2 ? this.M.white : this.M.steel;
          const rack = new THREE.Mesh(new THREE.BoxGeometry(0.9, L / n - 0.08, 0.5), m === this.M.screen ? this.M.trim : m);
          rack.position.copy(p);
          rack.quaternion.copy(rackQ(nrm, d));
          this.group.add(rack);
          if (m === this.M.screen) { const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), this.M.screen); sc.position.copy(p).addScaledVector(nrm, -0.26); sc.lookAt(sc.position.clone().sub(nrm)); this.group.add(sc); }
        }
        if (k === 1) {
          const strip = new THREE.Mesh(new THREE.BoxGeometry(0.25, L - 0.4, 0.04), this.M.lamp);
          strip.position.copy(mid).addScaledVector(nrm, r - 0.2);
          strip.quaternion.copy(rackQ(nrm, d));
          this.group.add(strip);
        }
      }
    }
    this.caps.push({ a: a.clone(), b: b.clone(), r: r - 0.55, name });
    if (lit) this.light(mid.x, mid.y, mid.z, 0xf4f8ff, 1.0, L + 8);
  }

  private buildStation() {
    const M = this.M, V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    this.module('habitation module', V(0, 0, -15), V(0, 0, -2.2), 2.1);
    this.module('node', V(0, 0, -2.4), V(0, 0, 2.4), 2.4, false);
    this.module('laboratory', V(0, 0, 2.2), V(0, 0, 14), 2.1);
    this.module('docking adapter', V(0, 0, 13.8), V(0, 0, 18.5), 1.4, false);
    this.module('greenhouse module', V(2.2, 0, 0), V(11, 0, 0), 2.0, false);
    this.module('airlock', V(-2.2, 0, 0), V(-7, 0, 0), 1.6, false);
    // the cupola, under the node: seven windows on the world below
    this.module('cupola', V(0, -2.2, 0), V(0, -3.6, 0), 1.4, false);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 0.8, 7, 1, true), M.glass);
    cup.position.set(0, -4.0, 0);
    this.group.add(cup);
    this.add(new THREE.CircleGeometry(0.9, 7), M.glass, 0, -4.4, 0, Math.PI / 2, 0, 0);
    this.cupola.set(0, -3.2, 0);
    this.station('cupola', 'Look down from the cupola', 0, -3.0, 0, 2.6);
    // the ends of the long axis, closed
    this.add(new THREE.CircleGeometry(2.0, 20), M.hull, 0, 0, -15, 0, 0, 0);
    this.add(new THREE.CircleGeometry(1.9, 20), M.trim, 0, 0, -14.9, 0, Math.PI, 0);
    // habitation: four sleeping pods, the galley
    for (const [x, y] of [[1.3, 0.6], [-1.3, 0.6], [1.3, -0.8], [-1.3, -0.8]] as const) {
      this.box(x - 0.45, x + 0.45, y - 0.55, y + 0.55, -13.5, -11.6, M.cloth);
      this.box(x - 0.4, x + 0.4, y - 0.5, y + 0.5, -11.62, -11.58, M.blanket);
    }
    this.station('sleep', 'Sleep, strapped into a pod', 0, 0, -12.2, 2.6);
    this.box(-1.0, 1.0, -1.6, -0.9, -8.0, -5.6, M.white);
    this.station('galley', 'The galley', 0, -0.9, -6.8, 2.4);
    this.station('gym', 'The treadmill', 0, 1.0, -4.0, 2.2);
    this.box(-0.5, 0.5, 1.2, 1.5, -4.6, -3.4, M.trim);
    // the lab: mission control, the survey
    this.station('mission', 'Mission control', 0, 0, 6, 2.6);
    this.station('survey', 'Survey the target', 0, 0, 10, 2.6);
    this.station('log', "The station's log", 0, 0, 12.8, 2.2);
    // the greenhouse module: trays of plants under grow lights
    for (let k = 0; k < 6; k++) {
      const x = 3.4 + k * 1.3;
      for (const y of [-1.0, 1.0]) {
        this.box(x - 0.55, x + 0.55, y - 0.1, y + 0.1, -0.8, 0.8, M.soil);
        for (let j = 0; j < 3; j++) this.add(new THREE.IcosahedronGeometry(0.2, 0), M.leaf, x, y + (y > 0 ? -0.25 : 0.25), -0.5 + j * 0.5);
      }
      this.box(x - 0.5, x + 0.5, 1.55, 1.6, -0.2, 0.2, M.grow);
    }
    this.station('greenhouse', 'Tend the plants', 7, 0, 0, 3);
    this.light(7, 1.2, 0, 0xff80e0, 1.0, 10);
    // the airlock's outer hatch, and the docking port's ring and lights
    this.add(new THREE.TorusGeometry(0.8, 0.12, 6, 16), M.accent, -7.05, 0, 0, 0, Math.PI / 2, 0);
    this.hatch.set(-8.5, 0, 0);
    this.station('exit', 'Airlock: spacewalk outside', -5.8, 0, 0, 2.2);
    this.add(new THREE.TorusGeometry(1.2, 0.18, 6, 20), M.accent, 0, 0, 18.5);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2, b = this.add(new THREE.SphereGeometry(0.12, 6, 4), M.lamp, Math.cos(a) * 1.5, Math.sin(a) * 1.5, 18.6); this.beacons.push(b); }
    this.dock.set(0, 0, 18.6);
    this.dockDir.set(0, 0, 1);
    this.station('board', 'Back aboard the ship', 0, 0, 17.2, 2.2);
    this.entry.set(0, 0, 16.5);
    this.entryYaw = 0;
    // outside: a truss over the modules with eight solar wings and radiators
    this.add(new THREE.BoxGeometry(96, 1.1, 1.1), M.steel, 0, 6, 0);
    for (let k = -4; k <= 4; k++) this.add(new THREE.BoxGeometry(0.15, 6, 0.15), M.steel, k * 2.5, 3, 0);
    for (const x of [-44, -36, 36, 44]) for (const s of [-1, 1]) {
      const w = this.add(new THREE.BoxGeometry(4.4, 0.04, 34), M.panel, x, 6, s * 18);
      for (let k = 1; k < 6; k++) { const g = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.05, 0.06), M.gold); g.position.set(0, 0, -17 + k * 5.7); w.add(g); }
    }
    for (const x of [-18, 18]) this.add(new THREE.BoxGeometry(0.06, 12, 4), M.white, x, 0, 0);
    const beacon = this.add(new THREE.SphereGeometry(0.4, 6, 4), M.red, 48, 6.8, 0);
    this.beacons.push(beacon);
  }

  // ---------------------------------------------------------------- moving about
  /** base: can someone stand at (x, z) on the floor? */
  canStand(x: number, z: number) {
    const r = 0.3;
    const on = this.floor.some(c => (x - c.x) ** 2 + (z - c.z) ** 2 < (c.r - r) ** 2) || this.halls.some(h => x > h.x0 + r && x < h.x1 - r && z > h.z0 + r && z < h.z1 - r);
    if (!on) return false;
    return !this.blocks.some(b => 'r' in b ? (x - b.x) ** 2 + (z - b.z) ** 2 < (b.r + r) ** 2 : x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r);
  }

  /** station: is a point inside the pressurised modules? */
  inside(p: THREE.Vector3) {
    const ab = new THREE.Vector3(), ap = new THREE.Vector3();
    return this.caps.some(c => {
      ab.subVectors(c.b, c.a); ap.subVectors(p, c.a);
      const t = Math.max(0, Math.min(1, ap.dot(ab) / ab.lengthSq()));
      return ap.addScaledVector(ab, -t).length() < c.r;
    });
  }

  /** the console someone at `eye` looking along `dir` can use */
  facing(eye: THREE.Vector3, dir: THREE.Vector3): HabStation | null {
    let best: HabStation | null = null, score = Infinity;
    const d = new THREE.Vector3();
    for (const s of this.stations) {
      d.subVectors(s.at, eye);
      const dist = d.length();
      if (dist > s.reach + (this.kind === 'station' ? 0.6 : 0)) continue;
      const ang = d.angleTo(dir);
      if (ang > 0.7 && dist > 1.2) continue;
      const sc = ang + dist * 0.1;
      if (sc < score) { score = sc; best = s; }
    }
    return best;
  }

  roomName(p: THREE.Vector3) {
    if (this.kind === 'station') {
      const ab = new THREE.Vector3(), ap = new THREE.Vector3();
      let best = 'node', bd = Infinity;
      for (const c of this.caps) {
        ab.subVectors(c.b, c.a); ap.subVectors(p, c.a);
        const t = Math.max(0, Math.min(1, ap.dot(ab) / ab.lengthSq()));
        const d = ap.addScaledVector(ab, -t).length() - c.r;
        if (d < bd) { bd = d; best = c.name; }
      }
      return best;
    }
    return this.rooms.find(r => r.test(p))?.name ?? 'tunnel';
  }

  /** each frame: the lights blink, the windows glow after dark */
  update(dt: number, night: number) {
    this.t += dt;
    const on = Math.sin(this.t * 3) > 0.7;
    for (const b of this.beacons) (b.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xff4030 : 0x401010);
    for (const g of this.glow) { g.emissive.setRGB(0.9 * night, 0.7 * night, 0.4 * night); g.opacity = 0.15 + 0.6 * night; }
  }
}

function tile(t: THREE.Texture, u: number, v: number) {
  t.repeat.set(u, v);
  return t;
}

function rackQ(nrm: THREE.Vector3, d: THREE.Vector3) {
  const dd = d.clone().normalize();
  // right-handed: x = d × n, y = d, z = n
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(dd.clone().cross(nrm), dd, nrm));
}
