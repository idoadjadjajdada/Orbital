import * as THREE from 'three';
import type { V3 } from '../pixel/sprites';
import { hash, fbm, vnoise } from '../pixel/noise';
import { faceOf, tangent, type GroundSpec, type GroundSample } from './terrain';

/**
 * What the heightfield cannot hold: rock you can walk under and into.
 *
 * A heightfield has one height for each point, so it can make mountains and
 * valleys but never an arch, an overhang or a cave. These are separate rock
 * meshes standing on the ground: natural arches and hoodoos where sandstone
 * weathers in a dry wind (the Colorado Plateau, Mars), rock shelters under
 * cliffs, sea-carved and frost-split spires on rugged ground, caves in
 * limestone country and in mountain crags, ice caves on frozen worlds, lava
 * tubes on the airless volcanic plains of the Moon. Which appear, and how
 * often, comes from where they are: the world, the colour and roughness of
 * the ground, its slope, whether there is air and water to carve it.
 *
 * They are placed on a fixed lattice over the world (about a kilometre a
 * cell), each cell deciding from its own hash and its own ground whether it
 * holds one, so the same arch is always in the same place. A cave is a hill of
 * rock with a tunnel winding into it and opening into a chamber, built as one
 * surface from the hill's outside through its mouth to the chamber's end; its
 * floor is what you walk on inside, its walls stop you, and the light from
 * the sky dies away as you go in (the helmet lamp is what you see by).
 */

export type FormKind = 'arch' | 'hoodoo' | 'spire' | 'shelter' | 'cave';
/** the rock it is made of, for its colour and its cave's dressing */
export type Rock = 'sandstone' | 'limestone' | 'granite' | 'basalt' | 'ice' | 'alien';

export interface Form {
  key: string;
  kind: FormKind;
  rock: Rock;
  /** where it stands (unit, body frame), the ground's height there (m), and the way it faces (rad from north, east positive) */
  n: V3; h0: number; head: number;
  /** its size, m (an arch's span, a spire's height, a cave hill's radius) */
  size: number;
  seed: number;
  name: string;
  about: string;
  /** a cave's floor along its path, m above h0 (set where it is placed, from the ground under it) */
  floor?: number[];
}

/** the ground, as the forms need to ask about it */
export type Sampler = (n: V3, fine: number) => GroundSample;

const CELL = 650;

