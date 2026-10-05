import * as THREE from 'three';
import type { V3 } from '../pixel/sprites';
import { buildTile, faceDir, faceOf, tileRange, TILE_N, type GroundSpec, type Tile, type TileJob } from './terrain';

/**
 * The tiles of the ground that are drawn, and the workers that build them.
 *
 * Every frame the tree of tiles (terrain.ts) is walked from its six faces:
 * a tile that is large for how near it is gives way to its four children,
 * once all four are built; one beyond the horizon (mountains included) is
 * left out. What is missing is asked of the workers, the tiles that cover the
 * most ground for their nearness first, so the ground comes in coarse and
 * sharpens toward you. Built tiles are kept — walking back over ground shows
 * the same tiles — until there are too many, when the longest unused go
 * (a tile's children before it, so the tree never has a gap).
 */

/** a tile gives way to its children when it is wider than this times its distance (so its vertices are
 * never further apart than about a sixteenth of the way to them); beyond the horizon, where only the
 * tops of mountains show, twice this */
const SPLIT = 2;
/** most tiles kept built */
const KEEP = 900;
/** the finest vertex spacing, m */
const FINEST = 0.4;

interface Built { tile: Tile; mesh: THREE.Mesh; used: number; centre: THREE.Vector3; radius: number }

export class TileSet {
  readonly group = new THREE.Group();
  /** every face's coarsest tile in view is in: the ground has no holes */
  ready = false;
  /** how many tiles are drawn, built, and being built */
  stats = { drawn: 0, built: 0, busy: 0 };
  /** the vertex spacing of the tile drawn under the viewer, m */
  under = Infinity;
  private built = new Map<string, Built>();
  private busy = new Set<string>();
  private workers: { w: Worker; job: string | null }[] = [];
  private local = false;
  private gen = 0;
  private frameNo = 0;
  private spec: GroundSpec | null = null;
  private maxL = 0;
  private rockGeo = new THREE.IcosahedronGeometry(1, 0);
  private rockMat = new THREE.MeshLambertMaterial({ flatShading: true });

  constructor(private mat: THREE.ShaderMaterial) {
    this.group.name = 'tiles';
    try {
      if (typeof Worker !== 'undefined') for (let k = 0; k < 2; k++) {
        const w = new Worker(new URL('./terrainworker.ts', import.meta.url), { type: 'module' });
        const slot = { w, job: null as string | null };
        w.onmessage = (e: MessageEvent<Tile>) => { if (slot.job) this.busy.delete(slot.job); slot.job = null; this.take(e.data); };
        w.onerror = () => { if (slot.job) this.busy.delete(slot.job); this.workers = this.workers.filter(s => s !== slot); };
        this.workers.push(slot);
      }
    } catch { this.workers = []; }
  }

  /** start over on a new world (or none) */
  reset(spec: GroundSpec | null) {
    for (const b of this.built.values()) this.drop(b);
    this.built.clear();
    this.busy.clear();
    this.gen++;
    this.spec = spec;
    this.ready = false;
    if (spec) this.maxL = Math.max(0, Math.floor(Math.log2(spec.R * Math.PI / 2 / TILE_N / FINEST)));
  }

