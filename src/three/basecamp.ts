import * as THREE from 'three';
import { load, type ModelName } from './models';
import { Interior } from './interior';
import { benchModel } from './growlab';

/**
 * A base on the ground, built from its three buildings: the modular outpost
 * in the middle (its hub is the command post: the table with Mission Control,
 * monitors to put any craft's camera on, the ship's console; its wings the
 * galley, the hydroponics, the quarters and the suit lockers by the door),
 * the dome habitat to the west (the common room, the greenhouse, the lab with
 * its sample analyser, the medical bay) and the vault hangar to the east (the
 * rover, ready to drive out of its open end). Between them the paths, and
 * south the pad the ship lands on. It all stands level on a terrace.
 *
 * You walk in and out through the buildings' own doors: where you can walk
 * comes from the buildings themselves, their floors where you stand and their
 * walls, furniture and machinery what stops you (a grid of them, a quarter of
 * a metre a cell, made once from each model).
 *
 * The base's frame: metres, y up, x to its right, z toward the back (as the
 * craft's models are built); its terrace at y = 0.
 */

/** a building: its model, where it stands in the base and which way it faces, and how high its floor is */
export interface Building { model: ModelName; name: string; x: number; z: number; rot: number; floor: number }
export const BUILDINGS: Building[] = [
  { model: 'modular-outpost', name: 'Outpost', x: 0, z: 0, rot: 0, floor: 1.6 },
  { model: 'dome-habitat', name: 'Habitat dome', x: -28, z: 1, rot: 0, floor: 0.12 },
  { model: 'vault-hangar', name: 'Hangar', x: 28, z: 0, rot: Math.PI / 2, floor: 0.1 },
];
/** where the ship lands, and how big the terrace is */
export const BASE = { pad: new THREE.Vector3(0, 0, -32), padR: 10, terrace: { x0: -42, x1: 42, z0: -44, z1: 14 } };

// ---------------------------------------------------------------- where you can walk
const RES = 0.25;
interface Grid { x0: number; z0: number; nx: number; nz: number; floor: Float32Array; solid: Uint8Array }
const grids = new Map<ModelName, Grid>();

/**
 * where a building's floors are and what stands on them, from its own
 * geometry: its floors (and, where there is no floor, the decks and steps you
 * climb to it); then what is in the way — the walls and furniture cut through
 * at knee to head height over whatever floor is there, so its doorways stay
 * open and you walk in and out through them
 */
/** doorways (middle and half sizes, a building's frame) to keep clear of the doors standing open in them */
const OPEN: Partial<Record<ModelName, [number, number, number, number][]>> = { 'modular-outpost': [[0, -6.1, 0.55, 0.45]], 'dome-habitat': [[8.6, 0, 0.35, 0.6]] };
/** what the base adds to a building and stands in the way (middle and half sizes, its frame): the dome's growth bench */
export const GROW = { x: 1.0, z: -2.65, w: 3.0, d: 0.6 };
const ADDED: Partial<Record<ModelName, [number, number, number, number][]>> = { 'dome-habitat': [[GROW.x, GROW.z, GROW.w / 2 + 0.05, GROW.d / 2 + 0.05]] };

