import type { Look } from '../physics/body';
import { fbm, ridged, vnoise } from './noise';
import { MARS } from './marsdata';
import { EARTH_DEM } from './earthdata';
import { REAL, paintTerran, cratered, ss, type Tx, type Detail, type V3 } from './worlds';

/**
 * A body's surface as an equirectangular map in its own spinning frame:
 * colour, height, glow, shine and cloud per texel, rows from south to north.
 * Real worlds are painted from what is known of them (see worlds.ts); made-up
 * ones from noise of the right character. Maps come in any size: small for a
 * dot on the map, large for a world filling the 3D view, built a few rows at
 * a time so a big one does not stall a frame.
 */
export interface SurfaceMap {
  w: number; h: number;
  rgb: Float32Array; emit: Float32Array; spec: Float32Array;
  /** relief, 0–1 with 0.5 the datum: for shading the hills and craters */
  height: Float32Array;
  /** cloud cover 0–1, drawn over the ground, or null for a world without weather */
  cloud: Float32Array | null;
  gas: boolean;
}

const hex = (c: number): V3 => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
const isGas = (st: string) => st === 'gas' || st === 'icegiant' || st === 'hotjupiter' || st === 'browndwarf';

/** how finely to paint at a given width */
export function detailFor(w: number): Detail {
  const l = Math.log2(w / 32);
  return { oct: Math.max(3, Math.min(8, Math.round(2 + l))), craters: w <= 64 ? 1 : w <= 256 ? 2 : w <= 512 ? 3 : 4, res: w };
}

/** the key under which two looks paint the same map (Mars' changes when its measured maps arrive) */
export const lookKey = (l: Look) => `${l.real ?? ''}${(l.real === 'Mars' && MARS) || (l.real === 'Earth' && EARTH_DEM) ? '*' : ''}|${l.style}|${l.c1}|${l.c2}|${l.seed % 1000}`;

export interface MapJob { map: SurfaceMap; done: boolean; step(budgetMs: number): boolean }

/** start painting a map `w` wide (and half as tall); `step` paints rows until the budget runs out */
export function mapJob(look: Look, w: number): MapJob {
  const W = Math.max(16, Math.round(w)), H = W >> 1;
  const st = look.style;
  const gas = isGas(st);
  const paint = look.real ? REAL[look.real] : undefined;
  const clouds = look.real === 'Earth' || (!paint && (st === 'terran' || st === 'ocean'));
  const map: SurfaceMap = {
    w: W, h: H, rgb: new Float32Array(W * H * 3), emit: new Float32Array(W * H), spec: new Float32Array(W * H),
    height: new Float32Array(W * H), cloud: clouds ? new Float32Array(W * H) : null, gas,
  };
  const d = detailFor(W);
  const o: Tx = { r: 0, g: 0, b: 0, h: 0.5, e: 0, s: 0, c: 0 };
  const at = pointPainter(look);
  let row = 0;
  const job: MapJob = {
    map, done: false,
    step(budget: number) {
      const t0 = performance.now();
      while (row < H) {
        const j = row++;
        const lat = ((j + 0.5) / H - 0.5) * Math.PI;
        const cl = Math.cos(lat), sl = Math.sin(lat);
        for (let i = 0; i < W; i++) {
          const lon = ((i + 0.5) / W) * 2 * Math.PI;
          const n: V3 = [cl * Math.cos(lon), cl * Math.sin(lon), sl];
          o.r = o.g = o.b = 0.5; o.h = 0.5; o.e = 0; o.s = 0; o.c = 0; o.w = -1;
          at(o, lat, lon, n, d);
          const k = j * W + i;
          map.rgb[k * 3] = Math.max(0, Math.min(1, o.r)); map.rgb[k * 3 + 1] = Math.max(0, Math.min(1, o.g)); map.rgb[k * 3 + 2] = Math.max(0, Math.min(1, o.b));
          map.height[k] = o.h; map.emit[k] = o.e; map.spec[k] = o.w! >= 0 ? o.w! : o.s;
          if (map.cloud) map.cloud[k] = o.c;
        }
        if (performance.now() - t0 > budget) break;
      }
      job.done = row >= H;
      return job.done;
    },
  };
  return job;
}

/**
 * the painter for a look, one point at a time: whatever paints its map, so
 * the ground seen close up (terrain.ts) is the same ground the map shows
 */
