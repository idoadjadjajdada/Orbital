import type { Look, Cls } from '../physics/body';
import { blackbody } from '../physics/stellar';
import { vnoise, fbm } from './noise';
import { buildMap, ringTau, sampleMap, type SurfaceMap } from './surface';

export type V3 = [number, number, number];

export interface SpriteIn {
  look: Look;
  cls: Cls;
  heat: number;
  teff: number;
  giant: boolean;
  /** disc diameter in art pixels */
  d: number;
  /** spin axis (world, unit) and how far the body has turned about it */
  axis: V3;
  spin: number;
  /** unit vector toward the lighting star (world), its colour, or null for none */
  light: V3 | null;
  lightCol: V3;
  /** dark scars in a gas giant's clouds: body-frame direction, angular radius, how fresh (0..1) */
  scars: { d: V3; a: number; k: number }[];
  time: number;
  map: SurfaceMap | null;
}

/** Saturated blackbody colour, so a 5800 K star reads yellow-white rather than white. */
export function starRGB(teff: number): V3 {
  const [r, g, b] = blackbody(teff);
  // push the colour away from grey: a stylised but honest ordering, red dwarfs
  // orange, the Sun yellow-white, O stars blue
  const k = teff < 7000 ? 4.5 : 2.4;
  const m = (r + g + b) / 3;
  const c: V3 = [Math.max(0, m + (r - m) * k), Math.max(0, m + (g - m) * k), Math.max(0, m + (b - m) * k)];
  const mx = Math.max(...c);
  return [c[0] / mx, c[1] / mx, c[2] / mx];
}

const norm = (v: V3): V3 => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const hex = (c: number): V3 => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

/** The body's own frame: x and y turning with it, z its spin axis. */
export function bodyFrame(axis: V3, spin: number): [V3, V3, V3] {
  const a = norm(axis);
  const ref: V3 = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = norm(cross(ref, a)), e2 = cross(a, e1);
  const c = Math.cos(spin), s = Math.sin(spin);
  const x: V3 = [c * e1[0] + s * e2[0], c * e1[1] + s * e2[1], c * e1[2] + s * e2[2]];
  return [x, cross(a, x), a];
}

/** relief: how strongly the height map tilts the surface for shading */
const BUMP = 0.035;

/**
 * Bake one body's sprite. Returns RGBA pixels of a square `size` px across,
 * the disc centred in it (bigger than the disc when there are rings).
 */
