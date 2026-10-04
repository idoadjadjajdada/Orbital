import * as THREE from 'three';
import type { V3 } from '../pixel/sprites';
import { faceDir, faceOf, tangent } from './terrain';
import { model, RUINS, type ModelName } from './models';
import { gridOf, gridAt } from './basecamp';

/**
 * Ruins: rare things left standing — an arch, a colonnade, an obelisk, a
 * shrine, a broken tower, a length of wall — on the worlds with ground to
 * stand on. They are fixed to the world on a lattice of cells four kilometres
 * across, each cell's hash deciding (rarely: about one in a hundred and fifty,
 * so a site every fifty kilometres or so) whether it holds a site, and if so
 * which ruins, where, how big and turned which way. So they are always in
 * the same places, and finding one is an event.
 *
 * Each is cut from the same stone as the ground under it: the model's
 * carved, masonry and rock faces are tinted toward the ground's colour (pale
 * on ice, red on Mars, grey on the Moon), and it is set down at the lowest
 * ground under its footprint so it never floats. You walk round it, under its
 * arches and up its steps: where you can stand comes from the model itself,
 * as the bases' buildings do (basecamp.ts). Only the ones within a few
 * kilometres are drawn; the nearest is labelled from twice that; coming
 * within eighty metres logs it.
 */

export interface RuinCtx {
  R: number;
  seed: number;
  /** the ground there: its height and colour, sea or not */
  sampleAt: (n: V3) => { h: number; sea: boolean; r: number; g: number; b: number };
  /** something built there: no ruins */
  built: (n: V3) => boolean;
  /** how common they are here: sites per cell (a few hundredths), more where a people lives */
  rate: number;
  /** who built them, if anyone is known to have */
  people: string | null;
}

export interface Ruin { key: string; n: V3; h: number; model: ModelName; s: number; rot: number; tint: THREE.Color; name: string }

const CELL = 4000, SHOW = 3000, LABEL = 6000;
const hash = (a: number, b: number, c: number) => { const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return x - Math.floor(x); };
const WHAT: Record<string, string> = {
  'ruin-arch': 'a broken arch', 'ruin-columns': 'a colonnade', 'ruin-obelisk': 'an obelisk',
  'ruin-shrine': 'a shrine', 'ruin-tower': 'a fallen tower', 'ruin-wall': 'a length of ruined wall',
};
/** the stone the models came in, before tinting */
const STONE = new THREE.Color(0.82, 0.72, 0.56);

export class Ruins {
  readonly group = new THREE.Group();
  private cells = new Map<string, Ruin[]>();
  private shown = new Map<string, { r: Ruin; obj: THREE.Object3D | null }>();
  private at: V3 | null = null;
  private key = '';
  /** the ruins within labelling range, nearest first */
  near: { r: Ruin; d: number }[] = [];

  constructor() { this.group.name = 'ruins'; }

  clear() {
    for (const { obj } of this.shown.values()) if (obj) this.drop(obj);
    this.shown.clear(); this.cells.clear(); this.near = []; this.at = null;
  }

