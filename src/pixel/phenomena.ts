import type { Body } from '../physics/body';
import type { SimEvent } from '../physics/events';
import { vnoise, bayer } from './noise';
import type { V3 } from './sprites';

type Halo = (R: number, c: V3, strength: number) => HTMLCanvasElement;

const rgba = (c: V3, a: number) => `rgba(${Math.round(Math.min(1, c[0]) * 255)},${Math.round(Math.min(1, c[1]) * 255)},${Math.round(Math.min(1, c[2]) * 255)},${Math.max(0, Math.min(1, a))})`;
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function blit(ctx: CanvasRenderingContext2D, h: HTMLCanvasElement, x: number, y: number) {
  ctx.drawImage(h, Math.round(x - (h.width - 1) / 2), Math.round(y - (h.height - 1) / 2));
}

/** a ring of pixels, brightness varying round it by `f(angle)`, dithered */
function ring(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, thick: number, c: V3, f: (a: number) => number) {
  if (R < 1 || R > 4000) return;
  const n = Math.max(16, Math.round(2 * Math.PI * R * 1.2));
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * Math.PI;
    const v = f(a);
    if (v <= 0.02) continue;
    for (let t = 0; t < thick; t++) {
      const rr = R - t;
      const px = Math.round(x + Math.cos(a) * rr), py = Math.round(y + Math.sin(a) * rr);
      const lv = v * (1 - t / (thick + 0.5));
      if (lv < bayer(px, py) * 0.6) continue;
      ctx.fillStyle = rgba(c, lv);
      ctx.fillRect(px, py, 1, 1);
    }
  }
}

/**
 * Explosions and bursts, in art pixels at (x, y). `u` runs 0..1 over the
 * flash's life; `R` is its natural size on screen. Each kind has its own
 * signature: a supernova's blast wave with filaments, a merger's
 * gravitational-wave ripples, a magnetar's rays.
 */
