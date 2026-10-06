import * as THREE from 'three';
import type { Body } from '../physics/body';
import { composition } from './science';

/**
 * The growth lab: a bench of six glass chambers in a base's dome, each a soil,
 * a plant and whatever you did to the soil first, run under grow lights at a
 * day a minute.
 *
 * The soils are what you can get: potting soil and a nutrient solution to
 * compare against, simulants of the Moon's and Mars' ground, and every sample
 * you have brought back and analysed, its chemistry worked out from where it
 * came from. What a soil gives a plant is boiled down to what matters: the
 * nitrogen, phosphorus and potassium a root can take up; how acid or alkaline
 * it is; what in it poisons (the perchlorate in Mars' ground, salts, metals,
 * cyanides); how well it holds water; and how sharp its grains are (the Moon's
 * are broken glass, never weathered).
 *
 * A plant grows as fast as the scarcest thing it needs allows (Liebig's law
 * of the minimum), slowed further by the wrong pH, by poisons it cannot
 * tolerate, by a soil that dries out and by grains that cut its roots. That
 * is roughly what was found when it was tried: Arabidopsis grew in Apollo
 * soil, given nutrients, but slowly and stressed, purple with it (Paul et al.
 * 2022); crops grow in a Mars simulant given compost, once the perchlorate is
 * washed out (Wamelink et al. 2014, 2019); a carbonaceous meteorite feeds
 * plants (Mautner 2002). Amendments change the soil before sowing: compost,
 * rinsing out what dissolves, a pH buffer, fertiliser, and rhizobia, which let
 * a legume make its own nitrogen.
 */

export interface Soil {
  id: string;
  name: string;
  /** where it is from (a world, or "reference") */
  from: string;
  /** availability to a root, 0–1 */
  N: number; P: number; K: number;
  pH: number;
  /** how poisonous, 0–1, and with what; whether rinsing takes it out */
  tox: number; toxWhat: string; soluble: boolean;
  /** how well it holds water, 0–1; organic matter, 0–1; how sharp its grains, 0–1 */
  water: number; org: number; sharp: number;
  /** its colour, for the chamber */
  col: number;
  note: string;
  /** what it is made of, if analysed */
  rows?: [string, number][];
}

export interface Plant {
  id: string; name: string; latin: string; days: number; N: number; P: number; K: number; pH: [number, number]; tol: number; legume: boolean; form: 'rosette' | 'radish' | 'wheat' | 'vine' | 'bush' | 'cress'; fruit?: number;
  /** a full chamber's harvest, as food: days of it for a crew of six (at what potting soil gives) */
  food: number;
}

export const PLANTS: Plant[] = [
  { id: 'cress', name: 'Thale cress', latin: 'Arabidopsis thaliana', days: 40, N: 0.5, P: 0.4, K: 0.4, pH: [5.5, 7.5], tol: 0.2, legume: false, form: 'cress', food: 0.3 },
  { id: 'lettuce', name: 'Lettuce', latin: 'Lactuca sativa', days: 45, N: 0.7, P: 0.4, K: 0.6, pH: [6, 7], tol: 0.15, legume: false, form: 'rosette', food: 1.5 },
  { id: 'radish', name: 'Radish', latin: 'Raphanus sativus', days: 28, N: 0.4, P: 0.5, K: 0.5, pH: [6, 7.5], tol: 0.3, legume: false, form: 'radish', food: 1 },
  { id: 'wheat', name: 'Dwarf wheat', latin: 'Triticum aestivum', days: 80, N: 0.6, P: 0.5, K: 0.4, pH: [6, 7.5], tol: 0.45, legume: false, form: 'wheat', food: 3.5 },
  { id: 'pea', name: 'Pea', latin: 'Pisum sativum', days: 60, N: 0.6, P: 0.6, K: 0.5, pH: [6, 7.5], tol: 0.2, legume: true, form: 'vine', fruit: 0x5aa83a, food: 2 },
  { id: 'tomato', name: 'Dwarf tomato', latin: 'Solanum lycopersicum', days: 75, N: 0.7, P: 0.6, K: 0.8, pH: [6, 6.8], tol: 0.35, legume: false, form: 'bush', fruit: 0xd8321e, food: 2 },
  { id: 'potato', name: 'Potato', latin: 'Solanum tuberosum', days: 90, N: 0.7, P: 0.6, K: 0.9, pH: [5, 6.5], tol: 0.3, legume: false, form: 'bush', food: 4 },
];

