import * as THREE from 'three';
import type { V3 } from '../pixel/sprites';
import { hash } from '../pixel/noise';
import { faceOf, tangent } from './terrain';
import { model, parts, TREES, type ModelName } from './models';

/**
 * The trees and the larger plants round you.
 *
 * They stand on a lattice fixed to the world, a cell every twelve metres or
 * so, each cell's own hash deciding whether it holds one, which kind, how big
 * (from two-thirds to half again its kind's size), how it is stretched taller
 * or squatter, wider or narrower (and more one way than the other), which
 * way it is turned and leans, and a little of its colour — so walking past the same wood shows the same trees,
 * and no two of them alike. Near you (a hundred metres or so) they are the
 * modelled trees — oak, birch, maple, palm, pine — chosen for the species
 * that grows there and tinted, on a made-up world, the colour its plants are
 * under its star; further off, simple trunks and crowns of the same height,
 * shape and leaf colour, so nothing changes where one gives way to the other.
 * Each kind is one instanced draw, so a forest costs a handful of draws
 * whatever its size. The trees near you are solid: trunks stop you on foot,
 * and their crowns are what the ship keeps clear of.
 */

export interface PlantKind { name: string; col: number; size: number; cone: boolean }
export interface FloraCtx {
  R: number;
  heightAt: (n: V3) => { h: number; sea: boolean };
  /** something built here (a base, a pad): no trees */
  built: (n: V3) => boolean;
  seed: number;
}

const CELL = 12, NEAR = 110, FAR = 320, CAP_NEAR = 400, CAP_FAR = 1600;

interface Tree { n: V3; h: number; kind: number; s: number; sy: number; sw: number; sq: number; rot: number; lean: number; tint: number }

/** a tree as drawn: where its foot is (body frame), the ground there (m), its height and its trunk's radius (m) */
export interface Standing { n: V3; h: number; H: number; trunk: number }

/** the leaves of each modelled tree, as seen from a distance, until its texture has been measured */
const LEAF: Record<string, number> = { oak: 0x3f5f2a, birch: 0x5f7d34, maple: 0x8c3c22, palm: 0x4f6d2c, pine: 0x2d4a2c };

/** a tree's height, m: as tall as its kind grows (4–22 m here, so a sequoia does not fill the view), then its own build */
const heightOf = (k: PlantKind, t: Tree) => Math.min(22, Math.max(4, k.size)) * (0.55 + 0.45 * t.s) * t.sy;

/** which modelled tree stands for a species */
function modelFor(k: PlantKind, alt: number): ModelName | null {
  const n = k.name.toLowerCase();
  if (/cactus|saguaro|welwitschia|bluestem|grass|kelp|edelweiss|rafflesia|corpse|reed|moss|lichen/.test(n)) return null;
  if (k.cone || /spruce|pine|fir|sequoia|larch|cedar|cypress/.test(n)) return 'pine';
  if (/palm|coconut|date/.test(n)) return 'palm';
  if (/birch|aspen|poplar/.test(n)) return 'birch';
  // (the maple wears its autumn red: only real maples and their kin get it)
  if (/maple|plane|sycamore/.test(n)) return 'maple';
  if (/oak|beech|baobab|acacia|eucalyptus|elm|kapok|mangrove|fig/.test(n)) return 'oak';
  return (['oak', 'birch', 'oak', 'pine'] as const)[alt % 4];
}

export class Flora {
  readonly group = new THREE.Group();
  private cells = new Map<string, Tree[]>();
  private at: V3 | null = null;
  private key = '';
  private far: THREE.InstancedMesh[] = [];
  private near = new Map<ModelName, THREE.InstancedMesh[]>();
  private kinds: PlantKind[] = [];
  private density = 0;
  private tint: THREE.Color | null = null;
  private waiting = false;
  /** the trees drawn now, with their sizes, for what they are in the way of */
  private standing: Standing[] = [];
  /** places kept clear of trees (where the ship has set down): the direction and a radius, m */
  clearings: { n: V3; r: number }[] = [];
  private leafCol = new Map<ModelName, THREE.Color>();

