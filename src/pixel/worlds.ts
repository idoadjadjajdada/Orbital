import { fbm, ridged, vnoise, hash } from './noise';
import { EARTH_RLE, EARTH_W, EARTH_H } from './data/earth';
import { MARS, type MarsData } from './marsdata';

/**
 * The real worlds, painted from what is known of them. Each painter is asked
 * for one point of the surface — latitude, east longitude, the unit vector in
 * the body's frame — and fills in its colour, height, glow, shine and cloud.
 * Features sit at their real coordinates and sizes (the IAU nomenclature and
 * the spacecraft maps): the Moon's maria and rayed craters, Mars' volcanoes,
 * canyon and dark albedo markings, Jupiter's belts and the Great Red Spot,
 * Pluto's heart. The Earth's coasts, ice sheets, deserts, mountains and
 * tundra come from Natural Earth. What is not mapped is filled in with noise
 * of the right character: crater fields on old surfaces, turbulence in
 * clouds.
 */

export type V3 = [number, number, number];

/** one texel: colour 0–1, height (0.5 is the datum), glow, shine, cloud cover */
export interface Tx { r: number; g: number; b: number; h: number; e: number; s: number; c: number }
/** how finely to paint: noise octaves and crater scales, from the map's size */
export interface Detail { oct: number; craters: number; res: number }
export type Painter = (o: Tx, lat: number, lon: number, n: V3, d: Detail) => void;

const D = Math.PI / 180;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const ss = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hex = (c: number): V3 => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
const set = (o: Tx, c: V3) => { o.r = c[0]; o.g = c[1]; o.b = c[2]; };
const mixTo = (o: Tx, c: V3, t: number) => { if (t <= 0) return; o.r += (c[0] - o.r) * t; o.g += (c[1] - o.g) * t; o.b += (c[2] - o.b) * t; };
const shade = (o: Tx, k: number) => { o.r *= k; o.g *= k; o.b *= k; };

/** longitude difference, degrees, in −180..180 */
const dlon = (a: number, b: number) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

/**
 * how far a point is inside an elliptical feature: 0 at its centre, 1 at its
 * edge. Centre and half-sizes in degrees; the edge is roughened by noise
 */
function blob(latD: number, lonD: number, n: V3, c: { lat: number; lon: number; a: number; b?: number; rough?: number; seed?: number }) {
  const dy = (latD - c.lat) / (c.b ?? c.a);
  const dx = (dlon(lonD, c.lon) * Math.cos(c.lat * D)) / c.a;
  let d = Math.hypot(dx, dy);
  // the ragged edge costs noise, so only near the edge
  if (c.rough && d < 1 + c.rough * 1.3) d += (fbm(n[0] * 5 + (c.seed ?? 0), n[1] * 5, n[2] * 5, 5) - 0.5) * c.rough * 2.6;
  return d;
}

/** angle between a point and a direction, degrees */
function angTo(n: V3, latD: number, lonD: number) {
  const cl = Math.cos(latD * D);
  const dot = n[0] * cl * Math.cos(lonD * D) + n[1] * cl * Math.sin(lonD * D) + n[2] * Math.sin(latD * D);
  return Math.acos(Math.max(-1, Math.min(1, dot))) / D;
}

/**
 * Craters of every size, as old surfaces have them: in each cell of a lattice
 * round the sphere, maybe a crater, its size drawn from a steep power law.
 * Returns the height change and a brightness change (fresh rims and ejecta
 * are bright, old floors dark), summed over `scales` sizes.
 */
function craterField(n: V3, scales: number, base: number, density: number, seed: number) {
  let dh = 0, db = 0;
  for (let s = 0; s < scales; s++) {
    const f = base * Math.pow(2.6, s);
    const px = n[0] * f + seed * 13.1, py = n[1] * f + seed * 7.7, pz = n[2] * f + seed * 3.3;
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    // a crater reaches less than half a cell from its centre, so only the eight nearest cells matter
    const sx = px - ix < 0.5 ? -1 : 1, sy = py - iy < 0.5 ? -1 : 1, sz = pz - iz < 0.5 ? -1 : 1;
    const amp = 1 / Math.pow(1.6, s);
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
      const cx = ix + a * sx, cy = iy + b * sy, cz = iz + c * sz;
      const h0 = hash(cx, cy, cz + s * 101);
      if (h0 > density) continue;
      const qx = cx + hash(cx + 17, cy, cz), qy = cy + hash(cx, cy + 31, cz), qz = cz + hash(cx, cy, cz + 47);
      const r = 0.1 + 0.25 * Math.pow(hash(cx + 5, cy + 9, cz + 2), 3);
      const dd = Math.hypot(px - qx, py - qy, pz - qz) / r;
      if (dd > 1.4) continue;
      const fresh = hash(cx + 3, cy + 1, cz + 8) < 0.12;
      if (dd < 1) { dh -= (1 - dd * dd) * 0.08 * amp * r * 3; db -= 0.05 * amp; }
      const rim = Math.exp(-(((dd - 1) / 0.18) ** 2));
      dh += rim * 0.04 * amp * r * 3;
      db += rim * 0.05 * amp + (fresh ? 0.18 * amp * Math.max(0, 1 - Math.max(0, dd - 0.9) / 0.7) : 0);
    }
  }
  return { dh, db };
}

/** a bright young crater with rays thrown far across the surface */
function rayed(o: Tx, n: V3, lat: number, lon: number, rDeg: number, reach: number, k = 1) {
  const a = angTo(n, lat, lon);
  if (a > rDeg * reach) return;
  const q = a / rDeg;
  if (q < 1) { o.h -= 0.06 * (1 - q * q); mixTo(o, [0.92, 0.92, 0.9], 0.55 * k); return; }
  // the rays: thin streaks radiating out, fading with distance
  const cl = Math.cos(lat * D);
  const ex = [-Math.sin(lon * D), Math.cos(lon * D), 0];
  const ny = [-Math.sin(lat * D) * Math.cos(lon * D), -Math.sin(lat * D) * Math.sin(lon * D), cl];
  const az = Math.atan2(n[0] * ny[0] + n[1] * ny[1] + n[2] * ny[2], n[0] * ex[0] + n[1] * ex[1] + n[2] * ex[2]);
  const streak = Math.pow(vnoise(az * 9 + lat, lon * 0.1, 3), 4) * 3;
  const fade = Math.max(0, 1 - (q - 1) / (reach - 1));
  const blanket = q < 2.5 ? 0.45 * (1 - (q - 1) / 1.5) : 0;
  if (q < 1.25) o.h += 0.03 * (1 - Math.abs(q - 1.1) / 0.15);
  mixTo(o, [0.88, 0.88, 0.86], Math.min(0.6, (blanket + streak * fade * fade) * k));
}

// ------------------------------------------------------------------ Earth
let earthCls: Uint8Array | null = null;
let earthShelf: Float32Array | null = null;
let earthInland: Float32Array | null = null;
let earthDesert: Float32Array | null = null;
let earthMount: Float32Array | null = null;
const SW = 256, SH = 128;

function earthData() {
  if (earthCls) return;
  const bin = atob(EARTH_RLE);
  const cls = new Uint8Array(EARTH_W * EARTH_H);
  let k = 0;
  for (let i = 0; i < bin.length; i += 2) { const c = bin.charCodeAt(i), n = bin.charCodeAt(i + 1); cls.fill(c, k, k + n); k += n; }
  earthCls = cls;
  // what fraction of each cell, at a quarter of the resolution, is land, desert, mountains; then blurred
  const frac = (want: (c: number) => boolean) => {
    const f = new Float32Array(SW * SH), sx = EARTH_W / SW, sy = EARTH_H / SH;
    for (let j = 0; j < SH; j++) for (let i = 0; i < SW; i++) {
      let s = 0;
      for (let b = 0; b < sy; b++) for (let a = 0; a < sx; a++) s += want(cls[(j * sy + b) * EARTH_W + i * sx + a]) ? 1 : 0;
      f[j * SW + i] = s / (sx * sy);
    }
    return f;
  };
  const land = frac(c => c !== 0 && c !== 4);
  earthShelf = blur(land, 2);
  earthInland = blur(land, 9);
  earthDesert = blur(frac(c => c === 3), 1);
  earthMount = blur(frac(c => c === 5), 1);
}