export function bakeSprite(p: SpriteIn): { size: number; data: Uint8ClampedArray<ArrayBuffer> } {
  const d = Math.max(1, Math.round(p.d));
  const R = d / 2;
  const rings = p.look.rings;
  const ext = rings ? rings.outer * 1.02 : 1;
  const size = Math.max(1, Math.ceil(d * ext)) | 1;
  const half = size / 2;
  const out = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
  const [bx, by, bz] = bodyFrame(p.axis, p.spin);
  const L = p.light ? norm(p.light) : null;
  const lc = p.lightCol;
  const isStar = p.cls === 'star' || p.cls === 'wd' || p.cls === 'ns';
  const sc = isStar ? starRGB(p.teff) : [1, 1, 1];
  const atmo = p.look.atmo !== undefined ? hex(p.look.atmo) : null;
  const ringN: V3 = norm(p.axis);
  const ringCol = rings ? hex(rings.color) : [0, 0, 0];
  const H: V3 | null = L ? norm([L[0], L[1], L[2] + 1]) : null;
  const smp = { r: 0, g: 0, b: 0, e: 0, s: 0, dx: 0, dy: 0 };

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // u, v in planet radii; world y points up the screen
      const u = (px + 0.5 - half) / R, v = -(py + 0.5 - half) / R;
      const rr = u * u + v * v;
      let r = 0, g = 0, b = 0, a = 0;
      // the limb is anti-aliased: a pixel half over the edge is half covered
      const cover = Math.max(0, Math.min(1, (1 - Math.sqrt(rr)) * R + 0.5));
      const onDisc = cover > 0;
      const zp = onDisc ? Math.sqrt(Math.max(0, 1 - Math.min(1, rr))) : 0;

      // ---- rings: where the line of sight meets the ring plane ----
      let ringA = 0, rR = 0, rG = 0, rB = 0, ringFront = false;
      if (rings && Math.abs(ringN[2]) > 1e-3) {
        const zr = -(ringN[0] * u + ringN[1] * v) / ringN[2];
        const rad = Math.sqrt(rr + zr * zr);
        if (rad >= rings.inner && rad <= rings.outer) {
          const tau = ringTau(rings.kind, rad) * (rings.kind ? 1 : rings.opacity);
          const muV = Math.max(Math.abs(ringN[2]), 0.04);
          ringA = 1 - Math.exp(-tau / muV);
          ringFront = !onDisc || zr > zp;
          let lit = 0.25;
          if (L) {
            const mu0 = Math.max(Math.abs(dot(ringN, L)), 0.04);
            const same = dot(ringN, L) * ringN[2] > 0;
            lit = same ? 1 - Math.exp(-tau / mu0) : 2.2 * (tau / mu0) * Math.exp(-tau / mu0);
            // the planet's shadow across the rings
            const P: V3 = [u, v, zr];
            const t = dot(P, L);
            if (t < 0 && dot(P, P) - t * t < 1) lit *= 0.08;
          }
          lit = Math.min(1, lit);
          rR = ringCol[0] * (0.2 + lit * lc[0]); rG = ringCol[1] * (0.2 + lit * lc[1]); rB = ringCol[2] * (0.2 + lit * lc[2]);
        }
      }

      if (onDisc) {
        const n: V3 = [u, v, zp];
        const nb: V3 = [dot(n, bx), dot(n, by), dot(n, bz)];
        if (p.cls === 'bh') {
          // the shadow, with the photon ring at its edge: a thin glow of wound-round starlight, warm white,
          // fading inward over a few percent of its radius (not a drawn outline)
          const x = (1 - Math.sqrt(rr)) * d;
          const edge = 0.5 * Math.exp(-(x * x) / 1.8) + 0.1 * Math.exp(-x / Math.max(1, 0.05 * d));
          r = edge; g = edge * 0.84; b = edge * 0.66; a = cover;
        } else if (isStar) {
          const mu = zp;
          let I = 1 - 0.55 * (1 - mu) - 0.25 * (1 - mu) ** 2;
          const gran = p.giant ? 3 : 14;
          I *= 0.82 + 0.36 * fbm(nb[0] * gran, nb[1] * gran, nb[2] * gran + p.time * 0.05, 3);
          // sunspots only on cool stars with convective surfaces, and small
          if (!p.giant && p.cls === 'star' && p.teff < 6500 && fbm(nb[0] * 4 + 7, nb[1] * 4, nb[2] * 4, 3) > 0.79) I *= 0.6;
          // the limb is a little redder: the light comes from higher, cooler gas
          const warm = mu < 0.3 ? [1, 0.82, 0.68] : [1, 1, 1];
          r = sc[0] * I * warm[0] * 1.2 + 0.08 * I; g = sc[1] * I * warm[1] * 1.2 + 0.08 * I; b = sc[2] * I * warm[2] * 1.2 + 0.04 * I; a = cover;
        } else {
          const m = p.map!;
          const lat = Math.asin(Math.max(-1, Math.min(1, nb[2])));
          let lon = Math.atan2(nb[1], nb[0]); if (lon < 0) lon += 2 * Math.PI;
          sampleMap(m, lat, lon, smp);
          let ar = smp.r, ag = smp.g, ab = smp.b;
          for (const s of p.scars) {
            const dd = Math.acos(Math.max(-1, Math.min(1, dot(nb, s.d)))) / s.a;
            if (dd < 1.4) { const f = 1 - 0.7 * s.k * (1 - dd / 1.4); ar *= f; ag *= f; ab *= f; }
          }
          // the relief tilts the surface: a slope up to the east faces west, and so on
          const cl = Math.max(0.05, Math.cos(lat)), sl = Math.sin(lat), co = Math.cos(lon), si = Math.sin(lon);
          const gx = (smp.dx / cl) * BUMP, gy = smp.dy * BUMP;
          const pb: V3 = [nb[0] - gx * -si - gy * -sl * co, nb[1] - gx * co - gy * -sl * si, nb[2] - gy * cl];
          const nn = norm([pb[0] * bx[0] + pb[1] * by[0] + pb[2] * bz[0], pb[0] * bx[1] + pb[1] * by[1] + pb[2] * bz[1], pb[0] * bx[2] + pb[1] * by[2] + pb[2] * bz[2]]);
          let diff = 0.035;
          let glint = 0;
          if (L) {
            let dl = dot(nn, L);
            const dl0 = dot(n, L);
            // the rings' shadow on the planet
            if (rings && Math.abs(dot(ringN, L)) > 1e-3) {
              const t = -dot(ringN, n) / dot(ringN, L);
              if (t > 0) {
                const q: V3 = [n[0] + L[0] * t, n[1] + L[1] * t, n[2] + L[2] * t];
                const rq = Math.hypot(q[0], q[1], q[2]);
                if (rq >= rings.inner && rq <= rings.outer) dl *= Math.exp(-ringTau(rings.kind, rq) / Math.abs(dot(ringN, L)));
              }
            }
            // a soft terminator: no relief lit past it
            const term = Math.max(0, Math.min(1, (dl0 + 0.04) / 0.1));
            diff = 0.035 + Math.max(0, dl) * term;
            if (smp.s > 0.5 && H) glint = Math.pow(Math.max(0, dot(n, H)), 60) * 0.7 * term;
          }
          r = ar * diff * lc[0] + glint; g = ag * diff * lc[1] + glint; b = ab * diff * lc[2] + glint;
          // a lit atmosphere glows at the limb
          if (atmo && L) {
            const rim = (1 - zp) ** 3 * Math.max(0, dot(n, L) + 0.3);
            r += atmo[0] * rim * 0.9; g += atmo[1] * rim * 0.9; b += atmo[2] * rim * 0.9;
          }
          // heat: lava cracks, a magma ocean after an impact, a brown dwarf's own glow
          const e = smp.e * (p.look.style === 'lava' ? 1.4 : 0.8) + Math.max(0, (p.heat - 0.55) / 0.45) ** 2 * (0.6 + 0.8 * vnoise(nb[0] * 9, nb[1] * 9, nb[2] * 9));
          if (e > 0.02) { const lv = Math.min(1, e); r += 1.0 * lv; g += 0.38 * lv; b += 0.08 * lv; }
          a = cover;
        }
      }
      if (ringA > 0.02 && (ringFront || !onDisc)) {
        r = r * (1 - ringA) + rR * ringA; g = g * (1 - ringA) + rG * ringA; b = b * (1 - ringA) + rB * ringA;
        a = Math.max(a, ringA);
      }
      if (a > 0) {
        const o = (py * size + px) * 4;
        out[o] = Math.min(255, r * 255); out[o + 1] = Math.min(255, g * 255); out[o + 2] = Math.min(255, b * 255);
        out[o + 3] = Math.min(255, Math.round(a * 510));
      }
    }
  }
  return { size, data: out };
}

/** A body's map, built on first use. */
export function mapFor(look: Look): SurfaceMap { return buildMap(look, 128); }
