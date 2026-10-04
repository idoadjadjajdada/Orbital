import type { Body } from '../physics/body';
import { vnoise } from './noise';

/**
 * A fed black hole's accretion disc on the map: the disc as it lies, tilted
 * by the hole's spin, seen from above. Hottest just outside the innermost
 * stable orbit (the thin-disc law), white-blue there through gold to a dull
 * red rim; the gas streaming round at the orbital speed of each radius, so
 * the inner streaks lap the outer ones; the side whose gas comes toward the
 * eye beamed brighter; and in the middle the hole's shadow ringed by the
 * light that wound round it. Painted into a small canvas each frame (a few
 * tens of thousands of texels), and drawn smoothly scaled.
 */

const RES = 256;
const PERIOD = 14;

interface Disc { cv: HTMLCanvasElement; img: ImageData; t: number }
const discs = new WeakMap<Body, Disc>();

/** the colour of the disc's light by how bright it is: deep red, orange, gold, near white (as NASA's renderings show it) */
function fire(v: number, out: number[]) {
  const ss = (a: number, b: number, x: number) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  const stops: [number, number, number, number, number][] = [[0, 0.25, 0.55, 0.06, 0], [0.2, 0.55, 1, 0.33, 0.04], [0.5, 0.85, 1, 0.68, 0.3], [0.82, 1, 1, 0.94, 0.8]];
  let r = 0, g = 0, b = 0;
  for (const [a0, a1, cr, cg, cb] of stops) { const k = ss(a0, a1, v); r += (cr - r) * k; g += (cg - g) * k; b += (cb - b) * k; }
  out[0] = r; out[1] = g; out[2] = b;
}

/**
 * draw a hole's disc: centred at (x, y) px, the horizon `rsPx` px across, out to `rOut` horizon radii,
 * as bright as `power` (0–1), at the time `now` (s)
 */
