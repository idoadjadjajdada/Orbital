import { Body, type Look } from './body';
import type { World } from './world';
import { makeBody, refreshRoche } from './catalog';
import { G, KM, KMS, M_EARTH, R_EARTH, DAY, HOUR, radiusFromDensity } from './units';
import { stateFromElements, elementsDeg, osculating, relative, type V3 } from './orbit';
import { makePlanet } from './solarsystem';
import { preMSLife, structure, teffOf, newStar } from './stellar';

/**
 * The solar system young: from the Sun's disc of gas and dust to today, in
 * eras you can watch or jump between, with what we think happened happening.
 *
 * Two clocks run. The orbits run at their own speed, integrated like any
 * other system here: Jupiter takes its twelve years, debris round the Earth
 * its hours. The age of the system, the clock of the eras, runs as much
 * faster as an era needs (a few hundred years a year in the disc, millions in
 * the long quiet ages), and what is slower than an orbit — a giant gathering
 * its gas, planets migrating, a Moon's orbit growing — goes by it.
 *
 * What decides how it comes out is simulated, not drawn: the giant impacts
 * that build the Earth and Venus are collisions worked out by the impact
 * physics (Theia's makes a ring of debris round the Earth, a Moon gathers in
 * it and the rest falls back); the giants' instability is the planets' own
 * gravity throwing each other about, with the drag of the disc of icy
 * planetesimals they scatter (the Nice model's engine) standing in as a
 * steady push. So it comes out a little differently every time, and how
 * close it gets to today is scored.
 *
 * The eras (Myr after the first solids, 4,567 million years ago):
 *  - 0: the disc. A young Sun, still contracting, in a disc of gas and dust;
 *    rock and ice gathering into planetesimals; the giants' cores growing,
 *    Jupiter first, then pulling in gas.
 *  - 0.6: the Grand Tack (Walsh et al. 2011). Jupiter, grown, migrates in
 *    through the gas to 1.5 AU and Saturn after it; caught in resonance they
 *    turn and go back out, and the inner disc is cut short at 1 AU (why Mars is
 *    small).
 *  - 3: giant impacts. The gas has gone. Mars-sized embryos left in the inner
 *    disc collide over tens of millions of years into Mercury, Venus and the
 *    proto-Earth; Mars, a stranded embryo, is already done.
 *  - 60: Theia. A Mars-sized world formed at the Earth's Lagrange point drifts
 *    and strikes it a glancing blow: the Earth's surface melts, a disc of
 *    rock vapour and debris forms, and in weeks a Moon gathers in it. The Moon
 *    then slowly spirals out on the tides it raises, and the Earth's day,
 *    five hours then, lengthens.
 *  - 100: the giants' instability (the Nice model in its five-planet form,
 *    Nesvorný & Morbidelli 2012). Jupiter, Saturn and three ice giants in a
 *    tight resonant chain; the planetesimals outside push the chain apart; it
 *    breaks, an ice giant is thrown at Jupiter and out of the solar system,
 *    Jupiter jumps inward, Uranus and Neptune are scattered out to where they
 *    are now. (Recent work puts this early; the classic model put it at 600
 *    Myr, as the cause of the late heavy bombardment.)
 *  - 467: the late heavy bombardment: the great basins, Hellas on Mars,
 *    Imbrium on the Moon, Caloris on Mercury.
 *  - 767: oceans and the first life; Mars dries out.
 *  - 2167: oxygen, and snowball Earths.
 *  - 4029: animals, plants on land, Chicxulub.
 *  - 4567: today, and the score.
 */

export interface Era { key: string; name: string; at: number; blurb: string; pace: number; warp: number; view: number; focus: string }

/** at: Myr after the first solids; pace: Myr of the system's age per year of its orbits; warp: years a second to run them at */
export const ERAS: Era[] = [
  { key: 'disc', name: 'The Sun’s disc', at: 0, pace: 2e-3, warp: 8, view: 9, focus: 'Sun',
    blurb: 'A young Sun, still contracting, in a disc of gas and dust. Rock and ice stick into planetesimals; Jupiter’s core grows past ten Earths and starts pulling in gas.' },
  { key: 'tack', name: 'Jupiter’s Grand Tack', at: 0.6, pace: 2e-3, warp: 8, view: 9, focus: 'Jupiter',
    blurb: 'Grown, Jupiter migrates in through the gas toward the Sun, scattering what is in its way; Saturn follows, catches it in resonance, and the pair turn back out. The inner disc is cut short at 1 AU: why Mars is small.' },
  { key: 'impacts', name: 'Giant impacts', at: 3, pace: 0.05, warp: 20, view: 2.4, focus: 'Sun',
    blurb: 'The gas has gone. Mars-sized embryos crowd the inner system and, over tens of millions of years, collide into Mercury, Venus and the proto-Earth. Mars, a stranded embryo, is already done.' },
  { key: 'theia', name: 'Theia', at: 60, pace: 0.05, warp: 20, view: 1.6, focus: 'Proto-Earth',
    blurb: 'Theia, a Mars-sized world that grew at the Earth’s Lagrange point, drifts out of it and strikes the proto-Earth a glancing blow. The Earth melts; rock vapour and debris form a ring; in weeks a Moon gathers in it, and the rest falls back.' },
  { key: 'nice', name: 'The giants’ instability', at: 100, pace: 0.008, warp: 300, view: 36, focus: 'Jupiter',
    blurb: 'Jupiter, Saturn and three ice giants, locked in a tight chain of resonances, are pushed apart by the icy planetesimals outside them. The chain breaks: an ice giant is thrown at Jupiter and out of the solar system, and Uranus and Neptune are scattered out to where they are now.' },
  { key: 'lhb', name: 'Late heavy bombardment', at: 467, pace: 4, warp: 2, view: 2.4, focus: 'Earth',
    blurb: 'What the giants scattered, and what was left of the asteroid belt, rains on the inner planets: the great basins, Hellas on Mars, Imbrium on the Moon, Caloris on Mercury.' },
  { key: 'archean', name: 'Oceans and first life', at: 767, pace: 25, warp: 2, view: 2.4, focus: 'Earth',
    blurb: 'Oceans under an orange haze of methane, small islands of continent, the first life in mats on the shallows. Mars loses its rivers and lakes to space.' },
  { key: 'oxygen', name: 'Oxygen and snowballs', at: 2167, pace: 30, warp: 2, view: 2.4, focus: 'Earth',
    blurb: 'Photosynthesis fills the air with oxygen. Twice, late on, the Earth freezes almost pole to pole — a snowball — and thaws.' },
  { key: 'life', name: 'Animals and plants', at: 4029, pace: 12, warp: 2, view: 2.4, focus: 'Earth',
    blurb: 'Animals, then plants on land, then forests; continents gather into Pangaea and break apart; an asteroid ends the dinosaurs.' },
  { key: 'today', name: 'Today', at: 4567, pace: 0, warp: 0.1, view: 6, focus: 'Sun',
    blurb: 'The solar system as it is now, as this run made it, scored against the real one.' },
];

export const NOW = 4567;

