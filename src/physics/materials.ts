import { KM } from './units';
import type { Style } from './body';

/**
 * What a hand-built body is made of. Each material has a density and a
 * strength: the stress it can carry without flowing. Strength is what lets a
 * small body keep a lumpy shape; once its own gravity squeezes it harder than
 * that, it flows into a sphere. Values are bulk (fractured, at scale), not lab
 * samples, which is why they are well below the textbook figures.
 */
export interface Material {
  id: number;
  key: string;
  name: string;
  rho: number;      // g/cm³
  Y: number;        // Pa, yield strength at the scale of a world
  color: number;    // 0xRRGGBB, as drawn
  dark: number;     // shadow tone
  /** solid, liquid or gas: liquids and gas have no strength at all */
  phase: 'solid' | 'liquid' | 'gas';
  blurb: string;
}

export const MATERIALS: Material[] = [
  { id: 1, key: 'iron', name: 'Iron', rho: 7.9, Y: 3e8, color: 0xa8a4a0, dark: 0x4a4644, phase: 'solid', blurb: 'Iron–nickel: dense and strong. Planetary cores.' },
  { id: 2, key: 'rock', name: 'Rock', rho: 3.3, Y: 1e8, color: 0x8a7a68, dark: 0x3e352c, phase: 'solid', blurb: 'Silicate rock: mantles and crusts.' },
  { id: 3, key: 'basalt', name: 'Basalt', rho: 3.0, Y: 8e7, color: 0x4e4a48, dark: 0x22201f, phase: 'solid', blurb: 'Dark volcanic rock: the seafloor, the lunar maria.' },
  { id: 4, key: 'carbon', name: 'Carbon', rho: 2.6, Y: 2e8, color: 0x3a3842, dark: 0x16151a, phase: 'solid', blurb: 'Graphite and diamond: very strong when it is diamond.' },
  { id: 5, key: 'rubble', name: 'Rubble', rho: 1.9, Y: 1e3, color: 0x7a6e60, dark: 0x3a332c, phase: 'solid', blurb: 'Loose boulders held by gravity alone: almost no strength.' },
  { id: 6, key: 'ice', name: 'Ice', rho: 0.93, Y: 4e6, color: 0xd8e8f4, dark: 0x6a8296, phase: 'solid', blurb: 'Water ice: light and weak, it creeps.' },
  { id: 7, key: 'water', name: 'Water', rho: 1.0, Y: 0, color: 0x2a64b0, dark: 0x0e2648, phase: 'liquid', blurb: 'Liquid: no strength at all.' },
  { id: 8, key: 'lava', name: 'Magma', rho: 2.8, Y: 0, color: 0xff7a26, dark: 0x7a1e08, phase: 'liquid', blurb: 'Molten rock: flows into a sphere at any size.' },
  { id: 9, key: 'gas', name: 'Gas', rho: 0.7, Y: 0, color: 0xe0c89a, dark: 0x8a6a48, phase: 'gas', blurb: 'Hydrogen and helium, compressed: a giant’s envelope.' },
  { id: 10, key: 'gold', name: 'Gold', rho: 19.3, Y: 1e8, color: 0xe8c040, dark: 0x7a5a10, phase: 'solid', blurb: 'Heavier than iron, softer. Purely for fun.' },
];
export const MAT = new Map(MATERIALS.map(m => [m.id, m]));

/** The editor grid: N×N cells, 0 = empty, otherwise a material id. */
export const GRID = 32;

export interface Shape {
  /** material per cell, row-major, row 0 at the top */
  cells: Uint8Array;
  /** how far it has slumped from the drawn outline toward a sphere, 0..1 */
  round: number;
  /** where it is heading: 0 if it can hold its shape, up to 1 if it must become a sphere */
  roundGoal: number;
  /** e-folding time of the slump, yr */
  tau: number;
  /** drawn outline: radius against angle (in units of the equivalent radius), and the cells' polar coordinates */
  outline: Float32Array;
  /** sorted by density, heaviest in the middle: what it becomes if it melts */
  layered: Uint8Array | null;
  /** craters chipped into it */
  marks: Uint8Array;
  /** centroid and equivalent radius of the cells, in cell units */
  cx: number; cy: number; rc: number;
  /** once it has slumped all the way, it is drawn as an ordinary round world */
  packed: boolean;
}

