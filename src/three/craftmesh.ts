import * as THREE from 'three';
import { STATION } from './interior';
import { baseModel } from './basecamp';

/**
 * Models of the craft you can send out and the hardware already on the
 * worlds: a probe in its aeroshell, an orbiter, a lander, a rover, an
 * ISS-style station, a surface base, and what real missions left behind —
 * Apollo descent stages and flags, Lunar Roving Vehicles, Venera landers,
 * Huygens. Metres, y up, −z forward; each stands on its local origin.
 */

const lam = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
export const MAT = {
  white: lam(0xe8e8ea), grey: lam(0x8a909a), dark: lam(0x3a3f48), black: lam(0x18181c),
  gold: lam(0xd8a830, { emissive: 0x2a1800 }), foil: lam(0xc8a040), silver: lam(0xc8ccd4),
  panel: lam(0x1c2e5a, { emissive: 0x050a18 }), orange: lam(0xd8643a), red: lam(0xb02a20), blue: lam(0x2a4aa0),
  glass: new THREE.MeshLambertMaterial({ color: 0x6a90b0, transparent: true, opacity: 0.55 }),
  window: new THREE.MeshLambertMaterial({ color: 0x405870, emissive: 0x2a3a4a, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
  lamp: new THREE.MeshBasicMaterial({ color: 0xfff0c0 }), cyan: new THREE.MeshBasicMaterial({ color: 0x60e0ff }),
  chute: lam(0xf0f0f0, { side: THREE.DoubleSide }), chuteOr: lam(0xe06a30, { side: THREE.DoubleSide }),
};

type M = THREE.Material;
function add(g: THREE.Object3D, geo: THREE.BufferGeometry, m: M, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  g.add(o);
  return o;
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0: number, r1: number, h: number, n = 12) => new THREE.CylinderGeometry(r0, r1, h, n);

/** a solar array wing: a long blue panel on a boom */
function wing(g: THREE.Object3D, x: number, y: number, z: number, len: number, w: number, axis: 'x' | 'z' = 'x') {
  const p = add(g, axis === 'x' ? box(len, 0.04, w) : box(w, 0.04, len), MAT.panel, x, y, z);
  // the grid lines
  for (let k = 1; k < 4; k++) add(p, axis === 'x' ? box(0.03, 0.05, w) : box(w, 0.05, 0.03), MAT.silver, axis === 'x' ? -len / 2 + (len * k) / 4 : 0, 0, axis === 'x' ? 0 : -len / 2 + (len * k) / 4);
  return p;
}

/** an atmospheric entry probe: heat shield and backshell; `chute` adds the parachute above it */
export function probeMesh(chute = false) {
  const g = new THREE.Group();
  add(g, cyl(0.15, 0.65, 0.5, 16), MAT.dark, 0, 0.25, 0);
  add(g, cyl(0.65, 0.62, 0.18, 16), MAT.foil, 0, 0, 0);
  add(g, new THREE.SphereGeometry(0.62, 16, 6, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), MAT.orange, 0, 0.55, 0);
  if (chute) {
    const c = new THREE.Group();
    c.name = 'chute';
    add(c, new THREE.SphereGeometry(3, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2.6), MAT.chute, 0, 6, 0);
    add(c, new THREE.SphereGeometry(3.02, 16, 2, 0, Math.PI * 2, 0.2, 0.25), MAT.chuteOr, 0, 6, 0);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const l = add(c, cyl(0.01, 0.01, 6.6, 3), MAT.grey, Math.cos(a) * 1.3, 3.3, Math.sin(a) * 1.3);
      l.rotation.set(Math.sin(a) * 0.38, 0, -Math.cos(a) * 0.38);
    }
    g.add(c);
  }
  return g;
}

/** an orbiter: a gold box with two solar wings and a high-gain dish */
export function orbiterMesh() {
  const g = new THREE.Group();
  add(g, box(2, 2.2, 2), MAT.gold);
  add(g, cyl(0.06, 0.06, 1.2), MAT.silver, 0, 1.6, 0);
  const dish = add(g, new THREE.SphereGeometry(1.4, 16, 6, 0, Math.PI * 2, 0, Math.PI / 4), MAT.white, 0, 1.2, 0);
  dish.rotation.x = Math.PI;
  dish.position.y = 3.2;
  wing(g, -4, 0, 0, 5.5, 2.2);
  wing(g, 4, 0, 0, 5.5, 2.2);
  add(g, box(0.4, 0.4, 0.6), MAT.dark, 0, -1.3, 0.3);
  return g;
}

/** a lander: a hexagonal deck on three legs, with solar fans, a mast, a robot arm */
export function landerMesh() {
  const g = new THREE.Group();
  add(g, cyl(1.1, 1.1, 0.5, 6), MAT.foil, 0, 1.2, 0);
  add(g, cyl(1.12, 1.12, 0.06, 6), MAT.white, 0, 1.47, 0);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const l = add(g, cyl(0.05, 0.05, 1.4, 6), MAT.silver, Math.cos(a) * 1.25, 0.65, Math.sin(a) * 1.25);
    l.rotation.set(-Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3);
    add(g, cyl(0.25, 0.3, 0.06, 10), MAT.dark, Math.cos(a) * 1.45, 0.03, Math.sin(a) * 1.45);
  }
  // two round solar fans, like Phoenix and InSight
  for (const s of [-1, 1]) add(g, cyl(1.05, 1.05, 0.04, 10), MAT.panel, s * 2.1, 1.45, 0);
  add(g, cyl(0.04, 0.04, 1.5), MAT.silver, 0.4, 2.2, -0.4);
  add(g, box(0.3, 0.2, 0.2), MAT.dark, 0.4, 3, -0.4);
  const arm = add(g, box(0.08, 0.08, 1.6), MAT.white, -0.6, 1.6, -1.2);
  arm.rotation.x = 0.4;
  return g;
}