const D2R = Math.PI / 180;
function hashName(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

// ------------------------------------------------------------------ what is in it

/** the giants as they are made in the disc, and where the Grand Tack and the chain leave them (AU) */
const GIANTS: { name: string; mEnd: number; a0: number; aChain: number; aNow: number; look: Partial<Look>; real?: string }[] = [
  { name: 'Jupiter', mEnd: 317.8, a0: 3.5, aChain: 5.45, aNow: 5.2, look: {}, real: 'Jupiter' },
  { name: 'Saturn', mEnd: 95.2, a0: 4.6, aChain: 7.4, aNow: 9.58, look: {}, real: 'Saturn' },
  { name: 'Uranus', mEnd: 14.5, a0: 6.2, aChain: 9.7, aNow: 19.2, look: {}, real: 'Uranus' },
  { name: 'Planet Five', mEnd: 15.5, a0: 8.0, aChain: 12.8, aNow: 0, look: { style: 'icegiant', c1: 0x40607e, c2: 0x8aa8c0, atmo: 0x90b0d0 } },
  { name: 'Neptune', mEnd: 17.1, a0: 10.5, aChain: 16.9, aNow: 30.1, look: {}, real: 'Neptune' },
];

function sunAt(age: number, s: Body) {
  // still contracting for its first thirty million years: bigger and brighter, then settling onto the main sequence at 0.7 of today's light
  s.star = s.star ?? newStar(1, 0);
  s.star.age = age * 1e6 - preMSLife(1);
  const st = structure(s.star);
  s.r = st.r; s.star.L = st.L; s.star.teff = teffOf(st.L, st.r); s.star.phase = st.phase;
}

function circ(b: Body, host: Body, a: number, i = 0, M = 0, e = 0) {
  const { r, v } = stateFromElements(G * (host.m + b.m), elementsDeg(a, e, i, 0, 0, M));
  b.setPos(host.x + r[0], host.y + r[1], host.z + r[2]);
  b.setVel(host.vx + v[0], host.vy + v[1], host.vz + v[2]);
}

function rocky(name: string, mEarths: number, look: Partial<Look>, rho = 4.5) {
  const b = makeBody('terran', hashName(name), name);
  b.m = mEarths * M_EARTH;
  b.r = radiusFromDensity(b.m, rho);
  b.look = { ...b.look, style: 'rocky', c1: 0x4a3a30, c2: 0x9a7a60, atmo: undefined, real: undefined, rings: undefined, ...look };
  b.spin = (2 * Math.PI) / (12 * HOUR);
  b.tilt = 0;
  refreshRoche(b);
  return b;
}

function giant(g: typeof GIANTS[number], mEarths: number) {
  const b = g.real ? makePlanet(g.real) : makeBody('icegiant', hashName(g.name), g.name);
  b.name = g.name;
  b.look = { ...b.look, ...g.look, real: undefined };
  // (no rings yet: Saturn's are young, or made later; the ice giants' too)
  b.look.rings = undefined;
  // upright as they formed: Uranus is knocked onto its side later, by an impact
  if (g.name === 'Uranus' || !g.real) b.tilt = (4 + 6 * Math.random()) * D2R;
  setMass(b, mEarths);
  return b;
}

/** a giant's mass, its radius following: a core is small and dense, a gas giant big */
function setMass(b: Body, mEarths: number) {
  b.m = mEarths * M_EARTH;
  const rho = mEarths < 20 ? 1.6 : mEarths < 120 ? 0.7 : 1.33;
  b.r = radiusFromDensity(b.m, rho);
  refreshRoche(b);
}

function swarm(w: World, host: Body, n: number, aMin: number, aMax: number, seed: number, o: { name: string; gas?: boolean; m?: number; e?: number; i?: number; c1?: number }) {
  let s = seed >>> 0;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let k = 0; k < n; k++) {
    const p = new Body({ name: o.name, kind: o.gas ? 'gas' : 'fragment', cls: o.gas ? 'gasp' : 'debris', source: false, spin: 0, m: o.m ?? 1e-15, r: o.gas ? 0 : 50 * KM,
      look: { style: 'rocky', seed: k, c1: o.c1 ?? 0x8a7a6a, c2: 0x8a7a6a } });
    // (more of them close in, where the disc is denser: uniform in √a)
    const a = (Math.sqrt(aMin) + (Math.sqrt(aMax) - Math.sqrt(aMin)) * r()) ** 2;
    const e = (o.e ?? 0.02) * r(), i = (o.i ?? 1.5) * r();
    const { r: rr, v } = stateFromElements(G * host.m, elementsDeg(a, e, i, 360 * r(), 360 * r(), 360 * r()));
    p.setPos(host.x + rr[0], host.y + rr[1], host.z + rr[2]);
    p.setVel(host.vx + v[0], host.vy + v[1], host.vz + v[2]);
    if (o.gas) p.heat = 0.2;
    w.add(p);
  }
}

// ------------------------------------------------------------------ how the worlds look, era by era

/** the Earth's face at an age (Myr): molten, a dark Hadean ocean, orange-hazed Archean seas, bare continents, ice, green */
function earthLook(age: number, theia: number | null): Partial<Look> & { heat: number } {
  if (theia === null || age < theia) return { style: 'lava', c1: 0x2a1c16, c2: 0xb0502a, atmo: undefined, real: undefined, heat: 0.25 };
  const since = age - theia;
  if (since < 3) return { style: 'lava', c1: 0x3a160a, c2: 0xffa040, atmo: 0xff9050, real: undefined, heat: 1 - since / 4 };
  if (age < 167) return { style: 'barren', c1: 0x1c1c1e, c2: 0x5a4436, atmo: 0xc0a080, real: undefined, heat: 0.15 };
  if (age < 767) return { style: 'ocean', c1: 0x183048, c2: 0x3a3430, atmo: 0xc8a070, real: undefined, heat: 0 };
  if (age < 2167) return { style: 'ocean', c1: 0x1e4a50, c2: 0x6a5a48, atmo: 0xe0a050, real: undefined, heat: 0 };
  if (age >= 3850 && age < 3932) return { style: 'ice', c1: 0x9ab4c8, c2: 0xf4f8ff, atmo: 0xc8e0ff, real: undefined, heat: 0 };
  if (age < 4100) return { style: 'terran', c1: 0x183a6a, c2: 0x8a6a4a, atmo: 0x88b8ff, real: undefined, heat: 0 };
  return { style: 'terran', c1: 0x1a3a6a, c2: 0x4a6a32, atmo: 0x88b8ff, real: age >= NOW - 1 ? 'Earth' : undefined, heat: 0 };
}

function marsLook(age: number): Partial<Look> & { heat: number } {
  if (age < 20) return { style: 'lava', c1: 0x2a1810, c2: 0xc0582a, real: undefined, heat: 0.3 };
  if (age >= 467 && age < 1067) return { style: 'ocean', c1: 0x1e3a50, c2: 0x9a5a36, atmo: 0xd0b090, real: undefined, heat: 0 };
  return { style: 'desert', c1: 0x7a3a20, c2: 0xc87848, atmo: 0xd0a080, real: age >= 1067 ? 'Mars' : undefined, heat: 0 };
}

function moonLook(age: number, formed: number): Partial<Look> & { heat: number } {
  // a magma ocean for its first hundred million years, then pale anorthosite highlands, then the dark maria flood in
  if (age - formed < 100) return { style: 'lava', c1: 0x40281a, c2: 0xe07a3a, real: undefined, heat: 0.8 * (1 - (age - formed) / 120) };
  if (age < 767) return { style: 'barren', c1: 0x8a867e, c2: 0xdcd8d0, real: undefined, heat: 0 };
  return { style: 'barren', c1: 0x5d5a57, c2: 0xb8b2a8, real: 'Moon', heat: 0 };
}

