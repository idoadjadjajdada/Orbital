import * as THREE from 'three';
import type { Body } from '../physics/body';
import { AU_M, G, fmtLength } from '../physics/units';
import { tintOf } from '../pixel/renderer';
import type { V3 } from '../pixel/sprites';
import { fmtTime } from './radar';
import { BTN, type Pad } from '../ui/gamepad';

export interface NavHost {
  where(): V3;
  /** the ship's heading, world */
  heading(): THREE.Vector3;
  bodies(): Body[];
  selected(): Body | null;
  select(b: Body | null): void;
  hostOf(b: Body): Body | null;
  go(b: Body): void;
  jump(b: Body): void;
  canJump(): boolean;
  eta(d: number): number;
  /** where the ship is headed, if anywhere */
  route(): Body | null;
  onClose(): void;
}

type Filter = 'all' | 'worlds' | 'stars' | 'craft';

/**
 * The nav map: the system from above (the plane of the sky the simulation
 * calls x–y), drawn to scale with its orbits, where the ship is and which way
 * it points, and the route it is flying. Wheel or pinch to zoom, drag to pan,
 * tap to select; the card says how far and how long, and goes or jumps there.
 * Beside it, every destination, nearest first, searchable.
 */
export class NavMap {
  readonly el: HTMLElement;
  open = false;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private list: HTMLElement;
  private card: HTMLElement;
  private q: HTMLInputElement;
  /** the centre (AU) and the scale (CSS px per AU) */
  private cx = 0;
  private cy = 0;
  private scale = 1;
  private followShip = true;
  private filter: Filter = 'all';
  private rows: Body[] = [];
  private listKey = '';
  private cardKey = '';
  private drag: { x: number; y: number; cx: number; cy: number; moved: number } | null = null;
  private pinch = new Map<number, { x: number; y: number }>();
  private pinchD = 0;
  private placed: { b: Body; x: number; y: number }[] = [];

