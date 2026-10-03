import type { Body } from '../physics/body';
import { AU_M, MSUN_KG } from '../physics/units';
import type { SurfaceMap } from '../pixel/surface';
import { hash, vnoise } from '../pixel/noise';

/**
 * The ground of a world, close up: heights in metres and colours at any point,
 * so a patch of terrain can be built round wherever you are at whatever
 * resolution the distance calls for. The broad shape comes from the world's
 * surface map — the same one it wears from orbit, so the Earth's mountains are
 * where its mountains are and the Moon's maria are its maria — scaled to the
 * world's real relief; below the map's resolution, fractal detail, craters on
 * airless worlds, and seas held flat at their level.
 *
 * Everything here is plain arithmetic on plain arrays, so the terrain worker
 * builds the same ground the walker stands on.
 */

export type V3 = [number, number, number];

/** what the ground of one world is made from: small enough to hand to a worker */
export interface TerrainSrc {
  key: string;
  /** radius, m */
  R: number;
  w: number; h: number;
  height: Float32Array; rgb: Float32Array; spec: Uint8Array;
  /** metres per unit of map height, and the map height of the datum */
  K: number; datum: number;
  /** the map holds seas (spec set), held flat at height 0 */
  seas: boolean;
  /** the map is all but flat: make the broad relief from noise instead, this tall (m) */
  synth: number;
  /** how rough the detail is (1 = rocky), how cratered (0–1) */
  rough: number; craters: number;
  seed: number;
  /** the tallest the ground goes above or below the datum, m, so the planet's sphere can be tucked under it */
  relief: number;
}

/** the real spread of heights (m) on the worlds we know, from the lowest basins to the highest peaks */
const RELIEF: Record<string, number> = {
  Earth: 8800, Moon: 4500, Mars: 26000, Mercury: 9000, Venus: 11000, Io: 14000, Europa: 1500, Ganymede: 4000, Callisto: 4000,
  Titan: 1000, Pluto: 6000, Charon: 7000, Ceres: 9000, Triton: 1500, Enceladus: 3000, Vesta: 40000, Phobos: 6000, Deimos: 2500,
  Mimas: 10000, Tethys: 8000, Dione: 6000, Rhea: 8000, Iapetus: 18000, Miranda: 15000, Ariel: 8000, Umbriel: 6000, Titania: 6000, Oberon: 8000,
  Eris: 3000, Makemake: 3000, Haumea: 6000,
};
/** worlds without craters to speak of: young or weathered surfaces */
const SMOOTH = new Set(['Earth', 'Venus', 'Io', 'Europa', 'Titan', 'Triton', 'Enceladus']);

const G = 6.674e-11;

/** the ground's recipe for a world, from its look and the map it wears */
export function terrainSrc(b: Body, map: SurfaceMap): TerrainSrc {
  const R = b.r * AU_M, real = b.look.real, style = b.look.style;
  const g = G * b.m * MSUN_KG / (R * R) / 9.81;
  // the map's own spread of heights (1st to 99th percentile, from a sample)
  const hs: number[] = [];
  const step = Math.max(1, Math.floor(map.height.length / 4000));
  for (let i = 0; i < map.height.length; i += step) if (!map.spec[i]) hs.push(map.height[i]);
  hs.sort((a, c) => a - c);
  const lo = hs.length ? hs[Math.floor(hs.length * 0.01)] : 0.5, hi = hs.length ? hs[Math.floor(hs.length * 0.99)] : 0.5;
  const med = hs.length ? hs[hs.length >> 1] : 0.5;
  const spread = hi - lo;
  // how tall the relief should be: measured, or mountains that scale against gravity, never more than a twentieth of the radius
  const styleK = style === 'ice' ? 0.5 : style === 'ocean' ? 0.4 : style === 'lava' ? 0.7 : style === 'desert' ? 1.1 : 1;
  const want = real && Object.hasOwn(RELIEF, real) ? RELIEF[real] : Math.min(0.05 * R, 9000 * styleK / Math.pow(Math.max(g, 0.01), 0.7));
  const seas = map.spec.some(s => s > 0);
  const flat = spread < 0.004;
  const K = flat ? 0 : want / spread;
  const crat = real ? (SMOOTH.has(real) ? 0.05 : real === 'Ganymede' ? 0.5 : 1) : ['barren', 'rocky', 'iron', 'carbon'].includes(style) ? 1 : style === 'ice' ? 0.6 : style === 'desert' ? 0.35 : 0.1;
  const rough = style === 'ice' ? 0.55 : style === 'ocean' ? 0.6 : style === 'lava' ? 1.2 : style === 'terran' ? 0.9 : 1;
  return {
    key: `${real ?? ''}|${style}|${b.look.seed}|${map.w}`, R, w: map.w, h: map.h, height: map.height, rgb: map.rgb, spec: map.spec,
    K, datum: seas ? lo : med, seas, synth: flat ? want : 0, rough, craters: crat, seed: b.look.seed % 9973,
    relief: Math.max(want, 50) * 1.1 + 200,
  };
}