// ------------------------------------------------------------------ the score

/** today's planets, for the score: a (AU), e, mass (Earths) */
const TODAY: Record<string, { a: number; e: number; m: number }> = {
  Mercury: { a: 0.387, e: 0.206, m: 0.0553 }, Venus: { a: 0.723, e: 0.0068, m: 0.815 }, Earth: { a: 1.0, e: 0.0167, m: 1.0 }, Mars: { a: 1.524, e: 0.0934, m: 0.107 },
  Jupiter: { a: 5.203, e: 0.0484, m: 317.8 }, Saturn: { a: 9.537, e: 0.0539, m: 95.2 }, Uranus: { a: 19.19, e: 0.0473, m: 14.5 }, Neptune: { a: 30.07, e: 0.0086, m: 17.1 },
};

export interface Score { total: number; rows: { name: string; score: number; note: string }[] }

/** how close a system is to today's: each planet's orbit and mass, the Moon, the fifth giant gone, Uranus on its side */
export function scoreSystem(w: World): Score {
  const sun = w.sources.find(b => b.name === 'Sun');
  const rows: Score['rows'] = [];
  const near = (x: number, x0: number, k: number) => Math.exp(-Math.abs(Math.log(Math.max(1e-9, x) / x0)) / k);
  for (const [name, t] of Object.entries(TODAY)) {
    const b = w.sources.find(q => q.alive && (q.name === name || (name === 'Earth' && q.name === 'Proto-Earth') || (name === 'Venus' && q.name === 'Proto-Venus')));
    if (!b || !sun) { rows.push({ name, score: 0, note: 'not there' }); continue; }
    const o = osculating(G * (sun.m + b.m), [b.x - sun.x, b.y - sun.y, b.z - sun.z], [b.vx - sun.vx, b.vy - sun.vy, b.vz - sun.vz]);
    if (!(o.a > 0)) { rows.push({ name, score: 0, note: 'flung out' }); continue; }
    const m = b.m / M_EARTH;
    const s = 0.5 * near(o.a, t.a, 0.08) + 0.2 * Math.exp(-Math.abs(o.e - t.e) / 0.06) + 0.3 * near(m, t.m, 0.3);
    rows.push({ name, score: s, note: `${o.a.toFixed(2)} AU (${t.a}), e ${o.e.toFixed(3)} (${t.e}), ${m < 1 ? m.toFixed(3) : m.toFixed(1)} Earths (${t.m})` });
  }
  // the Moon: there, bound to the Earth, as heavy as it is and as far out
  const earth = w.sources.find(b => b.alive && (b.name === 'Earth' || b.name === 'Proto-Earth'));
  const moon = w.bodies.find(b => b.alive && b.name === 'Moon');
  if (earth && moon) {
    const o = osculating(G * (earth.m + moon.m), [moon.x - earth.x, moon.y - earth.y, moon.z - earth.z], [moon.vx - earth.vx, moon.vy - earth.vy, moon.vz - earth.vz]);
    const aRe = o.a / R_EARTH, mm = moon.m / (0.0123 * M_EARTH);
    rows.push({ name: 'Moon', score: o.a > 0 ? 0.5 * near(mm, 1, 0.4) + 0.5 * near(aRe, 60.3, 0.15) : 0, note: `${(mm * 100).toFixed(0)}% of its mass, ${aRe.toFixed(1)} Earth radii out (60.3)` });
  } else rows.push({ name: 'Moon', score: 0, note: 'none' });
  // the fifth giant: gone
  const five = w.sources.find(b => b.alive && b.name === 'Planet Five');
  rows.push({ name: 'Planet Five', score: five ? 0 : 1, note: five ? 'still here' : 'flung out, as it seems to have been' });
  // Uranus on its side (98°), knocked over by an impact while it formed
  const ur = w.sources.find(b => b.alive && b.name === 'Uranus');
  if (ur) {
    // (its obliquity: a pole tipped past the horizontal reads as a backward spin about the other pole)
    const tilt = ur.spin < 0 ? 180 - ur.tilt / D2R : ur.tilt / D2R;
    rows.push({ name: 'Uranus’ tilt', score: Math.exp(-Math.abs(tilt - 97.8) / 25), note: `${tilt.toFixed(0)}° (97.8°)` });
  }
  const total = (rows.reduce((s, r) => s + r.score, 0) / rows.length) * 100;
  return { total, rows };
}

// ------------------------------------------------------------------ the director

export interface EarlyHost {
  toast(msg: string): void;
  /** run the orbits at this many years a second */
  setWarp(yrPerS: number): void;
}

interface Impact { at: number; target: string; by: string; mass: number; angle: number; vinf: number; note: string; slow: number; polar?: boolean; done?: boolean }

/** a body near and bound, for a moon: the biggest moonlet round the Earth */
function biggestRound(w: World, host: Body): Body | null {
  let best: Body | null = null;
  for (const b of w.bodies) {
    if (!b.alive || b === host || b.cls === 'gasp' || b.m < 1e-4 * host.m) continue;
    const { r, v, mu } = relative(b, host);
    const o = osculating(mu, r, v);
    if (o.a > 0 && o.a < 200 * host.r && (!best || b.m > best.m)) best = b;
  }
  return best;
}

export class Early {
  /** the system's age, Myr after the first solids */
  age = 0;
  era = 0;
  /** when the Moon formed (Myr), and its angular momentum budget with the Earth's spin */
  theia: number | null = null;
  moonAt: number | null = null;
  private L = 0;
  /** an episode in slow motion (an impact): the age holds while it plays */
  private hold: { until: (w: World) => boolean; t: number; max: number; then?: () => void } | null = null;
  private impacts: Impact[] = [];
  private said = new Set<string>();
  /** the age it was started (or jumped) at */
  private from = 0;
  /** the instability: not yet, under way (since this sim time), or settled */
  private nice: 'chain' | 'broken' | 'settled' = 'chain';
  private niceT = 0;
  score: Score | null = null;

  constructor(private host: EarlyHost) {}

  get current() { return ERAS[this.era]; }

  /** ages of the system as years ago, for the readout */
  static ago(age: number) {
    const ma = NOW - age;
    return ma <= 0.0005 ? 'today' : ma >= 1000 ? `${(ma / 1000).toFixed(ma >= 4500 ? 3 : 2)} billion years ago` : ma >= 1 ? `${ma.toFixed(ma >= 100 ? 0 : 1)} million years ago` : `${Math.round(ma * 1e6).toLocaleString('en-US')} years ago`;
  }

  // ---------------------------------------------------------------- building an era from scratch