export const OUTLINE_N = 96;

export interface ShapeStats {
  filled: number;
  /** equivalent radius (AU) for a frame `size` AU across */
  rEq: number;
  rho: number;     // g/cm³, mean
  mass: number;    // Msun
  Y: number;       // Pa, effective strength
  /** central pressure of a ball of this mass and size, Pa */
  Pc: number;
  /** how far from round the outline is, 0 = a circle */
  asph: number;
  /** stress from its shape against its strength: above 1 it slumps */
  stress: number;
  /** the largest it could be, made of this, and still hold this shape (km) */
  potatoKm: number;
  /** fraction of mass in each phase */
  gasFrac: number; iceFrac: number; liquidFrac: number;
  /** most abundant material near the surface */
  surface: number;
  /** heavy enough to separate into layers as it slumps */
  differentiates: boolean;
}

const MSUN_KG = 1.98847e30;

/** centroid of the filled cells, in cell units */
function centroid(cells: Uint8Array) {
  let cx = 0, cy = 0, n = 0;
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) if (cells[j * GRID + i]) { cx += i + 0.5; cy += j + 0.5; n++; }
  return n ? { cx: cx / n, cy: cy / n, n } : { cx: GRID / 2, cy: GRID / 2, n: 0 };
}

/**
 * Everything physical about a drawing, for a frame `sizeKm` across. The grid
 * is treated as the body's cross-section: its area gives an equivalent
 * radius, and each cell is weighted by its distance from the middle, as a
 * spherical shell would be, so a core counts for what a core really does.
 */
export function shapeStats(cells: Uint8Array, sizeKm: number): ShapeStats {
  const { cx, cy, n } = centroid(cells);
  const cell = sizeKm / GRID; // km per cell
  const rEqKm = cell * Math.sqrt(n / Math.PI);
  let wSum = 0, rhoW = 0, yW = 0, gasM = 0, iceM = 0, liqM = 0, mW = 0;
  const outer = new Map<number, number>();
  const rad: number[] = [];
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    const id = cells[j * GRID + i];
    if (!id) continue;
    const m = MAT.get(id)!;
    const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy) + 0.35;
    rad.push(d);
    wSum += d; rhoW += d * m.rho; yW += d * m.Y;
    mW += d * m.rho;
    if (m.phase === 'gas') gasM += d * m.rho;
    if (m.key === 'ice' || m.key === 'water') iceM += d * m.rho;
    if (m.phase !== 'solid') liqM += d * m.rho;
  }
  const rho = wSum ? rhoW / wSum : 0;
  const Y = wSum ? yW / wSum : 0;
  // surface: the outermost tenth of the cells
  const sorted = rad.slice().sort((a, b) => a - b);
  const rCut = sorted.length ? sorted[Math.floor(sorted.length * 0.8)] : 0;
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    const id = cells[j * GRID + i];
    if (!id) continue;
    if (Math.hypot(i + 0.5 - cx, j + 0.5 - cy) + 0.35 >= rCut) outer.set(id, (outer.get(id) ?? 0) + 1);
  }
  let surface = 2, best = -1;
  for (const [id, k] of outer) if (k > best) { best = k; surface = id; }

  const R = rEqKm * 1000;
  const rhoSI = rho * 1000;
  const massKg = (4 / 3) * Math.PI * R ** 3 * rhoSI;
  const Gsi = 6.674e-11;
  // central pressure of a uniform ball, (2π/3) G ρ² R²
  const Pc = (2 * Math.PI / 3) * Gsi * rhoSI * rhoSI * R * R;
  const outline = outlineOf(cells, cx, cy, Math.sqrt(n / Math.PI));
  let mean = 0, varr = 0;
  for (const v of outline) mean += v;
  mean /= outline.length;
  for (const v of outline) varr += (v - mean) ** 2;
  const asph = Math.min(1, (3 * Math.sqrt(varr / outline.length)) / (mean || 1) + (n ? 0 : 1));
  // A lump's deviatoric stress grows with how lumpy it is: a nearly round body
  // carries little, a dumbbell nearly the whole central pressure.
  const load = Pc * Math.max(0.05, asph);
  const stress = Y > 0 ? load / Y : (n ? Infinity : 0);
  // the size at which this outline's load reaches the strength: R ∝ √(Y / asph) / ρ
  const potatoKm = Y > 0 && rho > 0 ? Math.sqrt((3 * Y) / (2 * Math.PI * Gsi * rhoSI * rhoSI * Math.max(0.05, asph))) / 1000 : 0;
  return {
    filled: n, rEq: (rEqKm * KM), rho, mass: massKg / MSUN_KG, Y, Pc, asph, stress, potatoKm,
    gasFrac: mW ? gasM / mW : 0, iceFrac: mW ? iceM / mW : 0, liquidFrac: mW ? liqM / mW : 0, surface,
    // hot enough inside to melt: a body whose gravity overwhelms rock this badly
    // has been heated through by its own accretion, and its iron sinks
    differentiates: Pc > 2e9 || (stress > 30 && rEqKm > 300),
  };
}

