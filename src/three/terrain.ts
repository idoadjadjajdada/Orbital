import type { Look } from '../physics/body';
import { pointPainter, detailFor } from '../pixel/surface';
import { fbm, ridged, vnoise, hash } from '../pixel/noise';
import { earthRough } from '../pixel/worlds';
import { peaksOn, type PeakShape } from './peaks';
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
  /** a made-up world's mountain belts, 0 (none) – 1 (great folded ranges, as where plates meet) */
  belts: number;
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
const SCALE: Record<string, number> = { Moon: 22000, Venus: 35000, Mars: 40000, Earth: 40000 };
/** painted height of the datum, where the painter's heights are measured from one (Mars: the areoid) */
const DATUM: Record<string, number> = { Mars: 0.5, Earth: 0.5 };

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
  // a made-up rocky world's ranges: folded belts where its crust is pushed together, fewer on ice, none on a rubble pile
  const belts = real || isGas(st) || R < 2e5 ? 0 : ({ terran: 1, ocean: 0.8, desert: 0.9, lava: 0.7, iron: 0.8, ice: 0.5 } as Record<string, number>)[st] ?? 0.4;
  const spec: GroundSpec = { look, R, relief, seas, craters, dunes, lumpy: R < 2e5 ? 1 : 0, belts, datum: 0.5, scale: 0 };
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
  if (s.seas && isFinite(seaH) && SCALE[s.look.real ?? ''] === undefined) {
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
  let h = groundBase(s, n, fine, out, paint, det);
  const real = s.look.real, map = painted;
  if (real && !out.sea) {
    // the named mountains, raised to their heights
    for (const pk of peaksFor(real)) {
      const c = pk.c, dt = n[0] * c[0] + n[1] * c[1] + n[2] * c[2];
      if (dt < pk.cosR) continue;
      const d = Math.acos(Math.min(1, dt)) * s.R / 1000;
      if (pk.name === 'Olympus Mons') { h = olympus(h, d, n, pk, map); continue; }
      const q = d / pk.r;
      // the bearing round the summit, for a horn's ridges
      const [e, nn] = pk.t, mx = n[0] - c[0], my = n[1] - c[1], mz = n[2] - c[2];
      const th = Math.atan2(mx * nn[0] + my * nn[1] + mz * nn[2], mx * e[0] + my * e[1] + mz * e[2]);
      const base = pk.rise === undefined ? peakBase(s, pk, fine, paint, det) : 0;
      const rise = Math.max(0, pk.rise ?? (pk.h! - base)), shp = peakShape(pk.shape, q, th + pk.spin);
      h += rise * shp;
      // nothing on its slopes stands over the summit: the ground is held under an envelope a little above
      // the mountain's own shape (a neighbouring top can come close, as Lhotse does to Everest)
      if (pk.h !== undefined && q < 1) {
        const cap = pk.h - rise * (1 - shp) * 0.3 * (1 - smooth01(0.7, 1, q)) + smooth01(0.7, 1, q) * 1e4;
        if (h > cap) h = cap + (h - cap) * 0.08;
      }
    }
  }
  if (!out.sea) zones(s, n, h, out);
  out.h = h;
  return h;
}

interface PeakAt { name: string; shape: PeakShape; r: number; h?: number; rise?: number; c: V3; cosR: number; t: [V3, V3]; spin: number }
const peakCache = new Map<string, PeakAt[]>();
function peaksFor(real: string): PeakAt[] {
  let l = peakCache.get(real);
  if (!l) {
    l = peaksOn(real).map(k => {
      const c = dirFrom(k.lat, k.lon);
      return { name: k.name, shape: k.shape, r: k.r, h: k.h, rise: k.rise, c, cosR: Math.cos(((k.name === 'Olympus Mons' ? 1.25 : 1) * k.r * 1000) / radiusOf(real)), t: tangent(c), spin: k.lat * 7.3 + k.lon };
    });
    peakCache.set(real, l);
  }
  return l;
}
/** the radius of a real world, m, for the peaks' reach (the near-enough test only) */
const radiusOf = (real: string) => ({ Earth: 6.371e6, Mars: 3.3895e6, Moon: 1.7374e6 } as Record<string, number>)[real] ?? 3e6;
const dirFrom = (lat: number, lon: number): V3 => [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];