  /** each frame on or near the ground: the sites round you, the near ones drawn (rechecked every hundred metres or so) */
  frame(c: RuinCtx, n: V3) {
    const key = `${c.seed}:${c.rate}`;
    if (key !== this.key) { this.clear(); this.key = key; }
    // a model arriving means a waiting ruin can be drawn now
    for (const v of this.shown.values()) if (!v.obj) this.show(v, c.R);
    if (this.at && Math.acos(Math.min(1, n[0] * this.at[0] + n[1] * this.at[1] + n[2] * this.at[2])) * c.R < 100) { this.dist(n, c.R); return; }
    this.at = n;
    if (c.rate <= 0) { this.clear(); this.key = key; return; }
    const R = c.R, [e, nn] = tangent(n), L = Math.max(0, Math.round(Math.log2((R * Math.PI / 2) / CELL))), k = 2 / 2 ** L;
    const seen = new Set<string>(), want = new Set<string>();
    const step = CELL * 0.7, N = Math.ceil(LABEL / step) + 1;
    for (let a = -N; a <= N; a++) for (let b = -N; b <= N; b++) {
      const dx = a * step, dy = b * step;
      if (dx * dx + dy * dy > (LABEL + CELL) ** 2) continue;
      const v: V3 = [n[0] + (e[0] * dx + nn[0] * dy) / R, n[1] + (e[1] * dx + nn[1] * dy) / R, n[2] + (e[2] * dx + nn[2] * dy) / R];
      const l = Math.hypot(...v);
      const [f, fa, fb] = faceOf([v[0] / l, v[1] / l, v[2] / l]);
      const ci = Math.floor((fa + 1) / k), cj = Math.floor((fb + 1) / k), id = `${f}/${ci}/${cj}`;
      if (seen.has(id)) continue;
      seen.add(id);
      let cell = this.cells.get(id);
      if (!cell) { cell = this.site(c, f, ci, cj, k); this.cells.set(id, cell); }
      for (const r of cell) want.add(r.key);
      for (const r of cell) if (!this.shown.has(r.key)) { const v2 = { r, obj: null as THREE.Object3D | null }; this.shown.set(r.key, v2); }
    }
    for (const [kk, v] of this.shown) if (!want.has(kk)) { if (v.obj) this.drop(v.obj); this.shown.delete(kk); }
    if (this.cells.size > 4000) this.cells.clear();
    this.dist(n, R);
  }

  /** how far each is, and which are near enough to draw */
  private dist(n: V3, R: number) {
    this.near = [];
    for (const v of this.shown.values()) {
      const d = Math.acos(Math.min(1, n[0] * v.r.n[0] + n[1] * v.r.n[1] + n[2] * v.r.n[2])) * R;
      if (d < LABEL) this.near.push({ r: v.r, d });
      if (d < SHOW && !v.obj) this.show(v, R);
      if (d > SHOW * 1.2 && v.obj) { this.drop(v.obj); v.obj = null; }
    }
    this.near.sort((a, b) => a.d - b.d);
  }

  /** a cell: usually nothing; now and then a site of one to four ruins */
  private site(c: RuinCtx, f: number, ci: number, cj: number, k: number): Ruin[] {
    const h = (x: number) => hash(ci + x * 13, cj * 7 + f * 101, c.seed + x * 31);
    if (h(1) > c.rate) return [];
    const out: Ruin[] = [];
    const count = h(2) < 0.6 ? 1 : 2 + Math.floor(h(3) * 3);
    // the site's middle somewhere in the cell, away from its edges
    const u0 = 0.2 + 0.6 * h(4), v0 = 0.2 + 0.6 * h(5);
    const mid = faceDir(f, -1 + (ci + u0) * k, -1 + (cj + v0) * k);
    const [e, nn] = tangent(mid);
    const big = 1.2 + 2.2 * h(6) * h(6);
    for (let q = 0; q < count; q++) {
      const g = (x: number) => h(10 + q * 7 + x);
      const a = g(1) * Math.PI * 2, rr = q === 0 ? 0 : 14 + 40 * g(2);
      const m: V3 = [mid[0] + (e[0] * Math.cos(a) + nn[0] * Math.sin(a)) * rr / c.R, mid[1] + (e[1] * Math.cos(a) + nn[1] * Math.sin(a)) * rr / c.R, mid[2] + (e[2] * Math.cos(a) + nn[2] * Math.sin(a)) * rr / c.R];
      const l = Math.hypot(...m), n: V3 = [m[0] / l, m[1] / l, m[2] / l];
      if (c.built(n)) continue;
      const s = big * (0.75 + 0.5 * g(3));
      // set down at the lowest ground under it, and not on a cliff or in the sea
      const at = c.sampleAt(n);
      if (at.sea) continue;
      let lo = at.h, hi = at.h;
      const [e2, n2] = tangent(n), rad = 3.5 * s / c.R;
      for (let j = 0; j < 6; j++) {
        const ang = j * Math.PI / 3, p: V3 = [n[0] + (e2[0] * Math.cos(ang) + n2[0] * Math.sin(ang)) * rad, n[1] + (e2[1] * Math.cos(ang) + n2[1] * Math.sin(ang)) * rad, n[2] + (e2[2] * Math.cos(ang) + n2[2] * Math.sin(ang)) * rad];
        const pl = Math.hypot(...p), hh = c.sampleAt([p[0] / pl, p[1] / pl, p[2] / pl]);
        if (hh.sea) { lo = -Infinity; break; }
        lo = Math.min(lo, hh.h); hi = Math.max(hi, hh.h);
      }
      if (!Number.isFinite(lo) || hi - lo > 3 * s) continue;
      // the stone: the ground's colour, a little paler, with some of its own
      const tint = new THREE.Color(Math.min(1, at.r * 1.35 + 0.08), Math.min(1, at.g * 1.35 + 0.08), Math.min(1, at.b * 1.35 + 0.08)).lerp(STONE, 0.25);
      const mn = RUINS[Math.floor(g(4) * RUINS.length)];
      out.push({ key: `${f}/${ci}/${cj}/${q}`, n, h: lo - 0.15 * s, model: mn, s, rot: g(5) * Math.PI * 2, tint, name: WHAT[mn] });
    }
    return out;
  }