function blur(src: Float32Array, r: number) {
  const a = new Float32Array(src.length), b = new Float32Array(src.length);
  for (let j = 0; j < SH; j++) for (let i = 0; i < SW; i++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += src[j * SW + ((i + d + SW) % SW)];
    a[j * SW + i] = s / (2 * r + 1);
  }
  for (let j = 0; j < SH; j++) for (let i = 0; i < SW; i++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += a[Math.max(0, Math.min(SH - 1, j + d)) * SW + i];
    b[j * SW + i] = s / (2 * r + 1);
  }
  return b;
}

/** bilinear sample of a 256 × 128 field, north at the top, from 180 W */
function field(f: Float32Array, latD: number, lonE: number) {
  const u = (((lonE + 180) / 360) * SW - 0.5 + SW) % SW, v = Math.max(0, Math.min(SH - 1.001, ((90 - latD) / 180) * SH - 0.5));
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, i1 = (i + 1) % SW;
  return (f[j * SW + i] * (1 - fu) + f[j * SW + i1] * fu) * (1 - fv) + (f[(j + 1) * SW + i] * (1 - fu) + f[(j + 1) * SW + i1] * fu) * fv;
}

/** a land surface's colour from climate: wet tropics, dry subtropics, temperate, boreal, tundra, blended smoothly; `wet` is how near the sea */
function biome(alat: number, wet: number, n: V3, oct: number): V3 {
  const v = fbm(n[0] * 9 + 4, n[1] * 9, n[2] * 9, oct);
  const dry = clamp01(1 - wet * 1.3 + (v - 0.5) * 0.9);
  const g = (x: number, m: number, w: number) => Math.exp(-(((x - m) / w) ** 2));
  const parts: [V3, number][] = [
    [[0.09, 0.26, 0.08], g(alat, 0, 11) * (0.3 + (1 - dry))],
    [[0.44, 0.42, 0.2], g(alat, 15, 7) * (0.4 + dry * 0.6)],
    [[0.6, 0.53, 0.33], g(alat, 27, 8) * (0.15 + dry * 1.4)],
    [[0.22, 0.34, 0.14], g(alat, 42, 10) * (0.3 + (1 - dry))],
    [[0.55, 0.5, 0.32], g(alat, 46, 9) * dry * 0.8],
    [[0.12, 0.21, 0.11], g(alat, 58, 6)],
    [[0.44, 0.41, 0.32], ss(58, 70, alat) * 1.6],
  ];
  let r = 0, gg = 0, b = 0, w = 0;
  for (const [c, k] of parts) { r += c[0] * k; gg += c[1] * k; b += c[2] * k; w += k; }
  const k = (0.82 + 0.36 * v) / Math.max(1e-6, w);
  return [r * k, gg * k, b * k];
}

/** the Earth's clouds: the ITCZ at the equator, clearer subtropics, storm tracks at 50–60°, all swirled */
function earthClouds(n: V3, latD: number, oct: number, seed = 0) {
  const w = fbm(n[0] * 2 + seed, n[1] * 2, n[2] * 2, 3) * 2.5;
  const c = fbm(n[0] * 3 + w + seed, n[1] * 3 - w, n[2] * 6 + w * 0.5, oct);
  const alat = Math.abs(latD);
  const k = c + 0.12 * Math.exp(-((latD / 7) ** 2)) - 0.1 * Math.exp(-(((alat - 24) / 8) ** 2)) + 0.1 * Math.exp(-(((alat - 56) / 10) ** 2));
  return ss(0.56, 0.78, k) * 0.9;
}

export function paintEarth(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  earthData();
  const latD = lat / D, lonE = lon / D > 180 ? lon / D - 360 : lon / D;
  // jitter the lookup a little so coasts are not stair-stepped at high resolution
  const jit = d.res > 600 ? 0.9 : d.res > 300 ? 0.5 : 0;
  const ju = jit ? (fbm(n[0] * 40, n[1] * 40, n[2] * 40, 3) - 0.5) * jit : 0, jv = jit ? (fbm(n[0] * 40 + 9, n[1] * 40, n[2] * 40, 3) - 0.5) * jit : 0;
  const ci = Math.floor((((lonE + 180) / 360) * EARTH_W + ju + EARTH_W) % EARTH_W);
  const cj = Math.max(0, Math.min(EARTH_H - 1, Math.floor(((90 - latD) / 180) * EARTH_H + jv)));
  const cls = earthCls![cj * EARTH_W + ci];
  const shelf = field(earthShelf!, latD, lonE), inland = field(earthInland!, latD, lonE);
  const alat = Math.abs(latD);
  const v = fbm(n[0] * 14, n[1] * 14, n[2] * 14, d.oct);
  if (cls === 0 || cls === 4) {
    // the sea: deep blue, paler over the shelves; lakes darker. Its surface is flat, whatever the floor does
    const sh = cls === 4 ? 0.4 : ss(0.05, 0.5, shelf);
    set(o, [0.02 + 0.05 * sh, 0.07 + 0.13 * sh, 0.2 + 0.12 * sh]);
    shade(o, 0.94 + 0.12 * v);
    o.h = 0.46;
    o.s = 1;
    // sea ice
    if (alat > 66) mixTo(o, [0.86, 0.9, 0.95], ss(70, 76, alat + (v - 0.5) * 10) * (latD < 0 ? 1 : 0.85));
  } else if (cls === 2) {
    set(o, [0.93, 0.95, 0.99]);
    shade(o, 0.94 + 0.08 * v);
    o.h = 0.5 + 0.08 * v;
  } else {
    const wet = clamp01(1 - inland * 1.15 + 0.25);
    set(o, biome(alat, wet, n, d.oct));
    o.h = 0.47 + 0.05 * v;
    // deserts, feathered: sand, redder in Australia, paler in Arabia
    const des = ss(0.15, 0.65, field(earthDesert!, latD, lonE) + (v - 0.5) * 0.35);
    if (des > 0) {
      const red = latD < -12 && lonE > 110 && lonE < 155 ? 0.7 : 0.2;
      const k = 0.88 + 0.24 * v;
      mixTo(o, [(0.8 - 0.06 * red) * k, (0.69 - 0.18 * red) * k, (0.5 - 0.16 * red) * k], des * 0.9);
    }
    if (cls === 6) mixTo(o, [0.44 * (0.9 + 0.2 * v), 0.41 * (0.9 + 0.2 * v), 0.31 * (0.9 + 0.2 * v)], 0.6);
    // mountains: rock and ridges where the ranges are, snow on the high ones
    const mt = field(earthMount!, latD, lonE);
    if (mt > 0.05) {
      const rg = ridged(n[0] * 30, n[1] * 30, n[2] * 30, d.oct);
      const t = ss(0.05, 0.6, mt);
      mixTo(o, [0.42, 0.38, 0.32], t * 0.55);
      o.h += t * (0.08 + 0.25 * rg);
      mixTo(o, [0.9, 0.91, 0.94], t * t * ss(0.8, 0.95, rg) * ss(30, 55, alat + 20 * rg * t) * 0.6);
    }
    if (alat > 62) mixTo(o, [0.9, 0.92, 0.95], ss(70, 80, alat + (v - 0.5) * 12) * 0.8);
  }
  o.c = earthClouds(n, latD, d.oct);
}