export function drawAccretion(ctx: CanvasRenderingContext2D, b: Body, x: number, y: number, rsPx: number, rOut: number, power: number, now: number) {
  const Ln = Math.hypot(b.lx, b.ly, b.lz);
  const n = Ln > 0 ? [b.lx / Ln, b.ly / Ln, b.lz / Ln] : [0, 0, 1];
  const rIn = 3;
  const outPx = rOut * rsPx;
  if (outPx < 3) return;
  // the disc's own axes: e1 in the sky plane, e2 the other
  let e1 = [-n[1], n[0], 0];
  const l1 = Math.hypot(e1[0], e1[1]);
  e1 = l1 > 1e-6 ? [e1[0] / l1, e1[1] / l1, 0] : [1, 0, 0];
  const e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
  // edge-on, the disc is a line: give it a little thickness so it still shows
  const cosI = Math.max(0.06, Math.abs(n[2]));
  let d = discs.get(b);
  if (!d) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = RES;
    d = { cv, img: cv.getContext('2d')!.createImageData(RES, RES), t: -1 };
    discs.set(b, d);
  }
  // fine enough for the size it is drawn at, never more than RES across
  const N = Math.max(32, Math.min(RES, Math.round(outPx * 2)));
  const data = d.img.data;
  const ph = now / PERIOD, p1 = ph - Math.floor(ph), p2 = (ph + 0.5) - Math.floor(ph + 0.5), wmix = Math.abs(2 * p1 - 1);
  const col = [0, 0, 0];
  // e1 lies in the sky plane, so a point's screen position is u·e1 + v·(e2's sky part); invert for (u, v)
  const a11 = e1[0], a12 = e2[0], a21 = e1[1], a22 = e2[1];
  // (that determinant is the axis's tilt toward the eye: edge-on it is kept from zero, so the disc keeps a little thickness)
  const det0 = a11 * a22 - a12 * a21, det = (det0 < 0 ? -1 : 1) * Math.max(0.06, Math.abs(det0));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    // pixel → sky offset in horizon radii (y up on the sky, down on screen)
    const sx = ((i + 0.5) / N * 2 - 1) * rOut, sy = -((j + 0.5) / N * 2 - 1) * rOut;
    const u = (a22 * sx - a12 * sy) / det, v = (-a21 * sx + a11 * sy) / det;
    const r = Math.hypot(u, v);
    const o = (j * RES + i) * 4;
    const sr = Math.hypot(sx, sy);
    // the shadow and the ring round it, seen straight down the line of sight
    const ring = Math.exp(-(((sr - 2.6) / 0.2) ** 2)) * (0.3 + power) * 0.8;
    if (sr < 2.6) { data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 255; continue; }
    let R = ring * 255, G = ring * 158, B = ring * 77, A = Math.min(1, ring);
    if (r > rIn * 0.95 && r < rOut) {
      const x2 = rIn / r;
      const T = Math.pow(x2, 0.75) * Math.pow(Math.max(0, 1 - Math.sqrt(x2)), 0.25) / 0.488;
      // the gas carried round, two looks faded together so the shear never builds
      const lr = Math.log(r), phi = Math.atan2(v, u), w = 0.9 * Math.pow(r, -1.5);
      const g1 = gas(phi - w * (p1 - 0.5) * PERIOD, lr), g2 = gas(phi - w * (p2 - 0.5) * PERIOD, lr);
      const g0 = g1 + (g2 - g1) * wmix;
      // Doppler: the gas's speed along the line of sight (toward the eye is +z)
      const vz = (-Math.sin(phi) * e1[2] + Math.cos(phi) * e2[2]);
      const beta = Math.sqrt(0.5 / Math.max(r - 1, 1.05));
      const gam = 1 / Math.sqrt(1 - beta * beta);
      const g = Math.sqrt(Math.max(0, 1 - 1 / r)) / (gam * (1 - beta * vz));
      // as in 3D: bright out to a few tens of horizons, then the dim gas out to wherever it reaches
      const fade = 1 - 0.85 * Math.min(1, Math.max(0, (r - 18) / 27));
      const I = (g * g * g * Math.pow(T, 0.8) * fade + 0.02 * (1 - Math.min(1, Math.max(0, (r - 0.4 * rOut) / (0.6 * rOut))))) * (0.25 + 1.5 * g0 * g0) * power;
      const vb = 1 - Math.exp(-I * 2);
      fire(vb, col);
      const edge = Math.min(1, Math.max(0, (r - rIn * 0.97) / (rIn * 0.11))) * (1 - Math.min(1, Math.max(0, (r - rOut * 0.6) / (rOut * 0.4))));
      const a = Math.min(1, vb * 1.6) * edge * cosI ** 0.3;
      R += col[0] * 255 * a; G += col[1] * 255 * a; B += col[2] * 255 * a; A = Math.min(1, A + a);
    }
    data[o] = Math.min(255, R); data[o + 1] = Math.min(255, G); data[o + 2] = Math.min(255, B); data[o + 3] = Math.round(A * 255);
  }
  d.cv.getContext('2d')!.putImageData(d.img, 0, 0, 0, 0, N, N);
  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(d.cv, 0, 0, N, N, x - outPx, y - outPx, outPx * 2, outPx * 2);
  ctx.globalCompositeOperation = 'source-over';
  // the shadow itself, over whatever was drawn there
  if (rsPx * 2.6 > 1.5) {
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(x, y, rsPx * 2.6 * 0.96, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.imageSmoothingEnabled = prevSmooth;
}

function gas(phi: number, lr: number) {
  // drawn out round the hole into streaks, wandering a little in radius
  const cx = Math.cos(phi), sy = Math.sin(phi);
  const w = (vnoise(cx * 2.2 + 11, sy * 2.2, lr * 3) - 0.5) * 0.35;
  return vnoise(cx * 2.4, sy * 2.4, (lr + w) * 30) * 0.5 + vnoise(cx * 4.5 + 7, sy * 4.5, (lr + w * 0.6) * 85) * 0.35 + vnoise(cx * 9 + 3, sy * 9, lr * 150) * 0.15;
}

// ------------------------------------------------------------------ a nebula's shell, on the map
interface Shell { cv: HTMLCanvasElement; img: ImageData }
const shells = new WeakMap<Body, Shell>();
const SRES = 160;

/**
 * a planetary nebula's or a supernova remnant's shell, seen from above: the light of a thin glowing
 * shell summed along each line of sight (brightest at the rim, where the sight line runs along it, as
 * the Ring and Helix nebulae are), ripped into knots and threads, a planetary nebula's blue-green
 * oxygen inside a red rim, a remnant's blue-white filaments shot with red
 */
export function drawNebula(ctx: CanvasRenderingContext2D, b: Body, x: number, y: number, rPx: number, pne: boolean, now: number) {
  if (rPx < 3) return;
  let s = shells.get(b);
  if (!s) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = SRES;
    s = { cv, img: cv.getContext('2d')!.createImageData(SRES, SRES) };
    shells.set(b, s);
    // the shell barely changes: painted once, when first seen
    const data = s.img.data, seed = (b.id % 97) * 3.1;
    const inner = pne ? [0.25, 0.85, 0.8] : [0.55, 0.7, 1.0], rim = pne ? [1.0, 0.32, 0.28] : [1.0, 0.45, 0.35];
    const thick = pne ? 0.13 : 0.08, fill = pne ? 0.35 : 0.05;
    for (let j = 0; j < SRES; j++) for (let i = 0; i < SRES; i++) {
      const u = ((i + 0.5) / SRES * 2 - 1) * 1.3, v = ((j + 0.5) / SRES * 2 - 1) * 1.3;
      const q = Math.hypot(u, v);
      const o = (j * SRES + i) * 4;
      if (q > 1.3) { data[o + 3] = 0; continue; }
      let R = 0, G = 0, B = 0;
      const zMax = Math.sqrt(Math.max(0, 1.69 - q * q)), N = 24, dz = (2 * zMax) / N;
      for (let k = 0; k < N; k++) {
        const z = -zMax + (k + 0.5) * dz;
        const r = Math.hypot(q, z);
        const wob = (vnoise(u * 2.2 + seed, v * 2.2, z * 2.2) - 0.5) * 0.25;
        const shell = Math.exp(-(((r - 1 - wob) / thick) ** 2));
        const a = 1 - Math.abs(2 * vnoise(u * 3 + seed, v * 3, z * 3) - 1), bb = 1 - Math.abs(2 * vnoise(u * 7 + 4.1, v * 7 + seed, z * 7) - 1);
        const th = a ** 3 * 0.65 + bb ** 4 * 0.35;
        const dens = shell * (0.35 + 1.6 * th) + fill * Math.max(0, Math.min(1, (1.05 - r) / 0.85)) * (0.5 + 0.7 * vnoise(u * 4, v * 4 + seed, z * 4));
        const m = Math.max(0, Math.min(1, (r + wob * 0.5 - 0.85) / 0.27));
        R += (inner[0] + (rim[0] - inner[0]) * m) * dens * dz;
        G += (inner[1] + (rim[1] - inner[1]) * m) * dens * dz;
        B += (inner[2] + (rim[2] - inner[2]) * m) * dens * dz;
      }
      const k = pne ? 1.3 : 1.5;
      data[o] = 255 * (1 - Math.exp(-R * k)); data[o + 1] = 255 * (1 - Math.exp(-G * k)); data[o + 2] = 255 * (1 - Math.exp(-B * k)); data[o + 3] = 255;
    }
    s.cv.getContext('2d')!.putImageData(s.img, 0, 0);
  }
  void now;
  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'lighter';
  const R = rPx * 1.3;
  ctx.drawImage(s.cv, x - R, y - R, R * 2, R * 2);
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = prevSmooth;
}