/** a rover: Curiosity-sized, six wheels on rockers, a mast with its camera head, an RTG at the back */
export function roverMesh(scale = 1) {
  const g = new THREE.Group();
  const s = new THREE.Group();
  s.scale.setScalar(scale);
  g.add(s);
  add(s, box(1.8, 0.55, 2.4), MAT.white, 0, 1.05, 0);
  add(s, box(1.82, 0.06, 2.42), MAT.foil, 0, 0.8, 0);
  for (const x of [-1.1, 1.1]) for (const z of [-1.0, 0.0, 1.0]) {
    const w = add(s, cyl(0.26, 0.26, 0.4, 12), MAT.dark, x, 0.26, z, 0, 0, Math.PI / 2);
    w.name = 'wheel';
    add(s, box(0.08, 0.6, 0.08), MAT.silver, x * 0.92, 0.6, z);
  }
  add(s, cyl(0.06, 0.06, 1.3), MAT.white, 0.6, 1.95, -0.9);
  const head = add(s, box(0.55, 0.3, 0.35), MAT.white, 0.6, 2.7, -0.95);
  head.name = 'head';
  add(head, box(0.12, 0.12, 0.05), MAT.black, -0.12, 0, -0.18);
  add(head, box(0.12, 0.12, 0.05), MAT.black, 0.12, 0, -0.18);
  add(s, cyl(0.3, 0.3, 0.7, 8), MAT.grey, 0, 1.25, 1.45, 0.6, 0, 0);
  for (let k = 0; k < 6; k++) add(s, box(0.02, 0.6, 0.2), MAT.dark, 0, 1.25 + (k % 2) * 0.01, 1.45, 0.6, (k / 6) * Math.PI, 0);
  const arm = add(s, box(0.08, 0.08, 1.6), MAT.white, -0.6, 1.0, -1.6);
  arm.rotation.x = -0.2;
  add(s, cyl(0.05, 0.05, 0.9), MAT.silver, -0.7, 1.7, 0.8);
  return g;
}