/** a made-up Earth-like world: noise continents, the same climate and clouds */
export function paintTerran(o: Tx, n: V3, latD: number, sea: number, seed: number, c1: V3, c2: V3, d: Detail) {
  const sx = n[0] * 2 + seed, sy = n[1] * 2 + seed, sz = n[2] * 2 + seed;
  const h = fbm(sx * 1.3, sy * 1.3, sz * 1.3, d.oct + 1);
  const alat = Math.abs(latD);
  const v = fbm(n[0] * 14 + seed, n[1] * 14, n[2] * 14, d.oct);
  if (h < sea) {
    const sh = ss(sea - 0.08, sea, h);
    set(o, [c1[0] * (0.45 + 0.4 * sh), c1[1] * (0.45 + 0.4 * sh), c1[2] * (0.5 + 0.4 * sh)]);
    o.h = 0.46;
    o.s = 1;
    if (alat > 66) mixTo(o, [0.86, 0.9, 0.95], ss(70, 78, alat + (v - 0.5) * 10));
  } else {
    const wet = clamp01(1 - (h - sea) * 6);
    const c = biome(alat, wet, n, d.oct);
    set(o, [(c[0] * 2 + c2[0]) / 3, (c[1] * 2 + c2[1]) / 3, (c[2] * 2 + c2[2]) / 3]);
    o.h = 0.47 + (h - sea) * 1.2;
    const rg = ridged(sx * 6, sy * 6, sz * 6, d.oct);
    if (h > sea + 0.14) { mixTo(o, [0.42, 0.38, 0.33], ss(sea + 0.14, sea + 0.22, h)); o.h += 0.25 * rg; mixTo(o, [0.92, 0.93, 0.96], ss(0.7, 0.85, rg) * ss(sea + 0.18, sea + 0.26, h)); }
    if (alat > 62) mixTo(o, [0.92, 0.94, 0.97], ss(72, 80, alat + (v - 0.5) * 12));
  }
  o.c = earthClouds(n, latD, d.oct, seed);
}

// ------------------------------------------------------------------ the Moon
/** the maria and big basins: centre lat, lon (east), half-sizes in degrees */
const MARIA = [
  { lat: 32.8, lon: -15.6, a: 19 }, { lat: 28, lon: 17.5, a: 12 }, { lat: 8.5, lon: 31.4, a: 14, b: 12, rough: 0.5 },
  { lat: 17, lon: 59.1, a: 8.5, b: 7 }, { lat: -7.8, lon: 51.3, a: 9, b: 13, rough: 0.5 }, { lat: -15.2, lon: 35.5, a: 5.2 },
  { lat: -21.3, lon: -16.6, a: 10.5, rough: 0.5 }, { lat: -24.4, lon: -38.6, a: 6 }, { lat: 13.3, lon: 3.6, a: 3.8 },
  { lat: 7.5, lon: -30.9, a: 7.5, rough: 0.4 }, { lat: -10, lon: -23.1, a: 5.5, rough: 0.4 },
  // Oceanus Procellarum, a ragged sprawl
  { lat: 18, lon: -57, a: 20, b: 25, rough: 0.6 }, { lat: 2, lon: -45, a: 15, b: 14, rough: 0.6 }, { lat: 34, lon: -45, a: 13, rough: 0.5 }, { lat: 45, lon: -35, a: 10, rough: 0.5 },
  // Mare Frigoris, a band along 56 N
  { lat: 56, lon: -25, a: 18, b: 6, rough: 0.7 }, { lat: 57, lon: 15, a: 16, b: 5.5, rough: 0.7 },
  { lat: -1.3, lon: 87.3, a: 5, rough: 0.6 }, { lat: 13.3, lon: 86.1, a: 6, rough: 0.8 }, { lat: -38.9, lon: 93, a: 9, rough: 1 },
  { lat: 27.3, lon: 147.9, a: 4.2 }, { lat: -19.4, lon: -92.8, a: 4.5 }, { lat: -33.7, lon: 163.5, a: 3, rough: 1 },
];

export function paintMoon(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  const latD = lat / D, lonD = lon / D;
  const v = fbm(n[0] * 8, n[1] * 8, n[2] * 8, d.oct);
  set(o, [0.6, 0.585, 0.56]);
  shade(o, 0.85 + 0.3 * v);
  o.h = 0.55 + 0.08 * v;
  // the South Pole–Aitken basin: a little darker and lower
  const spa = blob(latD, lonD, n, { lat: -53, lon: -169, a: 38 });
  if (spa < 1) { shade(o, 0.9 + 0.1 * spa); o.h -= 0.08 * (1 - spa); }
  const cr = craterField(n, d.craters, 5, 0.55, 1);
  o.h += cr.dh; o.r += cr.db; o.g += cr.db; o.b += cr.db;
  for (const m of MARIA) {
    const q = blob(latD, lonD, n, { rough: 0.35, ...m, seed: m.lat });
    if (q < 1.2) {
      const t = ss(1.2, 0.8, q);
      const mare: V3 = [0.33 + 0.04 * v, 0.32 + 0.035 * v, 0.31 + 0.03 * v];
      mixTo(o, mare, t * 0.92);
      o.h = o.h * (1 - t) + (0.47 + cr.dh * 0.3) * t;
    }
  }
  // the dark-floored and the bright-rayed craters
  for (const [la, lo, r] of [[51.6, -9.4, 1.6], [-5.2, -68.6, 2.8]] as const) { const q = angTo(n, la, lo) / r; if (q < 1) mixTo(o, [0.3, 0.29, 0.28], 0.8); }
  rayed(o, n, -43.3, -11.2, 1.4, 22);
  rayed(o, n, 9.6, -20.1, 1.5, 9, 0.8);
  rayed(o, n, 8.1, -38, 0.6, 7, 0.7);
  rayed(o, n, 23.7, -47.4, 0.7, 4, 1);
  rayed(o, n, 36, 102.9, 0.4, 9, 0.8);
  rayed(o, n, -8.9, 61, 2.2, 3, 0.4);
  rayed(o, n, 22, -163, 1.2, 6, 0.6);
  for (const [la, lo, r] of [[-58.4, -14.4, 3.7], [-9.3, -1.9, 2.5], [-11.4, 26.4, 1.6], [-25.3, 60.4, 2.9]] as const) {
    const q = angTo(n, la, lo) / r;
    if (q < 1.2) { o.h += q < 1 ? -0.06 * (1 - q * q) : 0.04 * (1 - (q - 1) / 0.2); }
  }
}

// ------------------------------------------------------------------ Mars
/**
 * Mars from MOLA and the colour mosaic (marsdata.ts): heights as painted
 * height 0.5 + km / 40, so the ground's scale is 40 km a unit (terrain.ts).
 * Below the maps' 20 km texels, small craters and the grain of the dust.
 */