// ---------------------------------------------------------------- sampling the map
/** bilinear read of a map channel at a direction (body frame) */
function mapAt(t: TerrainSrc, n: V3, ch: Float32Array, stride: number, c: number) {
  const lon = Math.atan2(n[1], n[0]), lat = Math.asin(Math.max(-1, Math.min(1, n[2])));
  const u = ((lon / (2 * Math.PI)) % 1 + 1) % 1 * t.w - 0.5, v = Math.max(0, Math.min(t.h - 1.001, (lat / Math.PI + 0.5) * t.h - 0.5));
  const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
  const ia = (i0 + t.w) % t.w, ib = (i0 + 1) % t.w, j1 = Math.min(t.h - 1, j0 + 1);
  const a = ch[(j0 * t.w + ia) * stride + c], b = ch[(j0 * t.w + ib) * stride + c], d = ch[(j1 * t.w + ia) * stride + c], e = ch[(j1 * t.w + ib) * stride + c];
  return (a * (1 - fu) + b * fu) * (1 - fv) + (d * (1 - fu) + e * fu) * fv;
}

/** how much of the nearby map is sea, 0–1 */
function seaAt(t: TerrainSrc, n: V3) {
  const lon = Math.atan2(n[1], n[0]), lat = Math.asin(Math.max(-1, Math.min(1, n[2])));
  const u = ((lon / (2 * Math.PI)) % 1 + 1) % 1 * t.w - 0.5, v = Math.max(0, Math.min(t.h - 1.001, (lat / Math.PI + 0.5) * t.h - 0.5));
  const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
  const ia = (i0 + t.w) % t.w, ib = (i0 + 1) % t.w, j1 = Math.min(t.h - 1, j0 + 1);
  const s = (k: number) => (t.spec[k] > 0 ? 1 : 0);
  return (s(j0 * t.w + ia) * (1 - fu) + s(j0 * t.w + ib) * fu) * (1 - fv) + (s(j1 * t.w + ia) * (1 - fu) + s(j1 * t.w + ib) * fu) * fv;
}

// ---------------------------------------------------------------- detail
/** a cube face and coordinates on it, for laying cells over a sphere */
function cubeFace(n: V3): [number, number, number] {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  if (ax >= ay && ax >= az) return [n[0] > 0 ? 0 : 1, n[1] / ax, n[2] / ax];
  if (ay >= az) return [n[1] > 0 ? 2 : 3, n[0] / ay, n[2] / ay];
  return [n[2] > 0 ? 4 : 5, n[0] / az, n[1] / az];
}

/** craters of one size class (cells `L` metres across): their effect on the height here, m */
function craterLayer(t: TerrainSrc, n: V3, L: number, density: number, salt: number) {
  const [f, a, b] = cubeFace(n);
  const s = t.R / L;
  const x = a * s, y = b * s, ix = Math.floor(x), iy = Math.floor(y);
  let dh = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ix + i, cy = iy + j;
    const r0 = hash(cx * 7 + f * 1013 + salt, cy * 13 + t.seed, salt);
    if (r0 > density) continue;
    const px = cx + hash(cx, cy, salt + 1), py = cy + hash(cx, cy, salt + 2);
    const rad = (0.12 + 0.33 * Math.pow(hash(cx, cy, salt + 3), 2)) ; // in cells
    const d = Math.hypot(x - px, y - py) / rad;
    if (d > 2.2) continue;
    const D = rad * 2 * L; // diameter, m
    const depth = 0.18 * D * (1 - Math.exp(-D / 400)) + 0.05 * D * Math.exp(-D / 400);
    // a bowl, a raised rim, and ejecta fading outwards
    if (d < 1) dh += -depth * (1 - d * d) + 0.04 * D * Math.pow(d, 6);
    else dh += 0.04 * D * Math.exp(-(((d - 1) / 0.25) ** 2)) + 0.01 * D * Math.exp(-(d - 1) * 2);
  }
  return dh;
}

