import type { Look } from '../physics/body';
import { pointPainter, detailFor } from '../pixel/surface';
import { fbm, ridged, vnoise, hash } from '../pixel/noise';
import type { Tx, V3 } from '../pixel/worlds';

/**
 * The ground of a world, close up. Heights come from the same painter as its
 * surface map — Olympus Mons is where the map has it, the maria are low and
 * flat — scaled so its relief matches the world's real range of elevation
 * (Mars 29 km from Hellas to Olympus, the Moon 18 km, Europa barely 1). Below
 * what the map can hold, fractal relief carries on down to a metre: ridges
 * and hills that shrink as a power of their size, crater fields at every
 * scale on airless worlds (fresh bowls and old, softened ones), dunes where
 * there is sand and wind. Venus and Titan's maps are their cloud tops, so
 * their ground has painters of its own, from the radar maps: Ishtar and
 * Aphrodite, Maxwell Montes, Titan's equatorial dunes and its northern seas.
 *
 * Everything here is a pure function of the look and a direction, so the
 * worker that builds the terrain mesh and the main thread that asks how high
 * the ground is under a landing leg always agree.
 */

/** what the ground generator needs to know about a world (structured-cloneable, for the worker) */
export interface GroundSpec {
  look: Look;
  /** radius, m */
  R: number;
  /** the full range of elevation, m */
  relief: number;
  /** has seas (Earth-like), flat at height 0 */
  seas: boolean;
  /** pocked with craters (no air to burn up what falls) */
  craters: number;
  /** sand dunes */
  dunes: number;
  /** a body too small to be round: big lumps */
  lumpy: number;
  /** painter heights: the datum (0.5 normally, sea level for a world with seas) and metres per unit */
  datum: number; scale: number;
}

/** real elevation ranges, m: lowest basin to highest peak (land only for the Earth) */
const RELIEF: Record<string, number> = {
  Mercury: 10000, Venus: 13000, Earth: 8800, Moon: 18000, Mars: 29000, Io: 17000, Europa: 1000, Ganymede: 4000,
  Callisto: 5000, Titan: 2000, Enceladus: 3000, Mimas: 12000, Tethys: 9000, Dione: 6000, Rhea: 8000, Iapetus: 20000,
  Triton: 1500, Pluto: 6000, Charon: 6000, Ceres: 15000, Vesta: 40000, Phobos: 3000, Deimos: 1500, Miranda: 20000,
  Ariel: 6000, Titania: 5000, Oberon: 6000, Umbriel: 6000, Hyperion: 10000, Eris: 3000, Haumea: 4000, Makemake: 3000,
};
/** the spread (standard deviation) of elevation, m, where it is measured: LOLA, MOLA, Magellan, MESSENGER altimetry */
const SIGMA: Record<string, number> = { Moon: 2400, Mars: 3000, Mercury: 1500, Venus: 1000, Io: 1500, Vesta: 6000, Ceres: 2500 };

/**
 * metres per unit of painted height, set by hand where the painter's features need it (the Moon's maria
 * sit 2–3 km below its highlands), or where the painter gives real elevations (Mars: MOLA, 40 km a unit)
 */
const SCALE: Record<string, number> = { Moon: 22000, Venus: 35000, Mars: 40000 };
/** painted height of the datum, where the painter's heights are measured from one (Mars: the areoid) */
const DATUM: Record<string, number> = { Mars: 0.5 };

/** worlds with enough air to burn up small impactors and wear craters down */
const AIRY = new Set(['Earth', 'Venus', 'Titan', 'Mars']);

const D = Math.PI / 180;
const isGas = (st: string) => st === 'gas' || st === 'icegiant' || st === 'hotjupiter' || st === 'browndwarf';

