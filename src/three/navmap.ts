import type { Body } from '../physics/body';
import { AU_M, fmtLength } from '../physics/units';
import { relative, osculating, ellipsePoints, type V3 } from '../physics/orbit';
import { tintOf } from '../pixel/renderer';
import type { Pad } from '../ui/gamepad';
import { BTN } from '../ui/gamepad';
import { fmtTime } from './radar';

export interface NavHost {
  bodies(): Body[];
  hostOf(b: Body): Body | null;
  selected(): Body | null;
  select(b: Body | null): void;
  /** the ship: where it is (AU) and which way it points (world, unit) */
  ship(): { p: V3; fwd: V3 };
  /** the spacewalker, when outside */
  suit(): V3 | null;
  go(b: Body): void;
  jump(b: Body): void;
  /** why the wormhole drive cannot go now, or '' when it can */
  jumpBlock(): string;
  /** why the ship cannot fly somewhere now, or '' */
  goBlock(): string;
  eta(d: number): number;
  pad: Pad;
  onClose(): void;
}

/**
 * The nav map: the system from above, at true scale, to zoom from a moon's
 * orbit out to the whole system. Every body that goes round something is
 * drawn with its present orbit (the osculating ellipse about what it goes
 * round), the ship with its heading, and a route to the selected body with
 * how long it takes. A panel beside it lists destinations, nearest first,
 * to fly to or open a wormhole to.
 *
 * Wheel or pinch to zoom, drag to pan, tap a body to select it, double-tap to
 * go. On a controller: left stick pans, the triggers zoom, the d-pad steps
 * through bodies, A goes, Y opens a wormhole, X centres on the ship, B closes.
 */