/**
 * Height of the ground (m above the radius) in direction `n` (a unit vector in
 * the body's frame), with detail down to features about `res` metres across.
 */
export function heightAt(t: TerrainSrc, n: V3, res = 1): number {
  const R = t.R;
  let h: number;
  const sea = t.seas ? seaAt(t, n) : 0;
  if (t.synth > 0) {
    // a flat map (Venus under its clouds, Titan under its haze): broad plains and highlands from noise
    const c = vnoise(n[0] * 3 + t.seed, n[1] * 3, n[2] * 3) * 0.5 + vnoise(n[0] * 9, n[1] * 9 + t.seed, n[2] * 9) * 0.3 + vnoise(n[0] * 27, n[1] * 27, n[2] * 27 + t.seed) * 0.2;
    h = (Math.pow(c, 1.6) - 0.3) * t.synth;
  } else {
    h = (mapAt(t, n, t.height, 1, 0) - t.datum) * t.K;
  }
  // fractal detail below the map's resolution: each octave half the size and about 0.6 the height
  const texel = (2 * Math.PI * R) / t.w;
  const x = n[0] * R, y = n[1] * R, z = n[2] * R;
  let lam = texel * 1.5, amp = 0.012 * texel * t.rough * (1 + 0.5 * vnoise(x / 9e4 + 3, y / 9e4, z / 9e4));
  // the low parts of a world are smoother than its uplands
  const upland = t.K > 0 ? Math.max(0.35, Math.min(1.6, 0.8 + h / Math.max(1, t.relief) * 1.5)) : 1;
  amp *= upland;
  let d = 0, k = 0;
  while (lam > res * 0.7 && k < 18) {
    const v = vnoise(x / lam + k * 17.3, y / lam - k * 9.1, z / lam + k * 3.7) - 0.5;
    d += v * 2 * amp;
    lam *= 0.5; amp *= 0.58; k++;
  }
  h += d;
  // craters, big to small, on worlds that keep them
  if (t.craters > 0.02) {
    for (const [L, dens, salt] of [[24000, 0.35, 11], [5000, 0.4, 23], [1200, 0.45, 37], [300, 0.5, 51], [70, 0.55, 67], [16, 0.6, 79]] as const) {
      if (L * 0.3 < res) break;
      if (L > texel * 4) continue;
      h += craterLayer(t, n, L, dens * t.craters, salt + t.seed);
    }
  }
  // seas lie flat; the coast rises gently from them
  if (sea > 0) {
    if (sea >= 0.5) return 0;
    h = Math.max(h, 0) * (1 - 2 * sea) + 0.5;
  } else if (t.seas) h = Math.max(h, 1);
  return h;
}

/** the colour of the ground there (linear RGB), whether it is sea */
export function colourAt(t: TerrainSrc, n: V3, h: number, slope: number, out: { r: number; g: number; b: number; sea: boolean }) {
  let r = mapAt(t, n, t.rgb, 3, 0), g = mapAt(t, n, t.rgb, 3, 1), b = mapAt(t, n, t.rgb, 3, 2);
  const sea = t.seas && h <= 0.01 && seaAt(t, n) >= 0.5;
  out.sea = sea;
  if (!sea) {
    // mottled at small scales, bare rock where it is steep, a little lighter on the heights
    const x = n[0] * t.R, y = n[1] * t.R, z = n[2] * t.R;
    const m = 0.86 + 0.28 * vnoise(x / 37, y / 37, z / 37) * 0.6 + 0.28 * vnoise(x / 3.1, y / 3.1, z / 3.1) * 0.4;
    r *= m; g *= m; b *= m;
    const rock = Math.min(1, Math.max(0, (slope - 0.45) * 2.5));
    const grey = (r + g + b) / 3 * 0.85;
    r += (grey * 1.02 - r) * rock * 0.7; g += (grey - g) * rock * 0.7; b += (grey * 0.96 - b) * rock * 0.7;
  }
  out.r = r; out.g = g; out.b = b;
}