/** the spec for a world: radius (m), surface gravity (m/s²) and air pressure (bar) */
export function groundSpec(look: Look, R: number, gSurf: number, bar: number): GroundSpec {
  const st = look.style, real = look.real;
  // mountains stand as high as the rock can bear: about 10 km at 1 g, higher where gravity is weaker
  const byStyle: Record<string, number> = { ocean: 0.6, desert: 0.8, ice: 0.6, lava: 0.5, iron: 0.7 };
  let relief = real && RELIEF[real] !== undefined ? RELIEF[real]
    : Math.min(0.03 * R, 10000 * 9.81 / Math.max(gSurf, 0.3)) * (byStyle[st] ?? 1);
  if (R < 2e5) relief = Math.max(relief, 0.15 * R);
  const seas = real === 'Earth' || (!real && (st === 'terran' || st === 'ocean')) || real === 'Titan';
  const airy = real ? AIRY.has(real) : bar > 0.05;
  const craters = isGas(st) ? 0 : airy ? (real === 'Mars' ? 0.5 : 0.08) : st === 'lava' || real === 'Io' || real === 'Europa' || real === 'Enceladus' ? 0.15 : 1;
  const dunes = real === 'Titan' ? 0.8 : real === 'Mars' ? 0.35 : st === 'desert' ? 1 : real === 'Earth' ? 0.4 : 0;
  const spec: GroundSpec = { look, R, relief, seas, craters, dunes, lumpy: R < 2e5 ? 1 : 0, datum: 0.5, scale: 0 };
  calibrate(spec);
  return spec;
}