export function paintMars(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  const M = MARS;
  if (!M) { marsFeatures(o, lat, lon, n, d); return; }
  // texel coordinates: 180° W at the left edge, north at the top
  let u = lon / (2 * Math.PI) + 0.5;
  u -= Math.floor(u);
  const x = u * M.w - 0.5, y = (0.5 - lat / Math.PI) * M.h - 0.5;
  o.h = 0.5 + marsHeight(M, x, y) / 40;
  if (M.rgb) {
    const x0 = Math.floor(x), y0 = Math.max(0, Math.min(M.h - 2, Math.floor(y)));
    const fx = x - x0, fy = Math.max(0, Math.min(1, y - y0));
    const i00 = (y0 * M.w + ((x0 + M.w) % M.w)) * 3, i10 = (y0 * M.w + ((x0 + 1) % M.w)) * 3;
    const i01 = i00 + M.w * 3, i11 = i10 + M.w * 3;
    const c = M.rgb;
    const at = (k: number) => {
      const L = GRADE[k];
      return (L[c[i00 + k]] * (1 - fx) + L[c[i10 + k]] * fx) * (1 - fy) + (L[c[i01 + k]] * (1 - fx) + L[c[i11 + k]] * fx) * fy;
    };
    o.r = at(0); o.g = at(1); o.b = at(2);
  } else {
    marsFeatures(o, lat, lon, n, d);
    o.h = 0.5 + marsHeight(M, x, y) / 40;
  }
  // the residual caps, which the mosaic's edges smear
  const v = fbm(n[0] * 7, n[1] * 7, n[2] * 7, 4);
  const cap = Math.max(ss(1.1, 0.8, angTo(n, 90, 0) / (8 + 3 * (v - 0.5))), ss(1.1, 0.8, angTo(n, -87, -45) / (4.5 + 2 * (v - 0.5))));
  if (cap > 0) mixTo(o, [0.95, 0.94, 0.92], cap * 0.85);
  if (d.res >= 512) {
    // what the maps are too coarse to hold: craters under 20 km, and mottling in the dust
    const cr = craterField(n, Math.max(1, d.craters - 1), 70, 0.5, 2);
    o.h += cr.dh * 0.12;
    const m = fbm(n[0] * 60, n[1] * 60, n[2] * 60, Math.min(4, d.oct - 3));
    const k = 0.93 + 0.14 * m + cr.db * 0.5;
    o.r *= k; o.g *= k; o.b *= k;
  }
}

/**
 * the mosaic is dim, flat and a little yellow: each channel stretched about its mean to Mars' butterscotch as
 * the spacecraft see it, the dark markings darker, and the brightest (Hellas' frost, the caps) eased in rather than clipped
 */
const GRADE = [[0.345, 0.64], [0.247, 0.4], [0.157, 0.245]].map(([m, t]) => Float32Array.from({ length: 256 }, (_, i) => {
  const x = t * Math.pow(i / 255 / m, 1.3);
  return x < 0.75 ? x : 0.75 + 0.25 * (1 - Math.exp(-(x - 0.75) / 0.25));
}));

/** elevation, km, at texel coordinates: Catmull-Rom across the texels, so slopes run smooth */
function marsHeight(M: MarsData, x: number, y: number) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const wx = cr4(fx, WX), wy = cr4(fy, WY);
  let s = 0;
  for (let j = 0; j < 4; j++) {
    const row = Math.max(0, Math.min(M.h - 1, y0 - 1 + j)) * M.w;
    let r = 0;
    for (let i = 0; i < 4; i++) r += M.height[row + ((x0 - 1 + i + M.w) % M.w)] * wx[i];
    s += r * wy[j];
  }
  return s * 0.12 - 8.5;
}
const WX = [0, 0, 0, 0], WY = [0, 0, 0, 0];
function cr4(t: number, w: number[]) {
  const t2 = t * t, t3 = t2 * t;
  w[0] = -0.5 * t3 + t2 - 0.5 * t; w[1] = 1.5 * t3 - 2.5 * t2 + 1; w[2] = -1.5 * t3 + 2 * t2 + 0.5 * t; w[3] = 0.5 * t3 - 0.5 * t2;
  return w;
}

/** Mars from its features alone, before (or without) the measured maps */
function marsFeatures(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  const latD = lat / D, lonD = lon / D;
  const v = fbm(n[0] * 7, n[1] * 7, n[2] * 7, d.oct);
  // bright dusty ochre, with the darker southern highlands and dark albedo markings
  set(o, [0.74, 0.44, 0.26]);
  shade(o, 0.88 + 0.24 * v);
  o.h = 0.42 + 0.08 * v + (latD < 0 ? 0.1 : 0) * ss(-10, 10, -latD + 20 * (v - 0.5));
  const dark = [
    { lat: 10, lon: 69.5, a: 9, b: 16, rough: 0.5 }, { lat: -3, lon: 5, a: 14, b: 4, rough: 0.6 }, { lat: -8, lon: 30, a: 22, b: 5, rough: 0.6 },
    { lat: -24, lon: -38, a: 22, b: 9, rough: 0.6 }, { lat: 46.7, lon: -22, a: 14, b: 9, rough: 0.6 }, { lat: -22, lon: 145, a: 22, b: 7, rough: 0.6 },
    { lat: -18, lon: 105, a: 14, b: 7, rough: 0.6 }, { lat: -30, lon: -155, a: 16, b: 7, rough: 0.6 }, { lat: -26, lon: -85, a: 5, b: 4, rough: 0.5 },
    { lat: -15, lon: -50, a: 7, b: 5, rough: 0.5 }, { lat: 49.7, lon: 118, a: 16, b: 8, rough: 0.9 }, { lat: -32, lon: 22, a: 12, b: 6, rough: 0.6 },
  ];
  for (const m of dark) {
    const q = blob(latD, lonD, n, { ...m, rough: m.rough + 0.3, seed: m.lon });
    if (q < 1.3) mixTo(o, [0.38, 0.25, 0.18], ss(1.3, 0.6, q) * 0.8);
  }
  const cr = craterField(n, d.craters, 4, latD < 5 ? 0.45 : 0.18, 2);
  o.h += cr.dh; o.r += cr.db * 0.8; o.g += cr.db * 0.6; o.b += cr.db * 0.5;
  // Hellas and Argyre: deep, pale-floored basins
  for (const [la, lo, r] of [[-42.4, 70.5, 18], [-49.7, -43, 11]] as const) {
    const q = angTo(n, la, lo) / r;
    if (q < 1.15) { o.h -= 0.26 * (1 - Math.min(1, q) ** 2); mixTo(o, [0.82, 0.62, 0.45], ss(1.1, 0.6, q) * 0.6); }
  }
  // Tharsis: the bulge, the three Montes, Olympus, Alba; Elysium
  const th = angTo(n, 2, -110) / 32;
  if (th < 1) o.h += 0.15 * (1 - th * th);
  for (const [la, lo, r, hh] of [[18.65, -133.8, 5.2, 0.56], [-8.3, -120.1, 3.7, 0.35], [1.5, -113, 3.2, 0.32], [11.8, -104.5, 3.4, 0.35], [40.5, -109.6, 8, 0.12], [25, 147, 2.4, 0.25]] as const) {
    const q = angTo(n, la, lo) / r;
    if (q < 1.3) {
      o.h += hh * Math.max(0, 1 - q) ** 1.5;
      if (q < 0.18) o.h -= 0.08;
      if (q > 1 && q < 1.3 && hh > 0.4) o.h -= 0.05 * (1 - Math.abs(q - 1.15) / 0.15);
      mixTo(o, [0.68, 0.4, 0.26], 0.3 * Math.max(0, 1 - q));
    }
  }
  // Valles Marineris: a dark gash along −8° to −14° from 100 W to 40 W
  {
    const lE = lonD > 180 ? lonD - 360 : lonD;
    if (lE > -105 && lE < -38) {
      const mid = -9 - 4 * Math.sin(((lE + 105) / 67) * Math.PI) + (lE > -60 ? (lE + 60) * 0.08 : 0);
      const w = 1.1 + 1.6 * Math.sin(((lE + 105) / 67) * Math.PI);
      const q = Math.abs(latD - mid + (fbm(n[0] * 20, n[1] * 20, n[2] * 20, 3) - 0.5) * 1.5) / w;
      if (q < 1) { o.h -= 0.25 * (1 - q * q); mixTo(o, [0.42, 0.26, 0.18], 0.7 * (1 - q)); }
    }
  }
  // the polar caps: the north's residual cap, the smaller southern one off the pole
  const np = angTo(n, 90, 0) / (9 + 3 * (v - 0.5));
  const sp = angTo(n, -87, -45) / (5 + 2 * (v - 0.5));
  const cap = Math.max(ss(1.1, 0.8, np), ss(1.1, 0.8, sp));
  if (cap > 0) { mixTo(o, [0.95, 0.94, 0.92], cap); o.h += 0.04 * cap; }
}