  /** start an era as the textbooks have it (what came before taken as it is thought to have gone) */
  build(w: World, k: number) {
    w.clear();
    this.era = k;
    this.age = ERAS[k].at;
    this.from = this.age;
    this.hold = null;
    this.score = null;
    this.said.clear();
    const key = ERAS[k].key;
    const sun = makeBody('sun', 7, 'Sun');
    sun.setPos(0, 0, 0); sun.setVel(0, 0, 0);
    sunAt(this.age, sun);
    w.add(sun);
    const early = key === 'disc' || key === 'tack';
    // the giants: cores growing in the disc, the resonant chain after it, or where they are now after the instability
    for (const g of GIANTS) {
      const settled = k > ERAS.findIndex(e => e.key === 'nice');
      if (settled && !g.aNow) continue;
      const m = key === 'disc' ? Math.min(g.mEnd, 10) : g.mEnd;
      const b = giant(g, m);
      circ(b, sun, key === 'disc' ? g.a0 : settled ? g.aNow : g.aChain, 0.3 * Math.random(), 360 * Math.random());
      // (on its side already, if this era comes after the impact that knocked it over)
      if ((settled || (g.name === 'Uranus' && this.age > 45)) && g.real) { const t = makePlanet(g.real); b.tilt = t.tilt; b.node = t.node; }
      w.add(b);
    }
    this.nice = k > ERAS.findIndex(e => e.key === 'nice') ? 'settled' : 'chain';
    // the inner system: a disc of planetesimals early on, embryos once the gas has gone, planets later
    if (early) {
      swarm(w, sun, 220, 0.5, 4.5, 11, { name: 'planetesimal', c1: 0x8a7a6a, e: 0.01, i: 0.6 });
      swarm(w, sun, 160, 0.6, 30, 12, { name: 'gas', gas: true, e: 0.01, i: 2.5 });
    } else {
      swarm(w, sun, 140, 2.1, 3.4, 13, { name: 'asteroid', c1: 0x8a7a6a, e: 0.1, i: 8 });
    }
    // the icy planetesimals out past the giants: what drives the instability, and the Kuiper belt after it
    swarm(w, sun, key === 'nice' || k < ERAS.findIndex(e => e.key === 'nice') ? 260 : 120, k > ERAS.findIndex(e => e.key === 'nice') ? 39 : 19, k > ERAS.findIndex(e => e.key === 'nice') ? 48 : 30, 14,
      { name: 'icy planetesimal', c1: 0x9ab0c0, e: 0.03, i: 2 });
    if (key === 'tack') this.mars(w, sun);
    if (key === 'impacts') this.embryos(w, sun);
    if (k >= ERAS.findIndex(e => e.key === 'theia')) this.planets(w, sun, key === 'theia');
    this.looks(w);
    this.schedule();
  }

  /** Mars: an embryo that formed fast and was left alone, out where the Grand Tack left little to build with */
  private mars(w: World, sun: Body) {
    const m = rocky('Mars', 0.107, marsLook(this.age), 3.93);
    circ(m, sun, 1.52, 1.8, 200, 0.05);
    m.heat = 0.3;
    w.add(m);
  }

  /**
   * after the gas: the embryos in the annulus the Grand Tack left (0.5–1.1 AU), the seeds of Mercury, Venus
   * and the Earth heaviest in their parts of it, and Mars on its own
   */
  private embryos(w: World, sun: Body) {
    if (!w.sources.some(b => b.name === 'Mars')) this.mars(w, sun);
    const list: [string, number, number][] = [
      ['Mercury', 0.11, 0.4], ['Embryo 1', 0.025, 0.47],
      ['Proto-Venus', 0.42, 0.7], ['Embryo 2', 0.2, 0.64], ['Embryo 3', 0.18, 0.78],
      ['Proto-Earth', 0.5, 1.0], ['Embryo 4', 0.22, 0.93], ['Embryo 5', 0.17, 1.08],
    ];
    for (const [name, m, a] of list) {
      const b = rocky(name, m, { style: 'lava', c1: 0x2a1c16, c2: 0xb0502a }, name === 'Mercury' ? 5.4 : 4.4);
      b.heat = 0.3;
      circ(b, sun, a, 2 * Math.random(), 360 * Math.random(), 0.02);
      w.add(b);
    }
  }

  /** the inner planets made; for the Theia era, the proto-Earth still short of Theia's mass and Theia at its Lagrange point */
  private planets(w: World, sun: Body, beforeTheia: boolean) {
    for (const name of ['Mercury', 'Venus', 'Mars']) {
      if (w.sources.some(b => b.name === name)) continue;
      const t = TODAY[name];
      const b = rocky(name, t.m, name === 'Mercury' ? { style: 'barren', c1: 0x5a5450, c2: 0xa09890 } : name === 'Venus' ? { style: 'desert', c1: 0xc8a060, c2: 0xf0dcb0, atmo: 0xf0e0c0 } : marsLook(this.age), name === 'Mercury' ? 5.43 : name === 'Venus' ? 5.24 : 3.93);
      circ(b, sun, t.a, 2 * Math.random(), 360 * Math.random(), t.e);
      w.add(b);
    }
    const E = rocky(beforeTheia ? 'Proto-Earth' : 'Earth', beforeTheia ? 0.89 : 1, {}, 5.51);
    const M0 = 360 * Math.random();
    circ(E, sun, 1, 0, M0, 0.02);
    w.add(E);
    if (beforeTheia) {
      this.theia = null;
      const T = rocky('Theia', 0.11, { style: 'desert', c1: 0x5a4a3e, c2: 0xa08060 }, 3.9);
      // at the Lagrange point 60° ahead, drifting
      circ(T, sun, 1.0005, 0.4, M0 + 60, 0.02);
      w.add(T);
    } else {
      this.theia = Math.min(this.age, ERAS.find(e => e.key === 'theia')!.at + 2);
      this.moonAt = this.theia;
      const moon = rocky('Moon', 0.0123, {}, 3.34);
      moon.source = true;
      const aRe = this.moonA(this.age);
      circ(moon, E, aRe * R_EARTH, 5, 360 * Math.random());
      w.add(moon);
      // the angular momentum of the pair is today's, so the day comes out at 24 hours now
      this.L = 0;
      this.spinFromL(E, moon);
    }
  }

  // ---------------------------------------------------------------- what happens when

  private schedule() {
    const theia = ERAS.find(e => e.key === 'theia')!.at;
    this.impacts = [
      // the embryos into planets: speeds a little over their mutual escape speed, as orbits that have only just come to cross
      { at: 8, target: 'Proto-Venus', by: 'Embryo 2', mass: 0, angle: 30, vinf: 3, note: 'An embryo strikes the proto-Venus', slow: 0.4 * HOUR },
      { at: 15, target: 'Proto-Earth', by: 'Embryo 4', mass: 0, angle: 40, vinf: 3, note: 'An embryo strikes the proto-Earth', slow: 0.4 * HOUR },
      { at: 22, target: 'Mercury', by: 'Embryo 1', mass: 0, angle: 35, vinf: 15, note: 'A hit-and-run: an embryo strips much of Mercury’s rocky mantle away, leaving its big iron core', slow: 0.3 * HOUR },
      { at: 30, target: 'Proto-Venus', by: 'Embryo 3', mass: 0, angle: 25, vinf: 4, note: 'Another embryo strikes the proto-Venus', slow: 0.4 * HOUR },
      { at: 40, target: 'Proto-Earth', by: 'Embryo 5', mass: 0, angle: 35, vinf: 3, note: 'Another embryo strikes the proto-Earth', slow: 0.4 * HOUR },
      { at: 45, target: 'Uranus', by: 'Uranus impactor', mass: 1.5, angle: 60, vinf: 6, polar: true, note: 'An Earth-and-a-half-mass body strikes Uranus a glancing blow, and knocks it onto its side', slow: 0.6 * HOUR },
      { at: theia + 2, target: 'Proto-Earth', by: 'Theia', mass: 0, angle: 45, vinf: 4, note: 'Theia strikes the proto-Earth', slow: 1.2 * HOUR },
      { at: 480, target: 'Mars', by: 'Hellas impactor', mass: 2e-6, angle: 40, vinf: 12, note: 'Hellas: a 400-kilometre asteroid strikes Mars and digs the deepest basin in the solar system', slow: 0.2 * HOUR },
      { at: 717, target: 'Moon', by: 'Imbrium impactor', mass: 1e-6, angle: 35, vinf: 15, note: 'Imbrium: a 250-kilometre asteroid strikes the Moon; lava will flood the basin, the Moon’s right eye', slow: 0.2 * HOUR },
      { at: 667, target: 'Mercury', by: 'Caloris impactor', mass: 6e-7, angle: 40, vinf: 20, note: 'Caloris: a 100-kilometre asteroid strikes Mercury, and the shock buckles the far side', slow: 0.2 * HOUR },
      { at: NOW - 66, target: 'Earth', by: 'Chicxulub impactor', mass: 2e-10, angle: 60, vinf: 20, note: 'Chicxulub: a ten-kilometre asteroid strikes what is now Mexico, and ends the age of the dinosaurs', slow: 0.05 * HOUR },
    ].map(i => ({ ...i, done: i.at < this.age })).sort((x, y) => x.at - y.at);
  }