/** blanket-white with stitched quilting, for the modules' insulation */
const QUILT = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9e7e0'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = 1;
  for (let i = 0; i <= 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
  for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.04})`; g.fillRect(Math.random() * 128, Math.random() * 128, 6 + Math.random() * 14, 4 + Math.random() * 10); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 2);
  return t;
})();
const quilt = lam(0xffffff, { map: QUILT, flatShading: false });

/**
 * the station: the ISS's layout, built from the same list of modules as its
 * inside (interior.ts) — the docking adapter forward, Zvezda, the Unity node
 * with the laboratory and Kibo either side, Tranquility with the cupola under
 * it, Destiny, the stowage module — under the long truss with its eight
 * solar wings, radiators, and the robotic arm
 */
export function stationMesh() {
  const g = new THREE.Group();
  for (const m of STATION.main) {
    const len = m.z1 - m.z0, zc = (m.z0 + m.z1) / 2;
    add(g, cyl(m.hull, m.hull, len, 24), m.id === 'pma' ? MAT.silver : quilt, 0, 0, zc, Math.PI / 2, 0, 0);
    // the rings at the ends, and a band of dark insulation round the middle
    for (const z of [m.z0 + 0.1, m.z1 - 0.1]) add(g, cyl(m.hull + 0.06, m.hull + 0.06, 0.18, 24), MAT.silver, 0, 0, z, Math.PI / 2, 0, 0);
    if (len > 6) add(g, cyl(m.hull + 0.03, m.hull + 0.03, 0.5, 24), MAT.grey, 0, 0, zc, Math.PI / 2, 0, 0);
  }
  for (const m of STATION.side) {
    const len = m.x1 - m.x0, xc = (m.x0 + m.x1) / 2;
    add(g, cyl(m.hull, m.hull, len, 24), quilt, xc, 0, STATION.nodeZ, 0, 0, Math.PI / 2);
    for (const x of [m.x0 + 0.1, m.x1 - 0.1]) add(g, cyl(m.hull + 0.06, m.hull + 0.06, 0.18, 24), MAT.silver, x, 0, STATION.nodeZ, 0, 0, Math.PI / 2);
  }
  // the docking port's ring and the Kibo airlock's hatch
  add(g, new THREE.TorusGeometry(1.1, 0.12, 8, 24), MAT.dark, 0, 0, STATION.port.z);
  add(g, new THREE.TorusGeometry(0.8, 0.12, 8, 4), MAT.red, STATION.airlock.x, 0, STATION.airlock.z, 0, Math.PI / 2, Math.PI / 4);
  // Kibo's exposed platform beyond its airlock
  add(g, box(4, 0.6, 3.4), MAT.grey, STATION.airlock.x + 2.2, -0.5, STATION.airlock.z);
  // the cupola under Tranquility: a drum of seven windows looking down
  const cu = STATION.cupola;
  // (a frame round its glass, open where the windows are, so it can be seen out of)
  add(g, new THREE.TorusGeometry(1.0, 0.09, 6, 6), MAT.silver, cu.x, cu.y - 0.35, cu.z, Math.PI / 2, 0, 0);
  add(g, new THREE.TorusGeometry(0.5, 0.07, 6, 6), MAT.silver, cu.x, cu.y - 1.0, cu.z, Math.PI / 2, 0, 0);

  // the truss, over Destiny: a long box of girders, with the rotary joints near its ends
  const T = new THREE.Group();
  T.position.set(0, 4.2, 9);
  g.add(T);
  add(T, box(100, 1.4, 1.4), MAT.grey);
  for (let x = -48; x <= 48; x += 4) add(T, box(0.12, 1.5, 1.5), MAT.dark, x, 0, 0);
  for (const sx of [-1, 1]) add(T, box(0.12, 0.12, 1.4), MAT.silver, 0, sx * 0.65, 0), add(T, box(0.12, 1.4, 0.12), MAT.silver, 0, 0, sx * 0.65);
  add(g, box(1.2, 3, 1.2), MAT.grey, 0, 2.3, 9);
  for (const x of [-32, 32]) add(T, cyl(1.1, 1.1, 1.2, 12), MAT.silver, x, 0, 0, 0, 0, Math.PI / 2);
  // eight solar wings, gold-edged, at the ends of the truss, and their masts
  for (const x of [-46, -39, 39, 46]) for (const s of [-1, 1]) {
    const w = wing(T, x, 0, s * 19, 35, 4.6, 'z');
    add(w, box(4.8, 0.03, 0.15), MAT.gold, 0, 0, 0);
    add(T, box(0.15, 0.15, 36), MAT.silver, x, 0.4, s * 19);
  }
  // the radiators, pale and edge-on to the sun
  for (const x of [-22, -16, 16, 22]) add(T, box(0.08, 12, 3.2), MAT.white, x, -7.5, 0);
  // the robotic arm on its mobile base: two long booms and a hand
  const arm = new THREE.Group();
  arm.position.set(6, 0.9, 0);
  T.add(arm);
  add(arm, cyl(0.25, 0.25, 8.5, 8), MAT.white, 0, 4.2, 0, 0.3, 0, 0);
  add(arm, cyl(0.25, 0.25, 8.5, 8), MAT.white, 0, 7.5, -5, 1.6, 0, 0);
  add(arm, cyl(0.35, 0.35, 0.7, 8), MAT.dark, 0, 7.9, -1.3);
  add(arm, box(0.6, 0.6, 1), MAT.dark, 0, 7.3, -9.4);
  // a crew capsule docked on top of Unity
  add(g, cyl(1.6, 2, 2.6, 16), MAT.white, 0, 3.6, STATION.nodeZ);
  add(g, cyl(0.7, 1.6, 1.2, 16), MAT.black, 0, 5.5, STATION.nodeZ);
  // navigation lights at the ends of the truss
  for (const x of [-50, 50]) add(T, new THREE.SphereGeometry(0.4, 6, 4), MAT.lamp, x, 0.7, 0);
  return g;
}

/** a surface base: its terrace, pad and buildings (basecamp.ts) */
export function baseMesh(_seed = 1) { return baseModel(); }

/** where the launch pad's rocket stands and where landers set down, in its own frame */
export const PAD = { rocket: new THREE.Vector3(-8, 0, 0), land: new THREE.Vector3(10, 0, 4) };

/**
 * a launch pad: a concrete apron on a foundation, the flame trench, a
 * service tower with its swing arms beside a rocket on the stand, and a
 * marked circle beside it where landers come down and go up
 */
export function padMesh() {
  const g = new THREE.Group();
  const conc = lam(0x9a968e), slab = lam(0x8c8a84);
  add(g, box(44, 30, 34), slab, 0, -15.05, 0);
  add(g, box(44, 0.3, 34), conc, 0, 0.15, 0);
  // the flame trench under the rocket
  add(g, box(5, 0.32, 16), MAT.black, PAD.rocket.x, 0.16, 6);
  // the stand and the rocket on it: two stages and a capsule
  add(g, box(7, 1.6, 7), MAT.grey, PAD.rocket.x, 0.8, PAD.rocket.z);
  const r = new THREE.Group();
  r.name = 'rocket';
  r.position.set(PAD.rocket.x, 1.6, PAD.rocket.z);
  g.add(r);
  add(r, cyl(1.8, 1.8, 28, 16), MAT.white, 0, 14, 0);
  add(r, cyl(1.8, 1.8, 0.6, 16), MAT.black, 0, 20, 0);
  add(r, cyl(1.5, 1.8, 10, 16), MAT.white, 0, 33, 0);
  add(r, cyl(0.3, 1.5, 4, 16), MAT.silver, 0, 40, 0);
  for (let k = 0; k < 4; k++) add(r, box(0.15, 3, 1.6), MAT.dark, Math.cos(k * Math.PI / 2) * 1.9, 1.5, Math.sin(k * Math.PI / 2) * 1.9, 0, -k * Math.PI / 2, 0);
  // the service tower and its arms
  add(g, box(4, 46, 4), MAT.orange, PAD.rocket.x - 6.5, 23, PAD.rocket.z);
  for (let y = 4; y < 46; y += 4) add(g, box(4.2, 0.2, 4.2), MAT.dark, PAD.rocket.x - 6.5, y, PAD.rocket.z);
  for (const y of [18, 34]) add(g, box(4.5, 0.6, 1), MAT.grey, PAD.rocket.x - 3, y, PAD.rocket.z);
  add(g, new THREE.SphereGeometry(0.4, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3020 }), PAD.rocket.x - 6.5, 46.5, PAD.rocket.z);
  // the landing circle, ringed in orange with a big H
  add(g, cyl(7, 7, 0.06, 32), MAT.dark, PAD.land.x, 0.33, PAD.land.z);
  add(g, new THREE.TorusGeometry(6.2, 0.25, 4, 32), MAT.orange, PAD.land.x, 0.38, PAD.land.z, Math.PI / 2, 0, 0);
  for (const sx of [-1, 1]) add(g, box(0.7, 0.06, 5), MAT.white, PAD.land.x + sx * 1.6, 0.38, PAD.land.z);
  add(g, box(2.6, 0.06, 0.7), MAT.white, PAD.land.x, 0.38, PAD.land.z);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; add(g, new THREE.SphereGeometry(0.2, 6, 4), MAT.lamp, PAD.land.x + Math.cos(a) * 7.4, 0.5, PAD.land.z + Math.sin(a) * 7.4); }
  // floodlight masts at the corners
  for (const [x, z] of [[-20, -15], [20, -15], [-20, 15], [20, 15]]) { add(g, cyl(0.2, 0.25, 18, 6), MAT.silver, x, 9, z); add(g, box(1.6, 0.6, 0.6), MAT.lamp, x, 18, z); }
  return g;
}


/** the descent stage the Apollo crews left behind, on its four legs, with its gold foil */
export function apolloMesh() {
  const g = new THREE.Group();
  add(g, cyl(2.1, 2.1, 1.65, 8), MAT.gold, 0, 1.95, 0);
  add(g, box(3.2, 1.6, 3.2), MAT.foil, 0, 1.95, 0, 0, Math.PI / 8, 0);
  add(g, cyl(0.6, 0.9, 0.7, 10), MAT.dark, 0, 0.9, 0);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a), z = Math.sin(a);
    const l = add(g, cyl(0.07, 0.07, 2.4, 6), MAT.silver, x * 2.9, 1.2, z * 2.9);
    l.rotation.set(-z * 0.5, 0, x * 0.5);
    add(g, cyl(0.47, 0.47, 0.12, 10), MAT.silver, x * 3.5, 0.06, z * 3.5);
  }
  // the ladder down the front leg, the plaque on it
  add(g, box(0.5, 1.6, 0.05), MAT.silver, 2.5, 1.0, 0, 0, Math.PI / 2, -0.4);
  return g;
}

/** a flag on a pole with a crossbar to hold it out in vacuum (the Apollo ones; most have been bleached white) */
export function flagMesh(stripes: number[] = [0xb02030, 0xffffff, 0x203a80], vacuum = true) {
  const g = new THREE.Group();
  add(g, cyl(0.02, 0.02, 2.4, 6), MAT.silver, 0, 1.2, 0);
  if (vacuum) add(g, cyl(0.015, 0.015, 1.5, 6), MAT.silver, 0.75, 2.33, 0, 0, 0, Math.PI / 2);
  stripes.forEach((c, k) => add(g, box(1.5, 0.9 / stripes.length, 0.01), lam(c), 0.75, 2.3 - (0.9 / stripes.length) * (k + 0.5), 0));
  return g;
}

/** the Lunar Roving Vehicle */
export function lrvMesh() {
  const g = new THREE.Group();
  add(g, box(1.8, 0.1, 3.1), MAT.silver, 0, 0.7, 0);
  for (const x of [-0.95, 0.95]) for (const z of [-1.15, 1.15]) {
    add(g, cyl(0.41, 0.41, 0.23, 12), MAT.dark, x, 0.41, z, 0, 0, Math.PI / 2);
    add(g, box(0.5, 0.05, 1.0), MAT.grey, x, 0.9, z);
  }
  for (const x of [-0.4, 0.4]) add(g, box(0.6, 0.6, 0.05), MAT.grey, x, 1.0, 0.2, -0.2, 0, 0);
  add(g, cyl(0.02, 0.02, 1.2, 4), MAT.silver, 0.6, 1.3, -1.2);
  add(g, new THREE.SphereGeometry(0.5, 10, 4, 0, Math.PI * 2, 0, Math.PI / 3), MAT.white, 0.6, 2.0, -1.2, Math.PI, 0, 0);
  return g;
}

/** a Venera lander: a pressure sphere on a crushable landing ring, with its aerobrake disc */
export function veneraMesh() {
  const g = new THREE.Group();
  add(g, new THREE.TorusGeometry(1.0, 0.18, 6, 16), MAT.grey, 0, 0.18, 0, Math.PI / 2, 0, 0);
  add(g, cyl(0.5, 0.9, 0.6, 12), MAT.grey, 0, 0.55, 0);
  add(g, new THREE.SphereGeometry(0.85, 14, 10), MAT.silver, 0, 1.45, 0);
  add(g, cyl(1.2, 1.2, 0.08, 16), MAT.dark, 0, 2.3, 0);
  add(g, cyl(0.3, 0.3, 0.5, 8), MAT.silver, 0, 2.6, 0);
  // the colour calibration bar and the arm of the penetrometer
  add(g, box(0.6, 0.05, 0.12), MAT.orange, 0.9, 0.45, 0.6);
  return g;
}

/** Huygens, as it came to rest on Titan */
export function huygensMesh() {
  const g = new THREE.Group();
  add(g, cyl(0.65, 0.65, 0.5, 14), MAT.foil, 0, 0.25, 0);
  add(g, cyl(0.4, 0.55, 0.3, 14), MAT.silver, 0, 0.65, 0);
  return g;
}

/** an alien building, by seed: a dome, a stepped tower or a spire, in their own colours */
export function alienMesh(seed: number, color: number) {
  const g = new THREE.Group();
  const r = (k: number) => { const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  const m = lam(color), m2 = lam(new THREE.Color(color).offsetHSL(0.08, 0, -0.2).getHex());
  const kind = Math.floor(r(0) * 3);
  if (kind === 0) {
    const R = 4 + 6 * r(1);
    add(g, new THREE.SphereGeometry(R, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), m);
    add(g, new THREE.TorusGeometry(R * 0.7, 0.3, 4, 18), MAT.lamp, 0, R * 0.55, 0, Math.PI / 2, 0, 0);
  } else if (kind === 1) {
    let y = 0, w = 10 + 6 * r(2);
    for (let k = 0; k < 3 + Math.floor(r(3) * 3); k++) { const h = 3 + 3 * r(4 + k); add(g, box(w, h, w), k % 2 ? m2 : m, 0, y + h / 2, 0); y += h; w *= 0.7; }
    add(g, box(w * 0.5, 1, w * 0.5), MAT.lamp, 0, y + 0.5, 0);
  } else {
    const h = 20 + 40 * r(5);
    add(g, new THREE.ConeGeometry(3 + 2 * r(6), h, 7), m, 0, h / 2, 0);
    add(g, new THREE.SphereGeometry(2, 8, 6), MAT.cyan, 0, h * 0.7, 0);
  }
  return g;
}

// ---------------------------------------------------------------- a base's modules, built beside it
/** how far each module reaches from its middle (half its width across, x, and its depth, z), m */
export const MODULE_SIZE = { greenhouse: [13.5, 5], drill: [5, 5], habitat: [8.5, 4], silo: [7.5, 4] } as const;
export type ModuleKind = keyof typeof MODULE_SIZE;

/** a module's model: a greenhouse, an ice drill, a habitat module or a pair of storage silos */
export function moduleMesh(k: ModuleKind): THREE.Group {
  const g = new THREE.Group();
  const leaf = lam(0x4f9a4a), soil = lam(0x5a4430);
  // a low concrete footing under each
  const [hx, hz] = MODULE_SIZE[k];
  add(g, box(hx * 2, 0.4, hz * 2), MAT.grey, 0, 0.1, 0);
  if (k === 'greenhouse') {
    // a long glass vault on a low wall, rows of crops under it, white end walls with doors
    const vault = new THREE.CylinderGeometry(4.4, 4.4, 24, 20, 1, true, -Math.PI / 2, Math.PI);
    add(g, vault, MAT.window, 0, 0.9, 0, 0, 0, Math.PI / 2);
    for (let k2 = -5; k2 <= 5; k2++) add(g, box(0.08, 4.4, 0.08), MAT.silver, k2 * 2.2, 0.9 + 2.2, 0).scale.set(1, 1, 1);
    for (const s of [-1, 1]) {
      add(g, box(24, 0.6, 0.25), MAT.white, 0, 0.6, s * 4.4);
      add(g, new THREE.CircleGeometry(4.4, 20, 0, Math.PI), MAT.white, s * 12, 0.9, 0, 0, s * Math.PI / 2, 0);
      add(g, box(0.1, 2.2, 1.4), MAT.dark, s * 12.05, 1.4, 0);
    }
    for (let r = -1; r <= 1; r++) {
      add(g, box(22, 0.5, 1.1), soil, 0, 0.55, r * 2.4);
      for (let p = 0; p < 18; p++) add(g, new THREE.IcosahedronGeometry(0.42, 0), leaf, -10.5 + p * 1.24, 1.05, r * 2.4 + ((p * 7) % 3 - 1) * 0.15);
    }
    for (let k2 = 0; k2 < 3; k2++) add(g, box(22, 0.08, 0.08), MAT.lamp, 0, 4.2, -1.6 + k2 * 1.6);
  } else if (k === 'drill') {
    // a derrick over the hole, the drill string down it, a pump house and two tanks of meltwater
    for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { const leg = add(g, cyl(0.15, 0.15, 14.4, 6), MAT.orange, x * 0.7, 7.3, z * 0.7); leg.rotation.set(z * 0.07, 0, -x * 0.07); }
    for (let y = 2; y < 14; y += 3) add(g, box(2.9 - y * 0.1, 0.15, 2.9 - y * 0.1), MAT.orange, 0, y, 0);
    add(g, box(1.6, 1.2, 1.6), MAT.dark, 0, 14.3, 0);
    add(g, cyl(0.18, 0.18, 14, 8), MAT.silver, 0, 7, 0);
    add(g, box(3.4, 2.6, 3), MAT.white, -3.2, 1.6, 2.2);
    for (const z of [-2.6, -0.2]) { add(g, cyl(1.1, 1.1, 3, 14), MAT.silver, 3.4, 1.8, z); add(g, cyl(1.12, 1.12, 0.25, 14), MAT.blue, 3.4, 2.6, z); }
    add(g, new THREE.SphereGeometry(0.22, 8, 6), MAT.lamp, 0, 15.1, 0);
  } else if (k === 'habitat') {
    // two pressurised cylinders on legs either side of a node, a strip of lit windows down each
    add(g, new THREE.SphereGeometry(2.1, 14, 10), MAT.white, 0, 2.6, 0);
    for (const s of [-1, 1]) {
      add(g, cyl(2.3, 2.3, 6.4, 16), MAT.white, s * 4.9, 2.6, 0, 0, 0, Math.PI / 2);
      add(g, new THREE.SphereGeometry(2.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.white, s * 8.1, 2.6, 0, 0, 0, -s * Math.PI / 2);
      add(g, box(5.8, 0.4, 0.1), MAT.lamp, s * 4.9, 2.9, 2.28);
      add(g, box(5.8, 0.4, 0.1), MAT.lamp, s * 4.9, 2.9, -2.28);
      for (const x of [2.6, 7.2]) for (const z of [-1.4, 1.4]) add(g, cyl(0.12, 0.12, 1.2, 6), MAT.grey, s * x, 0.7, z);
      add(g, box(6.4, 0.15, 0.4), MAT.orange, s * 4.9, 4.85, 0);
    }
    add(g, box(1.2, 2.2, 0.2), MAT.dark, 0, 1.6, 2.05);
  } else {
    // two tall silos with domed tops, a ladder up each and a walkway between
    for (const s of [-1, 1]) {
      add(g, cyl(3, 3, 9, 20), MAT.white, s * 3.8, 4.8, 0);
      add(g, new THREE.SphereGeometry(3, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.silver, s * 3.8, 9.3, 0);
      add(g, cyl(3.02, 3.02, 0.4, 20), MAT.orange, s * 3.8, 3, 0);
      for (let y = 0.8; y < 9; y += 0.45) add(g, box(0.5, 0.05, 0.05), MAT.grey, s * 3.8, y, 3.08);
    }
    add(g, box(1.6, 0.2, 1.2), MAT.grey, 0, 9.3, 0);
  }
  g.traverse(o => { o.frustumCulled = false; });
  return g;
}
