import * as THREE from 'three';

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

/** a station: the ISS's layout, a long truss with eight solar wings and a string of pressurised modules */
export function stationMesh() {
  const g = new THREE.Group();
  add(g, box(100, 1.2, 1.2), MAT.silver);
  // the modules, along the middle, across the truss
  for (const [z, l, r] of [[-20, 8, 2.1], [-10, 10, 2.1], [0, 8, 2.2], [10, 12, 2.1], [22, 10, 2], [30, 6, 1.7]] as const) {
    add(g, cyl(r, r, l, 14), MAT.white, 0, -2.6, z, Math.PI / 2, 0, 0);
  }
  add(g, cyl(2.1, 2.1, 9, 14), MAT.white, 6, -2.6, 0, 0, 0, Math.PI / 2);
  add(g, cyl(2.1, 2.1, 9, 14), MAT.white, -6, -2.6, 0, 0, 0, Math.PI / 2);
  // eight solar wings at the ends of the truss
  for (const x of [-46, -38, 38, 46]) for (const s of [-1, 1]) wing(g, x, 0, s * 18, 35, 4.6, 'z');
  // radiators
  for (const x of [-20, 20]) add(g, box(0.06, 13, 4), MAT.white, x, -9, 0);
  // the cupola, and lights
  add(g, cyl(1, 1.4, 1.2, 7), MAT.glass, 0, -5, 4);
  for (const x of [-50, 50]) add(g, new THREE.SphereGeometry(0.4, 6, 4), MAT.lamp, x, 0.7, 0);
  return g;
}

/** a surface base: three habitat domes joined by tunnels, a solar field, a mast, a landing pad */
export function baseMesh(seed = 1) {
  const g = new THREE.Group();
  const domes: [number, number, number][] = [[0, 0, 7], [16, 6, 5], [-14, 9, 5.5]];
  for (const [x, z, r] of domes) {
    add(g, new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.white, x, 0, z);
    add(g, cyl(r * 1.02, r * 1.02, 0.6, 18), MAT.grey, x, 0.3, z);
    // windows round the dome
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + seed; add(g, box(0.9, 0.5, 0.1), MAT.lamp, x + Math.cos(a) * r * 0.86, r * 0.42, z + Math.sin(a) * r * 0.86, 0, -a + Math.PI / 2, 0); }
  }
  for (let k = 1; k < domes.length; k++) {
    const [x, z] = domes[k], dx = x - domes[0][0], dz = z - domes[0][1], l = Math.hypot(dx, dz);
    const t = add(g, cyl(1.3, 1.3, l, 10), MAT.grey, dx / 2, 1.2, dz / 2);
    t.rotation.set(Math.PI / 2, 0, 0);
    t.rotation.y = 0;
    t.lookAt(x, 1.2, z);
    t.rotateX(Math.PI / 2);
  }
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    const p = add(g, box(4, 0.05, 2), MAT.panel, -10 + i * 5, 1.4, -18 - j * 3, -0.5, 0, 0);
    add(g, box(0.1, 1.4, 0.1), MAT.silver, p.position.x, 0.7, p.position.z);
  }
  add(g, cyl(0.15, 0.2, 14, 6), MAT.silver, 8, 7, -8);
  add(g, new THREE.SphereGeometry(1.4, 12, 5, 0, Math.PI * 2, 0, Math.PI / 3), MAT.white, 8, 14, -8, Math.PI * 0.75, 0, 0);
  add(g, new THREE.SphereGeometry(0.3, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3020 }), 8, 14.4, -8);
  add(g, cyl(9, 9, 0.2, 24), MAT.dark, 30, 0.1, -12);
  add(g, new THREE.TorusGeometry(7.5, 0.25, 4, 24), MAT.orange, 30, 0.25, -12, Math.PI / 2, 0, 0);
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
