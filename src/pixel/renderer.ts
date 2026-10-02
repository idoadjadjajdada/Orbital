import type { Body } from '../physics/body';
import type { SimEvent } from '../physics/events';
import { osculating, relative, ellipsePoints } from '../physics/orbit';
import { lagrangePoints, habitableZone, barycentre } from '../physics/analysis';
import { schwarzschild } from '../physics/units';
import { blackbody } from '../physics/stellar';
import { bakeSprite, bodyFrame, starRGB, type V3 } from './sprites';
import { buildMap, paintCrater, type SurfaceMap } from './surface';
import { bayer } from './noise';
import { bakeShaped } from './shaped';
import { drawFlash, drawJet, drawPulsar, drawWhiteHole, drawWormhole, drawCraft } from './phenomena';
import { chip } from '../physics/materials';

/** CSS pixels per art pixel: the size of one chunky pixel */
export const PIX = 2;

export interface Flags { trails: boolean; orbits: boolean; zones: boolean; labels: boolean }

export interface DrawState {
  bodies: Body[];        // all bodies, particles included
  visual: Body[];        // bodies drawn as bodies
  sources: Body[];
  hostOf: (b: Body) => Body | null;
  hillOf: (b: Body) => number;
  flags: Flags;
  selected: Body | null;
  focus: Body | null;
  dtSim: number;
  dtReal: number;
  timeReal: number;
  simTime: number;
}

interface Drawn { b: Body; sx: number; sy: number; r: number; hidden: boolean }

const TRAIL_N = 1200;
class Trail {
  rel = new Float64Array(TRAIL_N * 2);
  n = 0; head = 0; hostId = -1;
  push(x: number, y: number) {
    this.rel[this.head * 2] = x; this.rel[this.head * 2 + 1] = y;
    this.head = (this.head + 1) % TRAIL_N; this.n = Math.min(TRAIL_N, this.n + 1);
  }
  last() { if (!this.n) return null; const i = (this.head - 1 + TRAIL_N) % TRAIL_N; return [this.rel[i * 2], this.rel[i * 2 + 1]]; }
}

interface Cached { key: string; canvas: HTMLCanvasElement; size: number; d: number }

const css = (c: V3, a = 1) => `rgba(${Math.round(Math.min(1, c[0]) * 255)},${Math.round(Math.min(1, c[1]) * 255)},${Math.round(Math.min(1, c[2]) * 255)},${a})`;
const hex3 = (c: number): V3 => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

export function tintOf(b: Body): V3 {
  if (b.star && b.cls === 'star') return starRGB(b.star.teff);
  if (b.cls === 'bh') return [1, 0.65, 0.35];
  if (b.cls === 'ns' || b.cls === 'wd') return [0.6, 0.75, 1];
  const c = hex3(b.look.atmo ?? b.look.c2);
  const m = Math.max(...c, 0.01);
  return [0.35 + 0.65 * c[0] / m, 0.35 + 0.65 * c[1] / m, 0.35 + 0.65 * c[2] / m];
}

/** A top-down, pixel-art view of the simulation. */
export class Renderer {
  ctx: CanvasRenderingContext2D;
  W = 1; H = 1;
  /** view centre (world, AU) and zoom (art pixels per AU) */
  cx = 0; cy = 0; cz = 0;
  scale = 100;
  scaleGoal = 100;
  /** offset glided away when the followed body changes */
  glide = { x: 0, y: 0 };
  drawn: Drawn[] = [];

  private sky!: HTMLCanvasElement;
  private part!: HTMLCanvasElement;
  private partCtx!: CanvasRenderingContext2D;
  private acc = new Float32Array(0);
  private partImg!: ImageData;
  private sprites = new Map<Body, Cached>();
  private maps = new Map<Body, { map: SurfaceMap; style: string; seen: Set<object> }>();
  private spinVis = new Map<Body, number>();
  private trails = new Map<Body, Trail>();
  private jet = new Map<Body, { rate: number; power: number }>();
  private haloCache = new Map<string, HTMLCanvasElement>();
  private flashes: { e: SimEvent; t0: number; dur: number }[] = [];
  private aim: { pts: [number, number, number][]; impact: [number, number, number] | null } | null = null;
  private bakeBudget = 0;
  /** drawn last, over everything: the tools' marks */
  overlay: ((ctx: CanvasRenderingContext2D) => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.W = Math.max(1, Math.ceil(w / PIX)); this.H = Math.max(1, Math.ceil(h / PIX));
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.ctx.imageSmoothingEnabled = false;
    this.part = document.createElement('canvas');
    this.part.width = this.W; this.part.height = this.H;
    this.partCtx = this.part.getContext('2d')!;
    this.partImg = this.partCtx.createImageData(this.W, this.H);
    this.acc = new Float32Array(this.W * this.H * 3);
    this.sky = buildSky(this.W, this.H);
  }