/** measure the painter's spread of heights, so its relief can be scaled to the real one */
function calibrate(s: GroundSpec) {
  const paint = groundPainter(s.look);
  const o: Tx = { r: 0, g: 0, b: 0, h: 0.5, e: 0, s: 0, c: 0 };
  const d = detailFor(256);
  const hs: number[] = [];
  let seaH = Infinity;
  // a golden-spiral set of points, the same every time
  const N = 1500;
  for (let k = 0; k < N; k++) {
    const z = 1 - (2 * (k + 0.5)) / N, rr = Math.sqrt(1 - z * z), ph = k * 2.399963229728653;
    const n: V3 = [rr * Math.cos(ph), rr * Math.sin(ph), z];
    o.h = 0.5; o.s = 0;
    paint(o, Math.asin(z), ((Math.atan2(n[1], n[0]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), n, d);
    if (s.seas && o.s >= 1) { seaH = Math.min(seaH, o.h); continue; }
    hs.push(o.h);
  }
  hs.sort((a, b) => a - b);
  const lo = hs[Math.floor(hs.length * 0.005)] ?? 0.4, hi = hs[Math.floor(hs.length * 0.995)] ?? 0.6;
  if (s.seas && isFinite(seaH)) {
    // sea level at the sea's painted height; the land rises from it
    s.datum = seaH;
    s.scale = (0.6 * s.relief) / Math.max(1e-3, hi - seaH);
  } else {
    s.datum = DATUM[s.look.real ?? ''] ?? hs[Math.floor(hs.length / 2)] ?? 0.5;
    // scaled so the spread of heights is the measured one (or a sixth of the full range): the
    // extremes — Olympus, Hellas, Maxwell — then fall where the painter's features put them.
    // A flat painter (a cloud-top map) gets its relief from the fractal instead
    const mean = hs.reduce((a, x) => a + x, 0) / Math.max(1, hs.length);
    const sd = Math.sqrt(hs.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, hs.length));
    const want = SIGMA[s.look.real ?? ''] ?? s.relief / 6;
    s.scale = SCALE[s.look.real ?? ''] ?? (sd > 0.003 && hi - lo > 0.01 ? Math.min(want / sd, (0.9 * s.relief) / (hi - lo)) : 0);
  }
}

// ------------------------------------------------------------------ the painters for the ground
/** the painter for the ground: the map's, or for a world whose map is its clouds, one of its own */
export function groundPainter(look: Look): (o: Tx, lat: number, lon: number, n: V3, d: { oct: number; craters: number; res: number }) => void {
  if (look.real === 'Venus') return venusGround;
  if (look.real === 'Titan') return titanGround;
  return pointPainter(look);
}

/** angular distance (deg) from a lat/lon (deg) */
function angTo(n: V3, lat: number, lon: number) {
  const c = Math.cos(lat * D);
  const x = c * Math.cos(lon * D), y = c * Math.sin(lon * D), z = Math.sin(lat * D);
  return Math.acos(Math.max(-1, Math.min(1, n[0] * x + n[1] * y + n[2] * z))) / D;
}
/** a soft blob: 1 at its middle, 0 beyond `r` degrees, frayed by noise */
function lump(n: V3, lat: number, lon: number, r: number, fray = 0.3) {
  const q = angTo(n, lat, lon) / r + (fbm(n[0] * 6 + lat, n[1] * 6, n[2] * 6, 4) - 0.5) * fray;
  return q >= 1 ? 0 : 0.5 + 0.5 * Math.cos(q * Math.PI);
}
const set = (o: Tx, r: number, g: number, b: number) => { o.r = r; o.g = g; o.b = b; };
const mix = (o: Tx, r: number, g: number, b: number, t: number) => { o.r += (r - o.r) * t; o.g += (g - o.g) * t; o.b += (b - o.b) * t; };

/** Venus under its clouds (Magellan radar): basalt plains, the highland continents, shield volcanoes, tesserae */
function venusGround(o: Tx, _lat: number, _lon: number, n: V3, d: { oct: number }) {
  const v = fbm(n[0] * 9, n[1] * 9, n[2] * 9, d.oct);
  set(o, 0.36 + 0.06 * v, 0.31 + 0.05 * v, 0.26 + 0.04 * v);
  let h = 0.5 + 0.06 * (v - 0.5);
  const ishtar = lump(n, 70, 10, 16), maxwell = lump(n, 65.2, 3.3, 4, 0.1);
  const aph = Math.max(lump(n, -5, 75, 18), lump(n, -8, 110, 20), lump(n, -12, 140, 16));
  const beta = lump(n, 25, -77, 9), atla = lump(n, 4, -160, 9);
  h += 0.1 * ishtar + 0.18 * maxwell + 0.06 * aph + 0.06 * beta + 0.06 * atla;
  // tesserae: ridged, crumpled highland
  const tes = ridged(n[0] * 20, n[1] * 20, n[2] * 20, d.oct);
  h += (aph + ishtar) * 0.06 * tes;
  // a few great shield volcanoes
  for (const [la, lo, r] of [[25.5, -80, 3], [21, -34, 3.5], [-6, -165, 3], [3, 26, 2.5], [9, -20, 2.5]] as const) h += 0.1 * lump(n, la, lo, r, 0.05);
  mix(o, 0.48, 0.42, 0.34, Math.min(1, (ishtar + aph) * 0.6 + tes * 0.15));
  o.h = h;
}

/** Titan under its haze (Cassini radar and VIMS): dark equatorial dunes, bright Xanadu, the northern seas */
function titanGround(o: Tx, _lat: number, _lon: number, n: V3, d: { oct: number }) {
  const latD = Math.asin(n[2]) / D;
  const v = fbm(n[0] * 8, n[1] * 8, n[2] * 8, d.oct);
  set(o, 0.46 + 0.08 * v, 0.34 + 0.06 * v, 0.2 + 0.04 * v);
  o.h = 0.5 + 0.08 * (v - 0.5);
  // the dune seas: dark organic sand within 30° of the equator
  const sand = Math.max(0, 1 - Math.abs(latD) / 30) * (0.6 + 0.5 * v);
  mix(o, 0.22, 0.16, 0.1, Math.min(1, sand));
  // Xanadu, bright and rugged
  const xan = lump(n, -10, 100, 22);
  mix(o, 0.66, 0.56, 0.42, xan);
  o.h += 0.12 * xan * ridged(n[0] * 18, n[1] * 18, n[2] * 18, d.oct);
  // the seas and lakes of liquid methane and ethane
  const sea = Math.max(lump(n, 68, -50, 9, 0.6), lump(n, 79, -112, 5, 0.6), lump(n, 85, -20, 3, 0.6), lump(n, 73, 60, 3, 0.8) * 0.9);
  const lakes = latD > 65 ? Math.max(0, fbm(n[0] * 30, n[1] * 30, n[2] * 30, 4) - 0.62) * 6 : 0;
  if (sea > 0.35 || lakes > 0.5) { set(o, 0.08, 0.07, 0.06); o.h = 0.44; o.s = 1; }
}

// ------------------------------------------------------------------ the height and colour at a point
export interface GroundSample {
  /** height above the datum (sea level, or the median), m */
  h: number;
  r: number; g: number; b: number;
  /** sea (flat, shiny) */
  sea: boolean;
  /** 0 smooth – 1 rocky, for scattering boulders */
  rock: number;
}

const tmp: Tx = { r: 0, g: 0, b: 0, h: 0.5, e: 0, s: 0, c: 0 };

/**
 * The ground in a direction `n` (unit, the body's own turning frame), with
 * detail down to `fine` metres. Fills `out` and returns its height.
 */
export function groundAt(s: GroundSpec, n: V3, fine: number, out: GroundSample, paint = groundPainter(s.look), det = detailFor(1024)): number {
  const lat = Math.asin(Math.max(-1, Math.min(1, n[2])));
  const lon = ((Math.atan2(n[1], n[0]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const o = tmp;
  o.r = o.g = o.b = 0.5; o.h = 0.5; o.e = 0; o.s = 0; o.c = 0;
  paint(o, lat, lon, n, det);
  const sea = s.seas && o.s >= 1;
  let h = (o.h - s.datum) * s.scale;
  // the point in metres, for the fractal: noise on the sphere, so nothing stretches at the poles
  const R = s.R, px = n[0] * R, py = n[1] * R, pz = n[2] * R;
  const seed = (s.look.seed % 997) * 13.7;
  // fractal hills: from a tenth of the relief at 30 km (less on a small world) down to the finest asked
  const top = Math.min(30000, R * 0.08), A0 = s.relief * (s.scale ? 0.035 : 0.1);
  let rough = 0;
  for (let lam = top, a = A0, k = 0; lam > fine && k < 18; lam *= 0.5, a *= 0.55, k++) {
    const q = 1 / lam;
    const v = k < 4 ? ridged(px * q + seed, py * q, pz * q, 1) - 0.5 : vnoise(px * q + seed + k * 7.1, py * q, pz * q) - 0.5;
    h += v * a * 2;
    if (lam < 50) rough += Math.abs(v);
  }
  if (s.lumpy) h += (fbm(n[0] * 2 + seed, n[1] * 2, n[2] * 2, 4) - 0.5) * R * 0.25;
  // craters at every scale: the big ones are in the map, these are what it cannot hold
  if (s.craters > 0 && !sea) h += craters(px, py, pz, Math.min(R * 0.02, 20000), Math.max(fine, 1), s.craters, seed);
  // dunes: long ridges across the wind, wandering
  if (s.dunes > 0 && !sea) {
    const sandy = o.r > o.b * 1.4 || s.look.real === 'Titan' ? 1 : 0.2;
    const w = fbm(px / 4000 + seed, py / 4000, pz / 4000, 3) * 6;
    const ph = (px * 0.8 + py * 0.6) / 320 + w;
    const ridge = Math.pow(Math.abs(Math.sin(ph)), 0.6);
    h += s.dunes * sandy * 25 * ridge * (0.5 + 0.5 * fbm(px / 9000, py / 9000 + seed, pz / 9000, 2));
  }
  if (sea) h = 0;
  // ground colour: the map's, with the grain of the soil and rock
  const grain = fbm(px / 37 + seed, py / 37, pz / 37, 3) - 0.5;
  const k = 1 + grain * 0.18;
  out.r = Math.min(1, o.r * k); out.g = Math.min(1, o.g * k); out.b = Math.min(1, o.b * k);
  out.h = h;
  out.sea = sea;
  out.rock = Math.min(1, rough * 0.6 + (s.craters > 0.5 ? 0.4 : 0.1));
  return h;
}

/** simple craters, fresh and old, in cells at each scale from `top` down to `fine` m; returns the height change */
function craters(px: number, py: number, pz: number, top: number, fine: number, density: number, seed: number) {
  let dh = 0;
  const sd = Math.floor(seed);
  for (let lam = top, k = 0; lam > fine * 2 && k < 14; lam *= 0.5, k++) {
    const q = 1 / lam;
    const cx = Math.floor(px * q), cy = Math.floor(py * q), cz = Math.floor(pz * q);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let l = -1; l <= 1; l++) {
      const X = cx + i, Y = cy + j, Z = cz + l;
      const h0 = hash(X + sd, Y + k * 131, Z);
      if (h0 > 0.28 * density) continue;
      const ox = (X + hash(X, Y + 7, Z + k)) * lam, oy = (Y + hash(X + 3, Y, Z + k)) * lam, oz = (Z + hash(X, Y, Z + 11 + k)) * lam;
      const rad = lam * (0.15 + 0.3 * hash(X + 5, Y + 5, Z + k));
      const dd = Math.sqrt((px - ox) ** 2 + (py - oy) ** 2 + (pz - oz) ** 2) / rad;
      if (dd > 2) continue;
      // older craters are shallower and softer
      const fresh = 0.25 + 0.75 * hash(X + 9, Y + 1, Z + k);
      const depth = 0.2 * 2 * rad * fresh, rim = 0.04 * 2 * rad * fresh;
      dh += dd < 1 ? rim - (depth + rim) * (1 - dd * dd) : rim * Math.pow((2 - dd), 3);
    }
  }
  return dh;
}

// ------------------------------------------------------------------ the patch
export interface PatchJob {
  id: number;
  spec: GroundSpec;
  /** the middle of the patch, unit, body frame */
  c: V3;
  /** innermost ring spacing and the patch's ground radius, m */
  r0: number; rMax: number;
  rings: number; segs: number;
}
export interface Patch {
  id: number;
  c: V3;
  /** vertices relative to the datum point under the middle (c·R), body frame, m */
  pos: Float32Array; nrm: Float32Array; col: Float32Array;
  /** extra per vertex: 1 for sea */
  sea: Float32Array;
  index: Uint32Array;
  /** height of the ground at the middle, m */
  h0: number;
  /** boulders to scatter: positions (as pos), sizes */
  rocks: Float32Array;
}

/** a tangent basis at a unit vector: east, north */
export function tangent(c: V3): [V3, V3] {
  let e: V3 = [-c[1], c[0], 0];
  const l = Math.hypot(e[0], e[1]);
  e = l > 1e-9 ? [e[0] / l, e[1] / l, 0] : [1, 0, 0];
  const nn: V3 = [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]];
  return [e, nn];
}

/**
 * Build the terrain round a point: rings at geometric spacing out from it, so
 * it is fine underfoot and coarse at the horizon, each vertex as detailed as
 * its spacing allows.
 */
export function buildPatch(job: PatchJob): Patch {
  const { spec: s, c, r0, rMax, rings: N, segs: S } = job;
  const R = s.R;
  const [e, nn] = tangent(c);
  const paint = groundPainter(s.look), det = detailFor(1024);
  const nv = (N + 1) * S;
  const P = new Float64Array(nv * 3);
  const col = new Float32Array(nv * 3), sea = new Float32Array(nv);
  const out: GroundSample = { h: 0, r: 0, g: 0, b: 0, sea: false, rock: 0 };
  const ratio = Math.pow(rMax / r0, 1 / (N - 1));
  const rocks: number[] = [];
  let h0 = 0;
  for (let i = 0; i <= N; i++) {
    const dist = i === 0 ? 0 : r0 * Math.pow(ratio, i - 1);
    const step = i === 0 ? r0 : dist * (ratio - 1);
    const fine = Math.max(0.4, 0.5 * Math.max(step, (2 * Math.PI * dist) / S));
    const th = dist / R, ct = Math.cos(th), st = Math.sin(th);
    for (let j = 0; j < S; j++) {
      const ph = (j / S) * 2 * Math.PI + (i % 2) * (Math.PI / S);
      const cp = Math.cos(ph), sp = Math.sin(ph);
      const n: V3 = [ct * c[0] + st * (cp * e[0] + sp * nn[0]), ct * c[1] + st * (cp * e[1] + sp * nn[1]), ct * c[2] + st * (cp * e[2] + sp * nn[2])];
      const h = groundAt(s, n, fine, out, paint, det);
      if (i === 0 && j === 0) h0 = h;
      const k = i * S + j, rr = R + h;
      P[k * 3] = n[0] * rr - c[0] * R; P[k * 3 + 1] = n[1] * rr - c[1] * R; P[k * 3 + 2] = n[2] * rr - c[2] * R;
      col[k * 3] = out.r; col[k * 3 + 1] = out.g; col[k * 3 + 2] = out.b;
      sea[k] = out.sea ? 1 : 0;
      // boulders on rocky ground, near the middle
      // (most small, a few big: a power law, as the boulder counts round lunar craters go)
      if (!out.sea && dist > 2 && dist < 400 && out.rock > 0.3 && hash(i * 31 + 7, j * 17 + 3, Math.floor(s.look.seed)) < out.rock * 0.06) {
        rocks.push(P[k * 3], P[k * 3 + 1], P[k * 3 + 2], Math.min(step, 3) * (0.08 + 0.5 * Math.pow(hash(i, j, 5), 3)) * out.rock);
      }
    }
  }
  // normals from the neighbours across and along the rings
  const nrm = new Float32Array(nv * 3);
  const at = (i: number, j: number) => ((Math.max(0, Math.min(N, i)) * S + ((j % S) + S) % S) * 3);
  for (let i = 0; i <= N; i++) for (let j = 0; j < S; j++) {
    const a = at(i + 1, j), b = at(i - 1, j), cc = at(i, j + 1), d = at(i, j - 1);
    let rx = P[a] - P[b], ry = P[a + 1] - P[b + 1], rz = P[a + 2] - P[b + 2];
    let tx = P[cc] - P[d], ty = P[cc + 1] - P[d + 1], tz = P[cc + 2] - P[d + 2];
    if (i === 0) {
      // the middle: the plain up
      const k = (i * S + j) * 3;
      const ux = c[0], uy = c[1], uz = c[2];
      const up0 = at(1, 0), up1 = at(1, Math.floor(S / 4)), up2 = at(1, Math.floor(S / 2)), up3 = at(1, Math.floor((3 * S) / 4));
      rx = P[up0] - P[up2]; ry = P[up0 + 1] - P[up2 + 1]; rz = P[up0 + 2] - P[up2 + 2];
      tx = P[up1] - P[up3]; ty = P[up1 + 1] - P[up3 + 1]; tz = P[up1 + 2] - P[up3 + 2];
      let x = ry * tz - rz * ty, y = rz * tx - rx * tz, z = rx * ty - ry * tx;
      if (x * ux + y * uy + z * uz < 0) { x = -x; y = -y; z = -z; }
      const l = Math.hypot(x, y, z) || 1;
      nrm[k] = x / l; nrm[k + 1] = y / l; nrm[k + 2] = z / l;
      continue;
    }
    let x = ry * tz - rz * ty, y = rz * tx - rx * tz, z = rx * ty - ry * tx;
    // outward
    const k = (i * S + j) * 3;
    const ox = P[k] + c[0] * R, oy = P[k + 1] + c[1] * R, oz = P[k + 2] + c[2] * R;
    if (x * ox + y * oy + z * oz < 0) { x = -x; y = -y; z = -z; }
    const l = Math.hypot(x, y, z) || 1;
    nrm[k] = x / l; nrm[k + 1] = y / l; nrm[k + 2] = z / l;
  }
  // triangles between each ring and the next
  const idx = new Uint32Array(N * S * 6);
  let q = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < S; j++) {
    const a = i * S + j, b = i * S + ((j + 1) % S), cc = (i + 1) * S + j, d = (i + 1) * S + ((j + 1) % S);
    idx[q++] = a; idx[q++] = cc; idx[q++] = b;
    idx[q++] = b; idx[q++] = cc; idx[q++] = d;
  }
  return { id: job.id, c, pos: Float32Array.from(P), nrm, col, sea, index: idx, h0, rocks: Float32Array.from(rocks) };
}

/** the patch radius and innermost spacing for a viewer `alt` m above the ground of a world of radius R and relief */
export function patchSize(alt: number, R: number, relief: number) {
  const a = Math.max(1, alt);
  const horizon = Math.sqrt(2 * R * (a + relief)) * 1.3 + 3000;
  return { r0: Math.max(0.5, a * 0.03), rMax: Math.min(R * 1.4, horizon) };
}