  /** what is in it now, by name (the Earth is the Proto-Earth until Theia) */
  private find(w: World, name: string) {
    if (name === 'Earth' || name === 'Proto-Earth') return w.sources.find(b => b.alive && (b.name === 'Earth' || b.name === 'Proto-Earth')) ?? null;
    return w.bodies.find(b => b.alive && b.name === name) ?? null;
  }

  /**
   * set an impactor on its way in: from a dozen radii off, at speed v∞ (km/s) over the pair's escape speed,
   * to strike at `angle` from head-on (45° is the likeliest). Made (and named) if it is not there already.
   */
  private aim(w: World, T: Body, name: string, mEarths: number, angle: number, vinfKms: number, polar = false): Body | null {
    let P = this.find(w, name);
    if (!P) {
      if (mEarths <= 0) return null;
      P = rocky(name, mEarths, { style: 'barren', c1: 0x4a4038, c2: 0x8a7a68 }, mEarths < 1e-3 ? 2.5 : 3.5);
      P.source = mEarths > 1e-4;
      w.add(P);
    }
    const Mt = T.m + P.m, R = T.r + P.r;
    const vesc = Math.sqrt(2 * G * Mt / R), vinf = vinfKms * KMS;
    const L = R * Math.sin(angle * D2R) * Math.sqrt(vesc * vesc + vinf * vinf);
    const d0 = 6 * R;
    const v0 = Math.sqrt(vinf * vinf + 2 * G * Mt / d0);
    const vt = L / d0, vr = -Math.sqrt(Math.max(0, v0 * v0 - vt * vt));
    // in the plane of the target's orbit round the Sun, coming in from a random side; or, to knock a planet
    // over, down over its pole, so the blow's angular momentum lies across its spin
    const ph = 2 * Math.PI * Math.random();
    const ex: V3 = polar ? [0, 0, Math.random() < 0.5 ? 1 : -1] : [Math.cos(ph), Math.sin(ph), 0], ey: V3 = [-Math.sin(ph), Math.cos(ph), 0];
    P.setPos(T.x + ex[0] * d0, T.y + ex[1] * d0, T.z + ex[2] * d0 + (polar ? 0 : 0.02 * d0));
    P.setVel(T.vx + ex[0] * vr + ey[0] * vt, T.vy + ex[1] * vr + ey[1] * vt, T.vz + ex[2] * vr);
    w.moved(P);
    return P;
  }

  // ---------------------------------------------------------------- each frame

  /** the forces slower than gravity, inside the integrator's steps: migration, the disc's drag (dt in years) */
  drive(w: World, dt: number) {
    if (!(dt > 0)) return;
    const sun = w.sources.find(b => b.name === 'Sun');
    if (!sun) return;
    const key = this.current.key, age = this.age;
    for (const g of GIANTS) {
      const b = w.sources.find(q => q.alive && q.name === g.name);
      if (!b) continue;
      let aT: number | null = null, tau = 0;
      if (key === 'disc' || key === 'tack') {
        // the Grand Tack (Walsh et al. 2011): in to 1.5 AU by 0.7 Myr, Saturn following, then back out to the chain by 1.3 Myr
        const tIn = 0.6, tTurn = 0.7, tOut = 1.3;
        const inA = g.name === 'Jupiter' ? 1.5 : g.name === 'Saturn' ? 2.0 : g.a0;
        aT = age < tIn ? g.a0 : age < tTurn ? g.a0 + (inA - g.a0) * (age - tIn) / (tTurn - tIn) : age < tOut ? inA + (g.aChain - inA) * (age - tTurn) / (tOut - tTurn) : g.aChain;
        tau = 15;
      } else if (key === 'impacts' || key === 'theia' || (key === 'nice' && this.nice === 'chain')) {
        // held in the chain by the gas they formed in... and, once it has gone, by their resonances;
        // then the planetesimals outside nudge the outermost outward until the chain breaks
        aT = key === 'nice' && g.name === 'Neptune' ? g.aChain * (1 + 0.5 * Math.min(1, (w.time - this.niceT) / 1000)) : g.aChain;
        tau = key === 'nice' ? 300 : 200;
      } else if (key === 'nice' && this.nice === 'broken') {
        // scattering the planetesimal disc, the survivors are pulled out to where they are now and their orbits
        // damped round (dynamical friction): all but the fifth, left to Jupiter
        if (g.aNow) { aT = g.aNow; tau = 600; }
      }
      // (settling, their orbits are rounded only so far: the giants keep a few percent of eccentricity, as they have)
      if (aT !== null) steer(b, sun, aT, tau, dt, key === 'nice' && this.nice === 'broken' ? 0.06 : 0.5);
    }
    // the inner planets' orbits damped round by what is left of the planetesimals (dynamical friction): an
    // e-folding every ten million years of the system's age
    // (only while there is that debris about: through the giant impacts and the instability's scattering)
    if ((key === 'impacts' || key === 'theia' || (key === 'nice' && this.nice !== 'settled')) && this.current.pace > 0) {
      const tau = (key === 'nice' ? 40 : 10) / this.current.pace;
      const moon = w.sources.find(b => b.alive && b.name === 'Moon');
      for (const b of w.sources) {
        if (!b.alive || b.cls === 'star' || b.m > 5 * M_EARTH || b.m < 0.03 * M_EARTH || b.name === 'Theia' || b.name === 'Moon') continue;
        const { r, v, mu } = relative(b, sun);
        const o = osculating(mu, r, v);
        if (!(o.a > 0 && o.a < 3)) continue;
        // (the Earth and its Moon kicked together, or the kicks would pull the pair apart)
        const v0: V3 = [b.vx, b.vy, b.vz];
        steer(b, sun, o.a, tau, dt);
        if (moon && (b.name === 'Earth' || b.name === 'Proto-Earth')) { moon.vx += b.vx - v0[0]; moon.vy += b.vy - v0[1]; moon.vz += b.vz - v0[2]; }
      }
    }
  }