// ---------------------------------------------------------------- a patch of ground
export interface Patch {
  /** the centre of the patch (unit vector, body frame) and its half-width, m */
  c: V3; E: number; N: number;
  /** vertices relative to the centre point on the sphere (c · R), m, body frame; colours; normals; triangles */
  pos: Float32Array; col: Float32Array; nor: Float32Array; idx: Uint32Array;
  /** the heights on the grid (m), and the stretch of the grid, to read the ground back exactly as it is drawn */
  hgt: Float32Array; k: number;
}

/** the axes of the plane touching the sphere at `c`: east and north */
export function tangent(c: V3): [V3, V3] {
  const z: V3 = Math.abs(c[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1];
  let e: V3 = [z[1] * c[2] - z[2] * c[1], z[2] * c[0] - z[0] * c[2], z[0] * c[1] - z[1] * c[0]];
  const l = Math.hypot(e[0], e[1], e[2]);
  e = [e[0] / l, e[1] / l, e[2] / l];
  const nn: V3 = [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]];
  return [e, nn];
}

/** spacing grows outwards from the middle: fine where you are, coarse at the horizon */
function stretch(E: number, N: number, fine: number) {
  // find k so the middle spacing is about `fine`: E·k/sinh(k)·2/(N−1) = fine
  const want = Math.min(1, fine * (N - 1) / (2 * E));
  let lo = 1e-3, hi = 14;
  for (let i = 0; i < 40; i++) { const k = (lo + hi) / 2; if (k / Math.sinh(k) > want) lo = k; else hi = k; }
  const k = (lo + hi) / 2;
  return { k, f: (u: number) => k < 0.01 ? E * u : E * Math.sinh(k * u) / Math.sinh(k) };
}

/**
 * Build a square patch of ground `2E` metres across round direction `c`, on
 * an N×N grid whose spacing is about `fine` metres in the middle. The rim is
 * dropped as a skirt, so no gap shows where the patch ends.
 */
export function buildPatch(t: TerrainSrc, c: V3, E: number, N: number, fine: number): Patch {
  const [e, nn] = tangent(c);
  const R = t.R, { k: kk, f } = stretch(E, N, fine);
  const M = N + 2; // with the skirt
  const pos = new Float32Array(M * M * 3), col = new Float32Array(M * M * 3), nor = new Float32Array(M * M * 3);
  const hgt = new Float64Array(M * M), dirs = new Float64Array(M * M * 3);
  const coord = (i: number) => f(Math.max(-1, Math.min(1, ((i - 1) / (N - 1)) * 2 - 1)));
  for (let j = 0; j < M; j++) {
    const y = coord(j), dy = Math.abs(coord(Math.min(M - 1, j + 1)) - y) || 1;
    for (let i = 0; i < M; i++) {
      const x = coord(i), dx = Math.abs(coord(Math.min(M - 1, i + 1)) - x) || 1;
      let d: V3 = [c[0] * R + e[0] * x + nn[0] * y, c[1] * R + e[1] * x + nn[1] * y, c[2] * R + e[2] * x + nn[2] * y];
      const l = Math.hypot(d[0], d[1], d[2]);
      d = [d[0] / l, d[1] / l, d[2] / l];
      const k = j * M + i;
      dirs[k * 3] = d[0]; dirs[k * 3 + 1] = d[1]; dirs[k * 3 + 2] = d[2];
      hgt[k] = heightAt(t, d, Math.max(dx, dy) * 0.9);
    }
  }
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const k = j * M + i;
    const skirt = i === 0 || j === 0 || i === M - 1 || j === M - 1;
    const h = skirt ? hgt[k] - Math.max(30, E * 0.03) : hgt[k];
    const r = R + h;
    pos[k * 3] = dirs[k * 3] * r - c[0] * R;
    pos[k * 3 + 1] = dirs[k * 3 + 1] * r - c[1] * R;
    pos[k * 3 + 2] = dirs[k * 3 + 2] * r - c[2] * R;
  }
  // normals from the neighbours, then colours (which want the slope)
  const p = (k: number, a: number) => pos[k * 3 + a];
  const out = { r: 0, g: 0, b: 0, sea: false };
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const k = j * M + i;
    const kl = j * M + Math.max(0, i - 1), kr = j * M + Math.min(M - 1, i + 1), kd = Math.max(0, j - 1) * M + i, ku = Math.min(M - 1, j + 1) * M + i;
    const ax = p(kr, 0) - p(kl, 0), ay = p(kr, 1) - p(kl, 1), az = p(kr, 2) - p(kl, 2);
    const bx = p(ku, 0) - p(kd, 0), by = p(ku, 1) - p(kd, 1), bz = p(ku, 2) - p(kd, 2);
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const d: V3 = [dirs[k * 3], dirs[k * 3 + 1], dirs[k * 3 + 2]];
    if (nx * d[0] + ny * d[1] + nz * d[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
    const slope = Math.sqrt(Math.max(0, 1 - (nx * d[0] + ny * d[1] + nz * d[2]) ** 2));
    colourAt(t, d, hgt[k], slope, out);
    col[k * 3] = out.r; col[k * 3 + 1] = out.g; col[k * 3 + 2] = out.b;
  }
  const idx = new Uint32Array((M - 1) * (M - 1) * 6);
  let q = 0;
  for (let j = 0; j < M - 1; j++) for (let i = 0; i < M - 1; i++) {
    const a = j * M + i, b = a + 1, cc = a + M, d = cc + 1;
    idx[q++] = a; idx[q++] = b; idx[q++] = d;
    idx[q++] = a; idx[q++] = d; idx[q++] = cc;
  }
  return { c, E, N: M, pos, col, nor, idx, hgt: Float32Array.from(hgt), k: kk };
}