export function gridOf(name: ModelName, root: THREE.Object3D): Grid {
  const had = grids.get(name);
  if (had) return had;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const x0 = box.min.x - 1, z0 = box.min.z - 1, nx = Math.ceil((box.max.x + 1 - x0) / RES), nz = Math.ceil((box.max.z + 1 - z0) / RES);
  const floor = new Float32Array(nx * nz).fill(NaN), deck = new Float32Array(nx * nz).fill(NaN), solid = new Uint8Array(nx * nz);
  // which of the horizontal cuts (every 15 cm up to 4.5 m) pass through something in each cell
  const cuts = new Uint32Array(nx * nz), CUT = 0.15, NCUT = 30;
  const cell = (x: number, z: number) => {
    const i = Math.floor((x - x0) / RES), j = Math.floor((z - z0) / RES);
    return i >= 0 && j >= 0 && i < nx && j < nz ? j * nx + i : -1;
  };
  const tris: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; mat: string; flat: boolean }[] = [];
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (let q: THREE.Object3D | null = m; q; q = q.parent) if (q.name === 'roof') return;
    const mat = (m.material as THREE.Material).name;
    if (mat === 'glow') return;
    // (the hangar's rover is not a wall: it drives out)
    if (m.name === 'hangar-rover') return;
    const pos = m.geometry.getAttribute('position'), idx = m.geometry.getIndex();
    const n = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < n; t++) {
      const v = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(t * 3 + k) : t * 3 + k).applyMatrix4(m.matrixWorld));
      const nn = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
      if (nn.lengthSq() < 1e-10) continue;
      tris.push({ a: v[0], b: v[1], c: v[2], mat, flat: Math.abs(nn.normalize().y) > 0.85 });
    }
  });
  // points over a triangle (seen from above), closer together than a cell
  const fill = (t: typeof tris[number], f: (x: number, y: number, z: number) => void) => {
    const { a, b, c } = t, L = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)), k = Math.max(1, Math.ceil(L / (RES * 0.5)));
    for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) {
      const u = i / k, w = j / k, s = 1 - u - w;
      f(a.x * s + b.x * u + c.x * w, a.y * s + b.y * u + c.y * w, a.z * s + b.z * u + c.z * w);
    }
  };
  // the floors themselves
  // (the lowest: the same finish turns up on a sill or a lintel too)
  for (const t of tris) if (t.mat === 'floor' && t.flat) fill(t, (x, y, z) => { const q = cell(x, z); if (q >= 0 && y < 2.5) floor[q] = Number.isNaN(floor[q]) ? y : Math.min(floor[q], y); });
  // other level surfaces: over a floor, furniture (a table, a bunk, a bench) in the way if it is between knee and head;
  // with no floor under, a deck or a step to walk on
  for (const t of tris) {
    if (!t.flat || t.mat === 'floor' || t.mat === 'regolith' || t.mat === 'solar') continue;
    fill(t, (x, y, z) => {
      const q = cell(x, z);
      if (q < 0) return;
      const f = floor[q];
      if (!Number.isNaN(f)) { if (y - f > 0.3 && y - f < 1.8) solid[q] = 1; }
      else if (y < 2.2 && t.c.y + t.a.y + t.b.y > 0) deck[q] = Number.isNaN(deck[q]) ? y : Math.max(deck[q], y);
    });
  }
  // walls and the rest: where each cut crosses a triangle
  const P: THREE.Vector3[] = [], e = new THREE.Vector3();
  for (const t of tris) {
    if (t.flat || t.mat === 'regolith' || t.mat === 'solar') continue;
    const lo = Math.min(t.a.y, t.b.y, t.c.y), hi = Math.max(t.a.y, t.b.y, t.c.y);
    for (let k = Math.max(0, Math.ceil(lo / CUT)); k < NCUT && k * CUT <= hi; k++) {
      const Y = k * CUT + 0.01;
      P.length = 0;
      for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) if ((u.y - Y) * (v.y - Y) < 0) P.push(e.clone().lerpVectors(u, v, (Y - u.y) / (v.y - u.y)));
      if (P.length < 2) continue;
      const n = Math.max(1, Math.ceil(P[0].distanceTo(P[1]) / (RES * 0.5)));
      for (let i = 0; i <= n; i++) { const q = cell(P[0].x + (P[1].x - P[0].x) * i / n, P[0].z + (P[1].z - P[0].z) * i / n); if (q >= 0) cuts[q] |= 1 << k; }
    }
  }
  // doors left standing open in their doorways: you squeeze past them
  for (const [x, z, hx, hz] of OPEN[name] ?? []) for (let a = x - hx; a <= x + hx; a += RES / 2) for (let b = z - hz; b <= z + hz; b += RES / 2) { const q = cell(a, b); if (q >= 0) cuts[q] = 0; }
  for (const [x, z, hx, hz] of ADDED[name] ?? []) for (let a = x - hx; a <= x + hx; a += RES / 2) for (let b = z - hz; b <= z + hz; b += RES / 2) { const q = cell(a, b); if (q >= 0) solid[q] = 1; }
  for (let q = 0; q < nx * nz; q++) {
    if (Number.isNaN(floor[q])) floor[q] = deck[q];
    const f = Number.isNaN(floor[q]) ? 0 : floor[q];
    // anything from just over the knee to head height over this floor
    for (let k = Math.ceil((f + 0.45) / CUT); k * CUT < f + 1.75 && k < NCUT; k++) if (cuts[q] & (1 << k)) { solid[q] = 1; break; }
  }
  const g = { x0, z0, nx, nz, floor, solid };
  grids.set(name, g);
  return g;
}