  /** each frame, after the step: the age, what happens next, the looks */
  private dtLast = 0;
  tick(w: World, dt: number) {
    this.dtLast = this.hold ? 0 : dt;
    const sun = w.sources.find(b => b.name === 'Sun');
    if (!sun) return;
    if (this.hold) {
      this.hold.t += dt;
      if (this.hold.until(w) || this.hold.t > this.hold.max) {
        const h = this.hold;
        this.hold = null;
        h.then?.();
        this.host.setWarp(this.current.warp);
      }
    } else if (this.current.pace > 0) {
      // (after the tack, nothing much until the gas goes: on faster)
      const key = this.current.key;
      const pace = key === 'tack' && this.age > 1.3 ? 0.02 : key === 'nice' && this.nice === 'settled' ? 2 : this.current.pace;
      this.age = Math.min(NOW, this.age + dt * pace);
    }
    // on into the next era when its time comes
    const next = ERAS[this.era + 1];
    if (next && this.age >= next.at && !this.hold) this.enter(w, this.era + 1, sun);
    sunAt(this.age, sun);
    this.grow(w, sun);
    this.events(w, sun);
    this.sweep(w, dt);
    this.moon(w);
    if (this.hold === null) this.looks(w);
    if (this.current.key === 'today' && !this.score) {
      this.score = scoreSystem(w);
      this.host.toast(`Today. This run of the solar system scores ${this.score.total.toFixed(0)}% against the real one`);
    }
  }

  /** the next era, played into from the last: its changes made to what is there */
  private enter(w: World, k: number, sun: Body) {
    this.era = k;
    const e = ERAS[k];
    this.host.toast(`${Early.ago(e.at)}: ${e.name}`);
    this.host.setWarp(e.warp);
    if (e.key === 'impacts') {
      // the gas is blown away by the Sun's wind and light, and the embryos are there to be seen
      for (const b of w.bodies) if (b.alive && b.cls === 'gasp' && b.name === 'gas') w.kill(b);
      this.embryos(w, sun);
    }
    if (e.key === 'theia' && !this.find(w, 'Theia')) {
      // Theia, grown at the Earth's Lagrange point: loaded as it becomes important
      const E = this.find(w, 'Proto-Earth');
      if (E) {
        const T = rocky('Theia', 0.11, { style: 'desert', c1: 0x5a4a3e, c2: 0xa08060 }, 3.9);
        const { r, v } = relative(E, sun);
        const c = Math.cos(60 * D2R), s = Math.sin(60 * D2R);
        T.setPos(sun.x + c * r[0] - s * r[1], sun.y + s * r[0] + c * r[1], sun.z + r[2]);
        T.setVel(sun.vx + c * v[0] - s * v[1], sun.vy + s * v[0] + c * v[1], sun.vz + v[2]);
        w.add(T);
      }
    }
    if (e.key === 'nice') { this.nice = 'chain'; this.niceT = w.time; }
    if (e.key === 'today') {
      // the names as they are now; the giants' rings as they are now
      for (const b of w.sources) {
        if (b.name === 'Proto-Earth') b.name = 'Earth';
        if (b.name === 'Proto-Venus') b.name = 'Venus';
        if (['Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Venus', 'Mercury'].includes(b.name)) b.look = { ...b.look, ...makePlanet(b.name).look };
      }
    }
  }

  /** Jupiter gathering its gas, then Saturn; the ice giants filling out */
  private grow(w: World, sun: Body) {
    const age = this.age;
    if (age > 2) return;
    for (const g of GIANTS) {
      const b = w.sources.find(q => q.alive && q.name === g.name);
      if (!b) continue;
      // runaway gas accretion: Jupiter from 0.2 to 0.6 Myr, Saturn 0.5 to 0.7, the ice giants slowly to 2 Myr
      const [t0, t1] = g.name === 'Jupiter' ? [0.2, 0.6] : g.name === 'Saturn' ? [0.5, 0.7] : [0.3, 2];
      const f = Math.max(0, Math.min(1, (age - t0) / (t1 - t0)));
      const m = 10 + (g.mEnd - 10) * f * f * (3 - 2 * f);
      if (Math.abs(m * M_EARTH - b.m) > 0.002 * b.m) {
        setMass(b, m);
        w.massChanged(b);
      }
    }
    void sun;
  }

