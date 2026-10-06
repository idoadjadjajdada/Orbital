import * as THREE from 'three';

/**
 * Places you go inside: an ISS-like station in orbit, a base on the ground,
 * and whatever comes later.
 *
 * An interior is a model in its craft's own frame (metres; y up, the long
 * way along z), with the spaces you can move through (boxes and round
 * rooms), the things you can use (spots, as on the ship: look at one and
 * press F), screens that show live readings, and the light fixtures the
 * lights inside follow. In a station you float: you move the way you look,
 * up and down as well, and push off the walls; in a base you walk, with the
 * world's own gravity, on its floors.
 *
 * Outside and inside are one: the station's exterior (craftmesh.ts) is built
 * from the same list of modules as its interior, and a base's domes are the
 * same domes, so a window seen from inside looks out where the outside has
 * one.
 */

export interface Spot { id: string; at: THREE.Vector3; label: string; reach: number }
interface Disc { x: number; z: number; r: number; y0: number; y1: number }
interface Region { name: string; box?: THREE.Box3; disc?: Disc }

export class Interior {
  readonly group = new THREE.Group();
  readonly spots: Spot[] = [];
  /** the spaces you can be in: a body's middle must be inside one of these */
  readonly boxes: THREE.Box3[] = [];
  readonly discs: Disc[] = [];
  /** things in the way inside those spaces (a rocket's crates and ladders) */
  readonly solids: THREE.Box3[] = [];
  /** named parts, for "where am I" */
  readonly regions: Region[] = [];
  /** the monitors that can carry a craft's camera (feeds.ts) */
  readonly monitors: { id: string; mesh: THREE.Mesh; label: string }[] = [];
  /** the light fixtures: the lights inside follow the nearest */
  readonly lamps: THREE.Vector3[] = [];
  /** where you come in, and which way you face */
  spawn = { p: new THREE.Vector3(), yaw: 0 };
  /** where the floor is, in one with gravity */
  floor = 0;
  private screens = new Map<string, { g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D; tex: THREE.CanvasTexture; w: number; h: number; tint: string }>();
  private anims: ((t: number) => void)[] = [];

  constructor(readonly name: string, readonly zeroG: boolean) { this.group.name = `interior:${name}`; }

  /** can a body of radius r have its middle at p? */
  canBe(p: THREE.Vector3, r = 0.25) {
    for (const b of this.solids) if (p.x > b.min.x - r && p.x < b.max.x + r && p.z > b.min.z - r && p.z < b.max.z + r && p.y + 0.6 > b.min.y && p.y - 0.9 < b.max.y) return false;
    for (const b of this.boxes) if (p.x > b.min.x + r && p.x < b.max.x - r && p.y > b.min.y + (this.zeroG ? r : -0.01) && p.y < b.max.y - r && p.z > b.min.z + r && p.z < b.max.z - r) return true;
    for (const d of this.discs) if (Math.hypot(p.x - d.x, p.z - d.z) < d.r - r && p.y >= d.y0 - 0.01 && p.y < d.y1 - r) return true;
    return false;
  }

  /** the part of the interior a point is in */
  where(p: THREE.Vector3) {
    for (const g of this.regions) {
      if (g.box && g.box.containsPoint(p)) return g.name;
      if (g.disc && Math.hypot(p.x - g.disc.x, p.z - g.disc.z) < g.disc.r && p.y >= g.disc.y0 - 0.01 && p.y < g.disc.y1) return g.name;
    }
    return this.name;
  }

  /** the spot you are looking at, near enough to use */
  facing(eye: THREE.Vector3, dir: THREE.Vector3): Spot | null {
    let best: Spot | null = null, bs = Infinity;
    for (const s of this.spots) {
      const v = s.at.clone().sub(eye), d = v.length();
      if (d > s.reach) continue;
      const c = v.dot(dir) / Math.max(d, 1e-6);
      if (c < (d < 1 ? 0.3 : 0.8)) continue;
      const score = d * (2 - c);
      if (score < bs) { bs = score; best = s; }
    }
    return best;
  }