// ------------------------------------------------------------------ the gas giants
interface Band { to: number; c: number }
/** belts and zones from the south pole up, by planetographic latitude */
const JUPITER_BANDS: Band[] = [
  { to: -66, c: 0x8a8c94 }, { to: -48, c: 0xa89c88 }, { to: -40, c: 0xd8cfbc }, { to: -33, c: 0xc0a688 }, { to: -26, c: 0xa88466 },
  { to: -19, c: 0xeee2c8 }, { to: -7, c: 0x9a6a48 }, { to: 7, c: 0xf0e4c8 }, { to: 17, c: 0x8c5c40 }, { to: 24, c: 0xece0c4 },
  { to: 31, c: 0xa08064 }, { to: 40, c: 0xdcd2bc }, { to: 48, c: 0xb4a28a }, { to: 66, c: 0xa89e90 }, { to: 91, c: 0x8a8e98 },
];
const SATURN_BANDS: Band[] = [
  { to: -70, c: 0x9a9480 }, { to: -50, c: 0xc8b88c }, { to: -35, c: 0xd8c898 }, { to: -20, c: 0xc4ac78 }, { to: -8, c: 0xe8d8a8 },
  { to: 8, c: 0xf0e2b4 }, { to: 20, c: 0xe2cc98 }, { to: 35, c: 0xc8b07c }, { to: 50, c: 0xd4c49a }, { to: 70, c: 0xb4ae9c }, { to: 91, c: 0x8c98a4 },
];

function bands(o: Tx, latD: number, n: V3, list: Band[], wobble: number, d: Detail, seed: number) {
  // zonal flow: the belts' edges ripple and the clouds are drawn out along the lines of latitude
  const warp = fbm(n[0] * 4 + seed, n[1] * 4, n[2] * 4, 3);
  const turb = fbm(n[0] * 3 + warp * 2 + seed, n[1] * 3 - warp * 2, n[2] * 22 + seed, d.oct);
  const L = latD + (turb - 0.5) * wobble * 2.6;
  let i = list.findIndex(b => L < b.to);
  if (i < 0) i = list.length - 1;
  const b = list[i], prev = list[Math.max(0, i - 1)];
  const c = hex(b.c), cp = hex(prev.c);
  const edge = ss(0, 2.5, L - (i > 0 ? prev.to : -91));
  set(o, [cp[0] + (c[0] - cp[0]) * edge, cp[1] + (c[1] - cp[1]) * edge, cp[2] + (c[2] - cp[2]) * edge]);
  const fine = fbm(n[0] * 10 + warp * 3 + seed, n[1] * 10, n[2] * 70, d.oct);
  shade(o, 0.84 + 0.32 * fine);
  o.h = 0.5 + 0.06 * (fine - 0.5);
}

export function paintJupiter(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  const latD = lat / D, lonD = lon / D;
  bands(o, latD, n, JUPITER_BANDS, 4.5, d, 0);
  // festoons: blue-grey plumes trailing from the north edge of the equatorial zone
  if (latD > 2 && latD < 9) {
    const f = fbm(n[0] * 14, n[1] * 14, n[2] * 4, 4);
    mixTo(o, [0.42, 0.48, 0.58], ss(0.6, 0.75, f) * 0.6 * Math.sin(((latD - 2) / 7) * Math.PI));
  }
  // eddies and small ovals in the belts
  const ed = fbm(n[0] * 18 + 3, n[1] * 18, n[2] * 18, d.oct);
  if (ed > 0.68) mixTo(o, ed > 0.74 ? [0.95, 0.92, 0.86] : [0.62, 0.42, 0.3], 0.35 * ss(0.68, 0.78, ed));
  // the Great Red Spot at 22 S: a brick-red core wound with spiral arms, a calmer heart, a pale collar of
  // cloud round it, and the turbulent wake it leaves to the west (the shader turns it on itself)
  {
    const dx = (dlon(lonD, 60) * Math.cos(22 * D)) / 8.5, dy = (latD + 22) / 6;
    const r = Math.hypot(dx, dy);
    if (r < 1.5) {
      const th = Math.atan2(dy, dx);
      const tw = fbm(n[0] * 30, n[1] * 30, n[2] * 30, 4);
      const arm = 0.5 + 0.5 * Math.sin(2 * th + 11 * r + 5 * (tw - 0.5));
      const core = ss(1.0, 0.45, r);
      mixTo(o, [0.95, 0.9, 0.82], ss(1.45, 1.12, r) * ss(0.85, 1.05, r) * 0.85);
      mixTo(o, arm > 0.5 ? [0.76, 0.36, 0.22] : [0.86, 0.5, 0.34], core * (0.72 + 0.2 * arm));
      mixTo(o, [0.84, 0.56, 0.4], ss(0.3, 0.05, r) * 0.55);
      o.h += 0.05 * Math.max(0, 1 - r);
    }
    const w = dlon(lonD, 60);
    if (w < -8 && w > -45 && latD > -26 && latD < -13) {
      const f = fbm(n[0] * 26 + 5, n[1] * 26, n[2] * 26, 5), g = ridged(n[0] * 18, n[1] * 18, n[2] * 18, 3);
      const k = ss(-45, -25, w) * ss(-8, -14, w) * Math.sin(((latD + 26) / 13) * Math.PI);
      mixTo(o, f > 0.5 ? [0.96, 0.92, 0.86] : [0.6, 0.42, 0.3], k * Math.abs(f - 0.5) * 1.6 + k * 0.25 * g);
    }
  }
  const ba = blob(latD, lonD, n, { lat: -33.5, lon: 105, a: 3, b: 2 });
  if (ba < 1) mixTo(o, [0.92, 0.82, 0.74], ss(1, 0.4, ba) * 0.85);
  // a string of white ovals at 41 S
  for (let k = 0; k < 6; k++) { const q = blob(latD, lonD, n, { lat: -41, lon: k * 60 + 20, a: 2, b: 1.4 }); if (q < 1) mixTo(o, [0.95, 0.93, 0.9], ss(1, 0.3, q) * 0.8); }
}

export function paintSaturn(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  const latD = lat / D, lonD = lon / D;
  bands(o, latD, n, SATURN_BANDS, 1.5, d, 7);
  // the north polar hexagon at 78 N, and the vortex in it
  const colat = 90 - latD;
  const seg = (((lonD % 60) + 60) % 60) - 30;
  const rHex = 12 / Math.cos(seg * D) * Math.cos(30 * D);
  if (colat < rHex + 0.6) mixTo(o, colat < rHex ? [0.52, 0.6, 0.66] : [0.8, 0.78, 0.7], colat < rHex ? 0.6 : 0.5);
  if (colat < 3) mixTo(o, [0.35, 0.4, 0.45], ss(3, 0.5, colat));
}

export function paintUranus(o: Tx, lat: number, _lon: number, n: V3, d: Detail) {
  const latD = lat / D;
  const f = fbm(n[0] * 2, n[1] * 2, n[2] * 14, d.oct);
  set(o, [0.66, 0.86, 0.88]);
  shade(o, 0.97 + 0.06 * f + 0.03 * Math.sin(latD * 0.3));
  // the south polar cap, brighter
  mixTo(o, [0.8, 0.93, 0.94], ss(-50, -75, latD) * 0.6);
  o.h = 0.5;
}