  /** the scheduled impacts and the instability */
  private events(w: World, sun: Body) {
    if (this.hold) return;
    for (const imp of this.impacts) {
      if (imp.done || this.age < imp.at) continue;
      imp.done = true;
      const T = this.find(w, imp.target);
      if (!T) continue;
      const P = this.aim(w, T, imp.by, imp.mass, imp.angle, imp.vinf, imp.polar);
      if (!P) continue;
      this.host.toast(`${Early.ago(this.age)}: ${imp.note}`);
      // slowed right down to watch it, and on until it has hit and what it threw up has settled a little
      this.host.setWarp(imp.slow);
      const isTheia = imp.by === 'Theia';
      if (isTheia) this.theia = this.age;
      // (a few thousand pieces at most: enough for a ring to gather a Moon, few enough to keep it running)
      w.maxParticles = w.particleCount + (isTheia ? 4000 : 1200);
      const t0 = w.time;
      // (how long until they meet, near enough: a hit-and-run leaves the impactor going, so the hold ends on the clock)
      const meet = Math.hypot(P.x - T.x, P.y - T.y, P.z - T.z) / Math.max(1e-12, Math.hypot(P.vx - T.vx, P.vy - T.vy, P.vz - T.vz));
      this.hold = {
        t: 0, max: isTheia ? 20 * DAY : Math.min(DAY, 2 * meet + HOUR),
        until: ww => (!P.alive || ww.time - t0 > 1.5 * meet + 0.5 * HOUR) && (!isTheia || ww.time - t0 > 8 * DAY),
        then: () => { w.maxParticles = 25000; if (isTheia) this.afterTheia(w); else this.fallBack(w, T); },
      };
      if (isTheia) this.host.setWarp(2 * HOUR);
      return;
    }
    // the instability: when the chain breaks (two giants' orbits cross), the scattering is under way
    if (this.current.key === 'nice') {
      const gs = GIANTS.map(g => w.sources.find(b => b.alive && b.name === g.name)).filter((b): b is Body => !!b);
      const els = gs.map(b => osculating(G * (sun.m + b.m), [b.x - sun.x, b.y - sun.y, b.z - sun.z], [b.vx - sun.vx, b.vy - sun.vy, b.vz - sun.vz]));
      if (this.nice === 'chain') {
        let crossed = false;
        for (let i = 0; i < els.length; i++) for (let j = 0; j < els.length; j++) if (i !== j && els[i].a < els[j].a && els[i].ra > els[j].rp) crossed = true;
        if (crossed || w.time - this.niceT > 2500) {
          this.nice = 'broken';
          this.niceT = w.time;
          this.host.toast('The giants’ chain has broken: they are scattering each other, and the icy planetesimals with them');
        }
      } else if (this.nice === 'broken') {
        const five = w.sources.find(b => b.alive && b.name === 'Planet Five');
        if (five) {
          const o = osculating(G * (sun.m + five.m), [five.x - sun.x, five.y - sun.y, five.z - sun.z], [five.vx - sun.vx, five.vy - sun.vy, five.vz - sun.vz]);
          const r = Math.hypot(five.x - sun.x, five.y - sun.y, five.z - sun.z);
          if (!(o.a > 0) && r > 60 || r > 400) {
            this.host.toast('Planet Five has been flung out of the solar system, into the dark between the stars');
            w.kill(five);
          } else {
            const J = w.sources.find(b => b.alive && b.name === 'Jupiter');
            const dJ = J ? Math.hypot(five.x - J.x, five.y - J.y, five.z - J.z) : Infinity;
            if (J && dJ < 0.36 && o.a > 0) {
              // a close pass by Jupiter, within its Hill sphere: it is slung out at more than the Sun's escape
              // speed there, and Jupiter, kicked the other way, loses as much momentum and drops inward (the
              // "jumping Jupiter" that spared the inner planets)
              const ve = Math.sqrt(2 * G * sun.m / Math.max(1e-6, r)) * 1.05;
              const v: V3 = [five.vx - sun.vx, five.vy - sun.vy, five.vz - sun.vz], vl = Math.hypot(...v) || 1;
              const nv: V3 = [v[0] / vl * ve, v[1] / vl * ve, v[2] / vl * ve], k = five.m / J.m;
              J.vx -= (nv[0] - v[0]) * k; J.vy -= (nv[1] - v[1]) * k; J.vz -= (nv[2] - v[2]) * k;
              five.setVel(sun.vx + nv[0], sun.vy + nv[1], sun.vz + nv[2]);
              w.moved(five); w.moved(J);
              this.host.toast('Planet Five passes close by Jupiter and is slung out of the solar system; Jupiter, kicked the other way, jumps inward');
            } else if (w.time - this.niceT > 2500 && J) {
              // still hanging on: the scattering brings its orbit to graze Jupiter's, sooner or later
              const rJ = Math.hypot(J.x - sun.x, J.y - sun.y, J.z - sun.z), rp = Math.min(rJ, r * 0.98);
              const v: V3 = [five.vx - sun.vx, five.vy - sun.vy, five.vz - sun.vz], ru: V3 = [(five.x - sun.x) / r, (five.y - sun.y) / r, (five.z - sun.z) / r];
              const vr = v[0] * ru[0] + v[1] * ru[1] + v[2] * ru[2];
              const tv: V3 = [v[0] - vr * ru[0], v[1] - vr * ru[1], v[2] - vr * ru[2]], tl = Math.hypot(...tv) || 1;
              // (from here, as its aphelion, the speed that brings it in to Jupiter's distance)
              const vt = Math.sqrt(2 * G * sun.m * rp / (r * (r + rp)));
              five.setVel(sun.vx + tv[0] / tl * vt, sun.vy + tv[1] / tl * vt, sun.vz + tv[2] / tl * vt);
              w.moved(five);
              this.niceT = w.time - 1000;
            }
          }
        }
        if (!five && w.time - this.niceT > 1500) {
          this.nice = 'settled';
          this.age = Math.max(this.age, ERAS.find(e => e.key === 'nice')!.at + 60);
        }
      }
    }
    // milestones, said once
    // (only what happens while you watch: not what an era jumped to was already past)
    const say = (key: string, at: number, msg: string) => { if (this.age >= at && !this.said.has(key)) { this.said.add(key); if (at > this.from) this.host.toast(`${Early.ago(at)}: ${msg}`); } };
    say('ms', 30, 'The Sun settles onto the main sequence, burning hydrogen; for now it gives 70% of today’s light');
    say('ocean', 167, 'The Earth has cooled enough for oceans (zircons this old say liquid water)');
    say('life', 767 + 300, 'Life: mats of microbes in the shallows, layering stromatolites');
    say('mars', 1067, 'Mars has lost most of its air and water to space: its rivers and lakes are gone');
    say('oxygen', 2167, 'The Great Oxidation: cyanobacteria have filled the air with oxygen');
    say('snow', 3850, 'Snowball Earth: ice almost from pole to pole');
    say('thaw', 3932, 'The ice melts back; soon after, the first animals');
    say('cambrian', 4029, 'The Cambrian explosion: most animal body plans appear within twenty million years');
    say('pangaea', 4232, 'The continents gather into Pangaea');
  }

  /**
   * what impacts threw out round the Sun (moonlets, debris) is swept up by the planets over a few million years:
   * taken in, a little at a time, by the planet nearest it
   */
  private sweep(w: World, dt: number) {
    if (this.hold || this.current.pace <= 0) return;
    const dAge = dt * this.current.pace;
    if (!(dAge > 0)) return;
    const p = 1 - Math.exp(-dAge / 2);
    const planets = w.sources.filter(b => b.alive && b.cls !== 'star' && b.m > 0.03 * M_EARTH && b.name !== 'moonlet');
    for (const b of w.bodies) {
      if (!b.alive || (b.name !== 'moonlet' && b.name !== 'debris' && b.name !== 'fragment') || b.m > 0.01 * M_EARTH) continue;
      // (not the ring round the Earth that the Moon is gathering from: that is the Moon's business)
      if (Math.random() > p) continue;
      let best: Body | null = null, bd = Infinity;
      for (const q of planets) { const d = Math.hypot(q.x - b.x, q.y - b.y, q.z - b.z); if (d < bd) { bd = d; best = q; } }
      // (the ring round the Earth is left to gather its Moon)
      if (best && (best.name === 'Earth' || best.name === 'Proto-Earth') && bd < 0.002) continue;
      if (best) { best.m += b.m; w.massChanged(best); }
      w.kill(b);
    }
  }

  /** after an impact (Theia's apart): what it threw up round the planet falls back onto it, or is swept up */
  private fallBack(w: World, T: Body) {
    if (!T.alive) return;
    let n = 0;
    for (const b of w.bodies) {
      if (!b.alive || b.source && b.name !== 'moonlet' || !(b.name === 'debris' || b.name === 'fragment' || b.name === 'moonlet' || b.cls === 'gasp')) continue;
      if (Math.hypot(b.x - T.x, b.y - T.y, b.z - T.z) > 0.02) continue;
      T.m += b.m;
      w.kill(b);
      n++;
    }
    if (n) { w.massChanged(T); w.structural(); }
  }

  /** after Theia: the Moon is the biggest body that has gathered round the Earth; its orbit and the day's length budgeted from now */
  private afterTheia(w: World) {
    const E = this.find(w, 'Proto-Earth');
    if (!E) return;
    E.name = 'Earth';
    const m = biggestRound(w, E);
    if (m) {
      m.name = 'Moon';
      m.source = true;
      // the tides it raises round its orbit off quickly, just outside where they would tear it apart
      const { r, v, mu } = relative(m, E), o = osculating(mu, r, v);
      const aC = Math.max(o.a > 0 ? o.a : 0, 4 * R_EARTH), hn = Math.hypot(...o.h) || 1;
      const nrm: V3 = [o.h[0] / hn, o.h[1] / hn, o.h[2] / hn], rn = Math.hypot(...r);
      const ru: V3 = [r[0] / rn, r[1] / rn, r[2] / rn], tu: V3 = [nrm[1] * ru[2] - nrm[2] * ru[1], nrm[2] * ru[0] - nrm[0] * ru[2], nrm[0] * ru[1] - nrm[1] * ru[0]];
      const vc = Math.sqrt(mu / aC);
      m.setPos(E.x + ru[0] * aC, E.y + ru[1] * aC, E.z + ru[2] * aC);
      m.setVel(E.vx + tu[0] * vc, E.vy + tu[1] * vc, E.vz + tu[2] * vc);
      w.structural();
      this.moonAt = this.age;
      this.host.toast(`A Moon has gathered from the ring round the Earth: ${(m.m / (0.0123 * M_EARTH) * 100).toFixed(0)}% of the real one’s mass. The rest of the debris is falling back`);
      this.L = 0;
    } else { this.moonAt = this.age; this.host.toast('No Moon gathered this time: the debris is falling back to the Earth'); }
  }