  /** draw a ruin, if its model is in */
  private show(v: { r: Ruin; obj: THREE.Object3D | null }, R: number) {
    const root = model(v.r.model);
    if (!root) return;
    gridOf(v.r.model, root);
    const o = root.clone();
    o.traverse(x => {
      const m = x as THREE.Mesh;
      if (!m.isMesh) return;
      const mt = (m.material as THREE.MeshStandardMaterial).clone();
      mt.color.copy(v.r.tint);
      m.material = mt;
    });
    const r = v.r, rr = R + r.h;
    o.position.set(r.n[0] * rr, r.n[1] * rr, r.n[2] * rr);
    // its frame: x east, y up, z (east × up) — the frame structureAt reads it in — then turned its own way
    const [e] = tangent(r.n), E = new THREE.Vector3(...e), U = new THREE.Vector3(...r.n);
    o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(E, U, E.clone().cross(U))).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.rot));
    o.scale.setScalar(r.s);
    this.group.add(o);
    v.obj = o;
  }

  private drop(o: THREE.Object3D) {
    this.group.remove(o);
    o.traverse(x => { const m = x as THREE.Mesh; if (m.isMesh) (m.material as THREE.Material).dispose(); });
  }

  /** what is underfoot among the ruins at n: a step or a plinth to stand on (m over the datum), or stone in the way */
  structureAt(n: V3, R: number): { floor: number | null; solid: boolean } | null {
    for (const { r, d } of this.near) {
      if (d > 30 * r.s) break;
      const [e, nn] = tangent(r.n);
      const dx = n[0] - r.n[0], dy = n[1] - r.n[1], dz = n[2] - r.n[2];
      // into the ruin's own frame: east and north on the ground, turned back by its rotation, shrunk by its size
      const x = (dx * e[0] + dy * e[1] + dz * e[2]) * R, z = -(dx * nn[0] + dy * nn[1] + dz * nn[2]) * R;
      const c = Math.cos(r.rot), s = Math.sin(r.rot);
      const lx = (c * x - s * z) / r.s, lz = (s * x + c * z) / r.s;
      const g = gridAt(r.model, lx, lz);
      if (g && (g.solid || g.floor !== null)) return { floor: g.floor === null ? null : r.h + g.floor * r.s, solid: g.solid };
    }
    return null;
  }
}