/** the height the ground would have at a mountain's summit without it (so the summit comes out at its measured height) */
const baseCache = new Map<string, number>();
function peakBase(s: GroundSpec, pk: PeakAt, fine: number, paint: ReturnType<typeof groundPainter>, det: { oct: number; craters: number; res: number }) {
  const key = `${s.look.real}|${pk.name}|${fine}`;
  let v = baseCache.get(key);
  if (v === undefined) {
    v = groundBase(s, pk.c, fine, { h: 0, r: 0, g: 0, b: 0, sea: false, rock: 0 }, paint, det);
    if (baseCache.size > 4000) baseCache.clear();
    baseCache.set(key, v);
  }
  return v;
}

/** a mountain's shape: 1 at its summit, 0 at the foot of its slopes (q = 1); th the bearing round it */
function peakShape(shape: PeakShape, q: number, th: number) {
  if (q >= 1) return 0;
  const foot = 1 - smooth01(0.8, 1, q);
  switch (shape) {
    case 'horn': {
      // a pyramid: steep faces between four sharp arêtes, carved deeper the further from the top
      const ridge = Math.pow(Math.abs(Math.cos(2 * th)), 0.5);
      return Math.pow(1 - q, 1.7) * (1 - 0.45 * Math.pow(q, 0.7) * (1 - ridge)) * foot;
    }
    case 'massif': {
      const ridge = Math.pow(Math.abs(Math.cos(1.5 * th)), 0.6);
      return Math.pow(1 - q * q, 2) * (1 - 0.25 * q * (1 - ridge)) * foot;
    }
    case 'cone': {
      // a stratovolcano's concave slopes, steepening to the top, and a crater in it
      const rc = 0.02, k = 3.2, e1 = Math.exp(-k);
      if (q < rc) return 1 - 0.07 * (1 - (q / rc) ** 2);
      return (Math.exp(-k * q) - e1) / (Math.exp(-k * rc) - e1) * foot;
    }
    case 'shield': {
      // a broad, gently convex swell with a caldera at the top
      const rc = 0.04;
      if (q < rc) return 1 - 0.04 * (1 - (q / rc) ** 2);
      return Math.pow(Math.cos(((q - rc) / (1 - rc)) * Math.PI / 2), 1.1) * foot;
    }
    case 'inselberg':
      // sheer sides, a rounded top
      return (1 - 0.12 * q * q) * (1 - smooth01(0.82, 1, q));
  }
}

/**
 * Olympus Mons, whole: the nested pits of its caldera, the long shield, and
 * the escarpment round its foot, cliffs up to 8 km high, then the plains.
 * `d` is the distance from its middle, km; the measured map takes over beyond.
 */
function olympus(h: number, d: number, n: V3, pk: PeakAt, painted: number) {
  // the second, younger pit of the caldera, off to the south-west
  const [e, nn] = pk.t, c = pk.c;
  const mx = n[0] - c[0], my = n[1] - c[1], mz = n[2] - c[2], k = 3389.5;
  const x = (mx * e[0] + my * e[1] + mz * e[2]) * k, y = (mx * nn[0] + my * nn[1] + mz * nn[2]) * k;
  const d2 = Math.hypot(x + 14, y + 10);
  // the escarpment wanders in and out, as the real one does
  const scarp = 280 + 18 * Math.sin(Math.atan2(y, x) * 3 + 1) + 9 * Math.sin(Math.atan2(y, x) * 7);
  let H: number;
  if (d < 30) H = 21.3 - 2.8 * (1 - smooth01(20, 30, d)) - 0.6 * (1 - smooth01(0, 14, d2));
  else if (d < 40) H = 21.9 - 0.6 * smooth01(30, 40, d);
  else if (d < scarp) H = 21.3 - 12.6 * Math.pow((d - 40) / (scarp - 40), 1.25);
  else H = 8.7 - 7.4 * smooth01(scarp, scarp + 14, d);
  const w = 1 - smooth01(scarp + 20, scarp + 70, d);
  // the map's own Olympus is a smooth blur of this: keep the ground's small detail, swap the large shape
  return h + (H * 1000 - painted) * w;
}