  // ---------------------------------------------------------------- camera
  /** art-pixel coordinates of a world point */
  sx(x: number) { return this.W / 2 + (x - this.cx) * this.scale; }
  sy(y: number) { return this.H / 2 - (y - this.cy) * this.scale; }
  /** world point under a CSS-pixel position */
  unproject(cssX: number, cssY: number) {
    return { x: this.cx + (cssX / PIX - this.W / 2) / this.scale, y: this.cy - (cssY / PIX - this.H / 2) / this.scale, z: this.cz };
  }
  /** world AU per CSS pixel */
  get perCss() { return 1 / (this.scale / PIX); }

  setCentre(c: { x: number; y: number; z: number }, dtReal: number) {
    const g = Math.exp(-dtReal * 6);
    this.glide.x *= g; this.glide.y *= g;
    this.scale *= Math.pow(this.scaleGoal / this.scale, 1 - Math.exp(-dtReal * 8));
    this.cx = c.x + this.glide.x; this.cy = c.y + this.glide.y; this.cz = c.z;
  }

  /** the body under a CSS-pixel position */
  pick(cssX: number, cssY: number): Body | null {
    const x = cssX / PIX, y = cssY / PIX;
    let best: Body | null = null, bd = Infinity;
    for (const d of this.drawn) {
      if (d.hidden) continue;
      const dist = Math.hypot(d.sx - x, d.sy - y);
      const reach = Math.max(d.r + 3, 9 / PIX * 2);
      if (dist < reach && dist - d.r < bd) { bd = dist - d.r; best = d.b; }
    }
    return best;
  }

  drawnOf(b: Body) { return this.drawn.find(d => d.b === b); }
  accRate(b: Body) { return this.jet.get(b)?.rate ?? 0; }
  setAim(pts: [number, number, number][] | null, impact: [number, number, number] | null) { this.aim = pts ? { pts, impact } : null; }
  flash(e: SimEvent, now: number) {
    const big = e.kind === 'supernova' || e.kind === 'ia' || e.kind === 'kilonova' || e.kind === 'evaporate' || e.kind === 'gw';
    this.flashes.push({ e, t0: now, dur: e.kind === 'crater' ? 1 : e.kind === 'flare' ? 1.6 : big ? 7 : 2.5 });
  }
  forget(b: Body) { this.sprites.delete(b); this.maps.delete(b); this.trails.delete(b); this.jet.delete(b); this.spinVis.delete(b); }
  clearTrails() { this.trails.clear(); }

  /** smallest radius a body is drawn at, in art pixels, so it is never lost */
  private minR(b: Body) {
    if (b.look.craft) return 3;
    if (b.look.wormhole) return 5;
    if (b.look.white) return 3;
    if (b.cls === 'star') return 4;
    if (b.cls === 'gas') return 3;
    if (b.cls === 'wd' || b.cls === 'ns' || b.cls === 'bh') return 2;
    if (b.kind === 'satellite') return 1;
    if (b.cls === 'debris') return 1;
    return b.m > 1e-7 ? 2.5 : 1.5;
  }

  /** the star that lights a body best, as a direction and a colour */
  private lightFor(b: Body, stars: Body[]): { L: V3 | null; col: V3 } {
    let best: Body | null = null, bf = 0;
    for (const s of stars) {
      if (s === b) continue;
      const d2 = (s.x - b.x) ** 2 + (s.y - b.y) ** 2 + (s.z - b.z) ** 2;
      const f = s.star!.L / d2;
      if (f > bf) { bf = f; best = s; }
    }
    if (!best) return { L: null, col: [1, 1, 1] };
    const c = starRGB(best.star!.teff);
    return { L: [best.x - b.x, best.y - b.y, best.z - b.z], col: [0.55 + 0.6 * c[0], 0.55 + 0.6 * c[1], 0.55 + 0.6 * c[2]] };
  }