/** the forms on the lattice within `reach` m of `n` */
export function formsNear(s: GroundSpec, n: V3, reach: number, sample: Sampler): Form[] {
  const R = s.R, [e, nn] = tangent(n);
  const seen = new Set<string>(), out: Form[] = [];
  const L = Math.max(0, Math.round(Math.log2((R * Math.PI / 2) / CELL)));
  const steps = Math.ceil(reach / (CELL * 0.6));
  for (let i = -steps; i <= steps; i++) for (let j = -steps; j <= steps; j++) {
    const dx = i * CELL * 0.6, dy = j * CELL * 0.6;
    if (dx * dx + dy * dy > (reach + CELL) ** 2) continue;
    const m: V3 = [n[0] + (e[0] * dx + nn[0] * dy) / R, n[1] + (e[1] * dx + nn[1] * dy) / R, n[2] + (e[2] * dx + nn[2] * dy) / R];
    const l = Math.hypot(...m);
    const [f, a, b] = faceOf([m[0] / l, m[1] / l, m[2] / l]);
    const k = 2 / 2 ** L, cx = Math.floor((a + 1) / k), cy = Math.floor((b + 1) / k);
    const key = `${f}/${cx}/${cy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const form = formIn(s, f, L, cx, cy, sample);
    if (form) out.push(form);
  }
  return out;
}

/** what one cell of the lattice holds, if anything */
function formIn(s: GroundSpec, f: number, L: number, cx: number, cy: number, sample: Sampler): Form | null {
  const sd = Math.floor(s.look.seed % 9973);
  const h1 = hash(cx * 7 + f, cy * 13 + L, sd), h2 = hash(cx + 101, cy + 37 * f, sd + 5), h3 = hash(cx + 7, cy + 3, sd * 3 + f);
  // somewhere in the cell
  const k = 2 / 2 ** L;
  const a = -1 + (cx + 0.15 + 0.7 * h2) * k, b = -1 + (cy + 0.15 + 0.7 * h3) * k;
  const n = faceDirOf(f, a, b);
  const g = sample(n, 4);
  if (g.sea) return null;
  const h0 = g.h;
  // the slope: from the ground 20 m round
  const [e, nn] = tangent(n), d = 20 / s.R;
  const at = (x: number, y: number) => { const m: V3 = [n[0] + e[0] * x + nn[0] * y, n[1] + e[1] * x + nn[1] * y, n[2] + e[2] * x + nn[2] * y]; const l = Math.hypot(...m); return sample([m[0] / l, m[1] / l, m[2] / l], 4).h; };
  const gx = (at(d, 0) - at(-d, 0)) / 40, gy = (at(0, d) - at(0, -d)) / 40, slope = Math.hypot(gx, gy);
  if (slope > 0.9) return null;
  const set = setting(s, g, slope);
  if (!set) return null;
  if (h1 > set.chance) return null;
  if (slope > 0.35) set.w = set.w.filter(w => w[0] !== 'cave' && w[0] !== 'arch');
  if (!set.w.length) return null;
  // which form, weighted by the setting
  let t = hash(cx * 3 + 11, cy * 5 + 17, sd + f) * set.w.reduce((x, y) => y[1] + x, 0), kind: FormKind = set.w[0][0];
  for (const [kk, w] of set.w) { if (t < w) { kind = kk; break; } t -= w; }
  const seed = Math.floor(hash(cx, cy, f + 99) * 1e6);
  // a cave's mouth faces down the slope, out of the hill; the rest any way
  const head = kind === 'cave' && slope > 0.02 ? Math.atan2(gx, gy) + Math.PI + (hash(cx, cy, 5) - 0.5) * 0.8 : hash(cx, cy, 7) * Math.PI * 2;
  const size = sizeOf(kind, set.rock, hash(cx + 3, cy + 9, 13));
  const [name, about] = describe(kind, set.rock, s.look.real);
  return { key: `${s.look.real ?? s.look.seed}:${f}/${cx}/${cy}`, kind, rock: set.rock, n, h0, head, size, seed, name, about };
}

const FACES: [V3, V3, V3][] = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, -1, 0], [0, 0, 1]],
  [[0, 1, 0], [-1, 0, 0], [0, 0, 1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [0, 1, 0], [-1, 0, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
];
function faceDirOf(f: number, a: number, b: number): V3 {
  const [F, U, V] = FACES[f];
  const ta = Math.tan(a * Math.PI / 4), tb = Math.tan(b * Math.PI / 4);
  const x = F[0] + ta * U[0] + tb * V[0], y = F[1] + ta * U[1] + tb * V[1], z = F[2] + ta * U[2] + tb * V[2];
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** the setting at a point: what rock is there, how likely a form is, and which */
function setting(s: GroundSpec, g: GroundSample, slope: number): { rock: Rock; chance: number; w: [FormKind, number][] } | null {
  const real = s.look.real, st = s.look.style;
  const lum = (g.r + g.g + g.b) / 3, warm = g.r - g.b;
  const airless = s.craters >= 1 && !s.seas && s.dunes === 0;
  const icy = st === 'ice' || ['Europa', 'Enceladus', 'Ganymede', 'Callisto', 'Triton', 'Pluto', 'Charon', 'Eris', 'Iapetus', 'Rhea', 'Dione', 'Tethys', 'Mimas', 'Miranda', 'Ariel', 'Titania', 'Oberon', 'Umbriel'].includes(real ?? '')
    || (lum > 0.82 && g.b >= g.r - 0.02);
  const rugged = g.rock > 0.55 || slope > 0.3;
  if (real === 'Venus' || real === 'Io' || st === 'lava') return { rock: 'basalt', chance: 0.25, w: [['spire', 2], ['shelter', 1], ['cave', 2]] };
  if (icy) return { rock: 'ice', chance: 0.3, w: [['cave', 3], ['shelter', 2], ['spire', 1], ['arch', 0.5]] };
  if (airless) {
    // lava tubes in the dark maria; a few great split boulders and overhangs on the rough highlands
    const mare = lum < 0.42;
    return mare ? { rock: 'basalt', chance: 0.22, w: [['cave', 4], ['shelter', 1]] } : { rock: 'basalt', chance: rugged ? 0.15 : 0.06, w: [['shelter', 2], ['spire', 1], ['cave', 1]] };
  }
  // sandstone country: red or yellow ground, dry (Mars, the Earth's deserts, made-up desert worlds)
  const sandy = warm > 0.12 && lum > 0.3 && (s.dunes > 0 || real === 'Mars' || st === 'desert');
  if (sandy) return { rock: 'sandstone', chance: rugged ? 0.55 : 0.4, w: [['arch', 3], ['hoodoo', 3], ['shelter', 2], ['spire', 1], ['cave', 1.2]] };
  if (!real && s.look.style === 'terran' && s.look.seed % 3 === 0) return { rock: 'alien', chance: 0.35, w: [['arch', 2], ['spire', 2], ['cave', 2], ['shelter', 1]] };
  // green and wet: limestone and its caves; high and rough: granite crags
  if (rugged || lum < 0.3) return { rock: rugged ? 'granite' : 'limestone', chance: rugged ? 0.4 : 0.22, w: [['cave', 3], ['shelter', 3], ['spire', 2], ['arch', 0.6]] };
  if (real === 'Titan') return { rock: 'ice', chance: 0.12, w: [['shelter', 1], ['cave', 1]] };
  return { rock: 'limestone', chance: 0.12, w: [['cave', 2], ['shelter', 2], ['arch', 0.5], ['spire', 0.5]] };
}

function sizeOf(kind: FormKind, rock: Rock, h: number) {
  const big = rock === 'ice' || rock === 'alien' ? 1.3 : 1;
  switch (kind) {
    case 'arch': return (14 + 40 * h) * big;
    case 'hoodoo': return 8 + 22 * h;
    case 'spire': return (18 + 50 * h) * big;
    case 'shelter': return 9 + 12 * h;
    case 'cave': return 26 + 16 * h;
  }
}

function describe(kind: FormKind, rock: Rock, real: string | undefined): [string, string] {
  const on = real ? ` on ${real}` : '';
  switch (kind) {
    case 'arch': return [rock === 'ice' ? 'An ice arch' : 'A natural arch', rock === 'sandstone' ? `Sandstone worn through by wind and frost${on}: the softer layers go first, the hard cap holds.` : `Rock worn through from both sides until only the bridge is left${on}.`];
    case 'hoodoo': return ['Hoodoos', 'Pillars of soft rock under caps of harder rock that shelter them from the rain and wind.'];
    case 'spire': return [rock === 'ice' ? 'An ice pinnacle' : 'A rock spire', rock === 'ice' ? 'Ice sculpted into a blade by the sun (a penitente) or split off a scarp.' : 'Harder rock left standing as everything round it wore away.'];
    case 'shelter': return ['A rock shelter', 'An overhang where the softer rock under a ledge has crumbled out: shade, and shelter from the wind.'];
    case 'cave': return rock === 'basalt' && (real === 'Moon' || real === 'Mars') ? ['A lava tube', 'A tunnel left where a river of lava drained out from under its own crust: shelter from radiation and meteorites, the best place for a base.']
      : rock === 'ice' ? ['An ice cave', 'Blue light through the walls near the mouth, darkness deeper in.']
      : rock === 'limestone' ? ['A limestone cave', 'Dissolved out by water seeping through the rock; stalactites hang where it drips.']
      : ['A cave', 'A way into the rock: the walls close round you and the daylight fades behind.'];
  }
}

// ---------------------------------------------------------------- the shapes, in a form's own frame
// x to the right, y up, z back toward you (forward is −z); metres, from the ground at its middle

/** the cave's path: a mouth at the hill's side, a winding tunnel, a chamber */
export interface CavePath { pts: THREE.Vector3[]; w: number[]; hgt: number[]; open: number }
export function cavePath(f: Form): CavePath {
  const S = f.size, r = mulberry(f.seed);
  const pts: THREE.Vector3[] = [], w: number[] = [], hgt: number[] = [];
  const N = 26, len = S * 1.25, mouthZ = S * 0.72;
  let x = 0, ang = 0;
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    ang += (r() - 0.5) * 0.5;
    ang *= 0.85;
    const z = mouthZ - t * len;
    x += Math.sin(ang) * (len / N);
    pts.push(new THREE.Vector3(x, f.floor ? f.floor[k] : 0.15, z));
    // a narrow passage that opens into a chamber at the end
    const ch = Math.max(0, (t - 0.62) / 0.38), bulge = Math.sin(Math.min(1, ch) * Math.PI * 0.85);
    w.push(2.4 + 0.6 * r() + 5.5 * bulge + (t < 0.08 ? 1.2 * (1 - t / 0.08) : 0));
    hgt.push(2.9 + 0.4 * r() + 4.5 * bulge + (t < 0.08 ? 0.8 * (1 - t / 0.08) : 0));
  }
  return { pts, w, hgt, open: mouthZ };
}

const mulberry = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** the rock's colour at a point of it: its base, banded where it was laid down in layers */
function rockColour(rock: Rock, p: THREE.Vector3, seed: number, out: THREE.Color) {
  const v = fbm(p.x * 0.15 + seed, p.y * 0.15, p.z * 0.15, 3), band = Math.sin(p.y * 1.7 + v * 3);
  switch (rock) {
    case 'sandstone': out.setRGB(0.68 + 0.08 * band, 0.36 + 0.05 * band, 0.2 + 0.03 * band); break;
    case 'limestone': out.setRGB(0.66 + 0.04 * band, 0.63 + 0.04 * band, 0.56 + 0.03 * band); break;
    case 'granite': out.setRGB(0.47, 0.45, 0.43); break;
    case 'basalt': out.setRGB(0.25, 0.24, 0.23); break;
    case 'ice': out.setRGB(0.72, 0.86, 0.95); break;
    case 'alien': out.setRGB(0.42 + 0.1 * band, 0.3 + 0.06 * band, 0.55 + 0.08 * band); break;
  }
  out.multiplyScalar(0.82 + 0.36 * v);
}

/** roughen a surface: push each vertex along its normal by noise, so nothing is smooth or regular */
function roughen(pos: Float32Array, nrm: Float32Array, amp: number, scale: number, seed: number) {
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const d = (fbm(x * scale + seed, y * scale, z * scale, 4) - 0.5) * 2 * amp + (vnoise(x * scale * 4, y * scale * 4 + seed, z * scale * 4) - 0.5) * amp * 0.35;
    pos[i] += nrm[i] * d; pos[i + 1] += nrm[i + 1] * d; pos[i + 2] += nrm[i + 2] * d;
  }
}

/** a mesh from rings of points (each ring the same count, closed round): the rings joined into a sleeve */
function sleeve(rings: THREE.Vector3[][], sky: number[]) {
  const M = rings[0].length, pos: number[] = [], skyv: number[] = [], idx: number[] = [];
  rings.forEach((ring, j) => ring.forEach(p => { pos.push(p.x, p.y, p.z); skyv.push(sky[j]); }));
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < M; i++) {
    const a = j * M + i, b = j * M + ((i + 1) % M), c = a + M, d = b + M;
    idx.push(a, c, b, b, c, d);
  }
  return { pos: new Float32Array(pos), sky: new Float32Array(skyv), idx };
}

/** a stand of hoodoos: where each pillar is, how tall, how thick */
function hoodoos(f: Form) {
  const r = mulberry(f.seed + 3), S = f.size, n = 3 + Math.floor(r() * 4), out: { x: number; z: number; H: number; w: number }[] = [];
  for (let c = 0; c < n; c++) out.push({ H: S * (0.45 + 0.55 * r()) * (c === 0 ? 1 : 0.85), x: c ? (r() - 0.5) * S * 1.1 : 0, z: c ? (r() - 0.5) * S * 1.1 : 0, w: 0.15 + 0.06 * r() });
  return out;
}

/** several sleeves as one */
function merge(parts: { pos: Float32Array; sky: Float32Array; idx: number[] }[]) {
  const pos: number[] = [], sky: number[] = [], idx: number[] = [];
  for (const p of parts) {
    const base = pos.length / 3;
    pos.push(...p.pos); sky.push(...p.sky);
    for (const i of p.idx) idx.push(i + base);
  }
  return { pos: new Float32Array(pos), sky: new Float32Array(sky), idx };
}

/** finish a geometry: normals, roughened, normals again, rock colours, the attributes the ground's shader wants */
function finish(pos: Float32Array, idx: number[], sky: Float32Array, f: Form, amp: number, scale: number) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (amp > 0) {
    roughen(pos, g.getAttribute('normal').array as Float32Array, amp, scale, f.seed % 1000);
    g.getAttribute('position').needsUpdate = true;
    g.computeVertexNormals();
  }
  const nv = pos.length / 3, col = new Float32Array(nv * 3), grain = new Float32Array(nv * 3), p = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < nv; i++) {
    p.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    rockColour(f.rock, p, f.seed % 100, c);
    // darker in the hollows the sky does not reach
    const k = 0.55 + 0.45 * sky[i];
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
    grain[i * 3] = (f.seed % 512) + 0.5; grain[i * 3 + 1] = 0.5; grain[i * 3 + 2] = 0.5;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('sea', new THREE.BufferAttribute(new Float32Array(nv), 1));
  g.setAttribute('grain', new THREE.BufferAttribute(grain, 3));
  g.setAttribute('sky', new THREE.BufferAttribute(sky, 1));
  g.computeBoundingSphere();
  return g;
}

/** a tube along a path with a radius that varies, rings of M: for arches */
function tubeAlong(path: THREE.Vector3[], rad: (t: number) => [number, number], M = 12) {
  const rings: THREE.Vector3[][] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < path.length; k++) {
    const t = k / (path.length - 1);
    const tan = path[Math.min(path.length - 1, k + 1)].clone().sub(path[Math.max(0, k - 1)]).normalize();
    const side = new THREE.Vector3().crossVectors(tan, up);
    if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
    side.normalize();
    const nrm = new THREE.Vector3().crossVectors(side, tan).normalize();
    const [ra, rb] = rad(t), ring: THREE.Vector3[] = [];
    for (let i = 0; i < M; i++) {
      const a = (i / M) * Math.PI * 2;
      ring.push(path[k].clone().addScaledVector(side, Math.cos(a) * ra).addScaledVector(nrm, Math.sin(a) * rb));
    }
    rings.push(ring);
  }
  return rings;
}

/** a body of revolution about y: profile of [radius, height] from the bottom up, closed at the top */
function lathe(profile: [number, number][], M = 16, wob = 0, seed = 0) {
  const rings: THREE.Vector3[][] = [];
  for (const [r, y] of profile) {
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < M; i++) {
      const a = (i / M) * Math.PI * 2;
      const rr = r * (1 + wob * (vnoise(Math.cos(a) * 2 + seed, y * 0.2, Math.sin(a) * 2) - 0.5));
      ring.push(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr));
    }
    rings.push(ring);
  }
  return rings;
}

/** the mesh of a form, in its own frame */
export function formGeometry(f: Form): THREE.BufferGeometry {
  const S = f.size, r = mulberry(f.seed);
  switch (f.kind) {
    case 'arch': {
      // two legs and a bridge: thick where it stands, thinnest at the top of the span, and a little lopsided
      const H = S * (0.5 + 0.25 * r()), path: THREE.Vector3[] = [];
      for (let k = 0; k <= 24; k++) {
        const t = k / 24, a = Math.PI * t;
        path.push(new THREE.Vector3(-Math.cos(a) * S / 2, Math.sin(a) * H - 3 + 3 * Math.sin(a) * 0, (r() - 0.5) * 0.6));
      }
      const thick = S * 0.11;
      const rings = tubeAlong(path, t => { const leg = Math.pow(Math.abs(t - 0.5) * 2, 3); return [thick * (0.8 + 1.8 * leg), thick * (1.4 + 2.2 * leg)]; }, 14);
      const s = sleeve(rings, rings.map(() => 1));
      // close the ends (buried anyway)
      return finish(s.pos, s.idx, s.sky, f, thick * 0.35, 0.12);
    }
    case 'hoodoo': {
      // a stand of pillars of soft rock, waisted, each under a cap of harder rock
      const parts: { pos: Float32Array; sky: Float32Array; idx: number[] }[] = [];
      hoodoos(f).forEach(({ x: cx, z: cz, H, w }, c) => {
        const prof: [number, number][] = [];
        for (let k = 0; k <= 14; k++) { const t = k / 14; prof.push([H * (w - 0.06 * Math.sin(t * Math.PI) + 0.025 * Math.sin(t * 19 + c)) * (t < 0.12 ? 1.5 - t * 4 : 1), -2 + t * H]); }
        prof.push([H * (w + 0.02), H - 1.0], [H * (w + 0.04), H - 0.5], [H * w * 0.8, H], [0.01, H + 0.3]);
        const rings = lathe(prof, 12, 0.25, f.seed % 50 + c * 7).map(ring => ring.map(p => p.add(new THREE.Vector3(cx, 0, cz))));
        parts.push(sleeve(rings, rings.map(() => 1)));
      });
      const m = merge(parts);
      return finish(m.pos, m.idx, m.sky, f, S * 0.025, 0.3);
    }
    case 'spire': {
      const H = S, prof: [number, number][] = [];
      for (let k = 0; k <= 16; k++) { const t = k / 16; prof.push([H * 0.2 * Math.pow(1 - t, 0.8) * (1 + 0.15 * Math.sin(t * 13)) + 0.2, -3 + t * H]); }
      prof.push([0.01, H + 0.5]);
      const rings = lathe(prof, 12, 0.45, f.seed % 50);
      const s = sleeve(rings, rings.map(() => 1));
      return finish(s.pos, s.idx, s.sky, f, H * 0.04, 0.15);
    }
    case 'shelter': {
      // a great half-dome of rock, open in front, the roof jutting out over a hollow you can stand in
      const W = S, H = S * 0.65, rings: THREE.Vector3[][] = [], sky: number[] = [];
      const M = 18;
      for (let j = 0; j <= 12; j++) {
        // from the ground at the back, up and over, and out to the lip of the overhang
        const t = j / 12, el = t * Math.PI * 0.62;
        const ring: THREE.Vector3[] = [];
        for (let i = 0; i < M; i++) {
          const a = Math.PI * 0.05 + (i / (M - 1)) * Math.PI * 0.9;
          const rr = W * (0.55 + 0.45 * Math.cos(el));
          ring.push(new THREE.Vector3(Math.cos(a) * rr, -1.5 + Math.sin(el) * H, -Math.sin(a) * rr * 0.75 + W * 0.25));
        }
        rings.push(ring);
        sky.push(0.45 + 0.55 * t);
      }
      // the rings are open (a horseshoe), so join them as strips, not round
      const pos: number[] = [], skyv: number[] = [], idx: number[] = [];
      rings.forEach((ring, j) => ring.forEach(p => { pos.push(p.x, p.y, p.z); skyv.push(sky[j]); }));
      for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < M - 1; i++) {
        const a = j * M + i, b = a + 1, c = a + M, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
      // and a thick top over it: the outside of the dome, joined at the lip
      const top = rings.map(ring => ring.map(p => p.clone().setY(p.y + 2.5).multiplyScalar(1.08)));
      const base = rings.length * M;
      top.forEach(ring => ring.forEach(p => { pos.push(p.x, p.y, p.z); skyv.push(1); }));
      for (let j = 0; j < top.length - 1; j++) for (let i = 0; i < M - 1; i++) {
        const a = base + j * M + i, b = a + 1, c = a + M, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const lip = rings.length - 1;
      for (let i = 0; i < M - 1; i++) { const a = lip * M + i, b = a + 1, c = base + lip * M + i, d = c + 1; idx.push(a, c, b, b, c, d); }
      return finish(new Float32Array(pos), idx, new Float32Array(skyv), f, 0.8, 0.12);
    }
    case 'cave': return caveGeometry(f);
  }
}

/**
 * A cave: one surface from the back of a hill of rock, over it to its mouth,
 * in through the mouth and along the tunnel to the far wall of the chamber.
 * Each row is a ring of the same number of points: on the hill, a ring round
 * the mouth's axis; in the tunnel, a ring round its path, flattened at the
 * bottom into a floor. Its outside is the air everywhere, so the hill's skin
 * and the tunnel's walls are the same face of one sheet.
 */
function caveGeometry(f: Form) {
  const S = f.size, P = cavePath(f), M = 20, rings: THREE.Vector3[][] = [], sky: number[] = [];
  const top = Math.max(...P.pts.map((p, k) => p.y + P.hgt[k]));
  const dome = (dir: THREE.Vector3) => {
    // the hill: a squat, lumpy dome, wider than it is tall
    const v = fbm(dir.x * 1.6 + f.seed % 97, dir.y * 1.6, dir.z * 1.6, 3);
    const rr = S * (0.85 + 0.35 * v);
    // tall enough over the tunnel's highest point, and reaching well down into the ground below
    return new THREE.Vector3(dir.x * rr, dir.y > 0 ? dir.y * Math.max(rr * 0.62, top + 4) - 1.5 : dir.y * rr - 1.5, dir.z * rr);
  };
  // the mouth's frame: the axis points out of the hill along +z
  const mouth = P.pts[0], ax = new THREE.Vector3(0, 0.12, 1).normalize();
  const sideA = new THREE.Vector3(1, 0, 0), upA = new THREE.Vector3().crossVectors(ax, sideA).normalize();
  // the tunnel's ring at k: round the path point, its floor flat
  const tunnelRing = (k: number) => {
    const p = P.pts[k], nx = P.pts[Math.min(P.pts.length - 1, k + 1)].clone().sub(P.pts[Math.max(0, k - 1)]).setY(0).normalize();
    const side = new THREE.Vector3(-nx.z, 0, nx.x);
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < M; i++) {
      const a = (i / M) * Math.PI * 2 + Math.PI / 2;
      const c = Math.cos(a), s = Math.sin(a);
      ring.push(p.clone().addScaledVector(side, -c * P.w[k] / 2).add(new THREE.Vector3(0, s > 0 ? s * P.hgt[k] : Math.max(-0.12, s * 0.12), 0)));
    }
    return ring;
  };
  // on the hill: rings round the mouth's axis, from the back of the hill (opposite the mouth) to the rim of the mouth
  const rim0 = tunnelRing(0);
  for (let j = 0; j <= 14; j++) {
    const t = j / 14, al = Math.PI * (1 - t * 0.9);
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < M; i++) {
      // the same bearing round the axis as the tunnel ring's point i, so the rows line up
      const q = rim0[i].clone().sub(mouth);
      const be = Math.atan2(q.dot(upA), q.dot(sideA));
      const dir = ax.clone().multiplyScalar(Math.cos(al)).addScaledVector(sideA, Math.sin(al) * Math.cos(be)).addScaledVector(upA, Math.sin(al) * Math.sin(be)).normalize();
      ring.push(dome(dir));
    }
    rings.push(ring);
    sky.push(1);
  }
  // round the mouth: from the hill's skin in to the tunnel's first ring, a short lip
  const hillRim = rings[rings.length - 1];
  rings.push(hillRim.map((p, i) => p.clone().lerp(rim0[i], 0.6)));
  sky.push(1);
  for (let k = 0; k < P.pts.length; k++) {
    rings.push(tunnelRing(k));
    const into = (P.open - P.pts[k].z);
    sky.push(Math.exp(-into / (f.rock === 'ice' ? 16 : 7)));
  }
  // the end wall: the last ring pulled in to a point
  const last = P.pts[P.pts.length - 1].clone().add(new THREE.Vector3(0, P.hgt[P.pts.length - 1] * 0.4, -1.5));
  rings.push(rings[rings.length - 1].map(p => p.clone().lerp(last, 0.7)));
  sky.push(0);
  rings.push(rings[rings.length - 1].map(() => last.clone()));
  sky.push(0);
  const s = sleeve(rings, sky);
  // roughen only gently in the tunnel, so its floor stays walkable
  const g = finish(s.pos, s.idx, s.sky, f, 0, 0);
  const pos = g.getAttribute('position').array as Float32Array, nrm = g.getAttribute('normal').array as Float32Array;
  const hillN = 16 * M;
  for (let i = 0; i < pos.length / 3; i++) {
    const inside = i >= hillN, y = pos[i * 3 + 1];
    const amp = inside ? (y < 0.3 ? 0.05 : 0.45) : 1.6;
    const x = pos[i * 3], z = pos[i * 3 + 2], sc = inside ? 0.6 : 0.09;
    const d = (fbm(x * sc + f.seed % 1000, y * sc, z * sc, 4) - 0.5) * 2 * amp;
    pos[i * 3] += nrm[i * 3] * d; pos[i * 3 + 1] += nrm[i * 3 + 1] * d; pos[i * 3 + 2] += nrm[i * 3 + 2] * d;
  }
  g.getAttribute('position').needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** what hangs from a cave's roof and stands on its floor: stalactites and stalagmites, or ice, or crystals */
export function caveDressing(f: Form): { at: THREE.Vector3; len: number; down: boolean }[] {
  if (f.kind !== 'cave' || f.rock === 'basalt') return [];
  const P = cavePath(f), r = mulberry(f.seed + 7), out: { at: THREE.Vector3; len: number; down: boolean }[] = [];
  for (let k = 8; k < P.pts.length - 1; k++) {
    const n = Math.floor(r() * (k > 16 ? 5 : 2));
    for (let m = 0; m < n; m++) {
      const p = P.pts[k].clone(), down = r() < 0.6;
      const side = (r() - 0.5) * P.w[k] * 0.8;
      p.x += side;
      if (down) p.y += P.hgt[k] * (0.92 - 0.25 * (side / P.w[k]) ** 2 * 4);
      out.push({ at: p, len: 0.3 + r() * (k > 16 ? 2.2 : 0.8), down });
    }
  }
  return out;
}

/** inside a cave's tunnel (local x, z)? its floor's height there and how high its roof is; null if not in it */
export function caveFloor(P: CavePath, x: number, z: number): { floor: number; roof: number; t: number } | null {
  let best = Infinity, bk = -1, bt = 0;
  for (let k = 0; k < P.pts.length - 1; k++) {
    const a = P.pts[k], b = P.pts[k + 1];
    const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
    const dx = a.x + ex * t - x, dz = a.z + ez * t - z, d = dx * dx + dz * dz;
    if (d < best) { best = d; bk = k; bt = t; }
  }
  if (bk < 0) return null;
  const w = P.w[bk] + (P.w[bk + 1] - P.w[bk]) * bt;
  if (Math.sqrt(best) > w / 2 - 0.45) return null;
  const a = P.pts[bk], b = P.pts[bk + 1];
  const floor = a.y + (b.y - a.y) * bt, roof = P.hgt[bk] + (P.hgt[bk + 1] - P.hgt[bk]) * bt;
  return { floor, roof, t: (bk + bt) / (P.pts.length - 1) };
}

/** is a point (local, y above the form's ground) inside a form's rock, where you cannot walk? */
export function formSolid(f: Form, x: number, y: number, z: number, P: CavePath | null): boolean {
  const S = f.size;
  switch (f.kind) {
    case 'arch': {
      // the legs: near either end of the span, low down
      const leg = S * 0.11 * 2.6;
      return y < S * 0.35 && Math.abs(z) < leg && Math.abs(Math.abs(x) - S / 2) < leg;
    }
    case 'hoodoo': return hoodoos(f).some(c => Math.hypot(x - c.x, z - c.z) < c.H * c.w + 0.4);
    case 'spire': return Math.hypot(x, z) < S * 0.2 * Math.max(0.2, 1 - y / S) + 0.3;
    case 'shelter': {
      // the back wall of the hollow
      const r = Math.hypot(x, (z - S * 0.25) / 0.75);
      return r > S * 0.92 && r < S * 1.15 && z < S * 0.25;
    }
    case 'cave': {
      if (P && caveFloor(P, x, z)) return false;
      const r = Math.hypot(x, z) / (S * 0.85);
      return r < 0.9 && y < S * 0.62 * Math.sqrt(Math.max(0, 1 - r * r)) - 1;
    }
  }
}

// ---------------------------------------------------------------- the forms round you

interface Placed { f: Form; obj: THREE.Mesh; path: CavePath | null; right: V3; back: V3 }

/** the forms within reach of the viewer: built as they come near, dropped as they go */
export class FormSet {
  readonly group = new THREE.Group();
  private placed = new Map<string, Placed>();
  private lastAt: V3 | null = null;
  private list: Form[] = [];

  constructor(private mat: THREE.ShaderMaterial) { this.group.name = 'landforms'; }

  clear() {
    for (const p of this.placed.values()) { this.group.remove(p.obj); p.obj.geometry.dispose(); }
    this.placed.clear();
    this.list = [];
    this.lastAt = null;
  }

  /** the forms near enough to see, re-planned as you move a few hundred metres */
  frame(s: GroundSpec, n: V3, alt: number, sample: Sampler) {
    const reach = Math.min(2500, 1500 + alt);
    if (!this.lastAt || Math.acos(Math.min(1, n[0] * this.lastAt[0] + n[1] * this.lastAt[1] + n[2] * this.lastAt[2])) * s.R > 250) {
      this.lastAt = n;
      this.list = formsNear(s, n, reach, sample);
    }
    const want = new Set<string>();
    for (const f of this.list) {
      const d = Math.acos(Math.min(1, n[0] * f.n[0] + n[1] * f.n[1] + n[2] * f.n[2])) * s.R;
      if (d > reach + f.size) continue;
      want.add(f.key);
      if (!this.placed.has(f.key)) this.place(s, f, sample);
    }
    for (const [k, p] of this.placed) if (!want.has(k)) { this.group.remove(p.obj); p.obj.geometry.dispose(); this.placed.delete(k); }
  }

  private place(s: GroundSpec, f: Form, sample: Sampler) {
    const [e, nn] = tangent(f.n), up = f.n;
    const fwd: V3 = [nn[0] * Math.cos(f.head) + e[0] * Math.sin(f.head), nn[1] * Math.cos(f.head) + e[1] * Math.sin(f.head), nn[2] * Math.cos(f.head) + e[2] * Math.sin(f.head)];
    const right: V3 = [fwd[1] * up[2] - fwd[2] * up[1], fwd[2] * up[0] - fwd[0] * up[2], fwd[0] * up[1] - fwd[1] * up[0]];
    const back: V3 = [-fwd[0], -fwd[1], -fwd[2]];
    const dirAt = (x: number, z: number): V3 => {
      const m: V3 = [f.n[0] + (right[0] * x + back[0] * z) / s.R, f.n[1] + (right[1] * x + back[1] * z) / s.R, f.n[2] + (right[2] * x + back[2] * z) / s.R];
      const l = Math.hypot(...m);
      return [m[0] / l, m[1] / l, m[2] / l];
    };
    if (f.kind === 'cave' && !f.floor) {
      // the tunnel's floor clears the ground under it all the way in, climbing gently where the hill rises
      const P0 = cavePath(f);
      const fl = P0.pts.map(p => Math.max(0.15, sample(dirAt(p.x, p.z), 1).h - f.h0 + 0.25));
      for (let k = 1; k < fl.length; k++) fl[k] = Math.max(fl[k], fl[k - 1] - 0.3);
      for (let k = fl.length - 2; k >= 0; k--) fl[k] = Math.max(fl[k], fl[k + 1] - 0.6);
      f.floor = fl;
    }
    const g = formGeometry(f);
    const dress = caveDressing(f);
    if (dress.length) mergeInto(g, dress, f);
    const obj = new THREE.Mesh(g, this.mat);
    obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...right), new THREE.Vector3(...up), new THREE.Vector3(...back)));
    const r = s.R + f.h0;
    obj.position.set(f.n[0] * r, f.n[1] * r, f.n[2] * r);
    obj.name = f.name;
    this.group.add(obj);
    this.placed.set(f.key, { f, obj, path: f.kind === 'cave' ? cavePath(f) : null, right, back });
  }

  /** where a direction falls in a placed form's frame: local x, z (m) and the form */
  private local(s: GroundSpec, n: V3) {
    const out: { p: Placed; x: number; z: number }[] = [];
    for (const p of this.placed.values()) {
      const f = p.f, dx = n[0] - f.n[0], dy = n[1] - f.n[1], dz = n[2] - f.n[2];
      const x = (dx * p.right[0] + dy * p.right[1] + dz * p.right[2]) * s.R, z = (dx * p.back[0] + dy * p.back[1] + dz * p.back[2]) * s.R;
      if (Math.abs(x) < f.size * 1.6 && Math.abs(z) < f.size * 1.6) out.push({ p, x, z });
    }
    return out;
  }

  /**
   * What is underfoot at `n` for someone whose feet are at height `foot` (m above
   * the datum): a cave's floor if they are in its tunnel (and its roof), or null
   * for the open ground; and whether rock stands in the way.
   */
  ground(s: GroundSpec, n: V3, foot: number): { floor: number | null; roof: number; solid: boolean; inside: Form | null; dark: number } {
    let floor: number | null = null, roof = Infinity, solid = false, inside: Form | null = null, dark = 0;
    for (const { p, x, z } of this.local(s, n)) {
      const f = p.f, y = foot - f.h0;
      if (p.path) {
        const c = caveFloor(p.path, x, z);
        if (c && y < c.roof + 1) { floor = f.h0 + c.floor; roof = f.h0 + c.floor + c.roof; inside = f; dark = Math.min(1, c.t * 1.6); continue; }
      }
      if (formSolid(f, x, Math.max(0, y), z, p.path)) solid = true;
    }
    return { floor, roof, solid, inside, dark };
  }

  /** the forms placed now (for the scanner and finds) */
  near(s: GroundSpec, n: V3, within: number) {
    return [...this.placed.values()].map(p => p.f).filter(f => Math.acos(Math.min(1, n[0] * f.n[0] + n[1] * f.n[1] + n[2] * f.n[2])) * s.R < within + f.size);
  }
}

/** add a cave's stalactites and stalagmites (or icicles, or crystals) to its geometry */
function mergeInto(g: THREE.BufferGeometry, dress: { at: THREE.Vector3; len: number; down: boolean }[], f: Form) {
  const pos = Array.from(g.getAttribute('position').array as Float32Array), col = Array.from(g.getAttribute('color').array as Float32Array);
  const nrm = Array.from(g.getAttribute('normal').array as Float32Array), sky = Array.from(g.getAttribute('sky').array as Float32Array);
  const grain = Array.from(g.getAttribute('grain').array as Float32Array), sea = Array.from(g.getAttribute('sea').array as Float32Array);
  const idx = Array.from(g.getIndex()!.array as ArrayLike<number>);
  const c = new THREE.Color();
  const crystal = f.rock === 'alien', ice = f.rock === 'ice';
  for (const d of dress) {
    const base = pos.length / 3, K = 6, w = d.len * (crystal ? 0.18 : 0.12) + 0.05, s = d.down ? -1 : 1;
    if (crystal) c.setRGB(0.5, 0.9, 1.0); else if (ice) c.setRGB(0.75, 0.9, 1); else rockColour(f.rock, d.at, 3, c);
    for (let i = 0; i < K; i++) {
      const a = (i / K) * Math.PI * 2;
      pos.push(d.at.x + Math.cos(a) * w, d.at.y, d.at.z + Math.sin(a) * w);
      nrm.push(Math.cos(a), 0, Math.sin(a));
    }
    pos.push(d.at.x, d.at.y + s * d.len, d.at.z);
    nrm.push(0, s, 0);
    for (let i = 0; i <= K; i++) {
      col.push(c.r * (crystal ? 1.6 : 0.75), c.g * (crystal ? 1.6 : 0.75), c.b * (crystal ? 1.6 : 0.75));
      sky.push(crystal ? 0.9 : 0.05); grain.push(1, 1, 1); sea.push(0);
    }
    for (let i = 0; i < K; i++) idx.push(base + i, base + ((i + 1) % K), base + K);
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('sky', new THREE.BufferAttribute(new Float32Array(sky), 1));
  g.setAttribute('grain', new THREE.BufferAttribute(new Float32Array(grain), 3));
  g.setAttribute('sea', new THREE.BufferAttribute(new Float32Array(sea), 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
}