/** altitude zones on a world with weather: trees give way to bare rock, rock to snow, lower toward the poles */
function zones(s: GroundSpec, n: V3, h: number, out: GroundSample) {
  const real = s.look.real;
  if (real !== 'Earth' && !(s.seas && !real)) return;
  const alat = Math.abs(Math.asin(Math.max(-1, Math.min(1, n[2])))) / D;
  const wob = (vnoise(n[0] * 9000, n[1] * 9000, n[2] * 9000) - 0.5) * 500;
  const tree = 3800 - 55 * Math.max(0, alat - 15) + wob, snow = 5200 - 75 * Math.max(0, alat - 20) + wob * 1.6;
  const rk = smooth01(tree, tree + 500, h);
  if (rk > 0) {
    const g = 0.4 + 0.08 * (vnoise(n[0] * 40000, n[1] * 40000, n[2] * 40000) - 0.5);
    out.r += (g * 1.04 - out.r) * rk * 0.8; out.g += (g - out.g) * rk * 0.8; out.b += (g * 0.92 - out.b) * rk * 0.8;
    out.rock = Math.max(out.rock, rk * 0.7);
  }
  const sn = smooth01(snow - 200, snow + 300, h);
  if (sn > 0) { out.r += (0.92 - out.r) * sn; out.g += (0.94 - out.g) * sn; out.b += (0.97 - out.b) * sn; out.rock *= 1 - sn; }
}
const smooth01 = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** the height the map alone gave the last point asked (m) */
let painted = 0;

