import * as THREE from 'three';
import type { V3 } from '../pixel/sprites';
import { faceDir, faceOf, tangent } from './terrain';

/**
 * Grass underfoot: small tufts of blades, a few thousand of them, round you
 * out to twenty metres, where the ground is grassy — the same test
 * the ground's own grass texture makes (ground.ts): on the Earth ground with
 * more green in it than red or blue, on a made-up world ground the colour of
 * its plants, and not too steep or rocky.
 *
 * They are fixed to the world like the trees: the ground is cut into cells two
 * metres across on a lattice over the whole world, and each cell's hash says
 * how many tufts it holds, where, how tall and which way they turn — so the
 * same grass is there when you come back. Heights come from the corners of
 * the cells (each worked out once and kept), the tufts in between laid on the
 * slope between them, so walking on only costs the new cells at the edge.
 *
 * One instanced draw for the lot. The blades sway in the wind in the vertex
 * shader (a few sines, each tuft out of step with its neighbours); the tufts
 * shrink to nothing toward the edge so there is no line where they stop; and
 * all of it is rebuilt only when you have walked a few metres.
 */

export interface GrassCtx {
  R: number;
  seed: number;
  /** the ground there: its height and colour, sea or not, how rocky */
  sampleAt: (n: V3) => { h: number; sea: boolean; r: number; g: number; b: number; rock: number };
  /** something built there (a base, a pad): no grass */
  built: (n: V3) => boolean;
}

const CELL = 2, FAR = 20, CAP = 5000, PER = 12;

interface Corner { h: number; w: number; r: number; g: number; b: number }
interface Tuft { n: V3; h: number; s: number; rot: number; col: [number, number, number] }

/** how grassy a sample of ground is (0–1): on the Earth by its green; elsewhere by how near its colour is to the plants' */
export function grassiness(r: number, g: number, b: number, rock: number, leaf: THREE.Color | null, lush: number): number {
  if (lush <= 0) return 0;
  const bare = 1 - sstep(0.55, 0.85, rock);
  if (!leaf) return lush * bare * sstep(0.012, 0.055, g - Math.max(r, b));
  const s = r + g + b + 1e-6, L = leaf.r + leaf.g + leaf.b + 1e-6;
  const d = Math.hypot(r / s - leaf.r / L, g / s - leaf.g / L, b / s - leaf.b / L);
  return lush * bare * (1 - sstep(0.06, 0.2, d));
}
const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (a: number, b: number, c: number) => { const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return x - Math.floor(x); };

