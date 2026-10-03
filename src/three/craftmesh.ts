import * as THREE from 'three';

/**
 * Models of the craft you can send out and of the ones already there — the
 * Apollo descent stages, the Mars rovers, the Venera landers — built from a
 * few boxes and cylinders, in metres, with +y up and −z forward.
 */

const lam = (c: number) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
const M = {
  white: lam(0xe6e6e2), grey: lam(0x8a8e96), dark: lam(0x2c3038), gold: lam(0xd8a840), foil: lam(0xc89a3a), panel: lam(0x23365e),
  red: lam(0xc84030), orange: lam(0xe07a30), black: lam(0x141418), tan: lam(0xb09878), glass: new THREE.MeshBasicMaterial({ color: 0x9fd8ff }),
  lamp: new THREE.MeshBasicMaterial({ color: 0xfff0c0 }), blue: lam(0x2a4ea0), silver: lam(0xc8ccd2), chute: new THREE.MeshLambertMaterial({ color: 0xf0f0f0, side: THREE.DoubleSide }),
};

function box(g: THREE.Group, w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  g.add(o);
  return o;
}
function cyl(g: THREE.Group, r0: number, r1: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 12) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m);
  o.position.set(x, y, z);
  g.add(o);
  return o;
}
function strut(g: THREE.Group, a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material) {
  const d = b.clone().sub(a), o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), m);
  o.position.copy(a).add(b).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.add(o);
}
function legs(g: THREE.Group, n: number, R: number, top: number, foot: number, m: THREE.Material) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + Math.PI / n;
    const p = new THREE.Vector3(Math.cos(a) * R, 0.1, Math.sin(a) * R);
    strut(g, new THREE.Vector3(Math.cos(a) * R * 0.45, top, Math.sin(a) * R * 0.45), p, 0.05, m);
    cyl(g, foot, foot * 1.15, 0.08, M.grey, p.x, 0.04, p.z);
  }
}
function panelWing(g: THREE.Group, w: number, h: number, x: number, y: number, z: number, rotY = 0) {
  const p = box(g, w, 0.05, h, M.panel, x, y, z);
  p.rotation.y = rotY;
  for (let k = 1; k < 4; k++) box(g, 0.03, 0.06, h, M.grey, x + (k / 4 - 0.5) * w, y, z).rotation.y = rotY;
}

/** an atmospheric entry probe: heat shield, aft cover, and a parachute that opens (`chute` named) */
export function probeMesh() {
  const g = new THREE.Group();
  const shield = cyl(g, 0.05, 0.65, 0.45, M.foil, 0, 0, 0, 20);
  shield.rotation.x = Math.PI;
  cyl(g, 0.6, 0.45, 0.5, M.white, 0, 0.45, 0, 20);
  const chute = new THREE.Group();
  chute.name = 'chute';
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), M.chute);
  canopy.position.y = 9;
  chute.add(canopy);
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; strut(chute, new THREE.Vector3(0, 0.7, 0), new THREE.Vector3(Math.cos(a) * 2.6, 9.6, Math.sin(a) * 2.6), 0.01, M.grey); }
  chute.visible = false;
  g.add(chute);
  return g;
}

/** an orbiter: a bus in gold foil, two solar wings, a dish */
export function orbiterMesh() {
  const g = new THREE.Group();
  box(g, 1.8, 1.8, 2.4, M.foil);
  panelWing(g, 5, 1.8, 3.6, 0, 0);
  panelWing(g, 5, 1.8, -3.6, 0, 0);
  box(g, 1.2, 0.08, 0.1, M.grey, 1.5, 0, 0);
  box(g, 1.2, 0.08, 0.1, M.grey, -1.5, 0, 0);
  const dish = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.4, 16, 1, true), new THREE.MeshLambertMaterial({ color: 0xe8e8e8, side: THREE.DoubleSide }));
  dish.position.set(0, 1.3, 0);
  dish.rotation.x = Math.PI;
  g.add(dish);
  cyl(g, 0.05, 0.05, 1.2, M.grey, 0, 0, 1.6).rotation.x = Math.PI / 2;
  return g;
}

/** a robotic lander on three legs, with solar fans, a mast camera and an arm */
export function landerMesh() {
  const g = new THREE.Group();
  cyl(g, 0.9, 0.9, 0.45, M.white, 0, 1.0, 0, 6);
  legs(g, 3, 1.4, 1.0, 0.18, M.grey);
  for (const s of [-1, 1]) {
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.03, 10), M.panel);
    fan.position.set(s * 1.9, 1.2, 0);
    g.add(fan);
  }
  cyl(g, 0.04, 0.04, 1.1, M.grey, 0.3, 1.75, 0.3);
  box(g, 0.25, 0.18, 0.18, M.dark, 0.3, 2.35, 0.3);
  strut(g, new THREE.Vector3(-0.4, 1.1, 0.5), new THREE.Vector3(-0.9, 0.5, 1.3), 0.03, M.grey);
  return g;
}

