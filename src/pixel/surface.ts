import type { Look } from '../physics/body';
import { fbm, ridged, vnoise } from './noise';

/**
 * A body's surface as an equirectangular map in its own spinning frame:
 * colour, emission and shininess per texel. Baked once from the body's look;
 * the sprite renderer then only has to look up and light it, which is cheap
 * enough to redo every frame as the body turns and its star moves.
 */
export interface SurfaceMap { w: number; h: number; rgb: Float32Array; emit: Float32Array; spec: Uint8Array; gas: boolean }

export const MAP_W = 128, MAP_H = 64;

const hex = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** pixel art reads as a limited palette: a few tones per channel */
const post = (v: number) => Math.round(v * 14) / 14;

export function buildMap(look: Look): SurfaceMap {
  const W = MAP_W, H = MAP_H;
  const rgb = new Float32Array(W * H * 3), emit = new Float32Array(W * H), spec = new Uint8Array(W * H);
  const c1 = hex(look.c1), c2 = hex(look.c2);
  const sd = (look.seed % 1000) * 0.137;
  const st = look.style;
  const gas = st === 'gas' || st === 'icegiant' || st === 'hotjupiter' || st === 'browndwarf';
  for (let j = 0; j < H; j++) {
    const lat = ((j + 0.5) / H - 0.5) * Math.PI;
    for (let i = 0; i < W; i++) {
      const lon = ((i + 0.5) / W) * 2 * Math.PI;
      const nx = Math.cos(lat) * Math.cos(lon), ny = Math.cos(lat) * Math.sin(lon), nz = Math.sin(lat);
      const sx = nx * 2 + sd, sy = ny * 2 + sd, sz = nz * 2 + sd;
      const alat = Math.abs(nz);
      let col: number[];
      let e = 0, sp = 0;
      if (st === 'terran' || st === 'ocean') {
        const h = fbm(sx * 1.3, sy * 1.3, sz * 1.3);
        const sea = st === 'ocean' ? 0.66 : 0.53;
        if (h < sea) { col = mix(c1.map(v => v * 0.55), c1, ss(sea - 0.25, sea, h)); sp = 1; }
        else {
          const m = fbm(sx * 3.1 + 5, sy * 3.1, sz * 3.1);
          col = mix(c2, [0.55, 0.45, 0.3], ss(0.45, 0.65, m));
          col = mix(col, [0.42, 0.4, 0.38], ss(sea + 0.12, sea + 0.22, h));
        }
        const ice = ss(0.8, 0.86, alat + 0.06 * fbm(sx * 4, sy * 4, sz * 4, 3));
        col = mix(col, [0.92, 0.95, 1], ice);
        const cl = ss(0.55, 0.72, fbm(nx * 2.5 + sd * 3, ny * 2.5, nz * 5, 4));
        col = mix(col, [1, 1, 1], cl * 0.85);
        if (ice > 0.5 || cl > 0.5) sp = 0;
      } else if (st === 'rocky' || st === 'barren' || st === 'desert') {
        const h = fbm(sx * 1.6, sy * 1.6, sz * 1.6);
        col = mix(c1, c2, ss(0.3, 0.7, h));
        const c = vnoise(sx * 9, sy * 9, sz * 9);
        const cr = ss(0.8, 0.86, c) - 0.6 * ss(0.86, 0.95, c);
        col = col.map(v => v * (1 + (st === 'desert' ? 0.08 : 0.25) * cr));
        if (st === 'desert') {
          const dune = 0.5 + 0.5 * Math.sin(nz * 40 + fbm(sx * 3, sy * 3, sz * 3, 3) * 8);
          col = col.map(v => v * (0.92 + 0.08 * dune));
          col = mix(col, [0.95, 0.92, 0.9], ss(0.9, 0.95, alat) * 0.8);
        }
      } else if (st === 'ice') {
        const h = fbm(sx * 1.4, sy * 1.4, sz * 1.4);
        col = mix(c1, c2, ss(0.25, 0.65, h));
        col = mix(col, c1.map(v => v * 0.6), ss(0.92, 0.98, ridged(sx * 2.5, sy * 2.5, sz * 2.5)));
        sp = 0;
      } else if (st === 'lava') {
        const crack = ss(0.72, 0.9, ridged(sx * 2.2, sy * 2.2, sz * 2.2));
        col = mix(c1, c1.map(v => Math.min(1, v * 1.6)), fbm(sx * 4, sy * 4, sz * 4, 3));
        e = crack;
      } else if (st === 'iron' || st === 'carbon') {
        const h = fbm(sx * 2, sy * 2, sz * 2);
        col = mix(c1, c2, st === 'carbon' ? ss(0.4, 0.8, h) : h);
        sp = 1;
      } else if (gas) {
        const bands = st === 'icegiant' ? 3 : st === 'browndwarf' ? 7 : 9;
        const turb = fbm(nx * 3 + sd, ny * 3 + sd, nz * 14 + sd);
        const b = Math.sin((nz + turb * (st === 'icegiant' ? 0.06 : 0.14)) * bands * Math.PI);
        col = mix(c1, c2, 0.5 + 0.5 * b);
        col = col.map(v => v * (0.88 + 0.24 * fbm(nx * 8 + sd, ny * 8 + sd, nz * 30 + sd, 3)));
        if (st === 'gas') {
          // one great storm
          const sx2 = Math.cos(sd), sy2 = Math.sin(sd), sz2 = -0.35, n2 = Math.hypot(sx2, sy2, sz2);
          const d = Math.hypot(nx - sx2 / n2, ny - sy2 / n2, nz - sz2 / n2);
          col = mix(col, [0.75, 0.38, 0.28], ss(0.16, 0.09, d) * 0.8);
        }
        if (st === 'browndwarf') e = 0.5 + 0.4 * b * b;
      } else {
        col = mix(c1, c2, fbm(sx, sy, sz));
      }
      const k = j * W + i;
      rgb[k * 3] = post(Math.min(1, col[0])); rgb[k * 3 + 1] = post(Math.min(1, col[1])); rgb[k * 3 + 2] = post(Math.min(1, col[2]));
      emit[k] = e; spec[k] = sp;
    }
  }
  return { w: W, h: H, rgb, emit, spec, gas };
}

/** Paint a crater into the map: a dark floor, a bright rim, a pale blanket. Direction in the body's frame. */
export function paintCrater(m: SurfaceMap, dx: number, dy: number, dz: number, ang: number) {
  const a = Math.max(ang, 1.2 * Math.PI / m.h); // never smaller than a texel or it would vanish
  for (let j = 0; j < m.h; j++) {
    const lat = ((j + 0.5) / m.h - 0.5) * Math.PI;
    for (let i = 0; i < m.w; i++) {
      const lon = ((i + 0.5) / m.w) * 2 * Math.PI;
      const nx = Math.cos(lat) * Math.cos(lon), ny = Math.cos(lat) * Math.sin(lon), nz = Math.sin(lat);
      const d = Math.acos(Math.max(-1, Math.min(1, nx * dx + ny * dy + nz * dz))) / a;
      if (d > 2.2) continue;
      const k = (j * m.w + i) * 3;
      const f = d < 0.8 ? 0.62 : d < 1.15 ? 1.35 : 1.08;
      for (let c = 0; c < 3; c++) m.rgb[k + c] = Math.min(1, post(m.rgb[k + c] * f));
    }
  }
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