export const AMENDS = [
  { id: 'compost', name: 'Compost', about: 'nitrogen, organic matter, holds water, binds metals' },
  { id: 'rinse', name: 'Rinse', about: 'soak and drain three times: washes out what dissolves (perchlorate, salts) — and some nutrients' },
  { id: 'buffer', name: 'pH buffer', about: 'lime or sulphur, toward neutral' },
  { id: 'npk', name: 'Fertiliser', about: 'nitrogen, phosphorus and potassium' },
  { id: 'rhizo', name: 'Rhizobia', about: 'root bacteria that let a legume fix nitrogen from the air' },
] as const;
export type Amend = (typeof AMENDS)[number]['id'];

const S = (id: string, name: string, from: string, N: number, P: number, K: number, pH: number, tox: number, toxWhat: string, soluble: boolean, water: number, org: number, sharp: number, col: number, note: string): Soil =>
  ({ id, name, from, N, P, K, pH, tox, toxWhat, soluble, water, org, sharp, col, note });

/** the reference soils on the shelf */
export const REFERENCE: Soil[] = [
  S('potting', 'Potting soil', 'reference', 0.9, 0.8, 0.8, 6.5, 0, '', true, 0.8, 0.9, 0, 0x3a2a1c, 'Earth soil: peat, compost and grit. The control.'),
  S('hydro', 'Nutrient solution', 'reference', 1, 1, 1, 6, 0, '', true, 1, 0, 0, 0x2a5a78, 'Hydroponics: no soil at all, everything a plant needs dissolved in water.'),
  S('lhs', 'Lunar highlands simulant', 'reference', 0.02, 0.15, 0.1, 8, 0.15, 'reactive glass', false, 0.35, 0, 0.5, 0x9a9890, 'Crushed anorthosite, like the Moon’s highland ground: no nitrogen, sharp unweathered grains.'),
  S('mgs', 'Mars simulant (washed)', 'reference', 0.05, 0.6, 0.4, 7.7, 0, '', true, 0.4, 0, 0.25, 0x9a5434, 'Basaltic Mars ground without its perchlorate: phosphorus aplenty, almost no nitrogen.'),
];

