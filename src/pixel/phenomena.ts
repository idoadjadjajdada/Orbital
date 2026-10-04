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
    // looking down the jet: a brilliant flickering point, and a soft glow round it
    const flick = 0.8 + 0.2 * Math.sin(now * 13) * Math.sin(now * 5.3);
    const R = Math.max(rPx * 5, 10 + 22 * power) * flick;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, rgba([0.95, 0.97, 1], power));
    g.addColorStop(0.15, rgba([0.75, 0.85, 1], power * 0.55));
    g.addColorStop(1, rgba([0.5, 0.6, 1], 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R, 0, 2 * Math.PI); ctx.fill();
  } else {
    const ux = ax[0] / proj, uy = -ax[1] / proj;
    const n = len * proj;
    // each jet: a soft sheath and a bright spine, tapering out from the hole, fading toward the tip,
    // and knots of brighter plasma streaming out along it
    for (const sg of [1, -1]) {
      const dx = sg * ux, dy = sg * uy, px = -dy, py = dx;
      const ex = x + dx * n, ey = y + dy * n;
      // nested bands, each narrower and brighter: together a soft glow brightest down the spine
      for (const [wTip, wRoot, k, c] of [[0.11, 1.8, 0.1, [0.45, 0.58, 1]], [0.075, 1.4, 0.13, [0.5, 0.62, 1]], [0.045, 1.0, 0.2, [0.65, 0.75, 1]], [0.022, 0.7, 0.35, [0.82, 0.9, 1]], [0.009, 0.45, 0.6, [0.95, 0.97, 1]]] as const) {
        const wt = Math.max(1.5, n * wTip * (0.6 + 0.6 * power)), w0 = Math.max(0.8, rPx * wRoot);
        const g = ctx.createLinearGradient(x, y, ex, ey);
        g.addColorStop(0, rgba(c as unknown as V3, k * power));
        g.addColorStop(0.35, rgba(c as unknown as V3, k * power * 0.55));
        g.addColorStop(1, rgba(c as unknown as V3, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x + px * w0, y + py * w0);
        ctx.lineTo(ex + px * wt, ey + py * wt);
        ctx.lineTo(ex - px * wt, ey - py * wt);
        ctx.lineTo(x - px * w0, y - py * w0);
        ctx.closePath();
        ctx.fill();
      }
      for (let q = 0; q < 6; q++) {
        const t = ((q / 6 + now * 0.05 * (sg > 0 ? 1 : 1.07)) % 1);
        const kx = x + dx * n * t, ky = y + dy * n * t;
        const kr = Math.max(2, n * (0.012 + 0.05 * t) * (0.6 + 0.6 * power));
        const a = power * 0.75 * (1 - t) ** 1.4;
        if (a < 0.03) continue;
        const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
        g.addColorStop(0, rgba([0.95, 0.97, 1], a));
        g.addColorStop(1, rgba([0.55, 0.7, 1], 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(kx, ky, kr, 0, 2 * Math.PI); ctx.fill();
      }
      // where the jet runs into its surroundings it spreads into a lobe
      if (power > 0.3) {
        const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, Math.max(4, n * 0.14));
        g.addColorStop(0, rgba([0.55, 0.6, 1], power * 0.3));
        g.addColorStop(1, rgba([0.4, 0.45, 0.9], 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(ex, ey, Math.max(4, n * 0.14), 0, 2 * Math.PI); ctx.fill();
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** A pulsar's two beams, sweeping round with its spin. */
/**
 * A pulsar on the map, as Chandra sees the Crab: a glowing ring and a wider wispy torus round its
 * equator (tilted as its spin is, so a circle seen from above, a line seen edge-on), jets straight out of
 * its poles with knots streaming out, and its two lighthouse beams sweeping round with its spin.
 * `axis` is the spin; `angle` how far it has turned. A magnetar is violet, its beams flickering.
 */
export function drawPulsar(ctx: CanvasRenderingContext2D, x: number, y: number, rPx: number, angle: number, strong: boolean, axis: [number, number, number] = [0, 0, 1], now = 0) {
  ctx.globalCompositeOperation = 'lighter';
  const hot: V3 = strong ? [0.95, 0.72, 1] : [0.78, 0.9, 1], cool: V3 = strong ? [0.55, 0.3, 0.95] : [0.35, 0.55, 1];
  const S = Math.max(14, rPx * 14);
  // the torus: a ring seen at the tilt of the spin; on screen an ellipse whose short axis is along the spin's sky direction
  const cosI = Math.abs(axis[2]), proj = Math.hypot(axis[0], axis[1]);
  const rot = proj > 1e-6 ? Math.atan2(-axis[1], axis[0]) : 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(Math.max(0.08, cosI), 1);
  for (const [R, w, k, c] of [[S * 1.05, S * 0.32, 0.22, cool], [S * 0.5, S * 0.07, 0.6, mix(cool, hot, 0.6)], [S * 0.22, S * 0.08, 0.7, hot]] as const) {
    const g = ctx.createRadialGradient(0, 0, Math.max(0, R - w), 0, 0, R + w);
    g.addColorStop(0, rgba(c as V3, 0));
    g.addColorStop(0.5, rgba(c as V3, k));
    g.addColorStop(1, rgba(c as V3, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R + w, 0, 2 * Math.PI); ctx.fill();
  }
  // wisps: arcs going round, the inner ones faster
  ctx.lineCap = 'round';
  for (let k = 0; k < 9; k++) {
    const R = S * (0.35 + 0.08 * k + 0.05 * Math.sin(k * 2.3));
    const a0 = k * 1.7 + now * 0.6 * Math.pow(0.5 / (R / S), 1.5);
    ctx.strokeStyle = rgba(k < 3 ? hot : cool, 0.35 - k * 0.025);
    ctx.lineWidth = Math.max(1, S * 0.025);
    ctx.beginPath(); ctx.arc(0, 0, R, a0, a0 + 0.9 + 0.4 * Math.sin(k)); ctx.stroke();
  }
  ctx.restore();
  // the jets, along the spin's direction on the sky, straight out of the poles
  if (proj > 0.15) {
    const ux = axis[0] / proj, uy = -axis[1] / proj;
    const n = S * 4.5 * proj;
    for (const sg of [1, -1]) {
      const ex = x + sg * ux * n, ey = y + sg * uy * n;
      for (const [wt, w0, k, c] of [[0.07, 0.6, 0.25, cool], [0.025, 0.3, 0.7, hot]] as const) {
        const g = ctx.createLinearGradient(x, y, ex, ey);
        g.addColorStop(0, rgba(c as V3, k));
        g.addColorStop(0.4, rgba(c as V3, k * 0.5));
        g.addColorStop(1, rgba(c as V3, 0));
        ctx.fillStyle = g;
        const W0 = Math.max(0.8, rPx * w0 + 0.6), WT = Math.max(1, n * wt);
        ctx.beginPath();
        ctx.moveTo(x - uy * W0, y + ux * W0); ctx.lineTo(ex - uy * WT, ey + ux * WT);
        ctx.lineTo(ex + uy * WT, ey - ux * WT); ctx.lineTo(x + uy * W0, y - ux * W0);
        ctx.closePath(); ctx.fill();
      }
      for (let q = 0; q < 4; q++) {
        const t = (q / 4 + now * 0.12) % 1;
        const kx = x + sg * ux * n * t, ky = y + sg * uy * n * t, kr = Math.max(1.5, S * (0.06 + 0.12 * t));
        const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
        g.addColorStop(0, rgba(hot, 0.6 * (1 - t)));
        g.addColorStop(1, rgba(cool, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(kx, ky, kr, 0, 2 * Math.PI); ctx.fill();
      }
    }
  }
  // the lighthouse beams, faint, sweeping
  const L = S * 3 * (strong ? 1.3 : 1);
  for (const sg of [1, -1]) {
    const a = angle + (sg > 0 ? 0 : Math.PI);
    const ux = Math.cos(a), uy = Math.sin(a);
    const g = ctx.createLinearGradient(x, y, x + ux * L, y + uy * L);
    const k = strong ? 0.22 * (0.8 + 0.2 * Math.sin(now * 9)) : 0.18;
    g.addColorStop(0, rgba([0.85, 0.9, 1], k));
    g.addColorStop(1, rgba([0.85, 0.9, 1], 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + ux * L - uy * L * 0.06, y + uy * L + ux * L * 0.06); ctx.lineTo(x + ux * L + uy * L * 0.06, y + uy * L - ux * L * 0.06);
    ctx.closePath(); ctx.fill();
  }
  // the star itself, white-hot
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(3, rPx * 2.5));
  g.addColorStop(0, rgba([1, 1, 1], 1));
  g.addColorStop(1, rgba(hot, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, Math.max(3, rPx * 2.5), 0, 2 * Math.PI); ctx.fill();
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