/** a rover: six wheels on rockers, a deck, a mast with its camera head, a power source at the back */
export function roverMesh(scale = 1) {
  const g = new THREE.Group();
  box(g, 2.0, 0.55, 2.8, M.white, 0, 1.05, 0);
  box(g, 1.9, 0.08, 2.7, M.dark, 0, 1.36, 0);
  for (const s of [-1, 1]) for (const z of [-1.1, 0, 1.1]) {
    const w = cyl(g, 0.3, 0.3, 0.3, M.dark, s * 1.25, 0.3, z, 14);
    w.rotation.z = Math.PI / 2;
    w.name = 'wheel';
    strut(g, new THREE.Vector3(s * 1.05, 0.95, z * 0.6), new THREE.Vector3(s * 1.2, 0.35, z), 0.04, M.grey);
  }
  cyl(g, 0.05, 0.05, 1.3, M.grey, 0.6, 2.0, -1.0);
  box(g, 0.5, 0.22, 0.25, M.white, 0.6, 2.7, -1.05);
  box(g, 0.08, 0.08, 0.02, M.black, 0.5, 2.7, -1.18);
  box(g, 0.08, 0.08, 0.02, M.black, 0.7, 2.7, -1.18);
  cyl(g, 0.22, 0.22, 0.7, M.grey, 0, 1.25, 1.55).rotation.x = Math.PI / 2 + 0.5;
  const dish = cyl(g, 0.35, 0.35, 0.04, M.silver, -0.6, 1.5, 0.6, 16);
  dish.rotation.x = 0.4;
  g.scale.setScalar(scale);
  return g;
}

/** an orbital station in the style of the ISS: a long truss, eight solar wings, a row of pressurised modules */
export function stationMesh() {
  const g = new THREE.Group();
  box(g, 108, 1.2, 1.2, M.grey);
  for (const x of [-48, -36, 36, 48]) for (const s of [-1, 1]) {
    const w = box(g, 11.5, 0.06, 34, M.panel, x, 0, s * 18);
    w.name = 'wing';
    box(g, 0.3, 0.3, 34, M.foil, x, 0, s * 18);
  }
  for (const x of [-20, 20]) box(g, 3.5, 0.1, 14, M.white, x, -3, 9);
  // modules along the station's length, crossing the truss
  for (const [z, r, l] of [[-22, 2.1, 10], [-12, 2.2, 10], [-3, 2.3, 8], [5, 2.1, 8], [13, 2.2, 9], [22, 1.8, 7]] as const) {
    const m = cyl(g, r, r, l, M.white, 0, -4, z, 16);
    m.rotation.x = Math.PI / 2;
  }
  for (const s of [-1, 1]) { const m = cyl(g, 2.1, 2.1, 7, M.white, s * 6, -4, 0, 16); m.rotation.z = Math.PI / 2; }
  box(g, 0.6, 7, 0.6, M.grey, 0, -1.5, 0);
  for (const [x, z] of [[2, -27], [-2, 27]]) { const l = cyl(g, 0.3, 0.3, 0.3, M.lamp, x, -4, z); l.name = 'blink'; }
  return g;
}

/** a surface base: domes, habitats, solar fields, an antenna, a landing pad with lights */
export function baseMesh() {
  const g = new THREE.Group();
  const dome = (x: number, z: number, r: number) => {
    const d = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.white);
    d.position.set(x, 0, z);
    g.add(d);
    cyl(g, r * 1.02, r * 1.02, 0.4, M.grey, x, 0.2, z, 20);
    const w = cyl(g, r * 0.35, r * 0.35, 0.1, M.lamp, x, r * 0.98, z, 12);
    w.name = 'window';
  };
  dome(0, 0, 7); dome(16, 4, 5); dome(-14, 6, 5.5);
  for (const [x, z, l, rot] of [[8, 2, 9, 0.25], [-7, 3, 8, -0.3]] as const) { const t = cyl(g, 1.6, 1.6, l, M.white, x, 1.6, z, 14); t.rotation.z = Math.PI / 2; t.rotation.y = rot; }
  const hab = cyl(g, 2.6, 2.6, 14, M.white, 2, 2.6, -14, 16);
  hab.rotation.z = Math.PI / 2;
  for (let k = 0; k < 4; k++) box(g, 0.6, 0.6, 0.05, M.lamp, -3 + k * 3, 2.8, -11.4);
  // solar field
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    const p = box(g, 5, 0.08, 3, M.panel, 26 + i * 6, 2.2, -8 + j * 5);
    p.rotation.x = -0.5;
    cyl(g, 0.08, 0.08, 2.1, M.grey, 26 + i * 6, 1.05, -8 + j * 5, 6);
  }
  // antenna tower with a red light
  cyl(g, 0.25, 0.4, 18, M.grey, -22, 9, -12, 8);
  const dish = new THREE.Mesh(new THREE.ConeGeometry(2.4, 0.9, 16, 1, true), new THREE.MeshLambertMaterial({ color: 0xe8e8e8, side: THREE.DoubleSide }));
  dish.position.set(-22, 17, -12);
  dish.rotation.x = Math.PI * 0.75;
  g.add(dish);
  const top = cyl(g, 0.3, 0.3, 0.3, new THREE.MeshBasicMaterial({ color: 0xff3020 }), -22, 18.3, -12);
  top.name = 'blink';
  // a landing pad, ringed with lights
  cyl(g, 14, 14, 0.15, M.grey, -4, 0.08, 26, 32);
  for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; cyl(g, 0.25, 0.25, 0.3, M.lamp, -4 + Math.cos(a) * 13.4, 0.25, 26 + Math.sin(a) * 13.4, 6); }
  return g;
}