  /** each frame, with the viewer at `vb` (m, the body's frame) */
  frame(vb: THREE.Vector3) {
    const s = this.spec;
    if (!s) return;
    this.frameNo++;
    const R = s.R, r = vb.length();
    const n: V3 = [vb.x / r, vb.y / r, vb.z / r];
    // the horizon, reaching over to the tops of mountains beyond it
    const lo = R - s.relief, hi = R + s.relief;
    const flat = r > R ? Math.acos(R / r) : 0, horizon = (r > lo ? Math.acos(Math.min(1, lo / r)) : 0) + Math.acos(lo / hi);
    const want: { key: string; f: number; L: number; x: number; y: number; p: number }[] = [];
    const drawn: Built[] = [];
    const [fn, an, bn] = faceOf(n);
    let under = Infinity, holes = false;
    const tmp = new THREE.Vector3();
    const ask = (f: number, L: number, x: number, y: number, p: number) => {
      const key = `${this.gen}/${f}/${L}/${x}/${y}`;
      if (!this.busy.has(key) && !this.built.has(key)) want.push({ key, f, L, x, y, p });
    };
    // the tiles covering a node: its own, or its four children's if it should split and they are all in
    const cover = (f: number, L: number, x: number, y: number, out: Built[]): boolean => {
      const { a0, b0, k } = tileRange(L, x, y);
      const c = faceDir(f, a0 + k / 2, b0 + k / 2);
      const ang = Math.acos(Math.max(-1, Math.min(1, c[0] * n[0] + c[1] * n[1] + c[2] * n[2])));
      if (L > 0 && ang - 0.6 * k > horizon) return true;
      const key = `${this.gen}/${f}/${L}/${x}/${y}`;
      const b = this.built.get(key);
      if (!b) return false;
      b.used = this.frameNo;
      // how far the tile's nearest point is: across the face to its edge, and up to the viewer
      let d: number;
      if (f === fn) {
        const da = Math.max(0, a0 - an, an - a0 - k), db = Math.max(0, b0 - bn, bn - b0 - k);
        d = Math.hypot(R * Math.PI / 4 * Math.hypot(da, db), Math.max(0, r - b.centre.length()));
      } else d = Math.max(0, tmp.copy(vb).sub(b.centre).length() - b.radius);
      const size = R * Math.PI / 4 * k;
      if (L < this.maxL && size > SPLIT * (ang - 0.6 * k > flat ? 2 : 1) * d) {
        const kids: Built[] = [];
        let all = true;
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
          const cx = x * 2 + i, cy = y * 2 + j;
          if (!cover(f, L + 1, cx, cy, kids)) {
            all = false;
            const r2 = tileRange(L + 1, cx, cy), cc = faceDir(f, r2.a0 + r2.k / 2, r2.b0 + r2.k / 2);
            const dd = tmp.set(cc[0] * R, cc[1] * R, cc[2] * R).distanceTo(vb);
            ask(f, L + 1, cx, cy, dd / (size / 2));
          }
        }
        if (all) { for (const q of kids) out.push(q); return true; }
      }
      out.push(b);
      return true;
    };
    for (let f = 0; f < 6; f++) if (!cover(f, 0, 0, 0, drawn)) { holes = true; ask(f, 0, 0, 0, -1); }
    // show what is drawn
    for (const b of this.built.values()) b.mesh.visible = false;
    for (const b of drawn) {
      b.mesh.visible = true;
      const { f, L, x, y, spacing } = b.tile, { a0, b0, k } = tileRange(L, x, y);
      if (f === fn && an >= a0 && an <= a0 + k && bn >= b0 && bn <= b0 + k) under = Math.min(under, spacing);
    }
    this.ready = !holes;
    this.under = under;
    // build what is wanted, the most needed first
    want.sort((a, b) => a.p - b.p);
    let wi = 0;
    for (const slot of this.workers) {
      if (slot.job || wi >= want.length) continue;
      const w = want[wi++];
      slot.job = w.key;
      this.busy.add(w.key);
      slot.w.postMessage({ key: w.key, spec: s, f: w.f, L: w.L, x: w.x, y: w.y } as TileJob);
    }
    if (!this.workers.length && !this.local && wi < want.length) {
      // no workers: one tile at a time between frames
      const w = want[wi], spec = s, key = w.key;
      this.local = true;
      this.busy.add(key);
      setTimeout(() => { this.local = false; this.busy.delete(key); if (this.spec === spec) this.take(buildTile({ key, spec, f: w.f, L: w.L, x: w.x, y: w.y })); }, 0);
    }
    this.evict();
    this.stats = { drawn: drawn.length, built: this.built.size, busy: this.busy.size };
  }

  private take(t: Tile) {
    const s = this.spec;
    if (!s || !t.key.startsWith(`${this.gen}/`)) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(t.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(t.nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(t.col, 3));
    g.setAttribute('sea', new THREE.BufferAttribute(t.sea, 1));
    g.setAttribute('rock', new THREE.BufferAttribute(t.rock, 1));
    g.setIndex(new THREE.BufferAttribute(t.index, 1));
    g.computeBoundingSphere();
    const R = s.R;
    // the grain's lattice, kept still from tile to tile: the tile's middle, modulo its period, the same for all its vertices
    const P = 2048, nv = t.pos.length / 3, off = new Float32Array(nv * 3);
    const ox = mod(t.c[0] * R, P), oy = mod(t.c[1] * R, P), oz = mod(t.c[2] * R, P);
    for (let v = 0; v < nv; v++) { off[v * 3] = ox; off[v * 3 + 1] = oy; off[v * 3 + 2] = oz; }
    g.setAttribute('grain', new THREE.BufferAttribute(off, 3));
    // and a far coarser one, for the detail seen from the air: its period 2^20 m, still exact to a few cm
    const F = 1 << 20, far = new Float32Array(nv * 3);
    const fx = mod(t.c[0] * R, F), fy = mod(t.c[1] * R, F), fz = mod(t.c[2] * R, F);
    for (let v = 0; v < nv; v++) { far[v * 3] = fx; far[v * 3 + 1] = fy; far[v * 3 + 2] = fz; }
    g.setAttribute('far', new THREE.BufferAttribute(far, 3));
    const mesh = new THREE.Mesh(g, this.mat);
    mesh.position.set(t.c[0] * R, t.c[1] * R, t.c[2] * R);
    mesh.visible = false;
    const n = t.rocks.length / 8;
    if (n) {
      const rk = new THREE.InstancedMesh(this.rockGeo, this.rockMat, n);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), at = new THREE.Vector3(), c = new THREE.Color();
      for (let k = 0; k < n; k++) {
        const o = k * 8, sz = t.rocks[o + 3], hk = t.rocks[o + 7];
        e.set(hsh(hk, 1) * 6, hsh(hk, 2) * 6, hsh(hk, 3) * 6);
        q.setFromEuler(e);
        sc.set(sz * (0.8 + 0.6 * hsh(hk, 4)), sz * (0.5 + 0.4 * hsh(hk, 5)), sz * (0.8 + 0.6 * hsh(hk, 6)));
        at.set(t.rocks[o], t.rocks[o + 1], t.rocks[o + 2]);
        m.compose(at, q, sc);
        rk.setMatrixAt(k, m);
        rk.setColorAt(k, c.setRGB(t.rocks[o + 4], t.rocks[o + 5], t.rocks[o + 6]));
      }
      rk.frustumCulled = false;
      mesh.add(rk);
    }
    this.group.add(mesh);
    const centre = g.boundingSphere!.center.clone().add(mesh.position);
    this.built.set(t.key, { tile: t, mesh, used: this.frameNo, centre, radius: g.boundingSphere!.radius });
  }

  private evict() {
    if (this.built.size <= KEEP) return;
    const old = [...this.built.entries()].filter(([, b]) => b.used < this.frameNo)
      .sort((a, b) => a[1].used - b[1].used || b[1].tile.L - a[1].tile.L);
    for (let k = 0; k < old.length && this.built.size > KEEP * 0.85; k++) { this.drop(old[k][1]); this.built.delete(old[k][0]); }
  }

  private drop(b: Built) {
    this.group.remove(b.mesh);
    b.mesh.geometry.dispose();
    for (const c of b.mesh.children) (c as THREE.InstancedMesh).dispose?.();
  }
}

const mod = (a: number, m: number) => ((a % m) + m) % m;
const hsh = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
