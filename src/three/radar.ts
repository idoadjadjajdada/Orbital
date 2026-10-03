import * as THREE from 'three';
import type { Body } from '../physics/body';
import { AU_M, fmtLength } from '../physics/units';
import { tintOf } from '../pixel/renderer';
import type { V3 } from '../pixel/sprites';

export interface RadarHost {
  /** the ship's orientation */
  q(): THREE.Quaternion;
  where(): V3;
  bodies(): Body[];
  selected(): Body | null;
  select(b: Body | null): void;
  /** open the full map */
  open(): void;
}

/**
 * The ship's scope, in the corner: everything round the ship laid out in the
 * plane it flies in, ahead at the top, on a log scale so the nearest moon and
 * the furthest star both show, each with a stalk for how far above or below
 * that plane it is. Tap a blip to select it, or the middle to open the map.
 */
export class Radar {
  readonly el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private blips: { b: Body; x: number; y: number }[] = [];

  constructor(private host: RadarHost) {
    this.el = document.createElement('div');
    this.el.className = 'radar3';
    this.el.innerHTML = `<canvas width="180" height="180"></canvas><button class="r3open" title="Open the map (M)">Map</button>`;
    this.cv = this.el.querySelector('canvas')!;
    this.g = this.cv.getContext('2d')!;
    this.el.querySelector('.r3open')!.addEventListener('click', e => { e.stopPropagation(); this.host.open(); });
    this.cv.addEventListener('pointerdown', e => {
      e.stopPropagation();
      const r = this.cv.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * this.cv.width, y = ((e.clientY - r.top) / r.height) * this.cv.height;
      let best: Body | null = null, bd = 14 ** 2;
      for (const p of this.blips) {
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bd) { bd = d; best = p.b; }
      }
      if (best) this.host.select(best);
      else this.host.open();
    });
  }

  draw() {
    const W = this.cv.width;
    const g = this.g, R = W / 2 - 6, cx = W / 2, cy = W / 2;
    g.clearRect(0, 0, W, W);
    g.fillStyle = 'rgba(6,14,22,0.82)';
    g.beginPath(); g.arc(cx, cy, R + 4, 0, 2 * Math.PI); g.fill();
    g.strokeStyle = 'rgba(90,200,170,0.5)';
    g.beginPath(); g.arc(cx, cy, R + 4, 0, 2 * Math.PI); g.stroke();

    const P = this.host.where();
    const q = this.host.q().clone().invert();
    const sel = this.host.selected();
    const items: { b: Body; v: THREE.Vector3; d: number }[] = [];
    for (const b of this.host.bodies()) {
      const v = new THREE.Vector3((b.x - P[0]) * AU_M, (b.y - P[1]) * AU_M, (b.z - P[2]) * AU_M).applyQuaternion(q);
      const d = v.length();
      if (d > 0 && (b.source || b === sel || b.look.craft)) items.push({ b, v, d });
    }
    let dmin = Infinity, dmax = 0;
    for (const it of items) { dmin = Math.min(dmin, it.d); dmax = Math.max(dmax, it.d); }
    const lo = Math.log10(Math.max(1e3, dmin / 3)), hi = Math.max(lo + 1, Math.log10(Math.max(dmax * 1.2, 1e4)));
    const rad = (d: number) => (R * Math.max(0, Math.log10(Math.max(d, 1)) - lo)) / (hi - lo);

    g.strokeStyle = 'rgba(90,200,170,0.22)';
    g.fillStyle = 'rgba(120,220,190,0.55)';
    g.font = '9px monospace';
    g.lineWidth = 1;
    const step = Math.max(1, Math.ceil((hi - lo) / 4));
    for (let e = Math.ceil(lo); e <= hi; e += step) {
      const r = rad(10 ** e);
      g.beginPath(); g.arc(cx, cy, r, 0, 2 * Math.PI); g.stroke();
      if (r > R * 0.5) g.fillText(fmtLength(10 ** e / AU_M), cx + 3, cy - r - 2);
    }
    g.beginPath(); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.stroke();
    // a sweep
    const a = (performance.now() / 1000) * 1.5;
    g.strokeStyle = 'rgba(120,255,200,0.25)';
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke();
    g.fillStyle = '#e8f4ff';
    g.beginPath(); g.moveTo(cx, cy - 6); g.lineTo(cx - 4, cy + 4); g.lineTo(cx + 4, cy + 4); g.fill();

    this.blips = [];
    items.sort((p, c) => c.d - p.d);
    for (const it of items) {
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
      this.blips.push({ b: it.b, x, y: y + up });
    }
  }
}

export function fmtTime(s: number) {
  if (!isFinite(s)) return '—';
  if (s < 1) return '<1 s';
  if (s < 90) return `${s.toFixed(0)} s`;
  if (s < 5400) return `${(s / 60).toFixed(0)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`;
  if (s < 3.15e7 * 2) return `${(s / 86400).toFixed(0)} d`;
  return `${(s / 3.156e7).toPrecision(2)} yr`;
}