/** radius of the drawing's edge against angle, in equivalent radii */
export function outlineOf(cells: Uint8Array, cx: number, cy: number, rEqCells: number): Float32Array {
  const out = new Float32Array(OUTLINE_N);
  for (let k = 0; k < OUTLINE_N; k++) {
    const th = (k / OUTLINE_N) * 2 * Math.PI;
    const dx = Math.cos(th), dy = -Math.sin(th);
    let last = 0;
    for (let s = 0; s < GRID * 0.75; s += 0.25) {
      const i = Math.floor(cx + dx * s), j = Math.floor(cy + dy * s);
      if (i < 0 || j < 0 || i >= GRID || j >= GRID) break;
      if (cells[j * GRID + i]) last = s + 0.25;
    }
    out[k] = rEqCells > 0 ? Math.max(0.05, last / rEqCells) : 1;
  }
  return out;
}

/** The same cells re-stacked by density: iron to the middle, water and gas on top. */
export function layeredOf(cells: Uint8Array): Uint8Array {
  const { cx, cy } = centroid(cells);
  const ids: number[] = [];
  const pos: { k: number; d: number }[] = [];
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    const k = j * GRID + i;
    if (!cells[k]) continue;
    ids.push(cells[k]);
    pos.push({ k, d: Math.hypot(i + 0.5 - cx, j + 0.5 - cy) });
  }
  ids.sort((a, b) => MAT.get(b)!.rho - MAT.get(a)!.rho);
  pos.sort((a, b) => a.d - b.d);
  const out = new Uint8Array(cells.length);
  pos.forEach((p, n) => { out[p.k] = ids[n]; });
  return out;
}

/** Build the runtime shape for a body from a drawing. */
export function makeShape(cells: Uint8Array, st: ShapeStats): Shape {
  const { cx, cy, n } = centroid(cells);
  const goal = st.stress <= 1 ? 0 : Math.min(1, 1 - 1 / st.stress);
  // Slumping is quick for anything without strength — about a free-fall time —
  // and slower the closer the load is to what the material can bear.
  const tff = Math.sqrt((3 * Math.PI) / (32 * 6.674e-11 * Math.max(1, st.rho * 1000))) / (365.25 * 86400);
  const tau = tff * (isFinite(st.stress) ? Math.max(1, 4 * st.stress / Math.max(1e-6, st.stress - 1)) : 1);
  return {
    cells: cells.slice(), round: 0, roundGoal: goal, tau,
    outline: outlineOf(cells, cx, cy, Math.sqrt(n / Math.PI)),
    layered: st.differentiates ? layeredOf(cells) : null,
    marks: new Uint8Array(cells.length),
    cx, cy, rc: Math.sqrt(n / Math.PI), packed: false,
  };
}