/** what is underfoot at a point of a model's own frame (its grid made): its floor there, or something in the way; null if the point is off the model */
export function gridAt(name: ModelName, x: number, z: number): { floor: number | null; solid: boolean } | null {
  const g = grids.get(name);
  if (!g) return null;
  const i = Math.floor((x - g.x0) / RES), j = Math.floor((z - g.z0) / RES);
  if (i < 1 || j < 1 || i >= g.nx - 1 || j >= g.nz - 1) return null;
  let solid = false;
  for (let dj = -1; dj <= 1 && !solid; dj++) for (let di = -1; di <= 1; di++) if (g.solid[(j + dj) * g.nx + i + di]) { solid = true; break; }
  const f = g.floor[j * g.nx + i];
  return { floor: Number.isNaN(f) ? null : f, solid };
}

/** a point of the base's frame in a building's own */
function inBuilding(B: Building, x: number, z: number) {
  const dx = x - B.x, dz = z - B.z, c = Math.cos(B.rot), s = Math.sin(B.rot);
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}

/**
 * what is underfoot at a point of the base (its frame): a building's floor
 * (its height) and which building, or rock in the way; null and false on open
 * ground. Before the buildings have loaded, nothing.
 */
export function baseGround(x: number, z: number): { floor: number | null; solid: boolean; building: Building | null } {
  for (const B of BUILDINGS) {
    const g = grids.get(B.model);
    if (!g) continue;
    const l = inBuilding(B, x, z);
    const i = Math.floor((l.x - g.x0) / RES), j = Math.floor((l.z - g.z0) / RES);
    if (i < 1 || j < 1 || i >= g.nx - 1 || j >= g.nz - 1) continue;
    // a body a little over half a metre across: anything solid within it stops you
    let solid = false;
    for (let dj = -1; dj <= 1 && !solid; dj++) for (let di = -1; di <= 1; di++) if (g.solid[(j + dj) * g.nx + i + di]) { solid = true; break; }
    const f = g.floor[j * g.nx + i];
    if (solid) return { floor: Number.isNaN(f) ? null : f, solid: true, building: B };
    if (!Number.isNaN(f)) return { floor: f, solid: false, building: B };
  }
  return { floor: null, solid: false, building: null };
}

