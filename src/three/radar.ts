import * as THREE from 'three';
import type { Body } from '../physics/body';
import { AU_M, fmtLength } from '../physics/units';
import { tintOf } from '../pixel/renderer';
import type { V3 } from '../pixel/sprites';

export interface RadarHost {
  camera: THREE.PerspectiveCamera;
  where(): V3;
  bodies(): Body[];
  selected(): Body | null;
  select(b: Body | null): void;
  go(b: Body): void;
  jump(b: Body): void;
  canJump(): boolean;
  /** seconds to reach a distance (m) at the best speed the drives allow */
  eta(d: number): number;
}

/**
 * The ship's map. Small, it is a scope in the corner: everything round the
 * ship laid flat in the plane it flies in, ahead at the top, on a log scale so
 * the nearest moon and the furthest star both show, each with a stalk for how
 * far above or below that plane it is. Opened (M), it fills most of the screen
 * beside a list of destinations, nearest first, to go to or jump to.
 * Tapping a blip selects it.
 */
export class Radar {
  readonly el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private list: HTMLElement;
  big = false;
  private blips: { b: Body; x: number; y: number }[] = [];
  private listKey = '';

  constructor(private host: RadarHost) {
    this.el = document.createElement('div');
    this.el.className = 'radar3';
    this.el.innerHTML = `<canvas></canvas><div class="dest3"></div>`;
    this.cv = this.el.querySelector('canvas')!;
    this.g = this.cv.getContext('2d')!;
    this.list = this.el.querySelector('.dest3')!;
    this.cv.addEventListener('pointerdown', e => {
      e.stopPropagation();
      const r = this.cv.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * this.cv.width, y = ((e.clientY - r.top) / r.height) * this.cv.height;
      let best: Body | null = null, bd = (this.cv.width / 14) ** 2;
      for (const p of this.blips) {
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bd) { bd = d; best = p.b; }
      }
      if (best) this.host.select(best);
      else if (!this.big) this.toggle();
    });
    this.list.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      const row = t.closest<HTMLElement>('[data-i]');
      if (!row) return;
      const b = this.rows[+row.dataset.i!];
      if (!b) return;
      if (t.dataset.a === 'go') { this.host.go(b); this.toggle(false); }
      else if (t.dataset.a === 'jump') { this.host.jump(b); this.toggle(false); }
      else this.host.select(b);
    });
  }

  private rows: Body[] = [];

  toggle(on = !this.big) {
    this.big = on;
    this.el.classList.toggle('big', on);
    this.listKey = '';
  }

  draw() {
    const W = this.big ? 560 : 180;
    if (this.cv.width !== W) { this.cv.width = W; this.cv.height = W; }
    const g = this.g, R = W / 2 - 6, cx = W / 2, cy = W / 2;
    g.clearRect(0, 0, W, W);
    g.fillStyle = 'rgba(6,14,22,0.82)';
    g.beginPath(); g.arc(cx, cy, R + 4, 0, 2 * Math.PI); g.fill();

    const P = this.host.where();
    const q = this.host.camera.quaternion.clone().invert();
    const sel = this.host.selected();
    const items: { b: Body; v: THREE.Vector3; d: number }[] = [];
    for (const b of this.host.bodies()) {
      const v = new THREE.Vector3((b.x - P[0]) * AU_M, (b.y - P[1]) * AU_M, (b.z - P[2]) * AU_M).applyQuaternion(q);
      const d = v.length();
      if (d > 0 && (b.source || b === sel || b.look.craft)) items.push({ b, v, d });
    }
    // the scale: from a little inside the nearest thing to the furthest
    let dmin = Infinity, dmax = 0;
    for (const it of items) { dmin = Math.min(dmin, it.d); dmax = Math.max(dmax, it.d); }
    const lo = Math.log10(Math.max(1e3, dmin / 3)), hi = Math.max(lo + 1, Math.log10(Math.max(dmax * 1.2, 1e4)));
    const rad = (d: number) => (R * Math.max(0, Math.log10(Math.max(d, 1)) - lo)) / (hi - lo);

    // rings, one a decade, labelled
    g.strokeStyle = 'rgba(90,200,170,0.22)';
    g.fillStyle = 'rgba(120,220,190,0.55)';
    g.font = `${this.big ? 11 : 9}px monospace`;
    g.lineWidth = 1;
    const step = Math.max(1, Math.ceil((hi - lo) / (this.big ? 8 : 4)));
    for (let e = Math.ceil(lo); e <= hi; e += step) {
      const r = rad(10 ** e);
      g.beginPath(); g.arc(cx, cy, r, 0, 2 * Math.PI); g.stroke();
      if (this.big || r > R * 0.5) g.fillText(fmtLength(10 ** e / AU_M), cx + 3, cy - r - 2);
    }
    g.beginPath(); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.stroke();
    // the ship, pointing up
    g.fillStyle = '#e8f4ff';
    g.beginPath(); g.moveTo(cx, cy - 6); g.lineTo(cx - 4, cy + 4); g.lineTo(cx + 4, cy + 4); g.fill();

    this.blips = [];
    items.sort((a, c) => c.d - a.d);
    for (const it of items) {
      // in the plane: x right, y ahead (−z); height along camera y
      const r = rad(it.d);
      const x = cx + (it.v.x / it.d) * r, y = cy + (it.v.z / it.d) * r;
      const up = (-it.v.y / it.d) * r;
      const t = tintOf(it.b);
      const col = `rgb(${(t[0] * 255) | 0},${(t[1] * 255) | 0},${(t[2] * 255) | 0})`;
      g.strokeStyle = col;
      g.globalAlpha = 0.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + up); g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = col;
      const s = it.b.source ? (it.b.cls === 'star' || it.b.cls === 'bh' ? 3 : 2) : 1.5;
      g.fillRect(x - s, y + up - s, 2 * s, 2 * s);
      if (it.b === sel) {
        g.strokeStyle = '#ffe070';
        g.strokeRect(x - s - 3, y + up - s - 3, 2 * s + 6, 2 * s + 6);
      }
      if (this.big && it.b.source && r > 8) { g.fillStyle = 'rgba(220,235,255,0.75)'; g.fillText(it.b.name, x + s + 3, y + up + 3); }
      this.blips.push({ b: it.b, x, y: y + up });
    }
    if (this.big) this.drawList(items);
  }

  private drawList(items: { b: Body; d: number }[]) {
    const near = items.filter(i => i.b.source || i.b.look.craft).sort((a, c) => a.d - c.d).slice(0, 40);
    const sel = this.host.selected();
    const jump = this.host.canJump();
    const key = near.map(i => `${i.b.id}:${fmtLength(i.d / AU_M)}`).join() + `|${sel?.id}|${jump}`;
    if (key === this.listKey) return;
    this.listKey = key;
    this.rows = near.map(i => i.b);
    this.list.innerHTML = `<div class="dh">Destinations</div>` + near.map((i, k) => {
      const eta = this.host.eta(i.d);
      return `<div class="row${i.b === sel ? ' sel' : ''}" data-i="${k}"><span class="nm">${esc(i.b.name)}</span><span class="ds">${fmtLength(i.d / AU_M)} · ${fmtTime(eta)}</span>`
        + `<button data-a="go">Go</button><button data-a="jump"${jump ? '' : ' disabled'}>Jump</button></div>`;
    }).join('');
  }
}

function esc(s: string) { return s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`); }

export function fmtTime(s: number) {
  if (!isFinite(s)) return '—';
  if (s < 1) return '<1 s';
  if (s < 90) return `${s.toFixed(0)} s`;
  if (s < 5400) return `${(s / 60).toFixed(0)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`;
  if (s < 3.15e7 * 2) return `${(s / 86400).toFixed(0)} d`;
  return `${(s / 3.156e7).toPrecision(2)} yr`;
}