/** The cells packed into a disc, keeping their order outward from the middle. */
function packedOf(cells: Uint8Array, byDensity: boolean): Uint8Array {
  if (byDensity) return layeredOf(cells);
  const { cx, cy } = centroid(cells);
  const ids: { id: number; d: number }[] = [];
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    const id = cells[j * GRID + i];
    if (id) ids.push({ id, d: Math.hypot(i + 0.5 - cx, j + 0.5 - cy) });
  }
  ids.sort((a, b) => a.d - b.d);
  const slots: { k: number; d: number }[] = [];
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) slots.push({ k: j * GRID + i, d: Math.hypot(i + 0.5 - GRID / 2, j + 0.5 - GRID / 2) });
  slots.sort((a, b) => a.d - b.d);
  const out = new Uint8Array(cells.length);
  ids.forEach((x, n) => { out[slots[n].k] = x.id; });
  return out;
}

/**
 * Advance a slump by `dt` years. Returns true when it has just finished
 * becoming a sphere: from then on it is an ordinary round world, and if it
 * melted on the way down its iron has sunk and its water and gas risen.
 */
export function slump(s: Shape, dt: number): boolean {
  if (s.packed || s.round >= s.roundGoal) return false;
  s.round = s.roundGoal - (s.roundGoal - s.round) * Math.exp(-dt / s.tau);
  if (s.roundGoal - s.round < 1e-3) s.round = s.roundGoal;
  if (s.round > 0.95) {
    s.cells = packedOf(s.cells, !!s.layered);
    s.layered = null;
    s.marks.fill(0);
    const c = centroid(s.cells);
    s.cx = c.cx; s.cy = c.cy; s.rc = Math.sqrt(c.n / Math.PI);
    s.outline.fill(1);
    s.round = 1;
    s.packed = true;
    return true;
  }
  return false;
}

/** What a finished sphere looks like from outside, from what ended up on top. */
export function lookFromShape(s: Shape, seed: number): { style: Style; c1: number; c2: number; atmo?: number } {
  const st = shapeStats(s.cells, 1);
  const surf = MAT.get(st.surface)!;
  const second = (() => {
    const count = new Map<number, number>();
    for (let k = 0; k < s.cells.length; k++) if (s.cells[k] && s.cells[k] !== st.surface) count.set(s.cells[k], (count.get(s.cells[k]) ?? 0) + 1);
    let best = 0, id = st.surface;
    for (const [i, n] of count) if (n > best) { best = n; id = i; }
    return MAT.get(id)!;
  })();
  void seed;
  switch (surf.key) {
    case 'water': return second.key === 'rock' || second.key === 'basalt'
      ? { style: 'terran', c1: surf.color, c2: 0x4f8a3c, atmo: 0x7ab0ff }
      : { style: 'ocean', c1: surf.dark, c2: surf.color, atmo: 0x80c0ff };
    case 'ice': return { style: 'ice', c1: second.color, c2: surf.color };
    case 'lava': return { style: 'lava', c1: 0x1c0e0c, c2: surf.color };
    case 'iron': case 'gold': return { style: 'iron', c1: surf.dark, c2: surf.color };
    case 'carbon': return { style: 'carbon', c1: surf.dark, c2: surf.color };
    case 'gas': return { style: st.iceFrac > 0.2 ? 'icegiant' : 'gas', c1: surf.dark, c2: surf.color, atmo: surf.color };
    case 'rubble': case 'basalt': return { style: 'barren', c1: surf.dark, c2: surf.color };
    default: return { style: 'rocky', c1: surf.dark, c2: surf.color };
  }
}

/** Chip a crater into the outline where something hit: angle in the body's frame, size as a fraction of its radius. */
export function chip(s: Shape, ang: number, size: number) {
  const { cx, cy, n } = centroid(s.cells);
  if (!n) return;
  const rEq = Math.sqrt(n / Math.PI);
  // walk in from outside along the hit direction to the surface
  const dx = Math.cos(ang), dy = -Math.sin(ang);
  let sx = cx, sy = cy;
  for (let t = GRID; t > 0; t -= 0.25) {
    const i = Math.floor(cx + dx * t), j = Math.floor(cy + dy * t);
    if (i >= 0 && j >= 0 && i < GRID && j < GRID && s.cells[j * GRID + i]) { sx = cx + dx * t; sy = cy + dy * t; break; }
  }
  const rc = Math.max(0.6, size * rEq);
  for (let j = Math.floor(sy - rc - 1); j <= sy + rc + 1; j++) for (let i = Math.floor(sx - rc - 1); i <= sx + rc + 1; i++) {
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
    const d = Math.hypot(i + 0.5 - sx, j + 0.5 - sy);
    const k = j * GRID + i;
    if (d < rc * 0.6 && rc > 1.2) s.cells[k] = 0;          // excavated
    else if (d < rc * 1.4 && s.cells[k]) s.marks[k] = Math.min(3, s.marks[k] + 1); // rim and ejecta blanket
  }
}