/** what a sample brought back gives a plant, from the world it came from and what it is */
export function soilOfSample(b: Body | null, world: string, what: string, where: string, k: number): Soil {
  const real = b?.look.real ?? world, style = b?.look.style ?? 'rocky', w = what.toLowerCase();
  const rows = b ? composition(b).rows.slice(0, 5) : undefined;
  const id = `s${k}`, name = `${world}: ${what}`;
  const mk = (N: number, P: number, K: number, pH: number, tox: number, toxWhat: string, soluble: boolean, water: number, org: number, sharp: number, col: number, note: string) =>
    ({ ...S(id, name, `${world} · ${where}`, N, P, K, pH, tox, toxWhat, soluble, water, org, sharp, col, note), rows });
  switch (real) {
    case 'Earth': return mk(0.6, 0.55, 0.6, 6.8, 0, '', true, 0.7, 0.5, 0, 0x4a3624, 'Earth ground, with its life in it.');
    case 'Moon': return /basalt|mare|ilmenite/.test(w)
      ? mk(0.02, 0.25, 0.15, 8.2, 0.25, 'nanophase iron and reactive glass', false, 0.3, 0, 0.65, 0x6e6c68, 'Mare regolith, long exposed: its glassy agglutinates stressed the plants grown in Apollo 11’s soil most of all.')
      : mk(0.02, 0.15, 0.1, 8, 0.15, 'reactive glass', false, 0.35, 0, 0.5, 0x9a9890, 'Highland regolith: anorthosite, no nitrogen, sharp unweathered grains.');
    case 'Mars': return mk(0.06, 0.6, 0.4, 7.7, 0.9, 'perchlorate (0.6%)', true, 0.4, 0, 0.25, 0x9a5434, 'Mars ground as Phoenix found it: pH 7.7, rich in phosphorus, and 0.6% perchlorate, enough to kill a plant until it is washed out.');
    case 'Venus': return mk(0, 0.3, 0.3, 7, 0.35, 'sulphur compounds', true, 0.3, 0, 0.3, 0x6a5a48, 'Basalt baked at 460 °C under sulphuric clouds.');
    case 'Mercury': return mk(0, 0.1, 0.25, 7.5, 0.3, 'sulphides', false, 0.3, 0, 0.45, 0x58544e, 'Dark, sulphur-rich regolith.');
    case 'Titan': return mk(0.4, 0, 0.02, 7, 0.75, 'nitriles and hydrocarbons (HCN)', false, 0.2, 0.8, 0.1, 0x6a5030, 'Water ice and tholins: organic, but cyanide-laced and with no phosphorus at all.');
    case 'Europa': return mk(0.05, 0.05, 0.25, 8.5, 0.5, 'magnesium sulphate salts', true, 1, 0, 0, 0xb8c4c8, 'Ice, melted: a salty brine.');
    case 'Enceladus': return mk(0.25, 0.45, 0.2, 9.5, 0.35, 'sodium carbonate salts', true, 1, 0.05, 0, 0xd8e0e4, 'Ice from the plumes, melted: alkaline, with ammonia and the phosphates Cassini found.');
    case 'Ceres': return mk(0.5, 0.45, 0.4, 9, 0.4, 'carbonate salts', true, 0.7, 0.1, 0.1, 0x4a4844, 'Ammoniated clays and carbonates: nitrogen, for once.');
    case 'Io': return mk(0, 0.05, 0.2, 5, 0.8, 'sulphur', false, 0.2, 0, 0.3, 0xc8b040, 'Sulphur frost and lava: acid, and poison.');
  }
  if (/chondrite|carbonaceous|clay/.test(w)) return mk(0.35, 0.7, 0.35, 7.5, 0.15, 'salts', true, 0.6, 0.3, 0.1, 0x2e2a28, 'Carbonaceous: clays, organics and phosphate. Plants have been grown on meteorite extract.');
  const table: Record<string, Parameters<typeof mk>> = {
    terran: [0.05, 0.4, 0.4, 7, 0.1, 'trace metals', false, 0.5, 0, 0.15, 0x6a5a4a, 'Weathered rock, never lived in: minerals but no nitrogen.'],
    desert: [0.03, 0.35, 0.3, 8.5, 0.35, 'sulphates and salts', true, 0.3, 0, 0.2, 0xa07048, 'Desert ground: alkaline and salty.'],
    ice: [0.08, 0.05, 0.1, 8, 0.3, 'ammonia and salts', true, 1, 0, 0, 0xc8d4dc, 'Ice, melted: water with a little dissolved in it.'],
    iron: [0, 0.05, 0.05, 7, 0.5, 'metals (nickel)', false, 0.2, 0, 0.4, 0x5a5048, 'Metal grains: nothing to eat and much to poison.'],
    carbon: [0.1, 0, 0.05, 7, 0.4, 'carbides', false, 0.3, 0.2, 0.3, 0x2a2a2a, 'Graphite and carbides.'],
  };
  const t = table[style] ?? [0.02, 0.2, 0.2, 7.8, 0.15, 'reactive glass', false, 0.35, 0, 0.45, 0x807c76, 'Airless regolith: crushed rock and glass, no nitrogen.'];
  return mk(...t);
}

/** a soil after what was done to it */
export function amended(s: Soil, am: Set<Amend>): Soil {
  const o = { ...s };
  const cap = (x: number) => Math.min(1, x);
  if (am.has('rinse')) { o.tox *= o.soluble ? 0.08 : 0.8; o.N *= 0.6; o.K *= 0.7; }
  if (am.has('compost')) { o.N = cap(o.N + 0.5); o.P = cap(o.P + 0.3); o.K = cap(o.K + 0.3); o.water = cap(o.water + 0.3); o.org = cap(o.org + 0.6); o.tox *= 0.7; o.sharp *= 0.6; o.pH += (6.8 - o.pH) * 0.3; }
  if (am.has('buffer')) o.pH += Math.max(-1.5, Math.min(1.5, 6.5 - o.pH));
  if (am.has('npk')) { o.N = cap(o.N + 0.6); o.P = cap(o.P + 0.5); o.K = cap(o.K + 0.5); }
  return o;
}

export interface Growth { rate: number; limits: string[]; dies: boolean; stress: 'none' | 'yellow' | 'purple' | 'dead' }