/** a tuft: thirteen blades leaning out from its middle, each in two bends, dark at the root and light at the tip */
function tuftGeometry() {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let k = 0; k < 13; k++) {
    const a = (k / 13) * Math.PI * 2 + hash(k, 1, 2) * 0.9, r0 = 0.04 + 0.22 * hash(k, 3, 4);
    const h = 0.55 + 0.45 * hash(k, 5, 6), lean = 0.15 + 0.3 * hash(k, 7, 8), w = 0.022 + 0.012 * hash(k, 9, 1);
    const cx = Math.cos(a), cz = Math.sin(a), px = -cz, pz = cx;
    const at = (t: number) => [cx * (r0 + lean * t * t * h), h * t, cz * (r0 + lean * t * t * h)];
    const base = pos.length / 3;
    for (const [t, ww] of [[0, w], [0.5, w * 0.75]] as const) {
      const [x, y, z] = at(t);
      pos.push(x - px * ww, y, z - pz * ww, x + px * ww, y, z + pz * ww);
      const c = 0.62 + 0.38 * t;
      col.push(c, c, c, c, c, c);
    }
    const [x, y, z] = at(1);
    pos.push(x, y, z);
    col.push(1, 1, 1);
    idx.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // lit as the ground under them is, not blade by blade
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

export class Grass {
  readonly group = new THREE.Group();
  readonly mesh: THREE.InstancedMesh;
  private time = { value: 0 };
  private corners = new Map<string, Corner>();
  private cells = new Map<string, Tuft[]>();
  private at: V3 | null = null;
  private key = '';

  constructor() {
    this.group.name = 'grass';
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = sh => {
      sh.uniforms.time = this.time;
      sh.vertexShader = 'uniform float time;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        // the wind: stronger toward the tip, each tuft out of step with the next
        float k = position.y * position.y;
        vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float ph = ip.x * 0.37 + ip.y * 0.21 + ip.z * 0.53;
        transformed.x += k * (0.10 * sin(time * 1.9 + ph) + 0.04 * sin(time * 4.7 + ph * 2.3));
        transformed.z += k * 0.06 * sin(time * 1.3 + ph * 1.7);`);
    };
    this.mesh = new THREE.InstancedMesh(tuftGeometry(), mat, CAP);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.group.add(this.mesh);
  }

  clear() { this.corners.clear(); this.cells.clear(); this.at = null; this.mesh.count = 0; }

  /**
   * each frame: the wind; and when you have moved a few metres (or the world's
   * grass has changed) the tufts round you again. `lush` is how much grass the
   * world grows (0 for none); `leaf` its plants' colour on a made-up world
   */
  frame(c: GrassCtx, n: V3, lush: number, leaf: THREE.Color | null, t: number) {
    this.time.value = t % 1000;
    const key = `${lush}:${leaf?.getHex() ?? 'earth'}:${c.seed}`;
    if (key !== this.key) { this.clear(); this.key = key; }
    if (this.at && Math.acos(Math.min(1, n[0] * this.at[0] + n[1] * this.at[1] + n[2] * this.at[2])) * c.R < 3) return;
    this.at = n;
    if (lush <= 0) { this.mesh.count = 0; return; }
    this.build(c, n, lush, leaf);
  }

  private build(c: GrassCtx, n: V3, lush: number, leaf: THREE.Color | null) {
    const R = c.R, [e, nn] = tangent(n), L = Math.max(0, Math.round(Math.log2((R * Math.PI / 2) / CELL))), k = 2 / 2 ** L;
    const base = new THREE.Vector3(n[0] * R, n[1] * R, n[2] * R);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(), y = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    const seen = new Set<string>();
    const step = CELL * 0.7, N = Math.ceil(FAR / step);
    let i = 0;
    const tufts: { t: Tuft; d: number }[] = [];
    for (let a = -N; a <= N; a++) for (let b = -N; b <= N; b++) {
      const dx = a * step, dy = b * step;
      if (dx * dx + dy * dy > FAR * FAR) continue;
      const v: V3 = [n[0] + (e[0] * dx + nn[0] * dy) / R, n[1] + (e[1] * dx + nn[1] * dy) / R, n[2] + (e[2] * dx + nn[2] * dy) / R];
      const l = Math.hypot(...v);
      const [f, fa, fb] = faceOf([v[0] / l, v[1] / l, v[2] / l]);
      const ci = Math.floor((fa + 1) / k), cj = Math.floor((fb + 1) / k), id = `${f}/${ci}/${cj}`;
      if (seen.has(id)) continue;
      seen.add(id);
      let cell = this.cells.get(id);
      if (!cell) { cell = this.cell(c, f, ci, cj, k, lush, leaf); this.cells.set(id, cell); }
      for (const t of cell) {
        const d = Math.acos(Math.min(1, n[0] * t.n[0] + n[1] * t.n[1] + n[2] * t.n[2])) * R;
        if (d < FAR) tufts.push({ t, d });
      }
    }
    if (this.cells.size > 6000) { this.cells.clear(); this.corners.clear(); }
    // nearest first, so the cap trims the far edge
    tufts.sort((a, b) => a.d - b.d);
    for (const { t, d } of tufts) {
      if (i >= CAP) break;
      up.set(t.n[0], t.n[1], t.n[2]);
      q.setFromUnitVectors(y, up).multiply(new THREE.Quaternion().setFromAxisAngle(y, t.rot));
      p.set(t.n[0] * (R + t.h) - base.x, t.n[1] * (R + t.h) - base.y, t.n[2] * (R + t.h) - base.z);
      // smaller toward the edge, so there is no line where the grass stops
      const sz = t.s * (1 - sstep(FAR * 0.7, FAR, d));
      s.set(sz, sz, sz);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(i, m);
      this.mesh.setColorAt(i, col.setRGB(...t.col));
      i++;
    }
    this.mesh.count = i;
    this.mesh.position.copy(base);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** a corner of the lattice: the ground's height and colour there, and how grassy it is */
  private corner(c: GrassCtx, f: number, i: number, j: number, k: number, lush: number, leaf: THREE.Color | null): Corner {
    const id = `${f}/${i}/${j}`;
    let o = this.corners.get(id);
    if (o) return o;
    const g = c.sampleAt(faceDir(f, -1 + i * k, -1 + j * k));
    o = { h: g.h, w: g.sea ? 0 : grassiness(g.r, g.g, g.b, g.rock, leaf, lush), r: g.r, g: g.g, b: g.b };
    this.corners.set(id, o);
    return o;
  }

  /** a cell: as many tufts as it is grassy, each its own */
  private cell(c: GrassCtx, f: number, ci: number, cj: number, k: number, lush: number, leaf: THREE.Color | null): Tuft[] {
    const out: Tuft[] = [];
    const c00 = this.corner(c, f, ci, cj, k, lush, leaf), c10 = this.corner(c, f, ci + 1, cj, k, lush, leaf);
    const c01 = this.corner(c, f, ci, cj + 1, k, lush, leaf), c11 = this.corner(c, f, ci + 1, cj + 1, k, lush, leaf);
    const w = (c00.w + c10.w + c01.w + c11.w) / 4;
    if (w < 0.05) return out;
    // (too steep: grass does not cling to a cliff)
    const slope = Math.max(Math.abs(c10.h - c00.h), Math.abs(c01.h - c00.h), Math.abs(c11.h - c10.h), Math.abs(c11.h - c01.h)) / CELL;
    if (slope > 0.9) return out;
    const mid = faceDir(f, -1 + (ci + 0.5) * k, -1 + (cj + 0.5) * k);
    if (c.built(mid)) return out;
    const sd = c.seed;
    const count = Math.round(PER * w * (0.6 + 0.8 * hash(ci, cj, sd + 1)));
    for (let q = 0; q < count; q++) {
      const h = (x: number) => hash(ci * 3 + q * 17 + x, cj * 5 + f * 131, sd + x * 7);
      const u = h(1), v = h(2);
      const lerp = (a: number, b: number, cc: number, d: number) => a * (1 - u) * (1 - v) + b * u * (1 - v) + cc * (1 - u) * v + d * u * v;
      // the blades a shade lighter than the ground they grow from, and greener
      const r = lerp(c00.r, c10.r, c01.r, c11.r), g = lerp(c00.g, c10.g, c01.g, c11.g), b = lerp(c00.b, c10.b, c01.b, c11.b);
      const lift = 1.15 + 0.35 * h(5);
      const col: [number, number, number] = leaf
        ? [Math.min(1, (r * 0.5 + leaf.r * 0.5) * lift), Math.min(1, (g * 0.5 + leaf.g * 0.5) * lift), Math.min(1, (b * 0.5 + leaf.b * 0.5) * lift)]
        : [Math.min(1, (r * 0.75 + 0.06 + 0.08 * h(6)) * lift), Math.min(1, (g * 0.85 + 0.09) * lift), Math.min(1, b * 0.7 * lift)];
      out.push({ n: faceDir(f, -1 + (ci + u) * k, -1 + (cj + v) * k), h: lerp(c00.h, c10.h, c01.h, c11.h) - 0.04, s: (0.18 + 0.3 * h(3)) * (0.6 + 0.5 * w), rot: h(4) * Math.PI * 2, col });
    }
    return out;
  }

  dispose() { this.clear(); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
