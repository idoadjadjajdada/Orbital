import type { Look } from '../physics/body';
import { buildMap, lookKey, type SurfaceMap } from './surface';
import { marsReady } from './marsdata';

/**
 * Surface maps, shared by everything that draws a body: the map, the 3D view,
 * the inspector. Each look is painted at a few widths (powers of two); the
 * smallest is made at once, the bigger ones in a worker, and until one is
 * ready the best that is ready stands in. A body that gets cratered takes
 * its own copy (see `owned`).
 */
const SIZES = [64, 128, 256, 512, 1024, 2048];
/** the most memory the finished maps may take, in texels */
const BUDGET = 9e6;

class MapService {
  private ready = new Map<string, SurfaceMap>();
  private used = new Map<string, number>();
  private asked = new Set<string>();
  private queue: { key: string; look: Look; w: number }[] = [];
  private worker: Worker | null = null;
  private busy = false;
  /** the job the worker has, to paint here instead if the worker fails */
  private job: { key: string; look: Look; w: number } | null = null;
  private tick = 0;
  /** called when a map finishes, so whoever drew the stand-in can redraw */
  onReady: (key: string) => void = () => {};

  constructor() {
    try {
      if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
        this.worker = new Worker(new URL('./mapworker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<{ key: string; map: SurfaceMap }>) => {
          this.busy = false;
          this.job = null;
          this.store(e.data.key, e.data.map);
          this.next();
        };
        this.worker.onerror = () => {
          this.worker = null;
          this.busy = false;
          if (this.job) this.queue.push(this.job);
          this.next();
        };
      }
    } catch { this.worker = null; }
    // maps of Mars painted before its measured maps came in are dropped (its key changes, so it is painted again)
    marsReady.then(ok => { if (ok) this.forget('Mars|'); });
  }

  /** drop every map whose key starts with `prefix`, so it is painted afresh */
  forget(prefix: string) {
    for (const k of [...this.ready.keys()]) if (k.startsWith(prefix)) { this.ready.delete(k); this.used.delete(k); this.onReady(k); }
  }

  /** the width to paint for a disc `px` pixels across (a hemisphere shows half the map) */
  static widthFor(px: number, max = 1024) {
    const want = Math.max(64, px * 2.2);
    return SIZES.find(s => s >= want && s <= max) ?? Math.min(max, SIZES[SIZES.length - 1]);
  }

  /** the best map for a look up to width `w`, asking for `w` to be painted if it is not yet */
  want(look: Look, w: number): SurfaceMap {
    const base = lookKey(look);
    const k = `${base}@${w}`;
    this.tick++;
    const have = this.ready.get(k);
    if (have) { this.used.set(k, this.tick); return have; }
    if (!this.asked.has(k)) { this.asked.add(k); this.queue.push({ key: k, look, w }); this.next(); }
    // the best smaller one that is ready, or the smallest, made now
    for (let i = SIZES.indexOf(w) - 1; i >= 0; i--) {
      const m = this.ready.get(`${base}@${SIZES[i]}`);
      if (m) { this.used.set(`${base}@${SIZES[i]}`, this.tick); return m; }
    }
    const k0 = `${base}@64`;
    const m0 = buildMap(look, 64);
    this.store(k0, m0);
    return m0;
  }

  private store(key: string, m: SurfaceMap) {
    this.ready.set(key, m);
    this.used.set(key, this.tick);
    this.asked.delete(key);
    // forget the least recently used when over budget
    let total = 0;
    for (const v of this.ready.values()) total += v.w * v.h;
    if (total > BUDGET) {
      const order = [...this.used.entries()].sort((a, b) => a[1] - b[1]);
      for (const [k] of order) {
        if (total <= BUDGET * 0.8) break;
        const v = this.ready.get(k);
        if (!v || v.w <= 64) continue;
        total -= v.w * v.h;
        this.ready.delete(k); this.used.delete(k);
      }
    }
    this.onReady(key);
  }

  private next() {
    if (this.busy || !this.queue.length) return;
    // the biggest discs first are not more urgent than many small ones: smallest width first
    this.queue.sort((a, b) => a.w - b.w);
    const job = this.queue.shift()!;
    if (this.worker) {
      this.busy = true;
      this.job = job;
      this.worker.postMessage(job);
    } else {
      // no worker (tests, old browsers): paint it in a moment, on this thread
      this.busy = true;
      setTimeout(() => { this.busy = false; this.store(job.key, buildMap(job.look, job.w)); this.next(); }, 0);
    }
  }
}

export const maps = new MapService();
export { MapService };