/** how well a plant does in a soil: its rate against ideal (0–1), and what held it back, worst first */
export function grow(soil: Soil, p: Plant, am: Set<Amend>): Growth {
  const s = amended(soil, am);
  const N = p.legume && am.has('rhizo') ? Math.max(s.N, 0.8 * (1 - s.tox)) : s.N;
  const f = (have: number, need: number) => (have >= need ? 1 : Math.pow(have / need, 0.8));
  const fac: [string, number][] = [
    ['nitrogen', f(N, p.N)], ['phosphorus', f(s.P, p.P)], ['potassium', f(s.K, p.K)],
  ];
  const dpH = s.pH < p.pH[0] ? p.pH[0] - s.pH : s.pH > p.pH[1] ? s.pH - p.pH[1] : 0;
  const fpH = Math.max(0.05, 1 - 0.35 * dpH), ftox = Math.max(0, 1 - s.tox * (1.15 - p.tol)), fw = 0.55 + 0.45 * s.water, fs = 1 - 0.35 * s.sharp;
  const nut = Math.min(...fac.map(x => x[1]));
  const rate = nut * fpH * ftox * fw * fs;
  const limits: [string, number][] = [
    ...fac.filter(x => x[1] < 0.95).map(([k, v]) => [`too little ${k}`, v] as [string, number]),
    ...(fpH < 0.95 ? [[`pH ${s.pH.toFixed(1)} (it likes ${p.pH[0]}–${p.pH[1]})`, fpH] as [string, number]] : []),
    ...(ftox < 0.95 ? [[s.toxWhat || 'something toxic', ftox] as [string, number]] : []),
    ...(fw < 0.85 ? [['dries out fast', fw] as [string, number]] : []),
    ...(fs < 0.9 ? [['sharp grains cut its roots', fs] as [string, number]] : []),
  ];
  limits.sort((a, b) => a[1] - b[1]);
  const dies = ftox < 0.25 || rate < 0.06;
  // stress shows: starved of nitrogen it yellows; poisoned or cut it purples (anthocyanin), as the Apollo-soil cress did
  const stress = dies ? 'dead' : rate > 0.7 ? 'none' : (ftox < 0.8 || fs < 0.85) && nut > 0.4 ? 'purple' : 'yellow';
  return { rate, limits: limits.map(x => x[0]), dies, stress };
}

// ---------------------------------------------------------------- the lab
export interface Chamber { soil: string; plant: string; amends: Amend[]; start: number; logged: boolean }
/** a day a minute: the chambers' time-lapse */
export const DAYS_PER_YEAR = 365.25 * 1440;

export class GrowLab {
  /** samples analysed, as soils */
  readonly samples: Soil[] = [];
  /** each base's six chambers, by the base's id */
  private labs = new Map<number, (Chamber | null)[]>();
  /** what is being set up: the chamber, its soil, its plant, what is done to it */
  draft: { base: number; k: number; soil: number; plant: number; amends: Set<Amend> } | null = null;
  /** the base whose lab is open */
  base = -1;

  soils(): Soil[] { return [...REFERENCE, ...this.samples]; }
  soil(id: string) { return this.soils().find(s => s.id === id) ?? REFERENCE[0]; }
  plant(id: string) { return PLANTS.find(p => p.id === id) ?? PLANTS[0]; }

  addSample(b: Body | null, world: string, what: string, where: string) {
    const s = soilOfSample(b, world, what, where, this.samples.length + 1);
    this.samples.push(s);
    return s;
  }

  chambers(base: number) {
    let l = this.labs.get(base);
    if (!l) { l = [null, null, null, null, null, null]; this.labs.set(base, l); }
    return l;
  }

  sow(now: number) {
    const d = this.draft;
    if (!d) return null;
    const s = this.soils()[d.soil], p = PLANTS[d.plant];
    this.chambers(d.base)[d.k] = { soil: s.id, plant: p.id, amends: [...d.amends], start: now, logged: false };
    this.draft = null;
    return { s, p };
  }