export function pointPainter(look: Look): (o: Tx, lat: number, lon: number, n: V3, d: Detail) => void {
  const paint = look.real ? REAL[look.real] : undefined;
  if (paint) return paint;
  const c1 = hex(look.c1), c2 = hex(look.c2);
  const sd = (look.seed % 1000) * 0.137;
  const bandSet = isGas(look.style) ? gasBands(look, c1, c2) : null;
  return (o, lat, _lon, n, d) => procedural(o, look, n, lat, d, c1, c2, sd, bandSet);
}

/** a whole map at once (small ones are quick) */
export function buildMap(look: Look, w = 256): SurfaceMap {
  const j = mapJob(look, w);
  j.step(Infinity);
  return j.map;
}

/** a copy, to paint craters into without touching the original */
export function cloneMap(m: SurfaceMap): SurfaceMap {
  return { ...m, rgb: m.rgb.slice(), emit: m.emit.slice(), spec: m.spec.slice(), height: m.height.slice(), cloud: m.cloud ? m.cloud.slice() : null };
}

/** belts and zones for a giant planet of the given look: latitudes and colours from its seed */
function gasBands(look: Look, c1: V3, c2: V3) {
  const n = look.style === 'icegiant' ? 5 : look.style === 'browndwarf' ? 9 : 13;
  const out: { to: number; c: V3 }[] = [];
  let lat = -90;
  for (let k = 0; k < n; k++) {
    const r = vnoise(k * 1.7 + (look.seed % 97), 3.3, 1.1);
    lat += (180 / n) * (0.6 + 0.8 * r);
    const t = k % 2 ? 0.15 + 0.3 * r : 0.65 + 0.35 * r;
    out.push({ to: k === n - 1 ? 91 : Math.min(89, lat), c: [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t] });
  }
  return out;
}

function procedural(o: Tx, look: Look, n: V3, lat: number, d: Detail, c1: V3, c2: V3, sd: number, bands: { to: number; c: V3 }[] | null) {
  const st = look.style;
  const sx = n[0] * 2 + sd, sy = n[1] * 2 + sd, sz = n[2] * 2 + sd;
  const latD = (lat * 180) / Math.PI, alat = Math.abs(latD);
  const mixc = (a: V3, b: V3, t: number) => { o.r = a[0] + (b[0] - a[0]) * t; o.g = a[1] + (b[1] - a[1]) * t; o.b = a[2] + (b[2] - a[2]) * t; };
  const toward = (c: V3, t: number) => { if (t <= 0) return; o.r += (c[0] - o.r) * t; o.g += (c[1] - o.g) * t; o.b += (c[2] - o.b) * t; };
  if (st === 'terran' || st === 'ocean') {
    paintTerran(o, n, latD, st === 'ocean' ? 0.64 : 0.52, sd, c1, c2, d);
  } else if (st === 'barren' || st === 'rocky') {
    cratered(o, n, d, c1, c2, st === 'barren' ? 0.6 : 0.3, look.seed % 97);
    const hi = fbm(sx * 1.5, sy * 1.5, sz * 1.5, d.oct);
    o.h += (hi - 0.5) * 0.2;
    if (st === 'rocky') { const k = 0.85 + 0.3 * hi; o.r *= k; o.g *= k; o.b *= k; }
  } else if (st === 'desert') {
    const h = fbm(sx * 1.6, sy * 1.6, sz * 1.6, d.oct);
    mixc(c1, c2, ss(0.3, 0.7, h));
    const dune = 0.5 + 0.5 * Math.sin(n[2] * 60 + fbm(sx * 3, sy * 3, sz * 3, 3) * 10);
    const k = 0.9 + 0.12 * dune; o.r *= k; o.g *= k; o.b *= k;
    o.h = 0.5 + 0.1 * (h - 0.5) + 0.02 * dune;
    toward([0.95, 0.93, 0.9], ss(78, 86, alat + (h - 0.5) * 10) * 0.85);
  } else if (st === 'ice') {
    cratered(o, n, d, c1, c2, 0.35, look.seed % 97);
    const r = ridged(sx * 2.5, sy * 2.5, sz * 2.5, d.oct);
    toward([c1[0] * 0.6, c1[1] * 0.6, c1[2] * 0.6], ss(0.9, 0.98, r) * 0.8);
    o.h -= 0.04 * ss(0.9, 0.98, r);
  } else if (st === 'lava') {
    const crack = ss(0.7, 0.92, ridged(sx * 2.2, sy * 2.2, sz * 2.2, d.oct));
    mixc(c1, [Math.min(1, c1[0] * 1.5), Math.min(1, c1[1] * 1.5), Math.min(1, c1[2] * 1.5)], fbm(sx * 4, sy * 4, sz * 4, d.oct));
    o.e = crack;
    o.h = 0.5 - 0.06 * crack + 0.08 * fbm(sx * 3, sy * 3, sz * 3, d.oct);
  } else if (st === 'iron' || st === 'carbon') {
    cratered(o, n, d, c1, c2, 0.4, look.seed % 97);
    o.s = st === 'iron' ? 1 : 0;
  } else if (bands) {
    // zonal bands, rippled by turbulence and drawn out along the latitudes
    const turb = fbm(n[0] * 3 + sd, n[1] * 3 + sd, n[2] * 16 + sd, d.oct);
    const L = latD + (turb - 0.5) * (st === 'icegiant' ? 3 : 7);
    let i = bands.findIndex(b => L < b.to);
    if (i < 0) i = bands.length - 1;
    const b = bands[i], p = bands[Math.max(0, i - 1)];
    mixc(p.c, b.c, ss(0, 3, L - (i > 0 ? p.to : -91)));
    const fine = fbm(n[0] * 10 + sd, n[1] * 10 + sd, n[2] * 50 + sd, d.oct);
    const k = 0.9 + 0.2 * fine; o.r *= k; o.g *= k; o.b *= k;
    o.h = 0.5 + 0.05 * (fine - 0.5);
    if (st === 'gas' || st === 'hotjupiter') {
      // one great storm
      const sx2 = Math.cos(sd), sy2 = Math.sin(sd), sz2 = -0.35, n2 = Math.hypot(sx2, sy2, sz2);
      const dd = Math.hypot(n[0] - sx2 / n2, n[1] - sy2 / n2, n[2] - sz2 / n2);
      toward([0.78, 0.42, 0.3], ss(0.17, 0.08, dd) * 0.85);
    }
    if (st === 'browndwarf' || st === 'hotjupiter') o.e = (st === 'browndwarf' ? 0.5 : 0.2) + 0.4 * (fine - 0.3);
  } else {
    mixc(c1, c2, fbm(sx, sy, sz, d.oct));
  }
}