  constructor(private host: NavHost) {
    this.el = document.createElement('div');
    this.el.className = 'nav3';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="navhead"><b>NAV</b><span class="navsub">the system from above · drag to pan · wheel or pinch to zoom · tap to select</span>
        <span class="navbtns"><button data-n="ship" title="Centre on the ship">⌖ Ship</button><button data-n="sel" title="Centre on the selection">◎ Target</button><button data-n="fit" title="See everything">⤢ All</button><button data-n="in">＋</button><button data-n="out">－</button></span>
        <button class="navx" data-n="close" title="Close (M)">✕</button></div>
      <div class="navbody">
        <div class="navmapwrap"><canvas></canvas><div class="navcard" hidden></div></div>
        <div class="navside">
          <input class="navq" placeholder="Search destinations" spellcheck="false">
          <div class="navf"><button data-f="all" class="on">All</button><button data-f="worlds">Worlds</button><button data-f="stars">Stars</button><button data-f="craft">Craft</button></div>
          <div class="navlist"></div>
        </div>
      </div>`;
    this.cv = this.el.querySelector('canvas')!;
    this.g = this.cv.getContext('2d')!;
    this.list = this.el.querySelector('.navlist')!;
    this.card = this.el.querySelector('.navcard')!;
    this.q = this.el.querySelector('.navq')!;
    this.q.addEventListener('input', () => { this.listKey = ''; });
    this.q.addEventListener('keydown', e => e.stopPropagation());
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-n]')) b.addEventListener('click', () => this.button(b.dataset.n!));
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-f]')) b.addEventListener('click', () => {
      this.filter = b.dataset.f as Filter;
      for (const c of this.el.querySelectorAll<HTMLElement>('[data-f]')) c.classList.toggle('on', c === b);
      this.listKey = '';
    });
    this.list.addEventListener('click', e => this.rowClick(e));
    this.card.addEventListener('click', e => {
      const a = (e.target as HTMLElement).dataset.a, s = this.host.selected();
      if (!s) return;
      if (a === 'go') { this.host.go(s); this.toggle(false); }
      if (a === 'jump') { this.host.jump(s); this.toggle(false); }
      if (a === 'centre') this.centreOn(s);
    });

    const cv = this.cv;
    cv.addEventListener('wheel', e => { e.preventDefault(); const r = cv.getBoundingClientRect(); this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch.size === 2) { const [a, b] = [...this.pinch.values()]; this.pinchD = Math.hypot(a.x - b.x, a.y - b.y); this.drag = null; return; }
      this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy, moved: 0 };
    });
    cv.addEventListener('pointermove', e => {
      if (!this.pinch.has(e.pointerId)) return;
      this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch.size === 2) {
        const [a, b] = [...this.pinch.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        const r = cv.getBoundingClientRect();
        if (this.pinchD > 0) this.zoomAt(d / this.pinchD, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        this.pinchD = d;
        return;
      }
      const dr = this.drag;
      if (!dr) return;
      dr.moved = Math.max(dr.moved, Math.hypot(e.clientX - dr.x, e.clientY - dr.y));
      if (dr.moved > 4) {
        this.followShip = false;
        this.cx = dr.cx - (e.clientX - dr.x) / this.scale;
        this.cy = dr.cy + (e.clientY - dr.y) / this.scale;
      }
    });
    const up = (e: PointerEvent) => {
      this.pinch.delete(e.pointerId);
      if (this.pinch.size < 2) this.pinchD = 0;
      const dr = this.drag;
      this.drag = null;
      if (!dr || dr.moved > 4) return;
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best: Body | null = null, bd = 16 ** 2;
      for (const p of this.placed) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p.b; } }
      this.host.select(best);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('dblclick', () => { const s = this.host.selected(); if (s) { this.host.go(s); this.toggle(false); } });
  }

  toggle(on = !this.open) {
    if (on === this.open) return;
    this.open = on;
    this.el.hidden = !on;
    this.listKey = this.cardKey = '';
    if (on) {
      if (document.pointerLockElement) document.exitPointerLock();
      this.followShip = true;
      this.fitNear();
    } else this.host.onClose();
  }

  /** a first view: the ship and the dozen things nearest it */
  private fitNear() {
    const P = this.host.where();
    const ds = this.host.bodies().filter(b => b.source).map(b => Math.hypot(b.x - P[0], b.y - P[1])).sort((a, b) => a - b);
    const d = ds[Math.min(ds.length - 1, 6)] ?? 1;
    this.cx = P[0]; this.cy = P[1];
    this.scale = (Math.min(this.size().w, this.size().h) * 0.42) / Math.max(d, 1e-9);
  }

  private size() { const r = this.cv.getBoundingClientRect(); return { w: r.width || 600, h: r.height || 400 }; }

  private button(n: string) {
    if (n === 'close') this.toggle(false);
    if (n === 'ship') { this.followShip = true; }
    if (n === 'sel') { const s = this.host.selected(); if (s) this.centreOn(s); }
    if (n === 'fit') {
      const bs = this.host.bodies().filter(b => b.source);
      if (!bs.length) return;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const b of bs) { x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x); y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y); }
      this.followShip = false;
      this.cx = (x0 + x1) / 2; this.cy = (y0 + y1) / 2;
      const { w, h } = this.size();
      this.scale = Math.min(w / Math.max(x1 - x0, 1e-9), h / Math.max(y1 - y0, 1e-9)) * 0.85;
    }
    if (n === 'in') this.zoomAt(1.6);
    if (n === 'out') this.zoomAt(1 / 1.6);
  }

  private centreOn(b: Body) {
    this.followShip = false;
    this.cx = b.x; this.cy = b.y;
    const h = this.host.hostOf(b);
    // close enough to see its moons, or its own orbit
    const r = h ? Math.hypot(b.x - h.x, b.y - h.y) * 0.6 : b.r * 200;
    const kids = this.host.bodies().filter(c => c.source && this.host.hostOf(c) === b).map(c => Math.hypot(c.x - b.x, c.y - b.y));
    const R = kids.length ? Math.max(...kids) * 1.3 : r;
    const { w, h: H } = this.size();
    this.scale = (Math.min(w, H) * 0.45) / Math.max(R, b.r * 4, 1e-10);
  }

  private zoomAt(f: number, x?: number, y?: number) {
    const { w, h } = this.size();
    x ??= w / 2; y ??= h / 2;
    const wx = this.cx + (x - w / 2) / this.scale, wy = this.cy - (y - h / 2) / this.scale;
    this.scale = Math.min(1e16, Math.max(1e-6, this.scale * f));
    if (!this.followShip || x !== w / 2) {
      this.cx = wx - (x - w / 2) / this.scale;
      this.cy = wy + (y - h / 2) / this.scale;
      if (x !== w / 2 || y !== h / 2) this.followShip = false;
    }
  }

  /** the controller while the map is open: stick pans, triggers zoom, d-pad steps through the list, A goes, Y jumps, X centres, B closes */
  pad(p: Pad, dt: number) {
    if (p.ls[0] || p.ls[1]) { this.followShip = false; this.cx += (p.ls[0] * 500 * dt) / this.scale; this.cy -= (p.ls[1] * 500 * dt) / this.scale; }
    const z = p.rt - p.lt - p.rs[1];
    if (z) this.zoomAt(Math.exp(z * 2.5 * dt));
    const step = (k: number) => {
      if (!this.rows.length) return;
      const i = this.rows.indexOf(this.host.selected()!);
      const b = this.rows[i < 0 ? 0 : (i + k + this.rows.length) % this.rows.length];
      this.host.select(b);
      this.centreOn(b);
    };
    if (p.hit(BTN.DOWN)) step(1);
    if (p.hit(BTN.UP)) step(-1);
    const s = this.host.selected();
    if (p.hit(BTN.A) && s) { this.host.go(s); this.toggle(false); }
    else if (p.hit(BTN.Y) && s) { this.host.jump(s); this.toggle(false); }
    else if (p.hit(BTN.X) && s) this.centreOn(s);
    else if (p.hit(BTN.B) || p.hit(BTN.VIEW)) this.toggle(false);
  }

  private rowClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('[data-i]');
    if (!row) return;
    const b = this.rows[+row.dataset.i!];
    if (!b) return;
    if (t.dataset.a === 'go') { this.host.go(b); this.toggle(false); }
    else if (t.dataset.a === 'jump') { this.host.jump(b); this.toggle(false); }
    else { this.host.select(b); this.centreOn(b); }
  }

  draw() {
    const { w, h } = this.size();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.cv.width !== Math.round(w * dpr) || this.cv.height !== Math.round(h * dpr)) { this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr); }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const P = this.host.where();
    if (this.followShip) { this.cx = P[0]; this.cy = P[1]; }
    const sx = (x: number) => w / 2 + (x - this.cx) * this.scale, sy = (y: number) => h / 2 - (y - this.cy) * this.scale;

    // background and grid
    const bg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    bg.addColorStop(0, '#0b1a26'); bg.addColorStop(1, '#03070c');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const step = niceStep(110 / this.scale);
    g.strokeStyle = 'rgba(90,200,170,0.08)'; g.lineWidth = 1;
    const gx0 = Math.floor((this.cx - w / 2 / this.scale) / step) * step;
    const gy0 = Math.floor((this.cy - h / 2 / this.scale) / step) * step;
    g.beginPath();
    for (let x = gx0; sx(x) < w; x += step) { g.moveTo(Math.round(sx(x)) + 0.5, 0); g.lineTo(Math.round(sx(x)) + 0.5, h); }
    for (let y = gy0; sy(y) > 0; y += step) { g.moveTo(0, Math.round(sy(y)) + 0.5); g.lineTo(w, Math.round(sy(y)) + 0.5); }
    g.stroke();

    const bodies = this.host.bodies().filter(b => b.source || b.look.craft);
    const sel = this.host.selected();

    // orbits
    g.lineWidth = 1;
    for (const b of bodies) {
      if (b.look.craft && b !== sel) continue;
      const hst = this.host.hostOf(b);
      if (!hst) continue;
      const pts = orbit(b, hst);
      if (!pts) continue;
      const span = Math.hypot(pts.ax, pts.ay) * this.scale;
      if (span < 3 || span > 1e6) continue;
      const t = tintOf(b);
      g.strokeStyle = `rgba(${(t[0] * 255) | 0},${(t[1] * 255) | 0},${(t[2] * 255) | 0},${b === sel ? 0.8 : 0.28})`;
      g.beginPath();
      for (let k = 0; k <= 96; k++) {
        const [x, y] = pts.at(k / 96);
        if (k === 0) g.moveTo(sx(hst.x + x), sy(hst.y + y)); else g.lineTo(sx(hst.x + x), sy(hst.y + y));
      }
      g.stroke();
    }

    // the route
    const route = this.host.route();
    const sxp = sx(P[0]), syp = sy(P[1]);
    for (const [b, col, dash] of [[route, '#7dffb0', [6, 4]], [sel !== route ? sel : null, 'rgba(255,224,112,0.7)', [2, 4]]] as const) {
      if (!b || !b.alive) continue;
      g.strokeStyle = col; g.setLineDash(dash as unknown as number[]); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(sxp, syp); g.lineTo(sx(b.x), sy(b.y)); g.stroke();
      g.setLineDash([]);
      const d = (Math.hypot(b.x - P[0], b.y - P[1], b.z - P[2]) - b.r) * AU_M;
      g.fillStyle = col; g.font = '11px system-ui, sans-serif';
      g.fillText(`${fmtLength(Math.max(0, d) / AU_M)} · ${fmtTime(this.host.eta(Math.max(0, d)))}`, (sxp + sx(b.x)) / 2 + 6, (syp + sy(b.y)) / 2 - 6);
    }
    g.lineWidth = 1;

    // bodies, biggest last so they sit on top
    this.placed = [];
    const labels: { x: number; y: number; t: string; c: string; pri: number }[] = [];
    const order = [...bodies].sort((a, b) => a.m - b.m);
    for (const b of order) {
      const x = sx(b.x), y = sy(b.y);
      if (x < -50 || x > w + 50 || y < -50 || y > h + 50) continue;
      const t = tintOf(b);
      const col = `rgb(${(t[0] * 255) | 0},${(t[1] * 255) | 0},${(t[2] * 255) | 0})`;
      const minR = b.look.craft ? 1.5 : b.cls === 'star' ? 5 : b.cls === 'bh' ? 4 : b.cls === 'gas' ? 3.5 : b.m > 1e-7 ? 2.5 : 1.8;
      const r = Math.max(minR, b.r * this.scale);
      if (b.cls === 'star' || b.cls === 'wd' || b.cls === 'ns') {
        const gl = g.createRadialGradient(x, y, 0, x, y, r * 4);
        gl.addColorStop(0, col); gl.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gl; g.beginPath(); g.arc(x, y, r * 4, 0, 2 * Math.PI); g.fill();
      }
      g.fillStyle = b.cls === 'bh' ? '#000' : col;
      if (b.look.craft) g.fillRect(x - 1.5, y - 1.5, 3, 3);
      else { g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fill(); }
      if (b.cls === 'bh') { g.strokeStyle = '#ffb070'; g.beginPath(); g.arc(x, y, r + 1.5, 0, 2 * Math.PI); g.stroke(); }
      if (b === sel) {
        g.strokeStyle = '#ffe070'; g.lineWidth = 1.5;
        const k = r + 5 + Math.sin(performance.now() / 200) * 1.5;
        g.beginPath(); g.arc(x, y, k, 0, 2 * Math.PI); g.stroke();
        g.lineWidth = 1;
      }
      this.placed.push({ b, x, y });
      if (b.source || b === sel) labels.push({ x: x + r + 4, y: y + 4, t: b.name, c: b === sel ? '#ffe070' : 'rgba(220,235,255,0.85)', pri: b === sel ? 1e9 : b.m });
    }
    // labels, most important first, none on top of another
    labels.sort((a, b) => b.pri - a.pri);
    g.font = '11px system-ui, sans-serif';
    const taken: [number, number, number][] = [];
    for (const l of labels) {
      const tw = g.measureText(l.t).width;
      if (taken.some(([x, y, ww]) => l.x < x + ww && x < l.x + tw && Math.abs(l.y - y) < 12)) continue;
      taken.push([l.x, l.y, tw]);
      g.fillStyle = 'rgba(3,7,12,0.6)'; g.fillRect(l.x - 2, l.y - 10, tw + 4, 13);
      g.fillStyle = l.c; g.fillText(l.t, l.x, l.y);
    }

    // the ship: an arrow along its heading, with a pulse
    const hd = this.host.heading();
    const ang = Math.atan2(-hd.y, hd.x);
    const pulse = (performance.now() / 1000) % 1.5 / 1.5;
    g.strokeStyle = `rgba(125,255,176,${1 - pulse})`;
    g.beginPath(); g.arc(sxp, syp, 6 + pulse * 18, 0, 2 * Math.PI); g.stroke();
    g.save(); g.translate(sxp, syp); g.rotate(ang);
    g.fillStyle = '#7dffb0';
    g.beginPath(); g.moveTo(9, 0); g.lineTo(-6, -5); g.lineTo(-3, 0); g.lineTo(-6, 5); g.closePath(); g.fill();
    g.restore();

    // scale bar
    const bar = niceStep(120 / this.scale);
    const bw = bar * this.scale;
    g.strokeStyle = 'rgba(200,230,255,0.8)'; g.fillStyle = 'rgba(200,230,255,0.85)';
    g.beginPath(); g.moveTo(16, h - 18); g.lineTo(16 + bw, h - 18); g.moveTo(16, h - 22); g.lineTo(16, h - 14); g.moveTo(16 + bw, h - 22); g.lineTo(16 + bw, h - 14); g.stroke();
    g.font = '11px system-ui, sans-serif';
    g.fillText(fmtLength(bar), 16, h - 26);

    this.drawCard(P);
    this.drawList(P);
  }

  private drawCard(P: V3) {
    const s = this.host.selected();
    if (!s || !s.alive) { this.card.hidden = true; this.cardKey = ''; return; }
    const d = (Math.hypot(s.x - P[0], s.y - P[1], s.z - P[2]) - s.r) * AU_M;
    const h = this.host.hostOf(s);
    const key = `${s.id}|${fmtLength(Math.max(0, d) / AU_M)}|${this.host.canJump()}`;
    if (key === this.cardKey) return;
    this.cardKey = key;
    this.card.hidden = false;
    this.card.innerHTML = `<div class="nc-n">${esc(s.name)}</div><div class="nc-k">${esc(kindOf(s))}${h ? ` · round ${esc(h.name)}` : ''}</div>`
      + `<div class="nc-d">${fmtLength(Math.max(0, d) / AU_M)} away · about ${fmtTime(this.host.eta(Math.max(0, d)))} by drive</div>`
      + `<div class="nc-b"><button data-a="go">Go</button><button data-a="jump"${this.host.canJump() ? '' : ' disabled title="The wormhole drive is recharging"'}>Wormhole</button><button data-a="centre">Centre</button></div>`;
  }

  private drawList(P: V3) {
    const q = this.q.value.trim().toLowerCase();
    const f = this.filter;
    const items = this.host.bodies()
      .filter(b => (b.source || b.look.craft) && (!q || b.name.toLowerCase().includes(q)))
      .filter(b => f === 'all' || (f === 'craft' ? !!b.look.craft : f === 'stars' ? ['star', 'wd', 'ns', 'bh'].includes(b.cls) : !b.look.craft && !['star', 'wd', 'ns', 'bh'].includes(b.cls)))
      .map(b => ({ b, d: Math.max(0, (Math.hypot(b.x - P[0], b.y - P[1], b.z - P[2]) - b.r) * AU_M) }))
      .sort((a, c) => a.d - c.d).slice(0, 60);
    const sel = this.host.selected(), jump = this.host.canJump();
    const key = items.map(i => `${i.b.id}:${fmtLength(i.d / AU_M)}`).join() + `|${sel?.id}|${jump}|${q}|${f}`;
    if (key === this.listKey) return;
    this.listKey = key;
    this.rows = items.map(i => i.b);
    this.list.innerHTML = items.map((i, k) => {
      const t = tintOf(i.b);
      return `<div class="row${i.b === sel ? ' sel' : ''}" data-i="${k}"><span class="dot" style="background:rgb(${(t[0] * 255) | 0},${(t[1] * 255) | 0},${(t[2] * 255) | 0})"></span>`
        + `<span class="nm">${esc(i.b.name)}</span><span class="ds">${esc(kindOf(i.b))} · ${fmtLength(i.d / AU_M)} · ${fmtTime(this.host.eta(i.d))}</span>`
        + `<button data-a="go">Go</button><button data-a="jump"${jump ? '' : ' disabled'}>Jump</button></div>`;
    }).join('') || '<div class="empty">Nothing matches.</div>';
  }
}

/** an orbit about its host as a closed curve (if bound), x–y relative to the host */
function orbit(b: Body, h: Body) {
  const mu = G * (h.m + b.m);
  const r = new THREE.Vector3(b.x - h.x, b.y - h.y, b.z - h.z), v = new THREE.Vector3(b.vx - h.vx, b.vy - h.vy, b.vz - h.vz);
  const rl = r.length();
  if (!(rl > 0) || !(mu > 0)) return null;
  const a = 1 / (2 / rl - v.lengthSq() / mu);
  if (!(a > 0) || !isFinite(a)) return null;
  const hv = r.clone().cross(v);
  const ev = v.clone().cross(hv).divideScalar(mu).sub(r.clone().divideScalar(rl));
  const e = ev.length();
  if (e >= 0.99) return null;
  const P = e > 1e-6 ? ev.clone().normalize() : r.clone().normalize();
  const Q = hv.clone().normalize().cross(P);
  const bAx = a * Math.sqrt(1 - e * e);
  return {
    ax: a * P.x, ay: a * P.y,
    at(t: number): [number, number] {
      const E = t * 2 * Math.PI;
      const c = a * (Math.cos(E) - e), s = bAx * Math.sin(E);
      return [c * P.x + s * Q.x, c * P.y + s * Q.y];
    },
  };
}

/** 1, 2 or 5 times a power of ten, near x */
function niceStep(x: number) {
  const p = 10 ** Math.floor(Math.log10(x)), m = x / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function kindOf(b: Body) {
  if (b.look.craft) return 'craft';
  if (b.look.wormhole) return 'wormhole';
  if (b.look.white) return 'white hole';
  return ({ star: 'star', wd: 'white dwarf', ns: 'neutron star', bh: 'black hole', gas: 'giant', ice: 'icy world', rock: 'rocky world' } as Record<string, string>)[b.cls] ?? b.cls;
}

function esc(s: string) { return s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`); }