export class NavMap {
  readonly el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private info: HTMLElement;
  private list: HTMLElement;
  open = false;
  /** the middle of the map, AU; or what it stays centred on */
  private centre: V3 = [0, 0, 0];
  private follow: 'ship' | Body | null = 'ship';
  /** px per AU, and where the zoom is heading */
  private scale = 1;
  private scaleGoal = 1;
  private W = 0;
  private H = 0;
  private blips: { b: Body; x: number; y: number }[] = [];
  private hover: Body | null = null;
  private orbits = new Map<Body, { pts: V3[]; host: Body; at: number }>();
  private frame = 0;
  private ptrs = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; moved: number } | null = null;
  private pinch = 0;
  private lastTap = { t: 0, b: null as Body | null };
  private rows: Body[] = [];
  private listKey = '';
  private infoKey = '';
  /** the controller press that opened the map is not also one that closes it */
  private fresh = false;

  constructor(private host: NavHost) {
    this.el = document.createElement('div');
    this.el.className = 'nav3';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="navmain">
        <canvas></canvas>
        <div class="navtools">
          <button data-n="ship" title="Centre on the ship (X)">⌖ Ship</button>
          <button data-n="target" title="Centre on the target">◎ Target</button>
          <button data-n="in" title="Zoom in (+)">＋</button>
          <button data-n="out" title="Zoom out (−)">−</button>
        </div>
        <div class="navscale"></div>
      </div>
      <div class="navside">
        <div class="navhead">Nav map <button class="icon close" data-n="close" title="Close (M)">✕</button></div>
        <div class="navinfo"></div>
        <div class="dest3"></div>
      </div>`;
    this.cv = this.el.querySelector('canvas')!;
    // drawn on the CPU: a big canvas redrawn every frame can queue up more work
    // than a slow GPU gets through, and stall the whole page while it catches up
    this.g = this.cv.getContext('2d', { willReadFrequently: true })!;
    this.info = this.el.querySelector('.navinfo')!;
    this.list = this.el.querySelector('.dest3')!;

    for (const b of this.el.querySelectorAll<HTMLElement>('[data-n]')) {
      b.addEventListener('click', () => {
        const n = b.dataset.n;
        if (n === 'close') this.show(false);
        if (n === 'ship') this.follow = 'ship';
        if (n === 'target') { const s = this.host.selected(); if (s) this.follow = s; }
        if (n === 'in') this.zoom(2);
        if (n === 'out') this.zoom(0.5);
      });
    }
    const cv = this.cv;
    cv.addEventListener('wheel', e => { e.preventDefault(); this.zoom(Math.exp(-e.deltaY * 0.0018), e.offsetX, e.offsetY); }, { passive: false });
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      this.ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.ptrs.size === 1) this.drag = { x: e.offsetX, y: e.offsetY, moved: 0 };
      else { this.drag = null; this.pinch = this.spread(); }
    });
    cv.addEventListener('pointermove', e => {
      const p = this.ptrs.get(e.pointerId);
      if (!p) { this.hover = this.near(e.offsetX, e.offsetY); return; }
      p.x = e.offsetX; p.y = e.offsetY;
      if (this.ptrs.size >= 2) {
        const s = this.spread();
        if (this.pinch > 0 && s > 0) this.zoom(s / this.pinch, this.W / 2, this.H / 2, true);
        this.pinch = s;
        return;
      }
      const d = this.drag;
      if (!d) return;
      const dx = e.offsetX - d.x, dy = e.offsetY - d.y;
      d.moved += Math.abs(dx) + Math.abs(dy);
      d.x = e.offsetX; d.y = e.offsetY;
      if (d.moved > 6) this.panBy(dx, dy);
    });
    const up = (e: PointerEvent) => {
      if (!this.ptrs.delete(e.pointerId)) return;
      const d = this.drag;
      this.drag = null;
      if (d && d.moved <= 6) {
        const b = this.near(e.offsetX, e.offsetY);
        const now = performance.now();
        if (b && this.lastTap.b === b && now - this.lastTap.t < 350) { this.go(b); return; }
        this.lastTap = { t: now, b };
        if (b) this.host.select(b);
      }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);

    const act = (e: Event) => {
      const t = e.target as HTMLElement;
      const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      const row = t.closest<HTMLElement>('[data-i]');
      const b = row ? this.rows[+row.dataset.i!] : this.host.selected();
      if (!b) return;
      if (a === 'go') this.go(b);
      else if (a === 'jump') this.jump(b);
      else if (a === 'show') this.follow = b;
      else if (row) { this.host.select(b); this.follow = b; }
    };
    this.list.addEventListener('click', act);
    this.info.addEventListener('click', act);
  }

  show(on = !this.open) {
    if (on === this.open) return;
    this.open = on;
    this.el.hidden = !on;
    this.listKey = this.infoKey = '';
    if (on) {
      this.fresh = true;
      this.follow = 'ship';
      const sel = this.host.selected();
      const s = this.host.ship().p;
      // fit the ship and the target, or the ship and what is round it
      let r = 0;
      if (sel && sel.alive) r = Math.hypot(sel.x - s[0], sel.y - s[1]) + sel.r * 4;
      else {
        const ds = this.host.bodies().filter(b => b.source).map(b => Math.hypot(b.x - s[0], b.y - s[1])).sort((a, c) => a - c);
        r = ds[Math.min(3, ds.length - 1)] ?? 1;
      }
      this.resize();
      this.scale = this.scaleGoal = (0.42 * Math.min(this.W, this.H)) / Math.max(r, 1e-9);
    } else this.host.onClose();
  }

  private go(b: Body) {
    if (this.host.goBlock()) return;
    this.host.select(b);
    this.host.go(b);
    this.show(false);
  }

  private jump(b: Body) {
    if (this.host.jumpBlock()) return;
    this.host.select(b);
    this.host.jump(b);
    this.show(false);
  }

  private spread() {
    const [a, b] = [...this.ptrs.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private zoom(k: number, sx = this.W / 2, sy = this.H / 2, now = false) {
    const goal = Math.min(1e16, Math.max(1e-4, this.scaleGoal * k));
    // keep the point under the pointer still
    if (this.follow === null || sx !== this.W / 2 || sy !== this.H / 2) {
      const w = this.unproject(sx, sy);
      this.follow = null;
      this.centre = [w[0] + (this.centre[0] - w[0]) * (this.scaleGoal / goal), w[1] + (this.centre[1] - w[1]) * (this.scaleGoal / goal), 0];
    }
    this.scaleGoal = goal;
    if (now) this.scale = goal;
  }

  private panBy(dx: number, dy: number) {
    if (this.follow !== null) this.centre = this.centreNow();
    this.follow = null;
    this.centre = [this.centre[0] - dx / this.scale, this.centre[1] + dy / this.scale, 0];
  }

  private centreNow(): V3 {
    const f = this.follow;
    if (f === 'ship') return this.host.ship().p;
    if (f && f.alive) return [f.x, f.y, f.z];
    return this.centre;
  }

  private sx(x: number) { return this.W / 2 + (x - this.centre[0]) * this.scale; }
  private sy(y: number) { return this.H / 2 - (y - this.centre[1]) * this.scale; }
  private unproject(px: number, py: number): V3 { return [this.centre[0] + (px - this.W / 2) / this.scale, this.centre[1] - (py - this.H / 2) / this.scale, 0]; }

  private near(x: number, y: number) {
    let best: Body | null = null, bd = 18 * 18;
    for (const p of this.blips) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = p.b; }
    }
    return best;
  }

  private resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    const w = Math.round(this.W * dpr), h = Math.round(this.H * dpr);
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** the controller, while the map is open */
  private padInput(dt: number) {
    const p = this.host.pad;
    if (!p.connected || this.fresh) { this.fresh = false; return; }
    if (p.ls[0] || p.ls[1]) this.panBy(-p.ls[0] * 600 * dt, -p.ls[1] * 600 * dt);
    if (p.rt || p.lt) this.zoom(Math.exp((p.rt - p.lt) * 2.5 * dt), this.W / 2, this.H / 2, true);
    const s = this.host.ship().p;
    if (p.hit(BTN.RIGHT) || p.hit(BTN.LEFT)) {
      const list = this.host.bodies().filter(b => b.source || b.look.craft)
        .sort((a, c) => Math.hypot(a.x - s[0], a.y - s[1], a.z - s[2]) - Math.hypot(c.x - s[0], c.y - s[1], c.z - s[2]));
      const cur = this.host.selected();
      const i = cur ? list.indexOf(cur) : -1, dir = p.hit(BTN.RIGHT) ? 1 : -1;
      const b = list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length];
      if (b) { this.host.select(b); this.follow = b; }
    }
    const sel = this.host.selected();
    if (p.hit(BTN.A) && sel) this.go(sel);
    else if (p.hit(BTN.Y) && sel) this.jump(sel);
    else if (p.hit(BTN.X)) this.follow = 'ship';
    else if (p.hit(BTN.B) || p.hit(BTN.VIEW)) this.show(false);
  }

  key(e: KeyboardEvent) {
    if (e.code === 'Equal' || e.code === 'NumpadAdd') this.zoom(2);
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.zoom(0.5);
    if (e.code === 'Escape' || e.code === 'KeyM') this.show(false);
    const sel = this.host.selected();
    if (e.code === 'Enter' && sel) this.go(sel);
    if (e.code === 'KeyJ' && sel) this.jump(sel);
  }

  draw(dt: number) {
    if (!this.open) return;
    this.padInput(dt);
    if (!this.open) return;
    this.resize();
    this.frame++;
    this.scale *= Math.pow(this.scaleGoal / this.scale, Math.min(1, dt * 10));
    this.centre = this.centreNow();
    const g = this.g, W = this.W, H = this.H, sc = this.scale;
    const sel = this.host.selected();
    const ship = this.host.ship();
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(4,10,18,0.55)';
    g.fillRect(0, 0, W, H);

    // faint scanlines, for the look of a screen
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);

    // the grid, a power of ten apart
    const step = 10 ** Math.ceil(Math.log10(70 / sc));
    g.strokeStyle = 'rgba(80,170,200,0.08)';
    g.lineWidth = 1;
    g.beginPath();
    const x0 = Math.floor(this.unproject(0, 0)[0] / step) * step, y0 = Math.floor(this.unproject(0, H)[1] / step) * step;
    for (let x = x0; this.sx(x) < W && x - x0 < step * 400; x += step) { const px = Math.round(this.sx(x)) + 0.5; g.moveTo(px, 0); g.lineTo(px, H); }
    for (let y = y0; this.sy(y) > 0 && y - y0 < step * 400; y += step) { const py = Math.round(this.sy(y)) + 0.5; g.moveTo(0, py); g.lineTo(W, py); }
    g.stroke();
    const sb = this.el.querySelector('.navscale') as HTMLElement;
    const lbl = `<i style="width:${(step * sc).toFixed(0)}px"></i>${fmtLength(step)}`;
    if (sb.innerHTML !== lbl) sb.innerHTML = lbl;

    const bodies = this.host.bodies();
    const shown = bodies.filter(b => b.source || b.look.craft || b === sel);

    // orbits, refreshed a few times a second
    g.lineWidth = 1;
    for (const b of shown) {
      let o = this.orbits.get(b);
      if (!o || this.frame - o.at > 20 || !o.host.alive) {
        const h = this.host.hostOf(b);
        if (!h) { this.orbits.delete(b); continue; }
        const { r, v, mu } = relative(b, h);
        const os = osculating(mu, r, v);
        if (!(os.a > 0 && os.e < 1)) { this.orbits.delete(b); continue; }
        o = { pts: os.a * sc > 2 ? ellipsePoints(os, r, 128) : [], host: h, at: this.frame };
        this.orbits.set(b, o);
      }
      if (o.pts.length < 2) { o.at = -99; continue; }
      const t = tintOf(b);
      g.strokeStyle = b === sel ? 'rgba(255,224,112,0.75)' : `rgba(${(t[0] * 255) | 0},${(t[1] * 255) | 0},${(t[2] * 255) | 0},0.28)`;
      // only the stretches near the screen: paths millions of pixels long are slow to draw
      g.beginPath();
      const M = W + H;
      let px = 0, py = 0, pin = false;
      o.pts.forEach((p, k) => {
        const x = this.sx(o!.host.x + p[0]), y = this.sy(o!.host.y + p[1]);
        const inside = x > -M && x < W + M && y > -M && y < H + M;
        if (k && (inside || pin)) { if (!pin) g.moveTo(px, py); g.lineTo(x, y); }
        px = x; py = y; pin = inside;
      });
      g.stroke();
    }
    for (const b of this.orbits.keys()) if (!b.alive) this.orbits.delete(b);

    // wormhole mouths, joined
    g.setLineDash([4, 5]);
    g.strokeStyle = 'rgba(170,130,255,0.5)';
    for (const b of shown) {
      if (!b.look.wormhole || !b.partnerId) continue;
      const o = bodies.find(q => q.id === b.partnerId);
      if (!o || o.id < b.id) continue;
      g.beginPath(); g.moveTo(this.sx(b.x), this.sy(b.y)); g.lineTo(this.sx(o.x), this.sy(o.y)); g.stroke();
    }

    // the route to the target
    const sx = this.sx(ship.p[0]), sy = this.sy(ship.p[1]);
    if (sel && sel.alive) {
      const tx = this.sx(sel.x), ty = this.sy(sel.y);
      g.strokeStyle = 'rgba(255,224,112,0.65)';
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(tx, ty); g.stroke();
      const d = (Math.hypot(sel.x - ship.p[0], sel.y - ship.p[1], sel.z - ship.p[2]) - sel.r) * AU_M;
      g.setLineDash([]);
      g.font = '11px ui-monospace, monospace';
      g.fillStyle = 'rgba(255,224,112,0.9)';
      const mx = (sx + tx) / 2, my = (sy + ty) / 2;
      if (Math.hypot(tx - sx, ty - sy) > 120) g.fillText(`${fmtLength(Math.max(0, d) / AU_M)} · ${fmtTime(this.host.eta(Math.max(0, d)))}`, mx + 6, my - 6);
    }
    g.setLineDash([]);

    // bodies, biggest last so they sit on top
    this.blips = [];
    const placed: [number, number, number, number][] = [];
    const order = [...shown].sort((a, c) => a.m - c.m);
    for (const b of order) {
      const x = this.sx(b.x), y = this.sy(b.y);
      const Rt = b.r * sc;
      if (x < -50 - Rt || x > W + 50 + Rt || y < -50 - Rt || y > H + 50 + Rt) continue;
      const t = tintOf(b), col = `rgb(${(t[0] * 255) | 0},${(t[1] * 255) | 0},${(t[2] * 255) | 0})`;
      // a disc bigger than the screen is drawn no bigger than it needs to be
      const R = Math.min(2 * (W + H), Math.max(b.source ? (b.cls === 'star' ? 4 : 2.5) : 1.5, b.r * sc));
      if (b.cls === 'star' || b.cls === 'wd') {
        const G = Math.min(W + H, R * 4 + 6);
        const gr = g.createRadialGradient(x, y, 0, x, y, G);
        gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.beginPath(); g.arc(x, y, G, 0, 2 * Math.PI); g.fill();
      }
      if (b.look.wormhole) {
        g.strokeStyle = '#b090ff'; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, Math.max(4, R), 0, 2 * Math.PI); g.stroke(); g.lineWidth = 1;
      } else if (b.cls === 'bh' && !b.look.white) {
        g.fillStyle = '#000'; g.strokeStyle = '#ffb070';
        g.beginPath(); g.arc(x, y, Math.max(3, R), 0, 2 * Math.PI); g.fill(); g.stroke();
      } else if (b.look.craft && !b.source) {
        g.fillStyle = col; g.fillRect(x - 1.5, y - 1.5, 3, 3);
      } else {
        g.fillStyle = col;
        g.beginPath(); g.arc(x, y, R, 0, 2 * Math.PI); g.fill();
      }
      if (b === sel || b === this.hover) {
        g.strokeStyle = b === sel ? '#ffe070' : 'rgba(255,255,255,0.6)';
        const k = R + 5;
        g.beginPath();
        for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          g.moveTo(x + a * k, y + c * k * 0.4); g.lineTo(x + a * k, y + c * k); g.lineTo(x + a * k * 0.4, y + c * k);
        }
        g.stroke();
      }
      this.blips.push({ b, x, y });
    }
    // names, where there is room, the most important first
    g.font = '11px ui-monospace, monospace';
    const named = [...shown].sort((a, c) => (c === sel ? 1 : 0) - (a === sel ? 1 : 0) || (c.source ? 1 : 0) - (a.source ? 1 : 0) || c.m - a.m);
    for (const b of named) {
      const x = this.sx(b.x), y = this.sy(b.y);
      if (x < 0 || x > W || y < 0 || y > H) continue;
      const R = Math.max(3, b.r * sc), w = g.measureText(b.name).width;
      const box: [number, number, number, number] = [x + R + 4, y - 7, x + R + 6 + w, y + 6];
      if (b !== sel && placed.some(p => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
      placed.push(box);
      g.fillStyle = b === sel ? '#ffe070' : b.source ? 'rgba(220,235,255,0.85)' : 'rgba(180,195,215,0.6)';
      g.fillText(b.name, box[0], y + 4);
      if (placed.length > 60) break;
    }

    // the spacewalker, and the ship with its heading
    const suit = this.host.suit();
    if (suit) {
      g.fillStyle = '#ffffff';
      g.fillRect(this.sx(suit[0]) - 2, this.sy(suit[1]) - 2, 4, 4);
    }
    const hx = ship.fwd[0], hy = -ship.fwd[1], hl = Math.hypot(hx, hy);
    const pulse = 9 + 3 * Math.sin(performance.now() / 300);
    g.strokeStyle = 'rgba(120,230,255,0.5)';
    g.beginPath(); g.arc(sx, sy, pulse, 0, 2 * Math.PI); g.stroke();
    g.fillStyle = '#7fe8ff';
    g.save();
    g.translate(sx, sy);
    if (hl > 0.2) {
      g.rotate(Math.atan2(hy, hx) + Math.PI / 2);
      g.beginPath(); g.moveTo(0, -8); g.lineTo(-5, 6); g.lineTo(0, 3); g.lineTo(5, 6); g.closePath(); g.fill();
    } else { g.beginPath(); g.arc(0, 0, 4, 0, 2 * Math.PI); g.fill(); }
    g.restore();

    this.drawInfo(sel, ship.p);
    this.drawList(ship.p);
  }

  private drawInfo(sel: Body | null, P: V3) {
    const jb = this.host.jumpBlock(), gb = this.host.goBlock();
    let d = 0;
    if (sel && sel.alive) d = Math.max(0, (Math.hypot(sel.x - P[0], sel.y - P[1], sel.z - P[2]) - sel.r) * AU_M);
    const dist = `${fmtLength(d / AU_M)} away · ${fmtTime(this.host.eta(d))} under drive`;
    const key = `${sel?.id}|${jb}|${gb}`;
    if (key === this.infoKey) {
      // only the distance changes: leave the buttons alone so they can be pressed
      const el = this.info.querySelector('.dist');
      if (el && el.textContent !== dist) el.textContent = dist;
      return;
    }
    this.infoKey = key;
    if (!sel || !sel.alive) { this.info.innerHTML = `<div class="dim">Tap a body to pick a destination.</div>`; return; }
    this.info.innerHTML = `<div class="nm">${esc(sel.name)}</div>`
      + `<div class="dim dist">${dist}</div>`
      + `<div class="row"><button data-a="go"${gb ? ' disabled' : ''}>Fly there</button><button data-a="jump" class="worm"${jb ? ' disabled' : ''}>Wormhole</button><button data-a="show">Show</button></div>`
      + (gb || jb ? `<div class="dim">${esc(gb || jb)}</div>` : '');
  }

  private drawList(P: V3) {
    const near = this.host.bodies().filter(b => b.source || b.look.craft)
      .map(b => ({ b, d: Math.max(0, Math.hypot(b.x - P[0], b.y - P[1], b.z - P[2]) - b.r) * AU_M }))
      .sort((a, c) => a.d - c.d).slice(0, 40);
    const sel = this.host.selected();
    const jump = !this.host.jumpBlock(), go = !this.host.goBlock();
    const text = (i: { b: Body; d: number }) => `${fmtLength(i.d / AU_M)} · ${fmtTime(this.host.eta(i.d))}`;
    const key = near.map(i => i.b.id).join() + `|${sel?.id}|${jump}|${go}`;
    if (key === this.listKey) {
      // the same rows in the same order: just the distances
      const ds = this.list.querySelectorAll('.ds');
      near.forEach((i, k) => { const t = text(i); if (ds[k] && ds[k].textContent !== t) ds[k].textContent = t; });
      return;
    }
    this.listKey = key;
    this.rows = near.map(i => i.b);
    this.list.innerHTML = `<div class="dh">Destinations</div>` + near.map((i, k) => {
      const t = tintOf(i.b);
      return `<div class="row${i.b === sel ? ' sel' : ''}" data-i="${k}"><span class="nm"><i style="background:rgb(${(t[0] * 255) | 0},${(t[1] * 255) | 0},${(t[2] * 255) | 0})"></i>${esc(i.b.name)}</span><span class="ds">${text(i)}</span>`
        + `<button data-a="go"${go ? '' : ' disabled'}>Go</button><button data-a="jump"${jump ? '' : ' disabled'}>Wormhole</button></div>`;
    }).join('');
  }
}

function esc(s: string) { return s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`); }