  /**
   * What the inspector's map needs: the surface as the renderer holds it
   * (craters and all), the body's turning frame right now, and where its
   * light comes from, so the map can show day and night.
   */
  surfaceOf(b: Body, sources: Body[]): { map: SurfaceMap; frame: [V3, V3, V3]; L: V3 | null } | null {
    let e = this.maps.get(b);
    // not drawn yet (the 3D view is showing): make its map now
    if (!e) {
      if (b.cls === 'star' || b.cls === 'wd' || b.cls === 'ns' || b.cls === 'bh' || b.look.craft) return null;
      e = { map: buildMap(b.look), style: `${b.look.style}|${b.look.c1}|${b.look.c2}`, seen: new Set() };
      this.maps.set(b, e);
    }
    const stars = sources.filter(x => (x.cls === 'star' || x.cls === 'wd') && (x.star?.L ?? 0) > 0);
    const { L } = this.lightFor(b, stars);
    return { map: e.map, frame: bodyFrame(bodyAxis(b), this.spinVis.get(b) ?? 0), L };
  }

  // ---------------------------------------------------------------- frame
  render(s: DrawState) {
    const ctx = this.ctx;
    const { W, H } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.sky, 0, 0);
    // Only what lies far behind a hole is lensed: the sky. Everything simulated
    // is near the hole's own plane, beside it rather than behind it.
    this.drawLensing(s.sources);
    const stars = s.sources.filter(b => b.cls === 'star' && b.star && b.star.L > 0 || (b.cls === 'wd' && (b.star?.L ?? 0) > 0));

    // ---- habitable zones ----
    if (s.flags.zones) {
      for (const st of stars) {
        if (st.cls !== 'star') continue;
        const [a, b] = habitableZone(st.star!.L);
        const x = this.sx(st.x), y = this.sy(st.y);
        if (b * this.scale < 3) continue;
        ctx.fillStyle = 'rgba(60,200,100,0.10)';
        ctx.beginPath(); ctx.arc(x, y, b * this.scale, 0, 2 * Math.PI); ctx.arc(x, y, a * this.scale, 0, 2 * Math.PI, true); ctx.fill('evenodd');
      }
    }

    // ---- orbits and trails ----
    ctx.lineWidth = 1;
    for (const b of s.visual) {
      if (b.cls === 'debris') continue;
      const host = s.hostOf(b);
      if (s.flags.orbits && host) this.drawOrbit(b, host, b === s.selected);
      if (s.flags.trails && (b.source || b === s.selected)) this.drawTrail(b, host);
    }

    // ---- particles: one additive layer ----
    this.drawParticles(s);

    // ---- bodies, far to near (the view looks down from +z) ----
    this.drawn = [];
    this.bakeBudget = 160000;
    const order = [...s.visual].sort((a, b) => a.z - b.z);
    const positions = new Map<Body, Drawn>();
    for (const b of order) {
      const x = this.sx(b.x), y = this.sy(b.y);
      const trueR = (b.cls === 'bh' ? 2.6 * schwarzschild(b.m) : b.r) * this.scale;
      const r = Math.max(trueR, this.minR(b));
      const d: Drawn = { b, sx: x, sy: y, r, hidden: false };
      positions.set(b, d);
      this.drawn.push(d);
    }
    // a moon drawn larger than life would sit on its planet: hide it until they separate
    for (const d of this.drawn) {
      const host = s.hostOf(d.b);
      if (!host || host.cls === 'star' || host.cls === 'bh') continue;
      const hd = positions.get(host);
      if (hd && Math.hypot(hd.sx - d.sx, hd.sy - d.sy) < hd.r + d.r + 1 && d.r > d.b.r * this.scale * 1.5) d.hidden = true;
    }
    for (const d of this.drawn) {
      if (d.hidden || d.sx < -d.r * 3 - 60 || d.sx > W + d.r * 3 + 60 || d.sy < -d.r * 3 - 60 || d.sy > H + d.r * 3 + 60) continue;
      this.drawBody(d, s, stars);
    }