/** Paint a crater into the map: a dark floor, a bright rim, a pale blanket. Direction in the body's frame. */
export function paintCrater(m: SurfaceMap, dx: number, dy: number, dz: number, ang: number) {
  const a = Math.max(ang, 1.2 * Math.PI / m.h); // never smaller than a texel or it would vanish
  // only the rows and columns it can reach
  const lat0 = Math.asin(Math.max(-1, Math.min(1, dz))), reach = a * 2.2;
  const j0 = Math.max(0, Math.floor(((lat0 - reach) / Math.PI + 0.5) * m.h)), j1 = Math.min(m.h - 1, Math.ceil(((lat0 + reach) / Math.PI + 0.5) * m.h));
  const lon0 = Math.atan2(dy, dx), cosl = Math.cos(Math.min(Math.PI / 2 - 1e-3, Math.abs(lat0) + reach));
  const span = cosl > 0.05 && Math.abs(lat0) + reach < Math.PI / 2 ? reach / cosl : Math.PI;
  const di = Math.ceil((span / (2 * Math.PI)) * m.w) + 1, ic = Math.round(((lon0 / (2 * Math.PI)) + 1) % 1 * m.w);
  for (let j = j0; j <= j1; j++) {
    const lat = ((j + 0.5) / m.h - 0.5) * Math.PI;
    for (let q = span >= Math.PI ? 0 : ic - di; q <= (span >= Math.PI ? m.w - 1 : ic + di); q++) {
      const i = ((q % m.w) + m.w) % m.w;
      const lon = ((i + 0.5) / m.w) * 2 * Math.PI;
      const nx = Math.cos(lat) * Math.cos(lon), ny = Math.cos(lat) * Math.sin(lon), nz = Math.sin(lat);
      const d = Math.acos(Math.max(-1, Math.min(1, nx * dx + ny * dy + nz * dz))) / a;
      if (d > 2.2) continue;
      const k = j * m.w + i;
      const f = d < 0.8 ? 0.62 : d < 1.15 ? 1.35 : 1.08;
      for (let c = 0; c < 3; c++) m.rgb[k * 3 + c] = Math.min(1, m.rgb[k * 3 + c] * f);
      m.height[k] += d < 1 ? -0.1 * (1 - d * d) : d < 1.3 ? 0.05 * (1 - Math.abs(d - 1.12) / 0.18) : 0;
      if (m.cloud) m.cloud[k] *= 0.6;
    }
  }
}