  /** a screen to draw on: a canvas texture on a plane, w × h m, facing +z of its parent */
  screen(id: string, parent: THREE.Object3D, w: number, h: number, at: THREE.Vector3, ry = 0, tint = '#7fe0ff') {
    const px = 256, ph = Math.max(32, Math.round((px * h) / w));
    const c = makeCanvas(px, ph);
    const tex = c ? new THREE.CanvasTexture(c.canvas as HTMLCanvasElement) : null;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), tex ? new THREE.MeshBasicMaterial({ map: tex }) : MATS.screen);
    m.position.copy(at);
    m.rotation.y = ry;
    parent.add(m);
    if (c && tex) { tex.colorSpace = THREE.SRGBColorSpace; this.screens.set(id, { g: c.g, tex, w: px, h: ph, tint }); this.drawScreen(id, [id.toUpperCase()]); }
    return m;
  }

  /** text on a screen: the first line a heading */
  drawScreen(id: string, lines: string[]) {
    const s = this.screens.get(id);
    if (!s) return;
    const g = s.g;
    g.fillStyle = '#04121c'; g.fillRect(0, 0, s.w, s.h);
    g.strokeStyle = 'rgba(127,224,255,0.25)'; g.lineWidth = 2; g.strokeRect(3, 3, s.w - 6, s.h - 6);
    const fs = Math.max(11, Math.min(20, Math.floor((s.h - 12) / Math.max(4, lines.length + 0.5))));
    g.textBaseline = 'top';
    lines.forEach((l, k) => {
      g.font = `${k === 0 ? 'bold ' : ''}${fs}px monospace`;
      g.fillStyle = k === 0 ? '#ffd27a' : s.tint;
      g.fillText(l, 9, 7 + k * (fs + 3), s.w - 16);
    });
    s.tex.needsUpdate = true;
  }

  /** something that moves: called each frame with the time */
  animate(f: (t: number) => void) { this.anims.push(f); }
  update(t: number) { for (const f of this.anims) f(t); }

  addSpot(id: string, at: THREE.Vector3, label: string, reach = 2.2) { this.spots.push({ id, at, label, reach }); }
}

// ---------------------------------------------------------------- materials and textures

function makeCanvas(w: number, h: number) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') {
    const c = new OffscreenCanvas(w, h);
    return { canvas: c, g: c.getContext('2d')! };
  }
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { canvas: c, g: c.getContext('2d')! };
}

/** a seeded random */
export const rnd = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/**
 * a wall of racks, as on the ISS: locker doors with handles and labels, panels
 * with switches and lights, cables, bungee cords, patches of velcro, a laptop
 * or two
 */