export function drawFlash(ctx: CanvasRenderingContext2D, e: SimEvent, x: number, y: number, u: number, R: number, halo: Halo, now: number) {
  ctx.globalCompositeOperation = 'lighter';
  const seed = (e.t * 1e3) % 97;
  switch (e.kind) {
    case 'supernova': case 'ia': case 'kilonova': {
      const hot: V3 = e.kind === 'ia' ? [1, 0.97, 0.85] : e.kind === 'kilonova' ? [1, 0.55, 0.3] : [0.8, 0.9, 1];
      const cool: V3 = e.kind === 'ia' ? [1, 0.75, 0.4] : e.kind === 'kilonova' ? [0.8, 0.25, 0.2] : [0.45, 0.6, 1];
      // the breakout: a blinding point that fades in the first moments
      if (u < 0.25) blit(ctx, halo(Math.max(R * 1.8, 30) * (0.6 + u), [1, 1, 1], (1 - u / 0.25) ** 1.5), x, y);
      // the glow of the expanding ejecta
      blit(ctx, halo(Math.max(R, 12) * (0.8 + 1.5 * u), mix(hot, cool, u), (1 - u) ** 1.5 * 0.9), x, y);
      // the blast wave: a shell broken into filaments, cooling as it grows
      const Rs = Math.max(6, R * 0.6) + u * Math.max(R * 3, 70);
      const fade = (1 - u) ** 1.2;
      ring(ctx, x, y, Rs, 3, mix(hot, cool, Math.sqrt(u)), a => fade * (0.35 + 0.65 * vnoise(Math.cos(a) * 4 + seed, Math.sin(a) * 4, u * 2)) ** 2 * 1.4);
      ring(ctx, x, y, Rs * 0.82, 1, cool, a => fade * 0.5 * vnoise(Math.cos(a) * 7, Math.sin(a) * 7 + seed, 3));
      if (e.kind === 'kilonova') gwRipples(ctx, x, y, u, Math.max(R * 3, 80), now);
      break;
    }
    case 'gw':
      gwRipples(ctx, x, y, u, Math.max(R * 2, 90), now);
      // a merger of holes gives off no light of its own; one with matter does
      if (e.energy < 1) blit(ctx, halo(Math.max(R, 10) * (1 + u), [0.7, 0.8, 1], (1 - u) ** 2 * 0.6), x, y);
      break;
    case 'collapse': {
      // the core falls in: a ring closing to nothing, then a short flash
      const Rc = Math.max(R, 20) * (1 - u);
      ring(ctx, x, y, Rc, 2, [0.75, 0.55, 1], () => (1 - u) * 0.9);
      if (u > 0.7) blit(ctx, halo(Math.max(R, 14), [0.8, 0.7, 1], (u - 0.7) / 0.3 * (1 - u) * 6), x, y);
      break;
    }
    case 'flare': case 'evaporate': {
      // a hard, brief burst: rays and a white core
      const c: V3 = e.kind === 'flare' ? [0.7, 0.85, 1] : [1, 1, 1];
      const k = (1 - u) ** 3;
      blit(ctx, halo(Math.max(R, 18) * (1 + u), c, k), x, y);
      const L = Math.max(R * 3, 40) * (0.4 + u);
      for (let r = 0; r < 12; r++) {
        const a = (r / 12) * 2 * Math.PI + seed;
        for (let t = 2; t < L; t++) {
          const v = k * (1 - t / L);
          const px = Math.round(x + Math.cos(a) * t), py = Math.round(y + Math.sin(a) * t);
          if (v < bayer(px, py) * 0.5) continue;
          ctx.fillStyle = rgba(c, v);
          ctx.fillRect(px, py, 1, 1);
        }
      }
      break;
    }
    case 'wormhole':
      ring(ctx, x, y, Math.max(R, 8) * (0.5 + u), 2, [0.75, 0.5, 1], a => (1 - u) * (0.6 + 0.4 * Math.sin(a * 3 + now * 6)));
      break;
    default: {
      const c: V3 = e.kind === 'nebula' ? [0.45, 0.88, 0.88] : e.kind === 'crater' ? [1, 0.75, 0.45] : [1, 0.7, 0.4];
      blit(ctx, halo(R * (0.6 + 0.8 * u), c, (1 - u) ** 2), x, y);
      if (e.kind === 'impact' || e.kind === 'merge' || e.kind === 'disrupt') {
        ring(ctx, x, y, R * (0.5 + 2 * Math.sqrt(u)), 2, c, a => (1 - u) * (0.5 + 0.5 * vnoise(Math.cos(a) * 5 + seed, Math.sin(a) * 5, 1)));
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** Gravitational waves drawn as ripples: a quadrupole pattern, two lobes, spiralling out. */
function gwRipples(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, Rmax: number, now: number) {
  for (let k = 0; k < 5; k++) {
    const t = u + k * 0.12;
    if (t > 1) continue;
    const R = t * Rmax;
    const fade = Math.min(1, (1 - t) * (1 - u) * 2.2);
    const phase = now * 3 - R * 0.12;
    ring(ctx, x, y, R, 2, [0.7, 0.85, 1], a => fade * (0.15 + 0.85 * Math.cos(2 * (a - phase)) ** 2));
  }
}

/**
 * Jets from a feeding compact object, as long as the hole is big and as bright
 * as it is fed: a narrow cone with knots that move outward. Seen down the
 * axis (a blazar) it is a single dazzling, flickering point instead.
 */
export function drawJet(ctx: CanvasRenderingContext2D, b: Body, x: number, y: number, rPx: number, power: number, len: number, now: number, halo: Halo) {
  const Ln = Math.hypot(b.lx, b.ly, b.lz);
  const ax = Ln > 0 ? [b.lx / Ln, b.ly / Ln, b.lz / Ln] : [0, 0, 1];
  const proj = Math.hypot(ax[0], ax[1]);
  ctx.globalCompositeOperation = 'lighter';
  // the inner disc's own glow
  blit(ctx, halo(Math.max(rPx * 3, 5 + 6 * power), [1, 0.75, 0.5], 0.5 * power), x, y);
  if (proj < 0.2) {
    const flick = 0.75 + 0.25 * Math.sin(now * 13) * Math.sin(now * 5.3);
    blit(ctx, halo(Math.max(rPx * 4, 8 + 16 * power), [0.7, 0.8, 1], power * flick), x, y);
    for (let r = 0; r < 4; r++) {
      const a = (r / 4) * Math.PI + 0.4;
      const L = (6 + 18 * power) * flick;
      for (let t = 2; t < L; t++) for (const sg of [1, -1]) {
        const px = Math.round(x + sg * Math.cos(a) * t), py = Math.round(y + sg * Math.sin(a) * t);
        ctx.fillStyle = rgba([0.75, 0.85, 1], power * (1 - t / L));
        ctx.fillRect(px, py, 1, 1);
      }
    }
  } else {
    const ux = ax[0] / proj, uy = -ax[1] / proj;
    const n = Math.round(len * proj);
    // a cone a couple of degrees across, so it widens with distance
    for (const sg of [1, -1]) {
      for (let k = 2; k < n; k++) {
        const t = k / n;
        const knot = 0.55 + 0.45 * Math.sin(k * 0.35 - now * 7);
        const a = power * (1 - t) ** 1.1 * (0.45 + 0.55 * knot);
        if (a < 0.04) continue;
        const half = Math.max(0, Math.round(k * 0.03 * (0.5 + power)));
        const c: V3 = mix([0.95, 0.97, 1], [0.55, 0.7, 1], t);
        for (let wv = -half; wv <= half; wv++) {
          const edge = half > 0 ? 1 - Math.abs(wv) / (half + 1) : 1;
          const px = Math.round(x + sg * ux * k - uy * wv), py = Math.round(y + sg * uy * k + ux * wv);
          const v = a * edge;
          if (v < bayer(px, py) * 0.5) continue;
          ctx.fillStyle = rgba(c, Math.min(1, v * 1.4));
          ctx.fillRect(px, py, 1, 1);
        }
      }
      // where the jet runs into its surroundings it spreads into a lobe
      if (power > 0.3) {
        const ex = x + sg * ux * n, ey = y + sg * uy * n;
        blit(ctx, halo(Math.max(4, n * 0.12), [0.55, 0.6, 1], power * 0.35), ex, ey);
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** A pulsar's two beams, sweeping round with its spin. */
export function drawPulsar(ctx: CanvasRenderingContext2D, x: number, y: number, rPx: number, angle: number, strong: boolean) {
  ctx.globalCompositeOperation = 'lighter';
  const L = Math.max(30, rPx * 10) * (strong ? 1.5 : 1);
  for (const sg of [1, -1]) {
    const a = angle + (sg > 0 ? 0 : Math.PI);
    const ux = Math.cos(a), uy = Math.sin(a);
    for (let t = rPx + 1; t < L; t++) {
      const v = Math.min(1, (1 - t / L) * 1.4);
      const half = Math.round(t * 0.08);
      for (let wv = -half; wv <= half; wv++) {
        const px = Math.round(x + ux * t - uy * wv), py = Math.round(y + uy * t + ux * wv);
        if (v * (1 - Math.abs(wv) / (half + 1)) < bayer(px, py) * 0.7) continue;
        ctx.fillStyle = rgba(strong ? [0.85, 0.75, 1] : [0.7, 0.85, 1], v);
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** A white hole: blinding, and nothing reaches it. */
export function drawWhiteHole(ctx: CanvasRenderingContext2D, x: number, y: number, rPx: number, now: number, halo: Halo) {
  ctx.globalCompositeOperation = 'lighter';
  blit(ctx, halo(Math.max(rPx * 6, 16), [0.85, 0.92, 1], 0.9), x, y);
  ring(ctx, x, y, Math.max(rPx * 2.5, 6) + 2 * Math.sin(now * 2), 1, [1, 1, 1], a => 0.5 + 0.5 * Math.sin(a * 6 - now * 4));
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#ffffff';
  const R = Math.max(2, Math.min(300, Math.round(rPx)));
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) ctx.fillRect(Math.round(x) + dx, Math.round(y) + dy, 1, 1);
}

/** A wormhole mouth: a swirl round a dark throat with the other side's stars in it. */
export function drawWormhole(ctx: CanvasRenderingContext2D, x: number, y: number, rPx: number, now: number, seed: number) {
  const R = Math.max(5, Math.min(300, Math.round(rPx * 2)));
  const cx = Math.round(x), cy = Math.round(y);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const r = Math.hypot(dx, dy) / R;
    if (r > 1) continue;
    const a = Math.atan2(dy, dx);
    let c: V3, v: number;
    if (r < 0.55) {
      // the throat: another sky
      const star = vnoise(dx * 1.7 + seed, dy * 1.7, 3) > 0.83;
      c = star ? [0.9, 0.9, 1] : [0.08, 0.04, 0.2];
      v = 1;
    } else {
      // the swirl, turning
      const arm = 0.5 + 0.5 * Math.sin(3 * a + 9 * r - now * 2.5);
      c = mix([0.25, 0.1, 0.55], [0.75, 0.55, 1], arm);
      v = (1 - (r - 0.55) / 0.45) * (0.5 + 0.5 * arm);
      if (v < bayer(cx + dx, cy + dy) * 0.8) continue;
    }
    ctx.fillStyle = rgba(c, v);
    ctx.fillRect(cx + dx, cy + dy, 1, 1);
  }
}

const PAL: Record<string, V3> = { p: [0.23, 0.36, 0.62], w: [0.95, 0.95, 0.97], g: [0.92, 0.75, 0.25], k: [0.3, 0.3, 0.33], s: [0.75, 0.62, 0.78] };
const CRAFT: Record<string, string[]> = {
  station: ['pp...pp', 'pp.b.pp', 'bbbbbbb', 'pp.b.pp', 'pp...pp'],
  telescope: ['p.....', 'pbbbbw', 'pbbbbw', 'p.....'],
  mirror: ['..ggg..', '.ggggg.', '..ggg..', 'sssssss', '.sssss.'],
  probe: ['.www.', 'wwwww', '..b..', '..b..', '.kbk.'],
  sat: ['pp.pp', 'ppbpp', 'pp.pp'],
  sail: ['...w...', '..www..', '.wwwww.', 'wwwbwww', '.wwwww.', '..www..', '...w...'],
  lander: ['.bb.', 'bbbb', 'k..k'],
};

/** A spacecraft, as a little pixel sprite: never to scale, always recognisable. */
export function drawCraft(ctx: CanvasRenderingContext2D, b: Body, x: number, y: number) {
  const rows = CRAFT[b.look.craft ?? 'sat'];
  const h = rows.length, wdt = rows[0].length;
  const ox = Math.round(x - (wdt - 1) / 2), oy = Math.round(y - (h - 1) / 2);
  const bc = b.look.c2, dc = b.look.c1;
  const body: V3 = [((bc >> 16) & 255) / 255, ((bc >> 8) & 255) / 255, (bc & 255) / 255];
  const dark: V3 = [((dc >> 16) & 255) / 255, ((dc >> 8) & 255) / 255, (dc & 255) / 255];
  for (let j = 0; j < h; j++) for (let i = 0; i < wdt; i++) {
    const ch = rows[j][i];
    if (ch === '.') continue;
    const c = ch === 'b' ? body : ch === 'd' ? dark : PAL[ch] ?? body;
    ctx.fillStyle = rgba(c, 1);
    ctx.fillRect(ox + i, oy + j, 1, 1);
  }
  return Math.max(h, wdt) / 2;
}