  clear(base: number, k: number) { this.chambers(base)[k] = null; }
  /** a grown chamber's harvest, the chamber cleared: the plant, how well it did, and the food it makes (days for a crew of six) */
  harvest(base: number, k: number, now: number): { p: Plant; yield: number; days: number } | null {
    const ch = this.chambers(base)[k];
    if (!ch) return null;
    const st = this.state(ch, now);
    this.clear(base, k);
    if (!st.done || st.g.dies) return null;
    return { p: st.p, yield: st.yield, days: Math.round(st.p.food * st.yield / 100 * 10) / 10 };
  }

  /** how far along a chamber is: its day, its size (0–1), done, and how it is doing */
  state(c: Chamber, now: number) {
    const p = this.plant(c.plant), s = this.soil(c.soil), am = new Set(c.amends), g = grow(s, p, am);
    const day = Math.max(0, (now - c.start) * DAYS_PER_YEAR), frac = Math.min(1, day / p.days);
    // the dying get a little way and stop
    const size = g.dies ? Math.min(frac, 0.2) * 0.5 : Math.pow(frac, 0.85) * (0.2 + 0.8 * g.rate);
    const ref = grow(REFERENCE[0], p, new Set()).rate;
    return { p, s, g, day, frac, size, done: frac >= 1, yield: g.dies ? 0 : Math.round((g.rate / ref) * 100) };
  }
}

// ---------------------------------------------------------------- what it looks like
const leafMat = new Map<string, THREE.MeshLambertMaterial>();
const mat = (c: number) => { const k = c.toString(16); let m = leafMat.get(k); if (!m) { m = new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide }); leafMat.set(k, m); } return m; };
const LEAF = new THREE.SphereGeometry(1, 8, 4);
const STEM = new THREE.CylinderGeometry(1, 1, 1, 5).translate(0, 0.5, 0);

/** a plant at a size (0–1) and in a state, as a small model about 0.4 m tall when grown */
export function plantModel(p: Plant, size: number, stress: Growth['stress'], seed = 1): THREE.Group {
  const g = new THREE.Group(), s = Math.max(0.04, size);
  const green = stress === 'dead' ? 0x6a5434 : stress === 'purple' ? 0x5a4a6a : stress === 'yellow' ? 0x9aa83a : 0x4a9a3a;
  const lm = mat(green), sm = mat(stress === 'dead' ? 0x5a4a30 : 0x5a8a3a);
  const r = (k: number) => { const x = Math.sin(seed * 91.7 + k * 17.3) * 43758.5; return x - Math.floor(x); };
  const leaf = (x: number, y: number, z: number, len: number, wid: number, yaw: number, tilt: number, m = lm) => {
    const l = new THREE.Mesh(LEAF, m);
    l.scale.set(wid, len * 0.08, len);
    l.position.set(x, y, z);
    l.rotation.set(tilt, yaw, 0, 'YXZ');
    l.translateZ(len * 0.8);
    g.add(l);
  };
  const stem = (h: number, w: number, x = 0, z = 0, lean = 0) => { const c = new THREE.Mesh(STEM, sm); c.scale.set(w, h, w); c.position.set(x, 0, z); c.rotation.z = lean; g.add(c); return c; };
  switch (p.form) {
    case 'rosette': case 'radish': case 'cress': {
      const n = p.form === 'rosette' ? 12 : 9, L = (p.form === 'rosette' ? 0.15 : 0.12) * s;
      for (let k = 0; k < n; k++) leaf(0, 0.01, 0, L * (0.7 + 0.5 * r(k)), L * 0.5, (k / n) * Math.PI * 2 + r(k + 9), -0.5 - 0.5 * (k / n));
      if (p.form === 'radish' && s > 0.3) { const b = new THREE.Mesh(LEAF, mat(0xc8344a)); b.scale.set(0.035 * s, 0.03 * s, 0.035 * s); b.position.y = 0.005; g.add(b); }
      if (p.form === 'cress' && s > 0.5) { stem(0.3 * s, 0.003); for (let k = 0; k < 6; k++) { const f = new THREE.Mesh(LEAF, mat(0xf0f0e8)); f.scale.setScalar(0.004); f.position.set((r(k) - 0.5) * 0.03, 0.3 * s - k * 0.012, (r(k + 3) - 0.5) * 0.03); g.add(f); } }
      break;
    }
    case 'wheat': {
      const n = 7;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, lean = 0.1 + 0.15 * r(k), h = 0.36 * s * (0.8 + 0.25 * r(k + 2));
        const c = stem(h, 0.004, Math.cos(a) * 0.02, Math.sin(a) * 0.02, lean);
        c.rotation.y = a;
        leaf(Math.cos(a) * 0.02, 0.05 * s, Math.sin(a) * 0.02, 0.16 * s, 0.009, a, -0.9);
        if (s > 0.6) { const e = new THREE.Mesh(LEAF, mat(stress === 'none' ? 0xd8c070 : 0xa89858)); e.scale.set(0.01, 0.04 * s, 0.01); e.position.set(Math.cos(a) * 0.02 + Math.sin(lean) * h * Math.cos(a), h, Math.sin(a) * 0.02 + Math.sin(lean) * h * Math.sin(a)); g.add(e); }
      }
      break;
    }
    case 'vine': case 'bush': {
      const h = (p.form === 'vine' ? 0.4 : 0.32) * s;
      stem(h, 0.006);
      const n = Math.max(3, Math.round(10 * s));
      for (let k = 0; k < n; k++) {
        const y = h * (0.15 + 0.85 * (k / n)), a = k * 2.4;
        leaf(0, y, 0, (p.form === 'vine' ? 0.07 : 0.1) * Math.max(0.4, s), 0.04 * Math.max(0.4, s), a, -0.35);
        if (p.fruit && s > 0.75 && k % 3 === 1 && stress !== 'dead') {
          const f = new THREE.Mesh(LEAF, mat(p.fruit));
          if (p.form === 'vine') f.scale.set(0.009, 0.009, 0.035); else f.scale.setScalar(0.02);
          f.position.set(Math.cos(a) * 0.06, y - 0.03, Math.sin(a) * 0.06);
          g.add(f);
        }
      }
      break;
    }
  }
  return g;
}