export function paintNeptune(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  const latD = lat / D, lonD = lon / D;
  const f = fbm(n[0] * 3, n[1] * 3, n[2] * 16, d.oct);
  set(o, [0.24, 0.42, 0.86]);
  shade(o, 0.9 + 0.2 * f + 0.06 * Math.sin(latD * 0.12));
  mixTo(o, [0.2, 0.32, 0.72], ss(55, 75, Math.abs(latD)) * 0.6);
  // the Great Dark Spot (1989) and its bright companion cloud
  const gds = blob(latD, lonD, n, { lat: -22, lon: 30, a: 8, b: 5 });
  if (gds < 1) mixTo(o, [0.1, 0.18, 0.5], ss(1, 0.5, gds) * 0.9);
  const sc = blob(latD, lonD, n, { lat: -28, lon: 34, a: 4, b: 1.5 });
  if (sc < 1) mixTo(o, [0.95, 0.97, 1], ss(1, 0.4, sc) * 0.8);
  // bright high clouds streaked along the latitudes
  for (const [la, w] of [[-42, 2.6], [27, 2.2], [-70, 3]] as const) {
    const q = Math.abs(latD - la) / w;
    if (q < 1) mixTo(o, [0.92, 0.95, 1], (1 - q) * ss(0.55, 0.72, fbm(n[0] * 6 + la, n[1] * 6, n[2] * 40, 4)) * 0.8);
  }
  o.h = 0.5;
}

// ------------------------------------------------------------------ the inner planets
export function paintMercury(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  const latD = lat / D;
  void lon;
  const v = fbm(n[0] * 6, n[1] * 6, n[2] * 6, d.oct);
  set(o, [0.55, 0.52, 0.49]);
  shade(o, 0.85 + 0.3 * v);
  o.h = 0.5 + 0.08 * v;
  // smooth plains, a touch darker, in the north
  mixTo(o, [0.47, 0.45, 0.43], ss(45, 70, latD + (v - 0.5) * 30) * 0.6);
  const cr = craterField(n, d.craters, 4, 0.6, 3);
  o.h += cr.dh; o.r += cr.db; o.g += cr.db; o.b += cr.db;
  // Caloris: a vast basin, its floor paler and warmer
  const cal = angTo(n, 30.5, 170.2) / 18;
  if (cal < 1.1) { mixTo(o, [0.68, 0.6, 0.5], ss(1.1, 0.8, cal) * 0.6); o.h -= 0.08 * Math.max(0, 1 - cal); if (cal > 0.95) o.h += 0.04; }
  rayed(o, n, 57.8, 16.8, 1.3, 14, 0.9);
  rayed(o, n, -33.9, -12.5, 1.0, 10, 0.8);
  rayed(o, n, -11.3, -31.5, 0.8, 6, 0.7);
}

export function paintVenus(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  const latD = lat / D, lonD = lon / D;
  // the cloud deck: cream, nearly featureless in visible light, with faint chevrons in the zonal wind
  const f = fbm(n[0] * 3, n[1] * 3, n[2] * 9, d.oct);
  set(o, [0.93, 0.86, 0.68]);
  const chevron = Math.sin(lonD * D * 2 + Math.abs(latD) * 0.06 + f * 3);
  shade(o, 0.92 + 0.06 * chevron * Math.exp(-((latD / 40) ** 2)) + 0.08 * f);
  mixTo(o, [0.98, 0.95, 0.85], ss(55, 80, Math.abs(latD)) * 0.5);
  o.h = 0.5;
}

// ------------------------------------------------------------------ moons
export function paintIo(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  const latD = lat / D, lonD = lon / D;
  const v = fbm(n[0] * 6, n[1] * 6, n[2] * 6, d.oct);
  set(o, [0.86, 0.78, 0.4]);
  mixTo(o, [0.92, 0.9, 0.8], ss(0.55, 0.7, fbm(n[0] * 4 + 3, n[1] * 4, n[2] * 4, d.oct)) * 0.7);
  mixTo(o, [0.62, 0.42, 0.26], ss(40, 65, Math.abs(latD) + (v - 0.5) * 20));
  shade(o, 0.9 + 0.2 * v);
  o.h = 0.5 + 0.05 * v;
  // Pele's red ring, Loki's dark lava lake, Prometheus' pale halo, and a scatter of paterae
  const pele = angTo(n, -18.7, 104.7);
  if (pele < 22) { mixTo(o, [0.7, 0.3, 0.15], Math.exp(-(((pele - 18) / 2.5) ** 2)) * 0.8); if (pele < 1.2) { set(o, [0.12, 0.08, 0.06]); o.e = 0.9; } }
  const loki = blob(latD, lonD, n, { lat: 13, lon: 51, a: 3.5, b: 2.5 });
  if (loki < 1) { mixTo(o, [0.1, 0.08, 0.07], ss(1, 0.6, loki)); o.e = Math.max(o.e, 0.6 * ss(1, 0.3, loki)); }
  const prom = angTo(n, -1.5, -153);
  if (prom < 6) { mixTo(o, [0.96, 0.95, 0.9], Math.exp(-(((prom - 4.5) / 1) ** 2)) * 0.7); if (prom < 0.8) { set(o, [0.15, 0.1, 0.08]); o.e = 0.7; } }
  const pat = vnoise(n[0] * 11, n[1] * 11, n[2] * 11);
  if (pat > 0.8) mixTo(o, [0.78, 0.46, 0.22], ss(0.8, 0.88, pat) * 0.5);
  if (pat > 0.9) { mixTo(o, [0.16, 0.1, 0.07], ss(0.9, 0.94, pat)); o.e = Math.max(o.e, ss(0.95, 0.99, pat) * 0.5); }
}

/** Europa's long lineae: a circle's pole, a direction along it, how far the arc runs (a cosine), how dark */
const EUROPA_ARCS: number[][] = Array.from({ length: 26 }, (_, k) => {
  const h = (q: number) => hash(k, q, 77);
  const z = 2 * h(1) - 1, t = 2 * Math.PI * h(2), r = Math.sqrt(1 - z * z);
  const p = [r * Math.cos(t), r * Math.sin(t), z];
  // a point on that circle, as the middle of the arc
  const a = [-p[1], p[0], 0], al = Math.hypot(a[0], a[1]) || 1;
  const u = [a[0] / al, a[1] / al, 0], w = [p[1] * u[2] - p[2] * u[1], p[2] * u[0] - p[0] * u[2], p[0] * u[1] - p[1] * u[0]];
  const ph = 2 * Math.PI * h(3), c = [u[0] * Math.cos(ph) + w[0] * Math.sin(ph), u[1] * Math.cos(ph) + w[1] * Math.sin(ph), u[2] * Math.cos(ph) + w[2] * Math.sin(ph)];
  return [p[0], p[1], p[2], c[0], c[1], c[2], Math.cos((0.12 + 0.3 * h(4)) * Math.PI), 0.35 + 0.65 * h(5)];
});

export function paintEuropa(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  const lonD = lon / D;
  const v = fbm(n[0] * 6, n[1] * 6, n[2] * 6, d.oct);
  set(o, [0.9, 0.87, 0.8]);
  // the trailing hemisphere (centred on 270 W = 90 E) is darker and redder
  const trail = Math.cos((lonD - 90) * D) * Math.cos(lat);
  mixTo(o, [0.7, 0.56, 0.44], ss(-0.2, 1, trail) * 0.45);
  shade(o, 0.92 + 0.14 * v);
  // lineae: long reddish-brown cracks along arcs of great circles, with a finer network between
  let line = 0;
  for (const g of EUROPA_ARCS) {
    const off = Math.abs(n[0] * g[0] + n[1] * g[1] + n[2] * g[2]);
    if (off > 0.016) continue;
    // only along part of the circle
    if (n[0] * g[3] + n[1] * g[4] + n[2] * g[5] < g[6]) continue;
    // a double ridge with a dark band each side of a paler centre
    line = Math.max(line, (off < 0.004 ? 0.45 : 1 - (off - 0.004) / 0.012) * g[7]);
  }
  line = Math.max(line, ss(0.9, 0.98, ridged(n[0] * 13 + 4, n[1] * 13, n[2] * 13, d.oct)) * 0.5);
  mixTo(o, [0.55, 0.36, 0.24], line * 0.75);
  // chaos terrain: mottled brown blotches
  mixTo(o, [0.6, 0.45, 0.33], ss(0.68, 0.78, fbm(n[0] * 9 + 2, n[1] * 9, n[2] * 9, d.oct)) * 0.5);
  o.h = 0.5 + 0.06 * line;
}