/**
 * Look up a point of a map, blended between texels: colour with the clouds
 * over it, glow, shine, and the slope of the ground (for shading relief).
 */
export function sampleMap(m: SurfaceMap, lat: number, lon: number, out: { r: number; g: number; b: number; e: number; s: number; dx: number; dy: number }) {
  const u = ((lon / (2 * Math.PI)) % 1 + 1) % 1 * m.w - 0.5, v = Math.max(0, Math.min(m.h - 1.001, (lat / Math.PI + 0.5) * m.h - 0.5));
  const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
  const ia = (i0 + m.w) % m.w, ib = (i0 + 1) % m.w, j1 = Math.min(m.h - 1, j0 + 1);
  const k00 = j0 * m.w + ia, k01 = j0 * m.w + ib, k10 = j1 * m.w + ia, k11 = j1 * m.w + ib;
  const w00 = (1 - fu) * (1 - fv), w01 = fu * (1 - fv), w10 = (1 - fu) * fv, w11 = fu * fv;
  const ch = (a: Float32Array, c: number, n: number) => a[k00 * n + c] * w00 + a[k01 * n + c] * w01 + a[k10 * n + c] * w10 + a[k11 * n + c] * w11;
  let r = ch(m.rgb, 0, 3), g = ch(m.rgb, 1, 3), b = ch(m.rgb, 2, 3);
  if (m.cloud) { const c = ch(m.cloud, 0, 1); r += (1 - r) * c; g += (1 - g) * c; b += (1 - b) * c; }
  out.r = r; out.g = g; out.b = b;
  out.e = ch(m.emit, 0, 1);
  out.s = m.spec[k00];
  // the slope, per radian of longitude and latitude
  const hW = m.height[j0 * m.w + ia], hE = m.height[j0 * m.w + ib], hN = m.height[j1 * m.w + ia];
  out.dx = (hE - hW) * m.w / (2 * Math.PI);
  out.dy = (hN - hW) * m.h / Math.PI;
}

const band = (r: number, a: number, b: number) => (r >= a && r <= b ? 1 : 0);

/**
 * Normal optical depth of planetary rings against radius in planet radii, from
 * the Voyager and Cassini occultation profiles (smoothed).
 */
export function ringTau(kind: string | undefined, r: number): number {
  if (kind === 'saturn') {
    let t = 0;
    t += 0.01 * band(r, 1.11, 1.236);                                          // D
    t += (0.09 + 0.05 * Math.sin(r * 140)) * band(r, 1.239, 1.527);            // C
    t += Math.max(0.3, 1.8 + 0.9 * Math.sin(r * 70 + 1.3)) * band(r, 1.527, 1.951); // B
    t += 0.12 * band(r, 1.951, 2.025);                                         // Cassini Division
    t += (0.55 + 0.1 * Math.sin(r * 160)) * band(r, 2.025, 2.27);             // A
    t *= 1 - band(r, 2.211, 2.217);                                            // Encke gap
    t += 0.5 * band(r, 2.322, 2.33);                                           // F
    return t;
  }
  if (kind === 'uranus') {
    return 0.3 * (band(r, 1.636, 1.642) + band(r, 1.65, 1.656) + band(r, 1.663, 1.669)) + 0.4 * band(r, 1.744, 1.753)
      + 0.3 * band(r, 1.784, 1.791) + 0.3 * band(r, 1.844, 1.85) + 0.5 * band(r, 1.859, 1.864) + 0.4 * band(r, 1.894, 1.9)
      + 1.2 * band(r, 1.99, 2.006);
  }
  if (kind === 'neptune') return 0.08 * band(r, 1.67, 1.71) + 0.05 * band(r, 2.13, 2.17) + 0.01 * band(r, 2.17, 2.4) + 0.1 * band(r, 2.53, 2.55);
  if (kind === 'jupiter') return 0.002 * band(r, 1.29, 1.71) + 0.006 * band(r, 1.72, 1.81) + 0.0006 * band(r, 1.81, 3.2);
  return 0.6;
}