function rackTexture(seed: number, base = '#d9d6cc') {
  const c = makeCanvas(512, 512);
  if (!c) return null;
  const g = c.g, r = rnd(seed);
  g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  // rack columns
  for (let i = 0; i < 4; i++) {
    const x = i * 128;
    g.fillStyle = '#b8b5ab'; g.fillRect(x, 0, 3, 512);
    // locker doors down the rack, or an instrument panel
    let y = 6;
    while (y < 500) {
      const h = 40 + Math.floor(r() * 4) * 22;
      const kind = r();
      if (kind < 0.55) {
        g.fillStyle = `hsl(45, 10%, ${78 + r() * 8}%)`; g.fillRect(x + 8, y, 112, h - 6);
        g.strokeStyle = '#9c988c'; g.lineWidth = 2; g.strokeRect(x + 8, y, 112, h - 6);
        g.fillStyle = '#6a6f78'; g.fillRect(x + 54, y + h / 2 - 8, 20, 6);
        g.fillStyle = r() < 0.5 ? '#2a4a8a' : '#f2f2f2'; g.fillRect(x + 14, y + 6, 26 + r() * 30, 8);
      } else if (kind < 0.8) {
        g.fillStyle = '#4a5058'; g.fillRect(x + 8, y, 112, h - 6);
        for (let k = 0; k < 8; k++) { g.fillStyle = ['#e0e0e0', '#ffcf40', '#40ff80', '#ff5050'][Math.floor(r() * 4)]; g.fillRect(x + 14 + k * 12, y + 8 + (k % 2) * 10, 5, 5); }
        g.fillStyle = '#9aa0a8'; for (let k = 0; k < 4; k++) g.fillRect(x + 16 + k * 24, y + h - 20, 10, 8);
      } else {
        // a laptop strapped to the rack
        g.fillStyle = '#22252a'; g.fillRect(x + 20, y + 4, 88, h - 14);
        g.fillStyle = `hsl(${190 + r() * 40}, 60%, 35%)`; g.fillRect(x + 25, y + 8, 78, h - 24);
        g.fillStyle = 'rgba(255,255,255,0.5)'; for (let k = 0; k < 4; k++) g.fillRect(x + 30, y + 13 + k * 7, 30 + r() * 40, 2);
      }
      y += h;
    }
  }
  // cables and bungees across the racks
  for (let k = 0; k < 7; k++) {
    g.strokeStyle = ['#202020', '#3050a0', '#c0c0c0', '#e0a020', '#202020'][k % 5];
    g.lineWidth = 2 + r() * 3;
    g.beginPath();
    const y0 = r() * 512;
    g.moveTo(0, y0);
    g.bezierCurveTo(170, y0 + (r() - 0.5) * 120, 340, y0 + (r() - 0.5) * 120, 512, y0 + (r() - 0.5) * 60);
    g.stroke();
  }
  // velcro patches and small bags
  for (let k = 0; k < 14; k++) { g.fillStyle = r() < 0.5 ? '#efe9d8' : '#8a8c90'; g.fillRect(r() * 490, r() * 490, 10 + r() * 22, 8 + r() * 12); }
  const tex = new THREE.CanvasTexture(c.canvas as HTMLCanvasElement);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** a panelled wall or floor: plates with seams and rivets, or ribbed padding */
function panelTexture(seed: number, base: string, kind: 'plate' | 'grate' | 'pad' | 'floor') {
  const c = makeCanvas(256, 256);
  if (!c) return null;
  const g = c.g, r = rnd(seed);
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  if (kind === 'plate' || kind === 'floor') {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`; g.fillRect(i * 64 + 2, j * 64 + 2, 60, 60);
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.strokeRect(i * 64 + 1, j * 64 + 1, 62, 62);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (const [a, b] of [[6, 6], [58, 6], [6, 58], [58, 58]]) g.fillRect(i * 64 + a, j * 64 + b, 2, 2);
    }
    if (kind === 'floor') { g.strokeStyle = 'rgba(255,200,40,0.6)'; g.lineWidth = 6; g.beginPath(); g.moveTo(0, 250); g.lineTo(256, 250); g.stroke(); }
  } else if (kind === 'grate') {
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    for (let i = 0; i < 256; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  } else {
    for (let j = 0; j < 256; j += 32) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, j, 256, 3); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, j + 4, 256, 2); }
  }
  const tex = new THREE.CanvasTexture(c.canvas as HTMLCanvasElement);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** the materials: lit by the lights inside, and a little by themselves, so nothing is ever black */
const lit = (color: number, map: THREE.Texture | null = null, extra: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ color, map, emissive: new THREE.Color(color).multiplyScalar(0.42), emissiveMap: map, ...extra });

export const MATS = {
  screen: new THREE.MeshBasicMaterial({ color: 0x0a2a3a }),
  light: new THREE.MeshBasicMaterial({ color: 0xf4f7ff }),
  warm: new THREE.MeshBasicMaterial({ color: 0xfff0d0 }),
  grow: new THREE.MeshBasicMaterial({ color: 0xff60d0 }),
  glass: new THREE.MeshLambertMaterial({ color: 0x9ac0e0, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
  rail: lit(0xe8c030),
  blue: lit(0x3060c0),
  dark: lit(0x30343c),
  grey: lit(0x8a9098),
  white: lit(0xe8e8e4),
  red: lit(0xc03028),
  green: lit(0x4a9a40),
  leaf: lit(0x3fa040),
  wood: lit(0x9a7048),
  orange: lit(0xe07030),
  holo: new THREE.MeshBasicMaterial({ color: 0x60d0ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true }),
};

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  parent.add(o);
  return o;
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0: number, r1: number, h: number, n = 16) => new THREE.CylinderGeometry(r0, r1, h, n);

/** a flat panel facing +z with a square hole in it (a hatchway), w × h, the hole s × s */
function bulkhead(w: number, h: number, s: number, round = false) {
  const sh = new THREE.Shape();
  sh.moveTo(-w / 2, -h / 2); sh.lineTo(w / 2, -h / 2); sh.lineTo(w / 2, h / 2); sh.lineTo(-w / 2, h / 2); sh.lineTo(-w / 2, -h / 2);
  const hole = new THREE.Path();
  if (round) hole.absarc(0, 0, s / 2, 0, Math.PI * 2, true);
  else { const q = s / 2, c = s * 0.18; hole.moveTo(-q + c, -q); hole.lineTo(q - c, -q); hole.lineTo(q, -q + c); hole.lineTo(q, q - c); hole.lineTo(q - c, q); hole.lineTo(-q + c, q); hole.lineTo(-q, q - c); hole.lineTo(-q, -q + c); hole.lineTo(-q + c, -q); }
  sh.holes.push(hole);
  return new THREE.ShapeGeometry(sh);
}

// ---------------------------------------------------------------- the station

/**
 * The station's modules, as the ISS's are laid out: a line of them along z
 * from the docking port (−z, where the ship docks) aft, a node with a module
 * to either side, and the cupola under Tranquility looking down at the world.
 * Interiors are square in section, lined with racks, inside round hulls.
 */
export const STATION = {
  main: [
    { id: 'pma', name: 'Docking adapter', z0: -28, z1: -24, half: 0.62, hull: 1.35 },
    { id: 'zvezda', name: 'Zvezda · crew quarters and galley', z0: -24, z1: -12.2, half: 1.05, hull: 2.15 },
    { id: 'unity', name: 'Unity · node', z0: -12.2, z1: -5.8, half: 1.2, hull: 2.3 },
    { id: 'tranq', name: 'Tranquility · life support and exercise', z0: -5.8, z1: 4.5, half: 1.05, hull: 2.2 },
    { id: 'destiny', name: 'Destiny · command and comms', z0: 4.5, z1: 14.5, half: 1.05, hull: 2.15 },
    { id: 'pmm', name: 'Stowage', z0: 14.5, z1: 19.5, half: 0.95, hull: 1.95 },
  ],
  side: [
    { id: 'lab', name: 'Columbus · laboratory', x0: -14, x1: -2.4, half: 1.05, hull: 2.15 },
    { id: 'kibo', name: 'Kibo · robotics and airlock', x0: 2.4, x1: 14.5, half: 1.05, hull: 2.15 },
  ],
  /** the node the side modules join at, z */
  nodeZ: -9,
  /** the cupola, under Tranquility */
  cupola: { x: 0, z: -1.2, y: -1.05 },
  /** where a ship docks: the end of the docking adapter, facing −z */
  port: new THREE.Vector3(0, 0, -28),
  /** the Kibo airlock's outer hatch, +x */
  airlock: new THREE.Vector3(14.5, 0, -9),
};

/** a module's square tube of racks along an axis: walls, light strips, handrails, end bulkheads with hatches */
function tube(I: Interior, parent: THREE.Object3D, len: number, half: number, seed: number, plain = false, ends: [boolean, boolean] = [true, true]) {
  const g = new THREE.Group();
  parent.add(g);
  const w = half * 2;
  const tex = (k: number) => {
    const t = plain ? panelTexture(seed + k, '#c8ccd2', 'pad') : rackTexture(seed * 7 + k);
    if (t) { t.wrapS = THREE.RepeatWrapping; t.repeat.set(Math.max(1, Math.round(len / 2.2)), 1); }
    return t;
  };
  // four walls, inward-facing: port, starboard, deck, overhead
  const walls: [number, number, number, number, number, number][] = [
    [-half, 0, 0, 0, Math.PI / 2, 0], [half, 0, 0, 0, -Math.PI / 2, 0],
    [0, -half, 0, -Math.PI / 2, 0, Math.PI / 2], [0, half, 0, Math.PI / 2, 0, Math.PI / 2],
  ];
  walls.forEach(([x, y, z, rx, ry, rz], k) => {
    const m = add(g, new THREE.PlaneGeometry(len, w), lit(0xffffff, tex(k)), x, y, z, rx, ry, rz);
    if (k >= 2) m.rotation.set(rx, 0, 0), m.rotateZ(rz);
  });
  // the lights: strips along the overhead corners
  for (const s of [-1, 1]) add(g, box(0.08, 0.04, len * 0.9), MATS.light, s * (half - 0.12), half - 0.03, 0);
  // handrails, yellow, along the walls
  for (const s of [-1, 1]) for (const y of [-0.45, 0.45]) add(g, box(0.035, 0.035, len * 0.8), MATS.rail, s * (half - 0.08), y, 0);
  // the corners: dark trim
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) add(g, box(0.1, 0.1, len), MATS.dark, sx * (half - 0.03), sy * (half - 0.03), 0);
  // the ends: bulkheads with a hatchway
  ends.forEach((on, k) => {
    if (!on) return;
    const s = k ? 1 : -1;
    const b = add(g, bulkhead(w, w, 1.25), lit(0xb8bcc4), 0, 0, s * len / 2, 0, k ? Math.PI : 0, 0);
    b.material = lit(0xb8bcc4, null, { side: THREE.DoubleSide });
    add(g, new THREE.TorusGeometry(0.66, 0.05, 6, 8), MATS.grey, 0, 0, s * (len / 2 - 0.02), 0, 0, Math.PI / 8);
  });
  for (let z = -len / 2 + 1; z < len / 2; z += 2.2) I.lamps.push(new THREE.Vector3(0, half - 0.2, z));
  return g;
}

/** the ISS-like station's inside, with what is in each module */
export function stationInterior(name: string): Interior {
  const I = new Interior(name, true);
  const G = I.group;
  const r = rnd(name.length * 97 + 3);
  for (const m of STATION.main) {
    const len = m.z1 - m.z0, zc = (m.z0 + m.z1) / 2;
    const holder = new THREE.Group();
    holder.position.set(0, 0, zc);
    G.add(holder);
    const t = tube(I, holder, len, m.half, Math.floor(r() * 1000), m.id === 'pma' || m.id === 'unity');
    // the node's side hatches: openings in its port and starboard walls
    if (m.id === 'unity') {
      t.children.slice(0, 2).forEach(o => { o.visible = false; });
      for (const s of [-1, 1]) {
        const b = add(holder, bulkhead(m.half * 2, m.half * 2, 1.25), lit(0xb8bcc4, null, { side: THREE.DoubleSide }), s * m.half, 0, 0, 0, s * Math.PI / 2, 0);
        b.rotation.y = -s * Math.PI / 2;
      }
    }
    I.boxes.push(new THREE.Box3(new THREE.Vector3(-m.half, -m.half, m.z0 - 0.05), new THREE.Vector3(m.half, m.half, m.z1 + 0.05)));
    I.regions.push({ name: m.name, box: new THREE.Box3(new THREE.Vector3(-m.half - 0.1, -m.half - 2, m.z0), new THREE.Vector3(m.half + 0.1, m.half + 0.1, m.z1)) });
    furnishStation(I, holder, m.id, len, m.half, r);
  }
  for (const m of STATION.side) {
    const len = m.x1 - m.x0, xc = (m.x0 + m.x1) / 2;
    const holder = new THREE.Group();
    holder.position.set(xc, 0, STATION.nodeZ);
    holder.rotation.y = Math.PI / 2;
    G.add(holder);
    tube(I, holder, len, m.half, Math.floor(r() * 1000));
    I.boxes.push(new THREE.Box3(new THREE.Vector3(m.x0 - 0.05, -m.half, STATION.nodeZ - m.half), new THREE.Vector3(m.x1 + 0.05, m.half, STATION.nodeZ + m.half)));
    I.regions.push({ name: m.name, box: new THREE.Box3(new THREE.Vector3(m.x0, -m.half, STATION.nodeZ - m.half), new THREE.Vector3(m.x1, m.half, STATION.nodeZ + m.half)) });
    furnishStation(I, holder, m.id, len, m.half, r);
  }
  cupola(I);
  I.spawn = { p: new THREE.Vector3(0, 0, -26.5), yaw: Math.PI };
  return I;
}

/** the cupola: seven windows under Tranquility, the big round one looking straight down */
function cupola(I: Interior) {
  const { x, z, y } = STATION.cupola, G = I.group;
  const c = new THREE.Group();
  c.position.set(x, y, z);
  G.add(c);
  // the short drum through Tranquility's deck, then the six slanted side windows narrowing to the round one
  // at the bottom, as the real one is: a hexagonal frustum of glass between thin frames
  add(c, cyl(0.95, 0.95, 0.35, 6), lit(0xc8ccd2, null, { side: THREE.BackSide }), 0, -0.17, 0, 0, Math.PI / 6, 0);
  const top = 0.95, bot = 0.48, y0 = -0.35, y1 = -1.0;
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * Math.PI * 2, a1 = ((k + 1) / 6) * Math.PI * 2;
    const g = new THREE.BufferGeometry();
    const pts = [Math.cos(a0) * top, y0, Math.sin(a0) * top, Math.cos(a1) * top, y0, Math.sin(a1) * top, Math.cos(a1) * bot, y1, Math.sin(a1) * bot, Math.cos(a0) * bot, y1, Math.sin(a0) * bot];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    c.add(new THREE.Mesh(g, MATS.glass));
    // the frame bar along each edge
    const e = new THREE.Vector3(Math.cos(a0) * bot, y1, Math.sin(a0) * bot), f = new THREE.Vector3(Math.cos(a0) * top, y0, Math.sin(a0) * top);
    const bar = add(c, box(0.03, 0.03, e.distanceTo(f)), MATS.dark);
    bar.position.copy(e).add(f).multiplyScalar(0.5);
    bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.clone().sub(e).normalize());
  }
  add(c, new THREE.CircleGeometry(bot - 0.04, 24), MATS.glass, 0, y1, 0, -Math.PI / 2, 0, 0);
  add(c, new THREE.TorusGeometry(bot - 0.02, 0.035, 6, 6), MATS.grey, 0, y1, 0, Math.PI / 2, 0, 0);
  // the deck around the hole: a grab bar ring
  add(c, new THREE.TorusGeometry(0.9, 0.03, 6, 24), MATS.rail, 0, 0.02, 0, Math.PI / 2, 0, 0);
  I.boxes.push(new THREE.Box3(new THREE.Vector3(x - 0.7, y - 0.85, z - 0.7), new THREE.Vector3(x + 0.7, y + 0.2, z + 0.7)));
  I.regions.push({ name: 'The Cupola', box: new THREE.Box3(new THREE.Vector3(x - 1.4, y - 1.4, z - 1.4), new THREE.Vector3(x + 1.4, y, z + 1.4)) });
  I.addSpot('cupola', new THREE.Vector3(x, y - 0.4, z), 'Look out of the Cupola', 2.8);
  I.lamps.push(new THREE.Vector3(x, y - 0.2, z));
}

/** what each module holds */
function furnishStation(I: Interior, h: THREE.Group, id: string, len: number, half: number, r: () => number) {
  // local: the module runs along its z, port −x, deck −y
  const W = (p: THREE.Vector3) => p.clone().applyMatrix4(h.matrix.compose(h.position, h.quaternion, h.scale));
  switch (id) {
    case 'pma': {
      add(h, new THREE.TorusGeometry(0.6, 0.06, 8, 24), MATS.grey, 0, 0, -len / 2 + 0.05);
      add(h, new THREE.CircleGeometry(0.58, 24), lit(0x9aa0a8, null, { side: THREE.DoubleSide }), 0, 0, -len / 2 + 0.02);
      I.addSpot('dock', W(new THREE.Vector3(0, 0, -len / 2 + 0.4)), 'Through the hatch, back aboard the ship', 2);
      break;
    }
    case 'zvezda': {
      // the galley table, its food trays and the water dispenser
      add(h, box(0.9, 0.06, 1.4), MATS.grey, 0, -0.55, -2);
      add(h, box(0.08, 0.5, 0.08), MATS.dark, 0, -0.8, -2);
      for (let k = 0; k < 6; k++) add(h, box(0.16, 0.05, 0.12), [MATS.orange, MATS.white, MATS.red, MATS.green][k % 4], -0.3 + (k % 3) * 0.3, -0.5, -2.4 + Math.floor(k / 3) * 0.8);
      add(h, box(0.35, 0.5, 0.15), MATS.white, half - 0.1, 0.1, -3.2);
      add(h, box(0.06, 0.08, 0.1), MATS.blue, half - 0.2, -0.1, -3.2);
      I.addSpot('galley', W(new THREE.Vector3(0, -0.4, -2)), 'Eat: a tray of rehydrated food', 2.2);
      // two sleep stations, one each side: a padded booth with a sleeping bag strapped in
      for (const s of [-1, 1]) {
        const z = 2.5;
        add(h, box(0.05, 1.9, 0.95), lit(0xd8d4c8), s * (half - 0.02), 0, z);
        add(h, box(0.25, 1.5, 0.6), [MATS.blue, MATS.orange][s > 0 ? 1 : 0], s * (half - 0.15), -0.05, z);
        add(h, new THREE.CircleGeometry(0.12, 12), MATS.warm, s * (half - 0.04), 0.7, z + 0.3, 0, -s * Math.PI / 2, 0);
      }
      I.addSpot('sleep', W(new THREE.Vector3(-half + 0.3, 0, 2.5)), 'Sleep in a sleep station', 2);
      // the toilet compartment: a curtain and the funnel
      add(h, box(0.04, 1.6, 0.9), lit(0x6a8ab0), half - 0.05, 0, 4.6);
      I.screen('zvezda', h, 0.6, 0.4, new THREE.Vector3(-half + 0.02, 0.35, -4), Math.PI / 2);
      break;
    }
    case 'unity': {
      // stowage bags tied to the walls
      for (let k = 0; k < 6; k++) add(h, box(0.4, 0.3, 0.5), lit(0xe8e0c8), (r() - 0.5) * 1.4, half - 0.2, (r() - 0.5) * 3, 0, r(), 0);
      break;
    }
    case 'tranq': {
      // the treadmill on the deck, its harness on bungees; the resistive exercise device beside it
      add(h, box(0.7, 0.18, 1.7), MATS.dark, 0, -half + 0.12, 2.4);
      add(h, box(0.55, 0.02, 1.5), lit(0x202020), 0, -half + 0.22, 2.4);
      for (const s of [-1, 1]) add(h, cyl(0.012, 0.012, 1.1, 4), MATS.rail, s * 0.3, -half + 0.75, 2.4, 0.2 * s, 0, 0);
      add(h, box(0.06, 1.6, 0.06), MATS.grey, half - 0.3, 0, -3.8);
      add(h, box(0.06, 1.6, 0.06), MATS.grey, half - 0.9, 0, -3.8);
      add(h, box(0.7, 0.06, 0.06), MATS.grey, half - 0.6, 0.6, -3.8);
      I.addSpot('treadmill', W(new THREE.Vector3(0, -0.3, 2.4)), 'Run on the treadmill', 2.2);
      I.screen('life', h, 0.8, 0.5, new THREE.Vector3(-half + 0.02, 0.25, -1.2 - 2.2), Math.PI / 2);
      I.addSpot('life', W(new THREE.Vector3(-half + 0.3, 0.25, -3.4)), 'Life support: the air and water', 2.2);
      break;
    }
    case 'destiny': {
      // the command post: three screens, a keyboard shelf, the comms panel
      I.screen('status', h, 0.9, 0.6, new THREE.Vector3(-half + 0.02, 0.2, -1.5), Math.PI / 2);
      I.screen('orbit', h, 0.9, 0.6, new THREE.Vector3(-half + 0.02, 0.2, -0.45), Math.PI / 2);
      // a big monitor for a craft's camera, and Mission Control at the post
      const big = I.screen('feed', h, 1.2, 0.75, new THREE.Vector3(half - 0.02, 0.15, -2.2), -Math.PI / 2);
      I.monitors.push({ id: 'feed', mesh: big, label: 'the Destiny monitor' });
      I.addSpot('monitor:feed', W(new THREE.Vector3(half - 0.4, 0.15, -2.2)), `Monitor: Mission Control, or a craft's camera on it`, 2.2);
      add(h, box(0.3, 0.04, 2.2), MATS.dark, -half + 0.18, -0.25, -1);
      I.addSpot('status', W(new THREE.Vector3(-half + 0.4, 0.2, -1)), 'The station: where it is, how it is', 2.2);
      I.screen('comms', h, 0.7, 0.45, new THREE.Vector3(half - 0.02, 0.2, 2), -Math.PI / 2);
      I.addSpot('comms', W(new THREE.Vector3(half - 0.4, 0.2, 2)), 'Call the ground', 2.2);
      // the window: the lab's nadir port, its shutter open
      add(h, new THREE.CircleGeometry(0.25, 20), lit(0x10141c), 0, -half + 0.01, 3, -Math.PI / 2, 0, 0);
      break;
    }
    case 'pmm': {
      // cargo bags, and the suit rack
      for (let k = 0; k < 10; k++) add(h, box(0.5, 0.35, 0.45), lit(r() < 0.5 ? 0xece4d0 : 0xd8d0b8), (r() - 0.5) * 1.2, (r() - 0.5) * 1.2, (r() - 0.5) * 3, r(), r(), 0);
      const suit = new THREE.Group();
      suit.position.set(half - 0.35, -0.1, 1.2);
      h.add(suit);
      add(suit, box(0.5, 0.7, 0.35), MATS.white, 0, 0.1, 0);
      add(suit, new THREE.SphereGeometry(0.17, 12, 8), lit(0xf0f0f0), 0, 0.62, 0);
      add(suit, new THREE.SphereGeometry(0.14, 12, 8), lit(0xd8a830, null, { emissive: 0x302000 }), 0.04, 0.62, 0);
      add(suit, box(0.42, 0.5, 0.2), MATS.white, 0, 0.15, -0.25);
      I.addSpot('suit', W(new THREE.Vector3(half - 0.5, 0, 1.2)), 'Top up your suit: oxygen, power, coolant', 2.2);
      break;
    }
    case 'lab': {
      // experiment racks lit up, the glovebox, the plant chamber with lettuce under pink light
      I.screen('lab', h, 0.8, 0.5, new THREE.Vector3(-half + 0.02, 0.25, -2), Math.PI / 2);
      I.addSpot('experiment', W(new THREE.Vector3(-half + 0.35, 0.25, -2)), 'Run an experiment', 2.2);
      add(h, box(0.5, 0.45, 0.8), MATS.glass, half - 0.3, 0, -0.5);
      for (const z of [-0.7, -0.3]) add(h, new THREE.TorusGeometry(0.08, 0.02, 6, 12), MATS.dark, half - 0.55, 0, z, 0, Math.PI / 2, 0);
      const veg = new THREE.Group();
      veg.position.set(half - 0.3, 0, 2.2);
      h.add(veg);
      add(veg, box(0.5, 0.6, 0.7), lit(0x808890), 0, 0, 0);
      add(veg, box(0.42, 0.02, 0.6), MATS.grow, -0.05, 0.27, 0);
      for (let k = 0; k < 6; k++) add(veg, new THREE.SphereGeometry(0.06 + r() * 0.03, 7, 5), MATS.leaf, -0.18, -0.12 + r() * 0.05, -0.22 + k * 0.09);
      I.addSpot('veggie', W(new THREE.Vector3(half - 0.45, 0, 2.2)), 'The plant chamber: lettuce, grown in orbit', 2);
      break;
    }
    case 'kibo': {
      // the robotics workstation: two screens and two hand controllers; the airlock hatch at the far end
      I.screen('arm', h, 0.8, 0.5, new THREE.Vector3(-half + 0.02, 0.25, -1.5), Math.PI / 2);
      const cam = I.screen('cam', h, 0.8, 0.5, new THREE.Vector3(-half + 0.02, 0.25, -0.6), Math.PI / 2);
      I.monitors.push({ id: 'cam', mesh: cam, label: 'the Kibo camera monitor' });
      for (const z of [-1.4, -0.7]) add(h, cyl(0.03, 0.04, 0.18, 6), MATS.dark, -half + 0.25, -0.2, z, 0, 0, Math.PI / 2);
      I.addSpot('arm', W(new THREE.Vector3(-half + 0.35, 0.2, -1)), 'The robotic arm: watch it work', 2.2);
      add(h, new THREE.TorusGeometry(0.62, 0.07, 8, 4), MATS.red, 0, 0, len / 2 - 0.05, 0, 0, Math.PI / 4);
      I.addSpot('eva', W(new THREE.Vector3(0, 0, len / 2 - 0.5)), 'Spacewalk: out through the airlock', 2.2);
      break;
    }
  }
}