// ---------------------------------------------------------------- the model
/** the base: its terrace, paths and pad now, its buildings as they arrive */
export function baseModel(): THREE.Group {
  const g = new THREE.Group();
  const concrete = new THREE.MeshLambertMaterial({ color: 0x8c8a84 }), path = new THREE.MeshLambertMaterial({ color: 0x5c5e62 });
  const T = BASE.terrace, w = T.x1 - T.x0, d = T.z1 - T.z0;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 30, d), concrete);
  slab.position.set((T.x0 + T.x1) / 2, -15.02, (T.z0 + T.z1) / 2);
  g.add(slab);
  // paths from building to building and down to the pad
  // (the outpost's stairs down to the pad; the dome's door and the hangar's apron round to the stairs)
  for (const [x0, z0, x1, z1] of [[0, -9.6, 0, -23], [-17.6, 1, -12, -11], [-12, -11, 26, -11], [28, -12, 28, -15], [28, -15, 7, -28]]) {
    const L = Math.hypot(x1 - x0, z1 - z0), p = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.06, L + 2.8), path);
    p.position.set((x0 + x1) / 2, 0.03, (z0 + z1) / 2);
    p.rotation.y = Math.atan2(x1 - x0, z1 - z0);
    g.add(p);
  }
  // the pad: a ringed circle with an H, lights round it
  const pad = new THREE.Group();
  pad.position.copy(BASE.pad);
  g.add(pad);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(BASE.padR, BASE.padR, 0.12, 40), new THREE.MeshLambertMaterial({ color: 0x2a2d33 }));
  disc.position.y = 0.06;
  pad.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(BASE.padR - 1.2, 0.25, 4, 40), new THREE.MeshLambertMaterial({ color: 0xd8643a }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.14;
  pad.add(ring);
  const white = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  for (const [x, z, sx, sz] of [[-1.6, 0, 0.7, 5], [1.6, 0, 0.7, 5], [0, 0, 2.6, 0.7]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.04, sz), white); b.position.set(x, 0.14, z); pad.add(b); }
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
  for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, s = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 4), lamp); s.position.set(Math.cos(a) * (BASE.padR + 0.4), 0.3, Math.sin(a) * (BASE.padR + 0.4)); pad.add(s); }
  // the buildings: a low shape in each place until the model is in
  const holders: { B: Building; g: THREE.Group }[] = [];
  for (const B of BUILDINGS) {
    const h = new THREE.Group();
    h.position.set(B.x, 0, B.z);
    h.rotation.y = B.rot;
    h.name = B.name;
    const stand = new THREE.Mesh(new THREE.BoxGeometry(14, 4, 12), new THREE.MeshLambertMaterial({ color: 0xc8ccd2 }));
    stand.position.y = 2;
    stand.name = 'stand-in';
    h.add(stand);
    g.add(h);
    holders.push({ B, g: h });
    load(B.model).then(m => {
      if (!m) return;
      if (B.model === 'vault-hangar') splitRover(m);
      const o = m.clone();
      gridOf(B.model, m);
      h.remove(stand);
      h.add(o);
      o.traverse(x => { x.frustumCulled = true; });
    });
  }
  g.userData.buildings = holders;
  return g;
}

/** the hangar's rover in its bay, in the hangar's own frame: the model's pieces wholly inside this box */
const ROVER_BAY = new THREE.Box3(new THREE.Vector3(1.2, 0.05, -0.9), new THREE.Vector3(4.8, 2.4, 1.9));

/**
 * The hangar's model has its rover built into it. Its pieces (the triangles joined at their corners: the
 * wheels, the chassis, the cab and its windows, the lights, the mast) are taken out into meshes of their own,
 * each called 'hangar-rover', so the rover can go from the bay when it drives out (once, on the model itself,
 * so every base's copy has them)
 */