export function paintGanymede(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  const latD = lat / D, lonD = lon / D;
  const v = fbm(n[0] * 6, n[1] * 6, n[2] * 6, d.oct);
  set(o, [0.72, 0.69, 0.63]);
  // the dark ancient regions: Galileo, Marius, Perrine, Nicholson
  for (const m of [{ lat: 35, lon: -145, a: 30, b: 22 }, { lat: -10, lon: -195, a: 32, b: 26 }, { lat: 40, lon: -30, a: 18, b: 14 }, { lat: -25, lon: -10, a: 16, b: 14 }]) {
    const q = blob(latD, lonD, n, { ...m, rough: 0.7, seed: m.lon });
    if (q < 1.1) mixTo(o, [0.4, 0.36, 0.31], ss(1.1, 0.8, q));
  }
  // the bright grooved terrain between
  const g = ridged(n[0] * 14, n[1] * 14, n[2] * 14, d.oct);
  shade(o, 0.88 + 0.2 * v + 0.08 * g);
  const cr = craterField(n, Math.max(1, d.craters - 1), 5, 0.35, 4);
  o.h = 0.5 + cr.dh + 0.03 * g; o.r += cr.db; o.g += cr.db; o.b += cr.db;
  mixTo(o, [0.88, 0.88, 0.88], ss(40, 70, Math.abs(latD)) * 0.35);
  rayed(o, n, -13, -167, 1.5, 6, 0.8);
}

export function paintCallisto(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  const v = fbm(n[0] * 6, n[1] * 6, n[2] * 6, d.oct);
  set(o, [0.36, 0.33, 0.29]);
  shade(o, 0.88 + 0.24 * v);
  const cr = craterField(n, d.craters, 6, 0.7, 5);
  o.h = 0.5 + cr.dh; o.r += cr.db * 1.6; o.g += cr.db * 1.6; o.b += cr.db * 1.5;
  // Valhalla and Asgard: bright centres in rings of ridges
  for (const [la, lo, r] of [[14.7, -56, 6], [32, -140, 4]] as const) {
    const a = angTo(n, la, lo);
    if (a < r) mixTo(o, [0.72, 0.7, 0.65], ss(r, r * 0.4, a) * 0.8);
    else if (a < r * 6) mixTo(o, [0.55, 0.52, 0.47], Math.pow(Math.max(0, Math.sin(a * 2.4)), 6) * 0.4 * (1 - a / (r * 6)));
  }
  void lat; void lon;
}

/** an icy moon pocked with craters, in two tones */
function cratered(o: Tx, n: V3, d: Detail, c1: V3, c2: V3, density: number, seed: number) {
  const v = fbm(n[0] * 6 + seed, n[1] * 6, n[2] * 6, d.oct);
  set(o, [c1[0] + (c2[0] - c1[0]) * v, c1[1] + (c2[1] - c1[1]) * v, c1[2] + (c2[2] - c1[2]) * v]);
  const cr = craterField(n, d.craters, 5, density, seed);
  o.h = 0.5 + cr.dh + 0.05 * v; o.r += cr.db; o.g += cr.db; o.b += cr.db;
}

export function paintTitan(o: Tx, lat: number, _lon: number, n: V3, d: Detail) {
  const latD = lat / D;
  const f = fbm(n[0] * 3, n[1] * 3, n[2] * 6, d.oct);
  set(o, [0.84, 0.6, 0.27]);
  shade(o, 0.94 + 0.1 * f);
  // the darker northern hood
  mixTo(o, [0.6, 0.42, 0.2], ss(55, 80, latD) * 0.5);
  o.h = 0.5;
}

export function paintEnceladus(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  const latD = lat / D, lonD = lon / D;
  cratered(o, n, d, [0.9, 0.92, 0.94], [0.98, 0.99, 1], latD > 0 ? 0.35 : 0.05, 6);
  // the tiger stripes: four bluish fractures across the south pole
  if (latD < -60) {
    const x = (90 + latD) * Math.cos((lonD + 45) * D), y = (90 + latD) * Math.sin((lonD + 45) * D);
    for (let k = -1.5; k <= 1.5; k += 1) {
      const q = Math.abs(x - k * 6 - 0.05 * y * y) / 0.9;
      if (q < 1 && Math.abs(y) < 22) { mixTo(o, [0.55, 0.7, 0.8], (1 - q) * 0.7); o.h -= 0.03 * (1 - q); }
    }
  }
}

export function paintMimas(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  cratered(o, n, d, [0.68, 0.68, 0.66], [0.86, 0.86, 0.84], 0.7, 7);
  // Herschel: a third of the moon across
  const a = angTo(n, 1.7, -112) / 19;
  if (a < 1.2) { o.h += a < 1 ? -0.25 * (1 - a * a) : 0.1 * (1 - (a - 1) / 0.2); if (a < 0.15) o.h += 0.15; shade(o, a < 1 ? 0.88 : 1.05); }
  void lat; void lon;
}

export function paintIapetus(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  const latD = lat / D, lonD = lon / D;
  cratered(o, n, d, [0.84, 0.82, 0.78], [0.95, 0.93, 0.9], 0.6, 8);
  // Cassini Regio: the leading hemisphere (centred on 90 W) is as dark as coal
  const lead = Math.cos((lonD + 90) * D) * Math.cos(lat);
  const t = ss(0.05, 0.3, lead + (fbm(n[0] * 8, n[1] * 8, n[2] * 8, 4) - 0.5) * 0.3);
  mixTo(o, [0.16, 0.12, 0.09], t * ss(70, 45, Math.abs(latD)));
  // the equatorial ridge
  if (Math.abs(latD) < 2.5) o.h += 0.08 * (1 - Math.abs(latD) / 2.5);
}

export function paintTriton(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  const latD = lat / D;
  const v = fbm(n[0] * 6, n[1] * 6, n[2] * 6, d.oct);
  // cantaloupe terrain: dimpled, greenish-grey, in the north and west
  const dimple = ridged(n[0] * 18, n[1] * 18, n[2] * 18, d.oct);
  set(o, [0.7, 0.72, 0.66]);
  shade(o, 0.88 + 0.12 * dimple + 0.1 * v);
  o.h = 0.5 + 0.05 * dimple;
  // the pinkish south polar cap, with dark plume streaks
  const cap = ss(-5, -25, latD + (v - 0.5) * 20);
  mixTo(o, [0.93, 0.82, 0.78], cap);
  if (cap > 0.5 && vnoise(n[0] * 3, n[1] * 40, n[2] * 3) > 0.78) mixTo(o, [0.4, 0.34, 0.32], 0.6);
  void lon;
}