    this.drawFlashes(s.timeReal);
    this.drawSelection(s);
    this.drawAim();
    this.overlay?.(ctx);
  }

  private drawOrbit(b: Body, host: Body, sel: boolean) {
    const { r, v, mu } = relative(b, host);
    const o = osculating(mu, r, v);
    if (!(o.a > 0 && o.e < 0.995 && o.rp > host.r && b.m < host.m)) return;
    const px = o.a * this.scale;
    if (px < 3 && !sel) return;
    const n = Math.max(24, Math.min(256, Math.round(px)));
    const pts = ellipsePoints(o, r, n);
    const c = tintOf(b);
    const ctx = this.ctx;
    ctx.strokeStyle = css(c, sel ? 0.75 : b.source ? 0.32 : 0.15);
    ctx.beginPath();
    for (let k = 0; k <= n; k++) {
      const x = this.sx(host.x + pts[k][0]), y = this.sy(host.y + pts[k][1]);
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  private drawTrail(b: Body, host: Body | null) {
    let t = this.trails.get(b);
    if (!t) { t = new Trail(); this.trails.set(b, t); }
    const hid = host ? host.id : 0;
    if (hid !== t.hostId) { t.n = 0; t.head = 0; t.hostId = hid; }
    const hx = host ? host.x : 0, hy = host ? host.y : 0;
    const rx = b.x - hx, ry = b.y - hy;
    const last = t.last();
    const span = host ? Math.hypot(rx, ry) : 1 / this.scale * 4;
    if (!last || Math.hypot(rx - last[0], ry - last[1]) > 0.008 * span) t.push(rx, ry);
    if (t.n < 2) return;
    const ctx = this.ctx;
    const c = tintOf(b);
    const start = (t.head - t.n + TRAIL_N) % TRAIL_N;
    const chunks = 6;
    for (let ch = 0; ch < chunks; ch++) {
      const k0 = Math.floor((ch / chunks) * (t.n - 1)), k1 = Math.floor(((ch + 1) / chunks) * (t.n - 1));
      ctx.strokeStyle = css(c, 0.08 + 0.45 * ((ch + 1) / chunks) ** 1.5);
      ctx.beginPath();
      for (let k = k0; k <= k1; k++) {
        const i = (start + k) % TRAIL_N;
        const x = this.sx(hx + t.rel[i * 2]), y = this.sy(hy + t.rel[i * 2 + 1]);
        if (k === k0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      if (ch === chunks - 1) ctx.lineTo(this.sx(b.x), this.sy(b.y));
      ctx.stroke();
    }
  }

  private drawParticles(s: DrawState) {
    const { W, H } = this;
    const acc = this.acc;
    acc.fill(0);
    const compact = s.sources.filter(b => b.compact);
    const emitters = s.sources.filter(b => b.cls === 'star');
    let any = false;
    for (const b of s.bodies) {
      if (b.source || !b.alive || !b.isParticle) continue;
      const x = this.sx(b.x), y = this.sy(b.y);
      if (x < -8 || y < -8 || x > W + 8 || y > H + 8) continue;
      let near: Body | null = null, nd = Infinity;
      for (const h of compact) { const dd = Math.hypot(b.x - h.x, b.y - h.y, b.z - h.z); if (dd < nd) { nd = dd; near = h; } }
      const inner = near ? Math.max(near.captureRadius, 2e-5) : 0;
      let c: V3, w: number, sz: number;
      if (near && b.cls === 'gasp' && nd < 3000 * inner) {
        // a thin disc is hotter inward as r^-3/4: red at the rim, blue-white at the inner edge
        const h = Math.max(b.heat, Math.min(1, Math.pow((3 * inner) / nd, 0.75)));
        c = blackbody(2500 + 30000 * h * h);
        w = 0.5 + 2.5 * h * h;
        sz = 0.04 * nd * this.scale;
      } else if (b.cls === 'gasp') {
        const base = hex3(b.look.c1), h = b.heat;
        c = [base[0] * (0.4 + h) + h * 0.5, base[1] * (0.4 + h) + h * 0.25, base[2] * (0.4 + h)];
        w = 0.5;
        let dc = nd;
        for (const st of emitters) dc = Math.min(dc, Math.hypot(b.x - st.x, b.y - st.y, b.z - st.z));
        sz = Math.min(0.1 * Math.hypot(b.vx - (near?.vx ?? 0), b.vy - (near?.vy ?? 0)) * b.age, 0.25 * dc) * this.scale;
      } else {
        const base = hex3(b.look.c1), h = b.heat;
        c = [base[0] + h * 1.2, base[1] + h * 0.45, base[2] + h * 0.1];
        w = 0.9;
        sz = 0;
      }
      const rad = Math.max(0, Math.min(4, sz));
      any = true;
      if (rad < 0.8) {
        const xi = x | 0, yi = y | 0;
        if (xi < 0 || yi < 0 || xi >= W || yi >= H) continue;
        const k = (yi * W + xi) * 3;
        acc[k] += c[0] * w; acc[k + 1] += c[1] * w; acc[k + 2] += c[2] * w;
      } else {
        // a puff of gas: spread the same light over a small disc
        const ri = Math.ceil(rad), norm = w / (rad * rad * 2);
        for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++) {
          const q = (dx * dx + dy * dy) / (rad * rad);
          if (q > 1) continue;
          const xi = (x + dx) | 0, yi = (y + dy) | 0;
          if (xi < 0 || yi < 0 || xi >= W || yi >= H) continue;
          const k = (yi * W + xi) * 3, f = norm * (1 - q) * 3;
          acc[k] += c[0] * f; acc[k + 1] += c[1] * f; acc[k + 2] += c[2] * f;
        }
      }
    }
    if (!any) return;
    const d = this.partImg.data;
    for (let i = 0, j = 0; i < acc.length; i += 3, j += 4) {
      const r = acc[i], g = acc[i + 1], b = acc[i + 2];
      if (r + g + b === 0) { d[j + 3] = 0; continue; }
      d[j] = 255 * (1 - Math.exp(-r)); d[j + 1] = 255 * (1 - Math.exp(-g)); d[j + 2] = 255 * (1 - Math.exp(-b)); d[j + 3] = 255;
    }
    this.partCtx.putImageData(this.partImg, 0, 0);
    this.ctx.globalCompositeOperation = 'lighter';
    this.ctx.drawImage(this.part, 0, 0);
    this.ctx.globalCompositeOperation = 'source-over';
  }

  private halo(radius: number, c: V3, strength: number) {
    const R = Math.max(3, Math.min(90, Math.round(radius)));
    const key = `${R}|${c.map(v => Math.round(v * 8)).join(',')}|${Math.round(strength * 8)}`;
    let cv = this.haloCache.get(key);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = cv.height = R * 2 + 1;
      const g = cv.getContext('2d')!;
      const img = g.createImageData(cv.width, cv.height);
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        const q = Math.hypot(x - R, y - R) / R;
        if (q > 1) continue;
        // dithered, in steps: a pixel-art glow
        const f = Math.pow(1 - q, 2.2) * strength;
        const lv = Math.floor(f * 4 + bayer(x, y)) / 4;
        if (lv <= 0) continue;
        const o = (y * cv.width + x) * 4;
        img.data[o] = 255 * c[0] * lv; img.data[o + 1] = 255 * c[1] * lv; img.data[o + 2] = 255 * c[2] * lv; img.data[o + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      if (this.haloCache.size > 200) this.haloCache.clear();
      this.haloCache.set(key, cv);
    }
    return cv;
  }

  private drawBody(d: Drawn, s: DrawState, stars: Body[]) {
    const b = d.b;
    const ctx = this.ctx;
    if (b.look.craft) { drawCraft(ctx, b, d.sx, d.sy); return; }
    if (b.look.white) { drawWhiteHole(ctx, d.sx, d.sy, d.r, s.timeReal, this.haloFn); return; }
    if (b.look.wormhole) { drawWormhole(ctx, d.sx, d.sy, d.r, s.timeReal, b.look.seed % 1000); return; }
    // visual spin, capped so a fast clock does not strobe
    const sv = (this.spinVis.get(b) ?? 0) + Math.max(-0.06, Math.min(0.06, b.spin * s.dtSim));
    this.spinVis.set(b, sv % (2 * Math.PI));
    const axis = bodyAxis(b);

    // a star's glow, behind it
    if (b.cls === 'star' || b.cls === 'wd' || b.cls === 'ns') {
      const c = b.cls === 'ns' ? [0.6, 0.75, 1] as V3 : starRGB(b.star?.teff ?? 5772);
      const L = b.star?.L ?? 0;
      const R = b.cls === 'star' ? Math.max(d.r * 2.2, 7 + 3.5 * Math.log10(1 + L)) : Math.max(d.r * 2.5, 5);
      const k = Math.min(1, R / Math.max(d.r * 2.2, 1));
      const h = this.halo(R, c, 0.9 * k + 0.1);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(h, Math.round(d.sx - (h.width - 1) / 2), Math.round(d.sy - (h.height - 1) / 2));
      ctx.globalCompositeOperation = 'source-over';
    }

    // the surface map, and craters painted into it as they happen
    let entry = this.maps.get(b);
    const isWorld = b.cls !== 'star' && b.cls !== 'wd' && b.cls !== 'ns' && b.cls !== 'bh';
    const lookKey = `${b.look.style}|${b.look.c1}|${b.look.c2}`;
    if (isWorld && (!entry || entry.style !== lookKey)) {
      entry = { map: buildMap(b.look), style: lookKey, seen: new Set() };
      this.maps.set(b, entry);
    }
    const [fx, fy, fz] = bodyFrame(axis, sv);
    const scars: { d: V3; a: number; k: number }[] = [];
    if (entry && b.craters.length) {
      for (const c of b.craters) {
        const local: V3 = [c.x * fx[0] + c.y * fx[1] + c.z * fx[2], c.x * fy[0] + c.y * fy[1] + c.z * fy[2], c.x * fz[0] + c.y * fz[1] + c.z * fz[2]];
        if (b.shape && !b.shape.packed) {
          if (!entry.seen.has(c)) {
            entry.seen.add(c);
            const lx = c.x * Math.cos(sv) + c.y * Math.sin(sv), ly = -c.x * Math.sin(sv) + c.y * Math.cos(sv);
            chip(b.shape, Math.atan2(ly, lx), c.a);
            this.sprites.delete(b);
          }
        } else if (entry.map.gas) {
          const k = Math.exp(-(s.simTime - c.t) / 0.08);
          if (k > 0.05) scars.push({ d: local, a: Math.max(c.a, 0.06), k });
        } else if (!entry.seen.has(c)) {
          entry.seen.add(c);
          paintCrater(entry.map, local[0], local[1], local[2], c.a);
          this.sprites.delete(b);
        }
      }
    }

    // ---- the sprite, rebaked when what it shows has changed ----
    const dpx = Math.max(2, Math.round(d.r * 2));
    const bakeD = Math.min(dpx, 360);
    const { L, col } = this.lightFor(b, stars);
    if (b.shape && !b.shape.packed) {
      const sh = b.shape;
      const lqs = L ? `${Math.round(Math.atan2(L[1], L[0]) * 8)}` : 'n';
      const keyS = `S|${bakeD}|${lqs}|${Math.round((sv / (2 * Math.PI)) * Math.min(72, bakeD * 2))}|${Math.round(sh.round * 40)}|${Math.round(b.heat * 8)}|${b.craters.length}`;
      let c = this.sprites.get(b);
      if (!c || (c.key !== keyS && (this.bakeBudget > 0 || Math.abs(c.d - bakeD) > bakeD * 0.3))) {
        const sp = bakeShaped(sh, bakeD, sv, L, col, b.heat);
        this.bakeBudget -= sp.size * sp.size;
        const cv = c?.canvas && c.size === sp.size ? c.canvas : document.createElement('canvas');
        cv.width = cv.height = sp.size;
        cv.getContext('2d')!.putImageData(new ImageData(sp.data, sp.size, sp.size), 0, 0);
        c = { key: keyS, canvas: cv, size: sp.size, d: bakeD };
        this.sprites.set(b, c);
      }
      const k = dpx / c.d, sz = c.size * k;
      ctx.drawImage(c.canvas, Math.round(d.sx - sz / 2), Math.round(d.sy - sz / 2), Math.round(sz), Math.round(sz));
      return;
    }
    const lq = L ? (() => { const n = Math.hypot(L[0], L[1], L[2]); return `${Math.round(Math.atan2(L[1], L[0]) * 10)},${Math.round((L[2] / n) * 8)}`; })() : 'none';
    const spinQ = Math.round((sv / (2 * Math.PI)) * Math.min(96, bakeD * 2));
    const timeQ = b.cls === 'star' ? Math.floor(s.timeReal * 3) : 0;
    const key = `${bakeD}|${lq}|${spinQ}|${Math.round(b.heat * 10)}|${b.craters.length}|${scars.map(x => Math.round(x.k * 5)).join('')}|${timeQ}|${Math.round(b.star?.teff ?? 0) >> 7}|${b.look.style}`;
    let cached = this.sprites.get(b);
    if (!cached || (cached.key !== key && (this.bakeBudget > 0 || cached.d !== bakeD && Math.abs(cached.d - bakeD) > bakeD * 0.3))) {
      const sp = bakeSprite({
        look: b.look, cls: b.cls, heat: b.heat, teff: b.star?.teff ?? 5772, giant: b.star?.phase === 'giant' || b.star?.phase === 'agb',
        d: bakeD, axis, spin: sv, light: L, lightCol: col, scars, time: s.timeReal, map: entry?.map ?? null,
      });
      this.bakeBudget -= sp.size * sp.size;
      const cv = cached?.canvas && cached.size === sp.size ? cached.canvas : document.createElement('canvas');
      cv.width = cv.height = sp.size;
      cv.getContext('2d')!.putImageData(new ImageData(sp.data, sp.size, sp.size), 0, 0);
      cached = { key, canvas: cv, size: sp.size, d: bakeD };
      this.sprites.set(b, cached);
    }
    const k = dpx / cached.d;
    const sz = cached.size * k;
    ctx.drawImage(cached.canvas, Math.round(d.sx - sz / 2), Math.round(d.sy - sz / 2), Math.round(sz), Math.round(sz));

    // ---- jets: along the spin of what has fallen in, as bright as the feeding ----
    if (b.look.pulsar) drawPulsar(ctx, d.sx, d.sy, d.r, s.timeReal * 3 + b.id, !!b.look.magnetar);
    if (b.cls === 'bh' || b.cls === 'ns') this.drawJets(b, d, s);
  }

  private drawJets(b: Body, d: Drawn, s: DrawState) {
    let j = this.jet.get(b);
    if (!j) { j = { rate: 0, power: 0 }; this.jet.set(b, j); }
    // paused, the jets hold as they were
    if (s.dtSim > 0) {
      const inst = b.swallowed / s.dtSim;
      b.swallowed = 0;
      j.rate += (inst - j.rate) * Math.min(1, s.dtReal * 1.5);
    }
    // against the Eddington rate, 2.2×10⁻⁸ M☉/yr per M☉ at 10% efficiency
    const want = j.rate > 0 ? Math.max(0, Math.min(1, (Math.log10(j.rate / (2.2e-8 * b.m)) + 4) / 4)) : 0;
    j.power += (want - j.power) * Math.min(1, s.dtReal * 2);
    if (j.power < 0.03) return;
    // as long as the hole is big — thousands of Schwarzschild radii — and longer the harder it is fed
    // (never drawn longer than the screen: zoomed in on a giant hole it would be billions of pixels)
    const len = Math.min(2 * (this.W + this.H), Math.max(30, schwarzschild(b.m) * this.scale * (800 + 6000 * j.power)));
    drawJet(this.ctx, b, d.sx, d.sy, d.r, j.power, len, s.timeReal, this.haloFn);
  }

  private drawFlashes(now: number) {
    this.flashes = this.flashes.filter(f => now - f.t0 < f.dur);
    for (const f of this.flashes) {
      const u = (now - f.t0) / f.dur;
      const big = f.dur > 3;
      const x = this.sx(f.e.x), y = this.sy(f.e.y);
      const R = Math.min(this.W + this.H, Math.max(f.e.size * this.scale, (big ? 40 : f.e.kind === 'crater' ? 4 : 12) * Math.sqrt(f.e.energy + 0.1)));
      drawFlash(this.ctx, f.e, x, y, u, R, this.haloFn, now);
    }
  }
  private haloFn = (R: number, c: V3, k: number) => this.halo(R, c, k);

  private drawSelection(s: DrawState) {
    const ctx = this.ctx;
    const sel = s.selected;
    if (!sel) return;
    const d = this.drawn.find(q => q.b === sel);
    if (d && !d.hidden) {
      // pixel brackets round what is selected
      const r = Math.round(d.r + 3), x = Math.round(d.sx), y = Math.round(d.sy), k = Math.max(2, Math.round(r / 2));
      ctx.fillStyle = '#ffd27a';
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.fillRect(x + sx * r - (sx > 0 ? k - 1 : 0), y + sy * r, k, 1);
        ctx.fillRect(x + sx * r, y + sy * r - (sy > 0 ? k - 1 : 0), 1, k);
      }
    }
    // zones for the selection: Hill sphere, Lagrange points, barycentre
    const host = s.hostOf(sel);
    if (!s.flags.zones || !host || !sel.source) return;
    const hill = s.hillOf(sel);
    const x = this.sx(sel.x), y = this.sy(sel.y);
    if (isFinite(hill) && hill * this.scale > 4) {
      ctx.strokeStyle = 'rgba(143,180,255,0.55)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(x, y, hill * this.scale, 0, 2 * Math.PI); ctx.stroke();
      ctx.setLineDash([]);
    }
    lagrangePoints(sel, host).forEach((p, i) => {
      const px = Math.round(this.sx(p[0])), py = Math.round(this.sy(p[1]));
      ctx.fillStyle = i >= 3 ? '#9fe0a8' : '#c8b8ff';
      ctx.fillRect(px - 2, py, 5, 1); ctx.fillRect(px, py - 2, 1, 5);
    });
    const bc = barycentre(sel, host);
    const bx = Math.round(this.sx(bc[0])), by = Math.round(this.sy(bc[1]));
    ctx.fillStyle = '#ffd080';
    for (let k = -2; k <= 2; k++) { ctx.fillRect(bx + k, by + k, 1, 1); ctx.fillRect(bx + k, by - k, 1, 1); }
  }

  private drawAim() {
    if (!this.aim) return;
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,226,160,0.9)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    this.aim.pts.forEach((p, k) => { const x = this.sx(p[0]), y = this.sy(p[1]); if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
    ctx.setLineDash([]);
    if (this.aim.impact) {
      const x = Math.round(this.sx(this.aim.impact[0])), y = Math.round(this.sy(this.aim.impact[1]));
      ctx.fillStyle = '#ff8060';
      for (let k = -3; k <= 3; k++) { ctx.fillRect(x + k, y + k, 1, 1); ctx.fillRect(x + k, y - k, 1, 1); }
    }
  }

  /**
   * A point-mass lens on the background sky. The view looks down from a
   * height equal to its own width, which sets the Einstein radius √(2 r_s D):
   * a pixel at distance ρ from the hole shows what lies at ρ − θE²/ρ.
   */
  private drawLensing(sources: Body[]) {
    const holes = sources.filter(b => b.cls === 'bh');
    if (!holes.length) return;
    const ctx = this.ctx;
    const D = this.W / this.scale;
    for (const h of holes.slice(0, 2)) {
      const rs = schwarzschild(h.m);
      const RE = Math.sqrt(2 * rs * D) * this.scale;
      if (RE < 2) continue;
      const Rl = Math.min(Math.ceil(RE * 3), 140);
      const cx = Math.round(this.sx(h.x)), cy = Math.round(this.sy(h.y));
      const x0 = cx - Rl, y0 = cy - Rl, S = Rl * 2 + 1;
      if (x0 + S < 0 || y0 + S < 0 || x0 > this.W || y0 > this.H) continue;
      const src = ctx.getImageData(x0, y0, S, S);
      const dst = ctx.createImageData(S, S);
      const shadow = 2.6 * rs * this.scale;
      const e2 = RE * RE;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const dx = x - Rl, dy = y - Rl, rho = Math.hypot(dx, dy);
        const o = (y * S + x) * 4;
        if (rho > Rl) { dst.data.set(src.data.subarray(o, o + 4), o); continue; }
        if (rho < Math.max(shadow, 0.5)) { dst.data[o + 3] = 255; continue; }
        const k = 1 - e2 / (rho * rho);
        const sx = Math.round(Rl + dx * k), sy = Math.round(Rl + dy * k);
        if (sx < 0 || sy < 0 || sx >= S || sy >= S) { dst.data[o + 3] = 255; continue; }
        const so = (sy * S + sx) * 4;
        dst.data[o] = src.data[so]; dst.data[o + 1] = src.data[so + 1]; dst.data[o + 2] = src.data[so + 2]; dst.data[o + 3] = 255;
        // light piles up near the photon sphere
        if (rho < shadow * 1.4) { dst.data[o] = Math.min(255, dst.data[o] + 120); dst.data[o + 1] = Math.min(255, dst.data[o + 1] + 80); dst.data[o + 2] = Math.min(255, dst.data[o + 2] + 40); }
      }
      ctx.putImageData(dst, x0, y0);
    }
  }
}

/** A body's spin axis in the world frame (from its tilt and the way it leans). */
export function bodyAxis(b: Body): V3 {
  const t = b.tilt, n = b.node;
  return [Math.sin(t) * Math.sin(n), -Math.sin(t) * Math.cos(n), Math.cos(t)];
}

/** Stars at infinity in their real spread of colour and brightness, and a faint dithered band of galaxy. */
function buildSky(W: number, H: number) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = 3; d[i + 1] = 3; d[i + 2] = 7; d[i + 3] = 255; }
  let s = 12345;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  // the band: a dithered diagonal glow
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = (x / W - y / H * 0.55 - 0.2);
    const f = Math.exp(-t * t / 0.012) * 0.5;
    if (f > bayer(x, y) * 2.2) { const o = (y * W + x) * 4; d[o] += 7; d[o + 1] += 7; d[o + 2] += 12; }
  }
  const n = Math.round(W * H / 90);
  for (let k = 0; k < n; k++) {
    const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H);
    const T = 2600 + 9000 * rnd() ** 2.2 + (rnd() < 0.04 ? 15000 * rnd() : 0);
    const [r, gg, b] = blackbody(T);
    const m = 0.15 + 0.85 * rnd() ** 5;
    const o = (y * W + x) * 4;
    d[o] = Math.min(255, d[o] + 255 * r * m); d[o + 1] = Math.min(255, d[o + 1] + 255 * gg * m); d[o + 2] = Math.min(255, d[o + 2] + 255 * b * m);
  }
  g.putImageData(img, 0, 0);
  return cv;
}