/** the bench: six glass chambers on a table, a soil in each and a plant growing in it, a lamp over each */
export function benchModel() {
  const g = new THREE.Group();
  g.name = 'growlab';
  const steel = new THREE.MeshLambertMaterial({ color: 0xb8bcc2 }), dark = new THREE.MeshLambertMaterial({ color: 0x3a3e44 });
  const glass = new THREE.MeshLambertMaterial({ color: 0xcfe8f0, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xf0b0ff });
  const W = 3.0, D = 0.6, H = 0.85;
  const top = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, D), steel);
  top.position.y = H;
  g.add(top);
  for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, H, 0.05), dark); l.position.set(x, H / 2, z); g.add(l); }
  const slots: { x: number; soil: THREE.Mesh; plant: THREE.Group; key: string }[] = [];
  for (let k = 0; k < 6; k++) {
    const x = -W / 2 + 0.25 + k * 0.5;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.48), glass);
    box.position.set(x, H + 0.275, 0);
    g.add(box);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.02, 0.06), lamp);
    bar.position.set(x, H + 0.51, 0);
    g.add(bar);
    const soil = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.42), new THREE.MeshLambertMaterial({ color: 0x2a2420 }));
    soil.position.set(x, H + 0.075, 0);
    soil.visible = false;
    g.add(soil);
    const plant = new THREE.Group();
    plant.position.set(x, H + 0.125, 0);
    g.add(plant);
    slots.push({ x, soil, plant, key: '' });
  }
  return { group: g, slots, height: H };
}

/** show a chamber as it is now (rebuilding its plant only when it has visibly changed) */
export function showSlot(slot: ReturnType<typeof benchModel>['slots'][number], st: ReturnType<GrowLab['state']> | null, seed: number) {
  if (!st) { slot.soil.visible = false; if (slot.key) { slot.plant.clear(); slot.key = ''; } return; }
  slot.soil.visible = true;
  (slot.soil.material as THREE.MeshLambertMaterial).color.setHex(st.s.col);
  const stage = Math.round(st.size * 20), key = `${st.p.id}:${stage}:${st.g.stress}:${st.frac >= 0.2 || !st.g.dies ? '' : 'early'}`;
  // the dying get as far as a seedling, then brown
  const stress = st.g.dies && st.frac < 0.2 ? 'yellow' : st.g.stress;
  if (key === slot.key) return;
  slot.key = key;
  slot.plant.clear();
  if (st.day < 1.5) return;
  slot.plant.add(plantModel(st.p, stage / 20, stress, seed));
}