  constructor() {
    this.group.name = 'flora';
    // (unit sizes: a trunk of radius 1 and height 1, crowns 1 across and 1 high, all from their foot)
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 1, 1, 6).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0x4e3a2a }), CAP_FAR);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial(), CAP_FAR);
    const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 1, 8).translate(0, 0.5, 0), new THREE.MeshLambertMaterial(), CAP_FAR);
    this.far = [trunk, crown, cone];
    for (const m of this.far) { m.count = 0; m.frustumCulled = false; this.group.add(m); }
  }

  clear() { this.cells.clear(); this.at = null; this.key = ''; this.standing = []; for (const m of [...this.far, ...[...this.near.values()].flat()]) m.count = 0; }

  /** the top of the trees within `r` m of n (m over the datum), or −∞ where there are none */
  canopy(n: V3, R: number, r: number) {
    let top = -Infinity;
    const c = Math.cos(r / R);
    for (const t of this.standing) if (t.n[0] * n[0] + t.n[1] * n[1] + t.n[2] * n[2] > c) top = Math.max(top, t.h + t.H);
    return top;
  }

  /** is a trunk in the way of someone `r` m wide at n? */
  trunkAt(n: V3, R: number, r: number) {
    for (const t of this.standing) {
      const d = Math.acos(Math.min(1, t.n[0] * n[0] + t.n[1] * n[1] + t.n[2] * n[2])) * R;
      if (d < t.trunk + r) return true;
    }
    return false;
  }

  /** keep the trees out of these places from now on (the ship's footprint where it has landed) */
  clearAround(places: { n: V3; r: number }[]) { this.clearings = places; this.at = null; }

  /**
   * each frame: what grows here (`kinds`, how thickly), and for a made-up
   * world the colour its leaves are; rebuilt as you move a few tens of metres
   */
  frame(c: FloraCtx, n: V3, kinds: PlantKind[], density: number, tint: THREE.Color | null) {
    const key = `${kinds.map(k => k.name).join('|')}:${density}`;
    if (key !== this.key) { this.key = key; this.cells.clear(); this.at = null; this.kinds = kinds; this.density = density; this.tint = tint; }
    // a model arriving means the near trees can be drawn properly
    const pending = TREES.some(t => !model(t));
    if (this.at && !(this.waiting && !pending) && Math.acos(Math.min(1, n[0] * this.at[0] + n[1] * this.at[1] + n[2] * this.at[2])) * c.R < 25) return;
    this.waiting = pending;
    this.at = n;
    this.build(c, n);
  }

  /** the trees in the lattice cells round n, generated once each and kept */
  private build(c: FloraCtx, n: V3) {
    if (!this.kinds.length || this.density <= 0) { for (const m of this.far) m.count = 0; for (const l of this.near.values()) for (const m of l) m.count = 0; return; }
    const R = c.R, [e, nn] = tangent(n), L = Math.max(0, Math.round(Math.log2((R * Math.PI / 2) / CELL))), k = 2 / 2 ** L;
    const seen = new Set<string>(), trees: Tree[] = [];
    const step = CELL * 0.7, N = Math.ceil(FAR / step);
    for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
      const dx = i * step, dy = j * step;
      if (dx * dx + dy * dy > FAR * FAR) continue;
      const m: V3 = [n[0] + (e[0] * dx + nn[0] * dy) / R, n[1] + (e[1] * dx + nn[1] * dy) / R, n[2] + (e[2] * dx + nn[2] * dy) / R];
      const l = Math.hypot(...m);
      const [f, a, b] = faceOf([m[0] / l, m[1] / l, m[2] / l]);
      const ci = Math.floor((a + 1) / k), cj = Math.floor((b + 1) / k), id = `${f}/${ci}/${cj}`;
      if (seen.has(id)) continue;
      seen.add(id);
      let cell = this.cells.get(id);
      if (!cell) { cell = this.cell(c, f, ci, cj, k); this.cells.set(id, cell); }
      for (const t of cell) trees.push(t);
    }
    if (this.cells.size > 20000) this.cells.clear();
    // nearest first, so the caps trim the forest's far edge evenly
    const dot = (t: Tree) => -(t.n[0] * n[0] + t.n[1] * n[1] + t.n[2] * n[2]);
    trees.sort((a, b) => dot(a) - dot(b));
    this.draw(c, n, trees);
  }

  /** a cell of the lattice: no tree, or one (sometimes two), each its own */
  private cell(c: FloraCtx, f: number, ci: number, cj: number, k: number): Tree[] {
    const out: Tree[] = [], sd = c.seed;
    for (let q = 0; q < 2; q++) {
      const h = (s: number) => hash(ci * 7 + q * 131 + s, cj * 13 + f * 977, sd + s * 31);
      if (h(1) > this.density * (q ? 0.35 : 0.8)) continue;
      const a = -1 + (ci + 0.1 + 0.8 * h(2)) * k, b = -1 + (cj + 0.1 + 0.8 * h(3)) * k;
      const ta = Math.tan(a * Math.PI / 4), tb = Math.tan(b * Math.PI / 4);
      const F = FACES[f], x = F[0][0] + ta * F[1][0] + tb * F[2][0], y = F[0][1] + ta * F[1][1] + tb * F[2][1], z = F[0][2] + ta * F[1][2] + tb * F[2][2], l = Math.hypot(x, y, z);
      const n: V3 = [x / l, y / l, z / l];
      if (c.built(n)) continue;
      const g = c.heightAt(n);
      if (g.sea) continue;
      out.push({ n, h: g.h - 0.3, kind: Math.floor(h(4) * this.kinds.length), s: 0.65 + 0.8 * h(5), sy: 0.85 + 0.4 * h(6), sw: 0.85 + 0.35 * h(7), sq: (h(11) - 0.5) * 0.3, rot: h(8) * Math.PI * 2, lean: (h(9) - 0.5) * 0.12, tint: h(10) });
    }
    return out;
  }

  private draw(c: FloraCtx, n: V3, trees: Tree[]) {
    const R = c.R, base = new THREE.Vector3(n[0] * R, n[1] * R, n[2] * R);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3();
    const lean = new THREE.Quaternion(), spin = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0), bark = new THREE.Color();
    const [trunk, crown, cone] = this.far;
    let a = 0, bN = 0, cN = 0;
    const nearCount = new Map<ModelName, number>();
    const clear = this.clearings.map(k => ({ n: k.n, c: Math.cos(k.r / R) }));
    this.standing = [];
    for (const t of trees) {
      if (clear.some(k => k.n[0] * t.n[0] + k.n[1] * t.n[1] + k.n[2] * t.n[2] > k.c)) continue;
      const kind = this.kinds[t.kind];
      const d = Math.acos(Math.min(1, n[0] * t.n[0] + n[1] * t.n[1] + n[2] * t.n[2])) * R;
      up.set(...t.n);
      q.setFromUnitVectors(Y, up).multiply(lean.setFromAxisAngle(X, t.lean)).multiply(spin.setFromAxisAngle(Y, t.rot));
      p.set(t.n[0] * (R + t.h) - base.x, t.n[1] * (R + t.h) - base.y, t.n[2] * (R + t.h) - base.z);
      const mn = modelFor(kind, t.kind + Math.floor(t.tint * 4)), root = mn ? model(mn) : null;
      const H = mn ? heightOf(kind, t) : kind.size * (0.5 + 0.55 * t.s) * t.sy;
      // its leaves: a made-up world's tinted the colour its plants are under its star
      if (mn) col.copy(this.leafOf(mn, root)); else col.setHex(kind.col);
      if (this.tint) col.lerp(this.tint, 0.5);
      if (mn && root && d < NEAR) {
        const list = this.instances(mn, root), i = nearCount.get(mn) ?? 0;
        if (i >= CAP_NEAR) continue;
        nearCount.set(mn, i + 1);
        // the height scales the model, its girth only so far, so tall trees stay slender rather than swelling
        const hs = H / modelHeight(mn, root);
        const ws = Math.min(hs, 1.5) * t.sw;
        // (a little wider one way than the other, so no two crowns make the same outline)
        s.set(ws * (1 + t.sq), hs, ws * (1 - t.sq));
        m.compose(p, q, s);
        const k = 0.85 + 0.3 * t.tint, tint = this.tint ? new THREE.Color().copy(this.tint).lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(k) : new THREE.Color(k, k, k);
        bark.setScalar(0.9 + 0.2 * t.tint);
        for (const im of list) { im.setMatrixAt(i, m); im.setColorAt(i, (im.material as THREE.Material).name.endsWith('bark') ? bark : tint); }
        this.standing.push({ n: t.n, h: t.h, H, trunk: 0.15 + H * 0.012 });
        continue;
      }
      if (a >= CAP_FAR) continue;
      // further off, the same tree in a few shapes: its trunk, and a crown the shape its kind's is
      const shape = mn ?? (kind.cone ? 'pine' : 'oak');
      const [trunkTop, crownBase, crownTop, width] = ({ pine: [0.3, 0.1, 1, 0.42], birch: [0.55, 0.32, 0.98, 0.44], palm: [0.9, 0.8, 1, 0.55], oak: [0.5, 0.3, 1, 0.6], maple: [0.5, 0.32, 1, 0.56] } as Record<string, number[]>)[shape];
      const tr = (0.15 + H * 0.012) * t.sw;
      s.set(tr, H * trunkTop, tr);
      m.compose(p, q, s);
      trunk.setMatrixAt(a++, m);
      const foot = p.clone().addScaledVector(up, H * crownBase), w = H * width * t.sw;
      col.offsetHSL((t.tint - 0.5) * 0.03, 0, (t.tint - 0.5) * 0.08);
      s.set(w * (1 + t.sq), H * (crownTop - crownBase), w * (1 - t.sq));
      m.compose(foot, q, s);
      if (shape === 'pine') { cone.setMatrixAt(cN, m); cone.setColorAt(cN++, col); }
      else { crown.setMatrixAt(bN, m); crown.setColorAt(bN++, col); }
      if (d < FAR * 0.5) this.standing.push({ n: t.n, h: t.h, H, trunk: tr });
    }
    trunk.count = a; crown.count = bN; cone.count = cN;
    for (const [mn, list] of this.near) for (const im of list) { im.count = nearCount.get(mn) ?? 0; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.position.copy(base); im.computeBoundingSphere(); }
    for (const im of this.far) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.position.copy(base); }
  }

  /** the colour a modelled tree's leaves are from a distance: its foliage texture, averaged once it is in */
  private leafOf(mn: ModelName, root: THREE.Group | null) {
    const have = this.leafCol.get(mn);
    if (have) return have;
    const fallback = new THREE.Color(LEAF[mn] ?? 0x3f5f2a);
    if (!root || typeof document === 'undefined') return fallback;
    let out = fallback;
    try {
      const leaf = parts(root).find(pt => pt.mat.name.endsWith('foliage'))?.mat as THREE.MeshStandardMaterial | undefined;
      const img = leaf?.map?.image as CanvasImageSource | undefined;
      if (leaf && img) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 16;
        const g = cv.getContext('2d')!;
        g.drawImage(img, 0, 0, 16, 16);
        const px = g.getImageData(0, 0, 16, 16).data;
        let r = 0, gg = 0, b = 0, w = 0;
        // (weighted by how opaque each texel is: the gaps between leaves are not leaf)
        for (let k = 0; k < px.length; k += 4) { const al = px[k + 3] / 255; r += px[k] * al; gg += px[k + 1] * al; b += px[k + 2] * al; w += al; }
        if (w > 0) out = new THREE.Color().setRGB(r / w / 255, gg / w / 255, b / w / 255, THREE.SRGBColorSpace).multiply(leaf.color);
      }
    } catch { /* the stand-in colour will do */ }
    this.leafCol.set(mn, out);
    return out;
  }

  /** the instanced draws of a modelled tree: one per part (bark, foliage) */
  private instances(mn: ModelName, root: THREE.Group) {
    let l = this.near.get(mn);
    if (!l) {
      l = parts(root).map(pt => {
        const im = new THREE.InstancedMesh(pt.geo, pt.mat, CAP_NEAR);
        im.count = 0;
        im.frustumCulled = true;
        im.setColorAt(0, new THREE.Color(1, 1, 1));
        this.group.add(im);
        return im;
      });
      this.near.set(mn, l);
    }
    return l;
  }

  dispose() { this.clear(); }
}

const tall = new Map<ModelName, number>();
/** how tall a model stands, measured once */
function modelHeight(mn: ModelName, root: THREE.Object3D) {
  let h = tall.get(mn);
  if (h === undefined) { h = Math.max(1, new THREE.Box3().setFromObject(root).max.y); tall.set(mn, h); }
  return h;
}

const FACES: [V3, V3, V3][] = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, -1, 0], [0, 0, 1]],
  [[0, 1, 0], [-1, 0, 0], [0, 0, 1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [0, 1, 0], [-1, 0, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
];
