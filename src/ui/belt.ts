import type { App } from '../app';
import { osculating, relative } from '../physics/orbit';

const A0 = 1.9, A1 = 3.6, BINS = 68;
// mean-motion resonances with Jupiter: asteroid orbits p times for every q of Jupiter's
const RES: [string, number][] = [['4:1', 1 / 4], ['3:1', 1 / 3], ['5:2', 2 / 5], ['7:3', 3 / 7], ['2:1', 1 / 2]];

/**
 * Kirkwood gaps exist in semi-major axis, not on the sky — a top-down view of
 * the belt never shows them. This counts asteroids still on belt-like orbits
 * (e < 0.3) by semi-major axis, with Jupiter's resonances marked where its
 * current orbit puts them.
 */
export class BeltChart {
  private el: HTMLDivElement;
  private cv: HTMLCanvasElement;
  private tip: HTMLDivElement;
  private counts = new Array(BINS).fill(0);
  private last = 0;
  private hover = -1;

  constructor(private app: App) {
    this.el = document.createElement('div');
    this.el.className = 'hud belt';
    this.el.innerHTML = '<div class="bt">Asteroids by semi-major axis <span>e &lt; 0.3</span></div>';
    this.cv = document.createElement('canvas');
    this.tip = document.createElement('div');
    this.tip.className = 'btip';
    this.el.append(this.cv, this.tip);
    document.body.appendChild(this.el);
    this.cv.addEventListener('pointermove', e => {
      const r = this.cv.getBoundingClientRect();
      const i = Math.floor(((e.clientX - r.left - 8) / (r.width - 16)) * BINS);
      this.hover = i >= 0 && i < BINS ? i : -1;
      this.draw();
    });
    this.cv.addEventListener('pointerleave', () => { this.hover = -1; this.draw(); });
  }

  update() {
    const show = this.app.presetKey === 'kirkwood' && this.app.world.sources.length > 0;
    this.el.hidden = !show;
    if (!show) return;
    const now = performance.now();
    if (now - this.last < 500) return;
    this.last = now;
    const sun = this.app.world.sources.reduce((a, b) => (b.m > a.m ? b : a));
    this.counts.fill(0);
    for (const b of this.app.world.bodies) {
      if (b.source || !b.alive || b.cls !== 'debris') continue;
      const { r, v, mu } = relative(b, sun);
      const o = osculating(mu, r, v);
      if (!(o.a > A0 && o.a < A1) || o.e >= 0.3) continue;
      this.counts[Math.floor(((o.a - A0) / (A1 - A0)) * BINS)]++;
    }
    this.draw();
  }

  private draw() {
    const cv = this.cv, dpr = Math.min(2, devicePixelRatio || 1);
    const W = cv.clientWidth || 300, H = cv.clientHeight || 120;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const L = 8, R = W - 8, T = 16, B = H - 18;
    const max = Math.max(4, ...this.counts);
    const bw = (R - L) / BINS;
    const x = (a: number) => L + ((a - A0) / (A1 - A0)) * (R - L);
    // baseline and axis ticks, recessive
    g.strokeStyle = 'rgba(160,180,255,0.18)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(L, B + 0.5); g.lineTo(R, B + 0.5); g.stroke();
    g.fillStyle = '#8d93ad';
    g.font = '10px ui-sans-serif, system-ui, sans-serif';
    g.textAlign = 'center';
    for (let a = 2; a <= 3.5; a += 0.5) g.fillText(`${a} AU`, x(a), H - 4);
    // bars: one hue, rounded top, 2px gap
    for (let i = 0; i < BINS; i++) {
      const h = (this.counts[i] / max) * (B - T);
      if (h <= 0) continue;
      const x0 = L + i * bw + 1, w = Math.max(1, bw - 2);
      g.fillStyle = i === this.hover ? '#ffe2a8' : '#d9a650';
      g.beginPath();
      g.roundRect(x0, B - h, w, h, [Math.min(2, w / 2), Math.min(2, w / 2), 0, 0]);
      g.fill();
    }
    // resonances where Jupiter's orbit puts them now
    const jup = this.app.world.sources.find(b => b.name === 'Jupiter');
    const sun = this.app.world.sources.reduce((a, b) => (b.m > a.m ? b : a));
    if (jup) {
      const { r, v, mu } = relative(jup, sun);
      const aj = osculating(mu, r, v).a;
      g.setLineDash([3, 3]);
      g.strokeStyle = 'rgba(230,233,245,0.35)';
      for (const [name, ratio] of RES) {
        const a = aj * Math.pow(ratio, 2 / 3);
        if (a < A0 || a > A1) continue;
        g.beginPath(); g.moveTo(x(a) + 0.5, T - 2); g.lineTo(x(a) + 0.5, B); g.stroke();
        g.fillStyle = '#c8cce0';
        g.fillText(name, x(a), T - 5);
      }
      g.setLineDash([]);
    }
    if (this.hover >= 0) {
      const a0 = A0 + (this.hover / BINS) * (A1 - A0);
      this.tip.textContent = `${a0.toFixed(3)}–${(a0 + (A1 - A0) / BINS).toFixed(3)} AU · ${this.counts[this.hover]} asteroids`;
      this.tip.style.left = `${Math.min(W - 150, Math.max(0, L + this.hover * bw - 60))}px`;
      this.tip.hidden = false;
    } else this.tip.hidden = true;
  }
}