/**
 * The height of the ground (m) at direction `n` as the patch draws it —
 * interpolated across its triangles' grid — or null when `n` is off the patch.
 * What a walker stands on, so feet meet the drawn ground.
 */
export function patchHeight(p: Patch, R: number, n: V3): number | null {
  const c = p.c, dc = n[0] * c[0] + n[1] * c[1] + n[2] * c[2];
  if (dc <= 0.5) return null;
  const [e, nn] = tangent(c);
  // where the direction meets the tangent plane, as the grid was laid out
  const s = R / dc;
  const px = n[0] * s - c[0] * R, py = n[1] * s - c[1] * R, pz = n[2] * s - c[2] * R;
  const x = px * e[0] + py * e[1] + pz * e[2], y = px * nn[0] + py * nn[1] + pz * nn[2];
  const inv = (v: number) => p.k < 0.01 ? v / p.E : Math.asinh(v / p.E * Math.sinh(p.k)) / p.k;
  const N = p.N - 2;
  const gx = (inv(x) + 1) / 2 * (N - 1) + 1, gy = (inv(y) + 1) / 2 * (N - 1) + 1;
  if (!(gx >= 1 && gy >= 1 && gx <= N && gy <= N)) return null;
  const M = p.N, i = Math.min(N - 1, Math.floor(gx)), j = Math.min(N - 1, Math.floor(gy)), fx = gx - i, fy = gy - j;
  const h = (ii: number, jj: number) => p.hgt[jj * M + ii];
  // the same split of each square into two triangles as the mesh
  return fx >= fy
    ? h(i, j) + (h(i + 1, j) - h(i, j)) * fx + (h(i + 1, j + 1) - h(i + 1, j)) * fy
    : h(i, j) + (h(i, j + 1) - h(i, j)) * fy + (h(i + 1, j + 1) - h(i, j + 1)) * fx;
}

/** a point a distance east and north (m) of `c` along the ground, as a direction */
export function offsetDir(c: V3, east: number, north: number, R: number): V3 {
  const [e, nn] = tangent(c);
  const d: V3 = [c[0] * R + e[0] * east + nn[0] * north, c[1] * R + e[1] * east + nn[1] * north, c[2] * R + e[2] * east + nn[2] * north];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
}

/** latitude and longitude (degrees, east positive) of a direction in the body's frame */
export function latLon(n: V3): [number, number] {
  return [Math.asin(Math.max(-1, Math.min(1, n[2]))) * 180 / Math.PI, Math.atan2(n[1], n[0]) * 180 / Math.PI];
}

/** the direction (body frame) of a latitude and longitude in degrees */
export function dirOf(latD: number, lonD: number): V3 {
  const la = latD * Math.PI / 180, lo = lonD * Math.PI / 180;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}
