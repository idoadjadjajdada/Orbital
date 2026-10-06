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
 *
 * In each site's main ruin something was left behind: an artefact, glinting
 * where you can reach it (under the arch, in the shrine, at the foot of the
 * obelisk), to pick up for the log. And the suit's scan reads a ruin: how old
 * it is, what it is made of, and from its doorways how tall its builders were.
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

export interface Ruin {
  key: string; n: V3; h: number; model: ModelName; s: number; rot: number; tint: THREE.Color; name: string;
  /** what was left in it (the site's main ruin only) */
  art?: { name: string; about: string };
  /** how long ago it was built, years */
  age: number;
}

/** an artefact as it lies: where (body frame, and m over the datum), and the ruin it is in */
interface Lying { r: Ruin; n: V3; h: number; obj: THREE.Object3D }

const ARTS = [
  'a carved tablet', 'a stone figurine', 'a disc of polished stone', 'a ring of dark metal', 'a broken mask',
  'a sealed jar', 'a bead of coloured glass', 'a seal cut with a sign', 'a lamp of carved stone', 'a fragment of a star map',
];
const MARKS = [
  'its marks run in rows, like writing nobody can read',
  'it shows the sky over this place, the stars as they stood when it was made',
  'worn smooth where hands held it',
  'cut with a pattern that repeats, and repeats again smaller inside itself',
  'it shows a figure with its arms raised to something above it',
  'a hole runs through it, as if it was worn on a cord',
  'its surface is scored with lines that meet at this very place, as on a map',
];

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
      // a few centuries to a few million years old: older where nothing wears it away (or where a people lives, younger)
      const age = Math.round(300 * 10 ** (h(8) * 4 * (c.people ? 0.6 : 1)));
      const art = q === 0 ? { name: ARTS[Math.floor(h(9) * ARTS.length)], about: `${MARKS[Math.floor(h(11) * MARKS.length)][0].toUpperCase()}${MARKS[Math.floor(h(11) * MARKS.length)].slice(1)}. ${c.people ? `The ${c.people} made it` : 'Whoever made it'}, about ${fmtAge(age)} ago.` } : undefined;
      out.push({ key: `${f}/${ci}/${cj}/${q}`, n, h: lo - 0.15 * s, model: mn, s, rot: g(5) * Math.PI * 2, tint, name: WHAT[mn], art, age });
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
    if (r.art && !this.taken.has(r.key)) this.lay(r, o, R);
  }

  /** the artefacts picked up already */
  readonly taken = new Set<string>();
  private lying = new Map<string, Lying>();

  /** put a ruin's artefact down in it: the nearest open spot to its middle (on the ground, or a step), glinting */
  private lay(r: Ruin, o: THREE.Object3D, R: number) {
    let spot: { x: number; z: number; y: number } | null = null;
    for (let ring = 0; ring < 12 && !spot; ring++) for (let k = 0; k < Math.max(1, ring * 6) && !spot; k++) {
      const a = (k / Math.max(1, ring * 6)) * Math.PI * 2, x = Math.cos(a) * ring * 0.4, z = Math.sin(a) * ring * 0.4;
      const g = gridAt(r.model, x, z);
      if (!g) spot = { x, z, y: 0 };
      else if (!g.solid && g.floor !== null && g.floor < 1.2) spot = { x, z, y: g.floor };
    }
    if (!spot) return;
    const a = artefactMesh();
    a.position.set(spot.x, spot.y + 0.35 / r.s, spot.z);
    a.scale.setScalar(1 / r.s);
    o.add(a);
    // where it is on the world: from the ruin's frame (east, up, north turned by its rotation) back to a direction
    o.updateMatrixWorld(true);
    const w = a.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.group.matrixWorld.clone().invert()), l = w.length();
    this.lying.set(r.key, { r, n: [w.x / l, w.y / l, w.z / l], h: l - R - 0.35, obj: a });
  }

  /** an artefact within reach of someone standing at n with their feet at `foot` m: its ruin, what it is */
  artefactAt(n: V3, R: number, foot: number): Ruin | null {
    for (const v of this.lying.values()) {
      if (!v.obj.parent) { this.lying.delete(v.r.key); continue; }
      const d = Math.acos(Math.min(1, n[0] * v.n[0] + n[1] * v.n[1] + n[2] * v.n[2])) * R;
      if (d < 2.4 && Math.abs(foot - v.h) < 2.5) return v.r;
    }
    return null;
  }

  /** pick an artefact up: gone from where it lay */
  take(r: Ruin) {
    this.taken.add(r.key);
    const v = this.lying.get(r.key);
    if (v) { v.obj.parent?.remove(v.obj); this.lying.delete(r.key); }
  }

  /** the artefacts glint and turn */
  spin(t: number) {
    for (const v of this.lying.values()) {
      v.obj.rotation.y = t * 0.8;
      const glow = v.obj.getObjectByName('glint') as THREE.Sprite | undefined;
      if (glow) glow.material.opacity = 0.55 + 0.35 * Math.sin(t * 2.5);
    }
  }

  /** what the suit's scan reads from a ruin */
  read(r: Ruin, people: string | null): string[] {
    const door = 2.1 * r.s, tall = door / 1.25;
    return [
      `${r.name[0].toUpperCase()}${r.name.slice(1)}, built about ${fmtAge(r.age)} ago${r.age > 1e5 ? ': older than any people we know of' : ''}`,
      `Cut from the stone of the ground here, and laid without mortar; tool marks on the inside faces`,
      `Its doorways stand ${door.toFixed(1)} m: built by, or for, beings about ${tall.toFixed(1)} m tall${tall > 2.6 ? ', far taller than us' : tall > 1.9 ? ', a little taller than us' : ''}`,
      people ? `In the style of the ${people}` : 'Who built it is not known: no people lives here now',
      r.art ? (this.taken.has(r.key) ? `You took ${r.art.name} from it` : `Something lies in it: ${r.art.name}`) : 'Nothing left in it',
    ];
  }

  private drop(o: THREE.Object3D) {
    this.group.remove(o);
    for (const [k, v] of this.lying) if (v.obj.parent === o) this.lying.delete(k);
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

/** years, as you would say them */
function fmtAge(y: number) {
  if (y >= 1e6) return `${(y / 1e6).toFixed(y < 1e7 ? 1 : 0)} million years`;
  if (y >= 1e4) return `${Math.round(y / 1000)} thousand years`;
  return `${Math.round(y / 100) * 100} years`;
}

/** an artefact: a small carved thing of the ruin's own sort, with a glint over it so it can be found */
function artefactMesh() {
  const g = new THREE.Group();
  g.name = 'artefact';
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), new THREE.MeshStandardMaterial({ color: 0xd8b060, emissive: 0x3a2a08, metalness: 0.6, roughness: 0.35, flatShading: true }));
  m.scale.set(1, 1.4, 1);
  g.add(m);
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTexture(), color: 0xffe2a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glint.name = 'glint';
  glint.scale.setScalar(0.9);
  g.add(glint);
  return g;
}
let glintTex: THREE.Texture | null = null;
function glintTexture() {
  if (glintTex) return glintTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d')!, gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,200,0.5)'); gr.addColorStop(1, 'rgba(255,220,160,0)');
  c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
  glintTex = new THREE.CanvasTexture(cv);
  return glintTex;
}