function splitRover(root: THREE.Object3D) {
  if (root.userData.roverSplit) return;
  root.userData.roverSplit = true;
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  for (const m of meshes) {
    let roof = false;
    for (let q: THREE.Object3D | null = m; q; q = q.parent) if (q.name === 'roof') roof = true;
    if (roof) continue;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry, pos = g.getAttribute('position'), n = pos.count / 3;
    // the pieces: triangles that share a corner
    const up = Array.from({ length: n }, (_, k) => k), find = (k: number): number => { while (up[k] !== k) { up[k] = up[up[k]]; k = up[k]; } return k; };
    const seen = new Map<string, number>(), v = new THREE.Vector3();
    const inBay = new Array<boolean>(n);
    for (let t = 0; t < n; t++) {
      let inside = true;
      for (let c = 0; c < 3; c++) {
        v.fromBufferAttribute(pos, t * 3 + c);
        const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`, o = seen.get(key);
        if (o === undefined) seen.set(key, t); else up[find(o)] = find(t);
        if (!ROVER_BAY.containsPoint(v.applyMatrix4(m.matrixWorld))) inside = false;
      }
      inBay[t] = inside;
    }
    // a piece is the rover's if every triangle of it is in the bay
    const whole = new Map<number, boolean>();
    for (let t = 0; t < n; t++) { const r = find(t); whole.set(r, (whole.get(r) ?? true) && inBay[t]); }
    const rover: number[] = [], rest: number[] = [];
    for (let t = 0; t < n; t++) (whole.get(find(t)) ? rover : rest).push(t);
    if (!rover.length) continue;
    const part = (tris: number[]) => {
      const out = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(g.attributes)) {
        const src = a as THREE.BufferAttribute, k = src.itemSize, arr = new (src.array.constructor as Float32ArrayConstructor)(tris.length * 3 * k);
        tris.forEach((t, i) => { for (let c = 0; c < 3 * k; c++) arr[i * 3 * k + c] = src.array[t * 3 * k + c]; });
        out.setAttribute(name, new THREE.BufferAttribute(arr, k, src.normalized));
      }
      out.computeBoundingSphere();
      return out;
    };
    const r = new THREE.Mesh(part(rover), m.material);
    r.name = 'hangar-rover';
    r.position.copy(m.position); r.quaternion.copy(m.quaternion); r.scale.copy(m.scale);
    m.geometry = part(rest);
    m.parent!.add(r);
  }
}

// ---------------------------------------------------------------- what there is to use
/** a building's point (its own frame) in the base's frame */
export function at(B: Building, x: number, y: number, z: number) {
  const c = Math.cos(B.rot), s = Math.sin(B.rot);
  return new THREE.Vector3(B.x + c * x + s * z, y, B.z - s * x + c * z);
}

/** each base's growth bench */
export const BENCH = new WeakMap<Interior, ReturnType<typeof benchModel>>();

/**
 * the base's consoles, monitors and fittings, as spots to use (F) and screens
 * that show its state; the monitors can carry a craft's camera
 */
export function baseLayer(name: string): Interior {
  const I = new Interior(name, false);
  const [O, D, Hg] = BUILDINGS, G = I.group;
  const Fo = O.floor, Fd = D.floor, Fh = Hg.floor;
  /** a monitor laid over one of a model's own screens (its middle and which way it faces, in the building's frame) */
  const monitor = (B: Building, id: string, x: number, y: number, z: number, nx: number, nz: number, label: string) => {
    const l = Math.hypot(nx, nz), p = at(B, x + (nx / l) * 0.02, y, z + (nz / l) * 0.02);
    const m = I.screen(id, G, 1.0, 0.52, p, Math.atan2(nx, nz) + B.rot);
    I.monitors.push({ id, mesh: m, label });
    I.addSpot(`monitor:${id}`, p, `${label[0].toUpperCase()}${label.slice(1)}: Mission Control, or a craft's camera on it`, 2.4);
    return m;
  };
  // the outpost, up its stairs and through the airlock: the hub with the command table; east the control room,
  // its three consoles; west the quarters, bunks and suit lockers; south the hydroponics
  I.addSpot('mission', at(O, 0, Fo + 0.9, 0), 'The command table: Mission Control', 2.6);
  monitor(O, 'base', 5.0, 2.72, 1.17, 0, -1, 'the base console');
  monitor(O, 'ship', 6.6, 2.72, 1.17, 0, -1, 'the ship console');
  monitor(O, 'feed', 8.2, 2.72, 1.17, 0, -1, 'the camera console');
  I.addSpot('callship', at(O, 7.2, Fo + 1.0, -1.1), 'The flight desk: call the ship to the pad', 2.4);
  I.addSpot('command', at(O, 5.0, Fo + 1.0, -1.1), 'Base status', 2.4);
  I.addSpot('sleep', at(O, -6.5, Fo + 0.7, 1.0), 'Sleep in the quarters', 2.6);
  I.addSpot('suit', at(O, -9.0, Fo + 1.0, -0.9), 'The suit lockers: refill your suit', 2.4);
  I.addSpot('greens', at(O, 0, Fo + 1.0, 6.5), 'Hydroponics: food and air', 2.8);
  // the dome: the common room's table, the greenhouse, the lab's desks, the medical bay
  I.addSpot('galley', at(D, 0, Fd + 0.9, 0), 'The common room: something hot from the galley', 2.6);
  I.addSpot('greens', at(D, 3.4, Fd + 1.1, -3.6), 'The greenhouse', 2.6);
  // the growth lab: six chambers on a bench in front of the greenhouse racks, a label over each
  const bench = benchModel();
  bench.group.position.copy(at(D, GROW.x, Fd, GROW.z));
  bench.group.rotation.y = D.rot;
  G.add(bench.group);
  BENCH.set(I, bench);
  for (let k = 0; k < 6; k++) I.screen(`ch${k}`, G, 0.44, 0.11, at(D, GROW.x + bench.slots[k].x, Fd + bench.height + 0.6, GROW.z + 0.25), D.rot);
  I.addSpot('growlab', at(D, GROW.x, Fd + 1.1, GROW.z), 'The growth lab: soils and plants', 2.6);
  I.addSpot('med', at(D, -4.0, Fd + 0.9, 0), 'The medical bay: a check-up', 2.4);
  monitor(D, 'lab', 3.96, 1.24, 3.33, -0.77, -0.64, 'the lab\'s east screen');
  monitor(D, 'dcam', -0.9, 1.24, 5.10, 0.17, -0.98, 'the lab\'s west screen');
  I.screen('spec', G, 1.0, 0.52, at(D, 1.77 - 0.34 * 0.02, 1.24, 4.86 - 0.94 * 0.02), Math.atan2(-0.34, -0.94) + D.rot);
  I.addSpot('analyse', at(D, 1.77, 1.24, 4.86), 'The lab: analyse your samples', 2.4);
  // the hangar: the rover in its bay; the crew room behind, its consoles, its table, its lockers
  I.addSpot('vehicle', at(Hg, 3.0, Fh + 1.0, 0.5), 'The rover: drive it out', 3.4);
  monitor(Hg, 'weather', -6.57, 1.22, -1.5, 1, 0, 'the weather console');
  monitor(Hg, 'rover', -6.57, 1.22, 0, 1, 0, 'the rover console');
  monitor(Hg, 'hcam', -6.57, 1.22, 1.5, 1, 0, 'the hangar\'s camera console');
  I.addSpot('holo', at(Hg, -3.8, Fh + 0.9, 0), 'The briefing table: the map', 2.4);
  I.addSpot('suit', at(Hg, -4.3, Fh + 1.1, -2.9), 'Suit lockers', 2.4);
  // the ceiling lights: the hub, the wings and the airlock; the dome's middle and its medical bay; the hangar's bay and crew room
  for (const [B, x, h, z] of [[O, 0, 2.6, 0], [O, 6.5, 2.2, 0], [O, -6.5, 2.2, 0], [O, 0, 2.2, 6.5], [O, 0, 2.2, -5.2], [D, 0, 2.8, 0], [D, -4, 2.4, 0], [D, 2, 2.6, 3.5], [Hg, 3, 3.2, 0], [Hg, -4.3, 2.6, 0]] as const) I.lamps.push(at(B, x, B.floor + h, z));
  return I;
}