/** Ready-made outlines, painted with one material (or layered ones). */
export type ShapePreset = { key: string; name: string; make: () => Uint8Array };

function paint(f: (x: number, y: number) => number): Uint8Array {
  const c = new Uint8Array(GRID * GRID);
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    const x = (i + 0.5 - GRID / 2) / (GRID / 2), y = (j + 0.5 - GRID / 2) / (GRID / 2);
    c[j * GRID + i] = f(x, y);
  }
  return c;
}
const lumpy = (seed: number, amp: number) => (th: number) =>
  1 + amp * (Math.sin(2 * th + seed) * 0.6 + Math.sin(3 * th + seed * 2.3) * 0.3 + Math.sin(5 * th + seed * 1.7) * 0.15);

export const SHAPES: ShapePreset[] = [
  { key: 'sphere', name: 'Sphere', make: () => paint((x, y) => (x * x + y * y < 0.9 ? 2 : 0)) },
  { key: 'potato', name: 'Potato', make: () => { const f = lumpy(1.3, 0.22); return paint((x, y) => (Math.hypot(x / 1.0, y / 0.7) < 0.85 * f(Math.atan2(y, x)) ? 2 : 0)); } },
  { key: 'contact', name: 'Contact binary', make: () => paint((x, y) => (Math.hypot(x + 0.38, y) < 0.48 || Math.hypot(x - 0.45, y * 1.1) < 0.4 ? 6 : 0)) },
  { key: 'dogbone', name: 'Dog bone', make: () => paint((x, y) => (Math.hypot(x + 0.55, y) < 0.36 || Math.hypot(x - 0.55, y) < 0.36 || (Math.abs(x) < 0.6 && Math.abs(y) < 0.16) ? 1 : 0)) },
  { key: 'cigar', name: 'Cigar', make: () => paint((x, y) => (Math.hypot(x / 0.95, y / 0.16) < 1 ? 2 : 0)) },
  { key: 'cube', name: 'Cube', make: () => paint((x, y) => (Math.abs(x) < 0.62 && Math.abs(y) < 0.62 ? 2 : 0)) },
  { key: 'star', name: 'Star', make: () => paint((x, y) => { const th = Math.atan2(y, x), r = Math.hypot(x, y); return r < 0.45 + 0.42 * Math.pow(Math.abs(Math.cos(2.5 * th)), 3) ? 3 : 0; }) },
  { key: 'ring', name: 'Ring', make: () => paint((x, y) => { const r = Math.hypot(x, y); return r < 0.9 && r > 0.55 ? 6 : 0; }) },
  { key: 'earth', name: 'Earth-like layers', make: () => paint((x, y) => { const r = Math.hypot(x, y); return r > 0.9 ? 0 : r < 0.48 ? 1 : r < 0.84 ? 2 : (Math.sin(Math.atan2(y, x) * 3) > 0.2 ? 2 : 7); }) },
  { key: 'icymoon', name: 'Icy moon', make: () => paint((x, y) => { const r = Math.hypot(x, y); return r > 0.9 ? 0 : r < 0.55 ? 2 : r < 0.7 ? 7 : 6; }) },
  { key: 'giant', name: 'Gas giant', make: () => paint((x, y) => { const r = Math.hypot(x, y); return r > 0.9 ? 0 : r < 0.2 ? 2 : 9; }) },
  { key: 'mixed', name: 'Shuffled', make: () => { let s = 7; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); return paint((x, y) => (x * x + y * y < 0.85 ? [1, 2, 6, 7][Math.floor(rnd() * 4)] : 0)); } },
];