/** the ground without the named mountains: the map's heights, the fractal, craters and dunes */
function groundBase(s: GroundSpec, n: V3, fine: number, out: GroundSample, paint: ReturnType<typeof groundPainter>, det: { oct: number; craters: number; res: number }): number {
  const lat = Math.asin(Math.max(-1, Math.min(1, n[2])));
  const lon = ((Math.atan2(n[1], n[0]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const o = tmp;
  o.r = o.g = o.b = 0.5; o.h = 0.5; o.e = 0; o.s = 0; o.c = 0;
  paint(o, lat, lon, n, det);
  const sea = s.seas && o.s >= 1;
  let h = (o.h - s.datum) * s.scale;
  painted = h;
  // the point in metres, for the fractal: noise on the sphere, so nothing stretches at the poles
  const R = s.R, px = n[0] * R, py = n[1] * R, pz = n[2] * R;
  const seed = (s.look.seed % 997) * 13.7;
  // how rugged the ground is here: the Earth's from its measured relief (the Himalaya jagged, the plains
  // gentle), a made-up world's from its mountain belts; elsewhere the same everywhere
  let rug = 1;
  if (s.look.real === 'Earth') {
    const lonE = lon / D > 180 ? lon / D - 360 : lon / D, r = earthRough(lat / D, lonE);
    rug = r < 0 ? 0.6 : Math.min(4.5, 0.1 + r / 250);
  } else if (s.belts > 0 && !sea) {
    // folded ranges along the seams of a slowly wandering field, like ranges along plate boundaries
    const w = fbm(n[0] * 1.3 + seed, n[1] * 1.3, n[2] * 1.3, 3) * 2;
    const b = Math.pow(ridged(n[0] * 2.2 + w + seed, n[1] * 2.2 - w, n[2] * 2.2 + w, 3), 6) * s.belts;
    h += b * s.relief * 0.55 * (0.6 + 0.8 * ridged(px / 60000 + seed, py / 60000, pz / 60000, 2));
    rug = 0.35 + 2.2 * b;
  }
  // fractal hills: from a tenth of the relief at 30 km (less on a small world) down to the finest asked
  const top = Math.min(30000, R * 0.08), A0 = s.relief * (s.scale ? 0.035 : 0.1) * rug;
  let rough = 0;
  for (let lam = top, a = A0, k = 0; lam > fine && k < 18; lam *= 0.5, a *= 0.55, k++) {
    const q = 1 / lam;
    let v: number;
    if (k < 4) {
      // the big ridges; in rugged country sharper, with broad glacier-cut valleys between
      const rd = ridged(px * q + seed, py * q, pz * q, 1), al = Math.min(1, Math.max(0, rug - 1));
      v = rd - 0.5 + al * (rd * rd - rd + 0.17);
    } else v = vnoise(px * q + seed + k * 7.1, py * q, pz * q) - 0.5;
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
  // the Earth's only tops over 8 km are its named 8000ers: the fractal does not make new ones
  if (s.look.real === 'Earth' && h > 8000) h = 8000 + (h - 8000) * 0.3;
  // ground colour: the map's, with the grain of the soil and rock
  const grain = fbm(px / 37 + seed, py / 37, pz / 37, 3) - 0.5;
  const k = 1 + grain * 0.18;
  out.r = Math.min(1, o.r * k); out.g = Math.min(1, o.g * k); out.b = Math.min(1, o.b * k);
  out.h = h;
  out.sea = sea;
  out.rock = Math.min(1, rough * 0.6 * Math.min(1.5, rug) + (s.craters > 0.5 ? 0.4 : 0.1));
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

// ------------------------------------------------------------------ the tiles
/**
 * The ground is a fixed lattice of tiles on a cube round the world, each face
 * split into quarters, and those into quarters, as far as is needed: coarse
 * far off, down to half a metre underfoot. A tile is always the same tile — the
 * same corners, the same vertices, the same heights — wherever the viewer is,
 * so nothing shifts as you walk; nearer, a tile is replaced by its four finer
 * children. Faces: +x, −x, +y, −y, +z, −z, each with its own across (U) and up
 * (V) axes, a and b running −1..1 over the face (tan-warped, so tiles are about
 * as wide at the face's edge as at its middle).
 */
const FACES: [V3, V3, V3][] = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, -1, 0], [0, 0, 1]],
  [[0, 1, 0], [-1, 0, 0], [0, 0, 1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [0, 1, 0], [-1, 0, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
];
/** quads along a tile's side */
export const TILE_N = 32;

/** the unit direction at face coordinates (a, b) of face f */
export function faceDir(f: number, a: number, b: number): V3 {
  const [F, U, V] = FACES[f];
  const ta = Math.tan(a * Math.PI / 4), tb = Math.tan(b * Math.PI / 4);
  const x = F[0] + ta * U[0] + tb * V[0], y = F[1] + ta * U[1] + tb * V[1], z = F[2] + ta * U[2] + tb * V[2];
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** which face a direction is on, and where on it (a, b in −1..1) */
export function faceOf(n: V3): [number, number, number] {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const f = ax >= ay && ax >= az ? (n[0] > 0 ? 0 : 1) : ay >= az ? (n[1] > 0 ? 2 : 3) : (n[2] > 0 ? 4 : 5);
  const [F, U, V] = FACES[f];
  const d = n[0] * F[0] + n[1] * F[1] + n[2] * F[2];
  const u = (n[0] * U[0] + n[1] * U[1] + n[2] * U[2]) / d, v = (n[0] * V[0] + n[1] * V[1] + n[2] * V[2]) / d;
  return [f, Math.atan(u) * 4 / Math.PI, Math.atan(v) * 4 / Math.PI];
}

/** a tile's corners in face coordinates: level L, column x, row y */
export function tileRange(L: number, x: number, y: number) {
  const k = 2 / 2 ** L;
  return { a0: -1 + x * k, b0: -1 + y * k, k };
}

export interface TileJob { key: string; spec: GroundSpec; f: number; L: number; x: number; y: number }
export interface Tile {
  key: string; f: number; L: number; x: number; y: number;
  /** the tile's middle (unit, body frame); vertices are relative to its point on the datum, m */
  c: V3;
  pos: Float32Array; nrm: Float32Array; col: Float32Array; sea: Float32Array; index: Uint32Array;
  /** how rocky each vertex is (0 soil, sand or ice – 1 bare rock), for the ground's close-up texture */
  rock: Float32Array;
  /** vertex spacing, m */
  spacing: number;
  /** boulders: position (as pos), size, colour, and a number of its own (for how it lies) — 8 numbers each */
  rocks: Float32Array;
}

/**
 * Build a tile: a (N+1)² grid of vertices, each as detailed as the grid's
 * spacing allows, with a skirt round its edge dropped down out of sight to
 * hide the seams where a finer tile meets a coarser one. Normals are taken
 * from a ring of samples beyond the edge too, so they match across seams.
 */
export function buildTile(job: TileJob): Tile {
  const { spec: s, f, L, x, y } = job;
  const N = TILE_N, R = s.R;
  const { a0, b0, k } = tileRange(L, x, y);
  const c = faceDir(f, a0 + k / 2, b0 + k / 2);
  const spacing = (R * (Math.PI / 2) / 2 ** L) / N;
  const fine = Math.max(0.4, spacing * 0.5);
  const paint = groundPainter(s.look), det = detailFor(1024);
  const out: GroundSample = { h: 0, r: 0, g: 0, b: 0, sea: false, rock: 0 };
  // samples on a grid one wider all round, for the normals
  const M = N + 3;
  const P = new Float64Array(M * M * 3), C = new Float32Array(M * M * 3), SEA = new Float32Array(M * M), ROCK = new Float32Array(M * M);
  const cx = c[0] * R, cy = c[1] * R, cz = c[2] * R;
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const n = faceDir(f, a0 + (i - 1) / N * k, b0 + (j - 1) / N * k);
    const h = groundAt(s, n, fine, out, paint, det);
    const q = j * M + i, rr = R + h;
    P[q * 3] = n[0] * rr - cx; P[q * 3 + 1] = n[1] * rr - cy; P[q * 3 + 2] = n[2] * rr - cz;
    C[q * 3] = out.r; C[q * 3 + 1] = out.g; C[q * 3 + 2] = out.b;
    SEA[q] = out.sea ? 1 : 0; ROCK[q] = out.sea ? 0 : out.rock;
  }
  // the grid proper, and the skirt: one more ring of vertices under the edge
  const nv = (N + 1) * (N + 1), ns = 4 * N;
  const pos = new Float32Array((nv + ns) * 3), nrm = new Float32Array((nv + ns) * 3), col = new Float32Array((nv + ns) * 3), sea = new Float32Array(nv + ns), rockv = new Float32Array(nv + ns);
  const rocks: number[] = [];
  const at = (i: number, j: number) => ((j + 1) * M + (i + 1)) * 3;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const v = j * (N + 1) + i, q = at(i, j);
    pos[v * 3] = P[q]; pos[v * 3 + 1] = P[q + 1]; pos[v * 3 + 2] = P[q + 2];
    const e = at(i + 1, j), w = at(i - 1, j), nN = at(i, j + 1), sS = at(i, j - 1);
    const rx = P[e] - P[w], ry = P[e + 1] - P[w + 1], rz = P[e + 2] - P[w + 2];
    const tx = P[nN] - P[sS], ty = P[nN + 1] - P[sS + 1], tz = P[nN + 2] - P[sS + 2];
    let nx = ry * tz - rz * ty, ny = rz * tx - rx * tz, nz = rx * ty - ry * tx;
    const ox = P[q] + cx, oy = P[q + 1] + cy, oz = P[q + 2] + cz;
    if (nx * ox + ny * oy + nz * oz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm[v * 3] = nx / l; nrm[v * 3 + 1] = ny / l; nrm[v * 3 + 2] = nz / l;
    const qq = q / 3;
    col[v * 3] = C[q]; col[v * 3 + 1] = C[q + 1]; col[v * 3 + 2] = C[q + 2];
    // steep ground sheds its snow and soil: cliffs and crags of bare rock
    const up = (nrm[v * 3] * ox + nrm[v * 3 + 1] * oy + nrm[v * 3 + 2] * oz) / (Math.hypot(ox, oy, oz) || 1);
    if (up < 0.85 && !SEA[qq]) {
      const lum = (C[q] + C[q + 1] + C[q + 2]) / 3, snowy = smooth01(0.7, 0.85, lum);
      // (snow clings up to about 45°; soil and plants slide off sooner)
      const t = snowy > 0 ? smooth01(0.74, 0.55, up) * (0.6 + 0.4 * snowy) : smooth01(0.85, 0.6, up) * 0.6;
      const rr = 0.36 + 0.25 * (C[q] - lum), rg = 0.34, rb = 0.31 - 0.2 * (C[q] - lum);
      const g = lum < 0.5 ? lum * 0.8 + 0.12 : 1;
      col[v * 3] += (rr * g - col[v * 3]) * t; col[v * 3 + 1] += (rg * g - col[v * 3 + 1]) * t; col[v * 3 + 2] += (rb * g - col[v * 3 + 2]) * t;
      ROCK[qq] = Math.max(ROCK[qq], t);
    }
    sea[v] = SEA[qq];
    rockv[v] = ROCK[qq];
  }
  // boulders: on a lattice fixed to the world (a cell every 2 m), each cell's own hash and its own ground
  // deciding whether it holds one and how big, so the same boulder is in the same place whichever tile
  // draws it; set on the tile's surface, so it neither floats nor sinks (most small, a few big: a power law)
  if (spacing < 6) {
    const LR = Math.max(L, Math.round(Math.log2((R * Math.PI / 2) / 2))), kc = 2 / 2 ** LR, per = 2 ** (LR - L);
    const i0 = Math.round((a0 + 1) / kc), j0 = Math.round((b0 + 1) / kc), sd = Math.floor(s.look.seed);
    const rs: GroundSample = { h: 0, r: 0, g: 0, b: 0, sea: false, rock: 0 };
    for (let jj = 0; jj < per; jj++) for (let ii = 0; ii < per; ii++) {
      const ci = i0 + ii, cj = j0 + jj;
      const hk = hash(ci * 7 + f * 131, cj * 13 + 7, sd + 17);
      if (hk > 0.09) continue;
      const ua = (ii + 0.15 + 0.7 * hash(ci, cj, sd + 3)) / per, vb = (jj + 0.15 + 0.7 * hash(cj, ci, sd + 5)) / per;
      groundAt(s, faceDir(f, a0 + ua * k, b0 + vb * k), 2, rs, paint, det);
      if (rs.sea || rs.rock < 0.3 || hk > rs.rock * 0.09) continue;
      const sz = (0.08 + 0.55 * Math.pow(hash(ci + 9, cj + 4, sd), 3)) * rs.rock * 2.2;
      // the tile's surface there, from its grid
      const gx = ua * N, gy = vb * N, ix = Math.min(N - 1, Math.floor(gx)), iy = Math.min(N - 1, Math.floor(gy)), fx = gx - ix, fy = gy - iy;
      const q00 = at(ix, iy), q10 = at(ix + 1, iy), q01 = at(ix, iy + 1), q11 = at(ix + 1, iy + 1);
      const lerp = (o: number) => (P[q00 + o] * (1 - fx) + P[q10 + o] * fx) * (1 - fy) + (P[q01 + o] * (1 - fx) + P[q11 + o] * fx) * fy;
      rocks.push(lerp(0), lerp(1), lerp(2), sz, C[q00] * 0.7, C[q00 + 1] * 0.7, C[q00 + 2] * 0.7, (ci * 7919 + cj * 104729) % 100003);
    }
  }
  // the skirt: the edge's vertices again, lowered along the up, round the tile in order
  const edge: number[] = [];
  for (let i = 0; i < N; i++) edge.push(i);
  for (let j = 0; j < N; j++) edge.push(j * (N + 1) + N);
  for (let i = N; i > 0; i--) edge.push(N * (N + 1) + i);
  for (let j = N; j > 0; j--) edge.push(j * (N + 1));
  // deep enough to cover the step to a neighbour one level finer (the detail between the two is a few
  // tenths of the spacing high), and no deeper: every pixel of it is shaded
  const drop = 0.5 + spacing * 0.4;
  edge.forEach((v, e) => {
    const t = nv + e;
    const ox = pos[v * 3] + cx, oy = pos[v * 3 + 1] + cy, oz = pos[v * 3 + 2] + cz, ol = Math.hypot(ox, oy, oz);
    pos[t * 3] = pos[v * 3] - ox / ol * drop; pos[t * 3 + 1] = pos[v * 3 + 1] - oy / ol * drop; pos[t * 3 + 2] = pos[v * 3 + 2] - oz / ol * drop;
    nrm[t * 3] = nrm[v * 3]; nrm[t * 3 + 1] = nrm[v * 3 + 1]; nrm[t * 3 + 2] = nrm[v * 3 + 2];
    col[t * 3] = col[v * 3]; col[t * 3 + 1] = col[v * 3 + 1]; col[t * 3 + 2] = col[v * 3 + 2];
    sea[t] = sea[v];
    rockv[t] = rockv[v];
  });
  const idx = new Uint32Array(N * N * 6 + ns * 6);
  let q = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, cc = a + (N + 1), d = cc + 1;
    // (the diagonal alternates, so ridges do not all run one way)
    if ((i + j) & 1) { idx[q++] = a; idx[q++] = b; idx[q++] = d; idx[q++] = a; idx[q++] = d; idx[q++] = cc; }
    else { idx[q++] = a; idx[q++] = b; idx[q++] = cc; idx[q++] = b; idx[q++] = d; idx[q++] = cc; }
  }
  for (let e = 0; e < ns; e++) {
    const v0 = edge[e], v1 = edge[(e + 1) % ns], s0 = nv + e, s1 = nv + (e + 1) % ns;
    // facing out of the tile, toward the seam it covers
    idx[q++] = v0; idx[q++] = s0; idx[q++] = v1; idx[q++] = v1; idx[q++] = s0; idx[q++] = s1;
  }
  return { key: job.key, f, L, x, y, c, pos, nrm, col, sea, rock: rockv, index: idx.slice(0, q), spacing, rocks: Float32Array.from(rocks) };
}

/** a tangent basis at a unit vector: east, north */
export function tangent(c: V3): [V3, V3] {
  let e: V3 = [-c[1], c[0], 0];
  const l = Math.hypot(e[0], e[1]);
  e = l > 1e-9 ? [e[0] / l, e[1] / l, 0] : [1, 0, 0];
  const nn: V3 = [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]];
  return [e, nn];
}