  /** the Moon's orbit as the tides push it out (constant-Q: a^13/2 grows with time), the Earth's spin slowing to pay for it */
  private moonA(age: number) {
    const since = Math.max(1e-6, age - (this.moonAt ?? age));
    // 60.3 Earth radii today, 4.5 billion years after it formed; nearer 4 when it gathered
    return Math.max(4, 60.3 * Math.pow(since / (NOW - (this.moonAt ?? 60)), 2 / 13));
  }

  private moon(w: World) {
    const E = this.find(w, 'Earth'), M = w.bodies.find(b => b.alive && b.name === 'Moon') ?? null;
    if (!E || this.moonAt === null || this.hold) return;
    // the rest of the ring rains back onto the Earth over the next few thousand years
    if (this.age - this.moonAt < 5) {
      // (debris, vapour and the moonlets that did not join the Moon alike)
      let fell = false;
      for (const p of w.bodies) {
        if (!p.alive || p === E || p === M || !(p.cls === 'debris' || p.cls === 'gasp' || p.name === 'moonlet')) continue;
        if (Math.hypot(p.x - E.x, p.y - E.y, p.z - E.z) < 300 * E.r && Math.random() < 0.05) { E.m += p.m; w.kill(p); fell = true; }
      }
      if (fell) w.massChanged(E);
    }
    if (!M) return;
    const { r, v, mu } = relative(M, E);
    const o = osculating(mu, r, v);
    if (!(o.a > 0)) return;
    // (the tides it raises damp its orbit round, as they push it out: an e-folding every twenty million years)
    const kd = Math.min(1, (this.dtLast * this.current.pace) / 20);
    if (kd > 0 && o.e > 0.06) {
      const rn = Math.hypot(...r), vr = (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / rn;
      M.vx -= (r[0] / rn) * vr * kd; M.vy -= (r[1] / rn) * vr * kd; M.vz -= (r[2] / rn) * vr * kd;
    }
    const want = Math.max(o.a, this.moonA(this.age) * R_EARTH);
    if (want > o.a * 1.0005) {
      const k = want / o.a, kv = 1 / Math.sqrt(k);
      M.setPos(E.x + r[0] * k, E.y + r[1] * k, E.z + r[2] * k);
      M.setVel(E.vx + v[0] * kv, E.vy + v[1] * kv, E.vz + v[2] * kv);
      w.moved(M);
    }
    this.spinFromL(E, M);
  }

  /** the Earth's spin from the angular momentum it shares with the Moon: as the Moon goes out, the day grows */
  private spinFromL(E: Body, M: Body) {
    const R = E.r, I = 0.33 * E.m * R * R;
    const { r, v } = relative(M, E);
    // (the pair's orbital angular momentum, about their barycentre)
    const h = Math.hypot(r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]);
    const orb = (E.m * M.m / (E.m + M.m)) * h;
    if (!this.L) {
      // budgeted on today's: a 24-hour day with the Moon at 60.3 Earth radii
      const w0 = (2 * Math.PI) / (23.934 * HOUR), a0 = 60.3 * R_EARTH;
      this.L = I * w0 + (E.m * M.m / (E.m + M.m)) * Math.sqrt(G * (E.m + M.m) * a0);
    }
    const spin = (this.L - orb) / I;
    if (spin > 0) E.spin = spin;
  }

  /** each world's face at the system's age */
  private looks(w: World) {
    for (const b of w.sources) {
      let l: (Partial<Look> & { heat: number }) | null = null;
      if (b.name === 'Earth' || b.name === 'Proto-Earth') l = earthLook(this.age, this.theia);
      else if (b.name === 'Mars') l = marsLook(this.age);
      else if (b.name === 'Moon') l = moonLook(this.age, this.moonAt ?? this.age);
      else if (b.name === 'Mercury' || b.name === 'Venus') l = this.age < 40 ? { style: 'lava', c1: 0x2a1c16, c2: 0xb0502a, heat: 0.2 } : null;
      if (!l) continue;
      const { heat, ...look } = l;
      const nl = { ...b.look, ...look } as Look;
      if (nl.style !== b.look.style || nl.c1 !== b.look.c1 || nl.c2 !== b.look.c2 || nl.real !== b.look.real || nl.atmo !== b.look.atmo) b.look = nl;
      b.heat = heat;
    }
  }

  /** jump: to an era as the textbooks have it; or, already in it or past it, rebuilt */
  jump(w: World, k: number) {
    this.build(w, k);
    this.host.setWarp(ERAS[k].warp);
    this.host.toast(`${Early.ago(ERAS[k].at)}: ${ERAS[k].name}`);
  }

  /** what comes next, for the readout */
  next(): string {
    if (this.hold) return 'in slow motion';
    const imp = this.impacts.find(i => !i.done && i.at >= this.age);
    const e = ERAS[this.era + 1];
    const t = Math.min(imp?.at ?? Infinity, e?.at ?? Infinity);
    if (!isFinite(t)) return '';
    const what = imp && imp.at <= (e?.at ?? Infinity) ? (imp.by === 'Theia' ? 'Theia strikes' : imp.note.split(':')[0].split(',')[0]) : e!.name;
    const dMy = t - this.age;
    return `${what} in ${dMy >= 1 ? `${dMy.toFixed(dMy >= 100 ? 0 : 1)} Myr` : `${Math.round(dMy * 1e6).toLocaleString('en-US')} yr`}`;
  }
}

/**
 * push a body's orbit toward semi-major axis `aT` over `tau` years, and damp its eccentricity (and tilt)
 * likewise: a tangential kick for the size, a radial and vertical drag for the shape
 */
function steer(b: Body, sun: Body, aT: number, tau: number, dt: number, damp = 0.5) {
  const { r, v, mu } = relative(b, sun);
  const o = osculating(mu, r, v);
  if (!(o.a > 0)) return;
  const rn = Math.hypot(...r), k = Math.min(1, dt / tau);
  const vt = Math.hypot(...v);
  const t: V3 = [v[0] / vt, v[1] / vt, v[2] / vt];
  // da = 2a²v·dv/μ, so the speed change that moves a by a fraction of the gap
  const dv = (k * (aT - o.a) * mu) / (2 * o.a * o.a * vt);
  const ru: V3 = [r[0] / rn, r[1] / rn, r[2] / rn];
  const vr = v[0] * ru[0] + v[1] * ru[1] + v[2] * ru[2];
  b.vx += t[0] * dv - ru[0] * vr * k * damp; b.vy += t[1] * dv - ru[1] * vr * k * damp; b.vz += t[2] * dv - ru[2] * vr * k * damp - v[2] * k * 0.4 * damp;
}

void KM;