/** the Apollo lunar module's descent stage, left behind, with a flag nearby */
export function lmMesh() {
  const g = new THREE.Group();
  const body = cyl(g, 2.1, 2.1, 1.6, M.foil, 0, 1.9, 0, 8);
  body.rotation.y = Math.PI / 8;
  legs(g, 4, 3.6, 1.6, 0.45, M.foil);
  box(g, 0.9, 0.08, 1.0, M.grey, 1.9, 1.1, 0); // the porch
  for (let k = 0; k < 5; k++) box(g, 0.05, 0.05, 0.8, M.grey, 2.6 + k * 0.12, 1.0 - k * 0.2, 0);
  g.add(flagMesh(0x203878, 6, 0));
  return g;
}

/** a flag on a pole */
export function flagMesh(color = 0x203878, x = 0, z = 0) {
  const g = new THREE.Group();
  cyl(g, 0.02, 0.02, 2.2, M.silver, x, 1.1, z, 6);
  box(g, 0.02, 0.8, 1.2, lam(color), x, 1.75, z + 0.62);
  box(g, 0.02, 0.02, 1.2, M.silver, x, 2.15, z + 0.62);
  return g;
}

/** the lunar roving vehicle */
export function lrvMesh() {
  const g = new THREE.Group();
  box(g, 1.8, 0.1, 3.0, M.grey, 0, 0.8, 0);
  for (const s of [-1, 1]) for (const z of [-1.1, 1.1]) { const w = cyl(g, 0.4, 0.4, 0.23, M.tan, s * 0.95, 0.4, z, 14); w.rotation.z = Math.PI / 2; }
  for (const s of [-1, 1]) box(g, 0.55, 0.5, 0.5, M.silver, s * 0.4, 1.1, 0.2);
  const umb = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.25, 16, 1, true), new THREE.MeshLambertMaterial({ color: 0xe8e8e8, side: THREE.DoubleSide }));
  umb.position.set(0, 1.8, -1.1);
  umb.rotation.x = Math.PI;
  g.add(umb);
  cyl(g, 0.02, 0.02, 1, M.grey, 0, 1.3, -1.1, 6);
  return g;
}

/** a Venera lander: a pressure sphere on a crushable ring, its petals open */
export function veneraMesh() {
  const g = new THREE.Group();
  cyl(g, 1.0, 1.2, 0.6, M.grey, 0, 0.3, 0, 16);
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 10), M.white);
  s.position.y = 1.4;
  g.add(s);
  cyl(g, 1.05, 1.05, 0.08, M.grey, 0, 2.2, 0, 16);
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; const p = box(g, 0.5, 0.05, 1.0, M.white, Math.cos(a) * 1.1, 2.3, Math.sin(a) * 1.1); p.rotation.y = -a; p.rotation.z = 0.5; }
  return g;
}

/** the Huygens probe on Titan's ground */
export function huygensMesh() {
  const g = new THREE.Group();
  const s = cyl(g, 0.65, 0.65, 0.5, M.foil, 0, 0.25, 0, 20);
  s.rotation.x = 0.15;
  cyl(g, 0.4, 0.55, 0.3, M.white, 0, 0.6, 0, 16);
  return g;
}

/** a little helicopter (Ingenuity) */
export function heliMesh() {
  const g = new THREE.Group();
  box(g, 0.2, 0.15, 0.2, M.white, 0, 0.35, 0);
  for (const s of [-1, 1]) strut(g, new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(s * 0.25, 0, s * 0.2), 0.008, M.grey);
  cyl(g, 0.01, 0.01, 0.35, M.grey, 0, 0.6, 0, 4);
  for (const y of [0.65, 0.75]) box(g, 1.2, 0.01, 0.06, M.dark, 0, y, 0).rotation.y = y * 3;
  box(g, 0.3, 0.02, 0.25, M.panel, 0, 0.8, 0);
  return g;
}

/** a model for a real site's craft */
export function siteMesh(model: string): THREE.Group | null {
  switch (model) {
    case 'lm': return lmMesh();
    case 'lrv': return lrvMesh();
    case 'rover-small': return roverMesh(0.35);
    case 'rover-mid': return roverMesh(0.6);
    case 'rover-big': return roverMesh(1);
    case 'lander': return landerMesh();
    case 'venera': return veneraMesh();
    case 'probe': return huygensMesh();
    case 'heli': return heliMesh();
    case 'flag': return flagMesh(0xc03030);
    default: return null;
  }
}