export function paintPluto(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  const latD = lat / D, lonD = lon / D;
  const v = fbm(n[0] * 6, n[1] * 6, n[2] * 6, d.oct);
  set(o, [0.76, 0.6, 0.45]);
  shade(o, 0.88 + 0.24 * v);
  o.h = 0.5 + 0.06 * v;
  // Cthulhu: a dark red-brown whale along the equator
  const cth = blob(latD, lonD, n, { lat: -5, lon: 100, a: 55, b: 16, rough: 0.6, seed: 2 });
  if (cth < 1.1) mixTo(o, [0.34, 0.17, 0.1], ss(1.1, 0.8, cth));
  // the heart: Sputnik Planitia (smooth nitrogen ice) and the rest of Tombaugh Regio
  const sp = blob(latD, lonD, n, { lat: 22, lon: 178, a: 20, b: 17, rough: 0.25, seed: 4 });
  const east = blob(latD, lonD, n, { lat: 0, lon: 212, a: 18, b: 22, rough: 0.5, seed: 5 });
  if (sp < 1) { mixTo(o, [0.96, 0.93, 0.86], ss(1, 0.85, sp)); o.h = 0.45 + 0.01 * ridged(n[0] * 30, n[1] * 30, n[2] * 30, 3); }
  else if (east < 1) mixTo(o, [0.9, 0.85, 0.76], ss(1, 0.7, east) * 0.8);
  // the north: tan and grey
  mixTo(o, [0.72, 0.66, 0.6], ss(50, 70, latD + (v - 0.5) * 15) * 0.7);
  if (sp >= 1) { const cr = craterField(n, Math.max(1, d.craters - 1), 5, 0.25, 9); o.h += cr.dh; o.r += cr.db; o.g += cr.db; o.b += cr.db; }
}

export function paintCharon(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  const latD = lat / D;
  cratered(o, n, d, [0.52, 0.52, 0.52], [0.68, 0.67, 0.66], 0.3, 10);
  // Mordor Macula: the reddish cap at the north pole
  mixTo(o, [0.42, 0.26, 0.18], ss(62, 78, latD + (fbm(n[0] * 6, n[1] * 6, n[2] * 6, 3) - 0.5) * 10));
  // the belt of canyons just north of the equator
  if (Math.abs(latD - 5) < 6) { const r = ridged(n[0] * 10, n[1] * 10, n[2] * 10, 3); if (r > 0.85) { o.h -= 0.08; shade(o, 0.85); } }
  void lon;
}

export function paintCeres(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  cratered(o, n, d, [0.33, 0.32, 0.31], [0.42, 0.41, 0.4], 0.5, 11);
  // Occator's bright salt spots
  const oc = angTo(n, 19.8, 239.3);
  if (oc < 1.8) { o.h -= 0.05; if (oc < 0.35) set(o, [0.95, 0.95, 0.93]); }
  void lat; void lon;
}

export function paintPhobos(o: Tx, lat: number, lon: number, n: V3, d: Detail) {
  cratered(o, n, d, [0.3, 0.27, 0.25], [0.4, 0.36, 0.33], 0.6, 12);
  const st = angTo(n, 1, -49) / 22;
  if (st < 1.1) o.h += st < 1 ? -0.2 * (1 - st * st) : 0.06;
  // the grooves
  if (Math.abs(Math.sin(lat * 30 + lon * 2)) < 0.12) o.h -= 0.02;
}

/** which painter draws a body, by its name */
export const REAL: Record<string, Painter> = {
  Earth: paintEarth, Moon: paintMoon, Mars: paintMars, Mercury: paintMercury, Venus: paintVenus,
  Jupiter: paintJupiter, Saturn: paintSaturn, Uranus: paintUranus, Neptune: paintNeptune,
  Io: paintIo, Europa: paintEuropa, Ganymede: paintGanymede, Callisto: paintCallisto,
  Titan: paintTitan, Enceladus: paintEnceladus, Mimas: paintMimas, Iapetus: paintIapetus,
  Triton: paintTriton, Pluto: paintPluto, Charon: paintCharon, Ceres: paintCeres, Phobos: paintPhobos,
  Tethys: (o, lat, lon, n, d) => { cratered(o, n, d, [0.82, 0.82, 0.8], [0.94, 0.94, 0.92], 0.55, 13); const a = angTo(n, 32.8, -128.9) / 24; if (a < 1.1) o.h += a < 1 ? -0.15 * (1 - a * a) : 0.05; void lat; void lon; },
  Dione: (o, lat, lon, n, d) => { cratered(o, n, d, [0.72, 0.72, 0.7], [0.88, 0.88, 0.86], 0.5, 14); const lD = lon / D; if (Math.cos((lD - 90) * D) > 0.2 && ridged(n[0] * 8, n[1] * 8, n[2] * 8, 3) > 0.86) mixTo(o, [0.98, 0.98, 0.98], 0.7); void lat; },
  Rhea: (o, lat, lon, n, d) => { cratered(o, n, d, [0.66, 0.66, 0.64], [0.86, 0.86, 0.84], 0.65, 15); rayed(o, n, 21, -128, 1.6, 8, 0.8); void lat; void lon; },
  Miranda: (o, lat, lon, n, d) => { cratered(o, n, d, [0.6, 0.6, 0.6], [0.8, 0.8, 0.78], 0.4, 16); if (ridged(n[0] * 4, n[1] * 12, n[2] * 4, 3) > 0.8) { o.h += 0.05; shade(o, 1.12); } void lat; void lon; },
  Ariel: (o, lat, lon, n, d) => { cratered(o, n, d, [0.66, 0.66, 0.64], [0.82, 0.82, 0.8], 0.35, 17); if (ridged(n[0] * 6, n[1] * 6, n[2] * 6, 3) > 0.9) { o.h -= 0.06; shade(o, 0.85); } void lat; void lon; },
  Umbriel: (o, lat, lon, n, d) => { cratered(o, n, d, [0.26, 0.26, 0.26], [0.36, 0.36, 0.35], 0.7, 18); const a = angTo(n, -10, 270); if (a < 2.5) mixTo(o, [0.8, 0.8, 0.78], 0.8 * (a > 1.5 ? 1 : 0.4)); void lat; void lon; },
  Titania: (o, lat, lon, n, d) => { cratered(o, n, d, [0.56, 0.52, 0.5], [0.72, 0.68, 0.64], 0.5, 19); void lat; void lon; },
  Oberon: (o, lat, lon, n, d) => { cratered(o, n, d, [0.44, 0.4, 0.38], [0.6, 0.55, 0.5], 0.7, 20); void lat; void lon; },
  Vesta: (o, lat, lon, n, d) => {
    cratered(o, n, d, [0.42, 0.39, 0.35], [0.6, 0.56, 0.5], 0.45, 22);
    // Rheasilvia: a basin half the asteroid across, with a central peak twice Everest
    const a = angTo(n, -75, 301) / 52;
    if (a < 1.1) { o.h += a < 1 ? -0.2 * (1 - a * a) + 0.35 * Math.max(0, 1 - a / 0.25) : 0.06; }
    void lat; void lon;
  },
  Eris: (o, lat, lon, n, d) => { cratered(o, n, d, [0.88, 0.88, 0.87], [0.96, 0.96, 0.95], 0.1, 23); void lat; void lon; },
  Makemake: (o, lat, lon, n, d) => { cratered(o, n, d, [0.72, 0.56, 0.44], [0.86, 0.74, 0.62], 0.1, 24); void lat; void lon; },
  Haumea: (o, lat, lon, n, d) => { cratered(o, n, d, [0.82, 0.82, 0.82], [0.92, 0.92, 0.92], 0.2, 25); const a = angTo(n, 0, 200); if (a < 25) mixTo(o, [0.6, 0.3, 0.25], ss(25, 15, a) * 0.6); void lat; void lon; },
  Deimos: (o, lat, lon, n, d) => { cratered(o, n, d, [0.42, 0.38, 0.34], [0.5, 0.46, 0.42], 0.3, 21); void lat; void lon; },
};

export { cratered };
