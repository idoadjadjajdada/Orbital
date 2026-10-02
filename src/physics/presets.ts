import { Body } from './body';
import { World } from './world';
import { makeBody, refreshRoche } from './catalog';
import { G, KM, M_EARTH, M_JUP, DAY, HOUR, R_EARTH, R_JUP, KMS, MSUN_KG, schwarzschild, radiusFromDensity } from './units';
import { stateFromElements, elementsDeg, type Elements } from './orbit';
import { newStar, structure, teffOf } from './stellar';
import { addPlanetSystem, makePlanet, planetHelio, setAxis } from './solarsystem';
import { lagrangePoints } from './analysis';
import { placeExtras } from './extras';




export interface PresetInfo {
  key: string;
  group: 'Solar System' | 'Exoplanets' | 'Events';
  name: string;
  blurb: string;
  /** suggested clock, years per real second */
  warp: number;
  /** suggested view radius, AU */
  view: number;
  focus: string;
}

const RS = 0.00465047; // AU per solar radius

export const PRESETS: PresetInfo[] = [
  { key: 'solar', group: 'Solar System', name: 'Solar system', blurb: 'Every planet at its J2000 position, all 460 known moons, dwarf planets, the main and Kuiper belts.', warp: 0.1, view: 6, focus: 'Sun' },
  { key: 'inner', group: 'Solar System', name: 'Inner solar system', blurb: 'Mercury to Mars with their moons, and the main belt.', warp: 0.1, view: 2, focus: 'Sun' },
  { key: 'outer', group: 'Solar System', name: 'Outer solar system', blurb: 'Jupiter to Pluto, every moon, and the Kuiper belt.', warp: 2, view: 35, focus: 'Sun' },
  { key: 'earth', group: 'Solar System', name: 'Earth', blurb: 'The Moon, the ISS, Hubble, GPS and geostationary satellites, and JWST at L2.', warp: 3 * HOUR, view: 0.003, focus: 'Earth' },
  { key: 'jupiter', group: 'Solar System', name: 'Jupiter', blurb: 'Jupiter, its faint rings, and all 115 moons in the JPL table.', warp: 2 * DAY, view: 0.02, focus: 'Jupiter' },
  { key: 'saturn', group: 'Solar System', name: 'Saturn', blurb: 'Saturn, its rings, and all 291 known moons.', warp: 2 * DAY, view: 0.012, focus: 'Saturn' },
  { key: 'uranus', group: 'Solar System', name: 'Uranus', blurb: 'Lying on its side, its rings and moons with it.', warp: 2 * DAY, view: 0.006, focus: 'Uranus' },
  { key: 'neptune', group: 'Solar System', name: 'Neptune', blurb: 'Triton going backwards, Nereid on a wild ellipse.', warp: 3 * DAY, view: 0.004, focus: 'Neptune' },
  { key: 'pluto', group: 'Solar System', name: 'Pluto and Charon', blurb: 'A double world circling a point in empty space, four small moons round both.', warp: 2 * DAY, view: 0.0007, focus: 'Pluto' },
  { key: 'trappist', group: 'Exoplanets', name: 'TRAPPIST-1', blurb: 'Seven Earths round an ultracool dwarf, chained in resonance.', warp: 0.02, view: 0.08, focus: 'TRAPPIST-1' },
  { key: 'kepler16', group: 'Exoplanets', name: 'Kepler-16', blurb: 'A Saturn with two suns — the first circumbinary planet found by transit.', warp: 0.1, view: 1.1, focus: 'Kepler-16 A' },
  { key: 'hr8799', group: 'Exoplanets', name: 'HR 8799', blurb: 'Four young super-Jupiters, directly imaged, in a near 1:2:4:8 chain.', warp: 20, view: 90, focus: 'HR 8799' },
  { key: 'cnc55', group: 'Exoplanets', name: '55 Cancri', blurb: 'A lava world on an 18-hour orbit, and four giants further out.', warp: 0.3, view: 7, focus: '55 Cancri A' },
  { key: 'kepler90', group: 'Exoplanets', name: 'Kepler-90', blurb: 'Eight planets — as many as ours — packed inside an Earth orbit.', warp: 0.1, view: 1.3, focus: 'Kepler-90' },
  { key: 'proxima', group: 'Exoplanets', name: 'Proxima Centauri', blurb: 'The nearest star and its two small planets.', warp: 0.02, view: 0.07, focus: 'Proxima Centauri' },
  { key: 'theia', group: 'Events', name: 'Theia', blurb: 'A Mars-sized world grazes the proto-Earth. A disc of debris and rock vapour forms, and over a few weeks a Moon gathers in it.', warp: 3 * HOUR, view: 0.0008, focus: 'Proto-Earth' },
  { key: 'ringmaker', group: 'Events', name: 'Making a ring', blurb: 'An icy moon on an orbit that dips inside its giant’s Roche limit.', warp: 2 * DAY, view: 0.004, focus: 'Giant' },
  { key: 'xrb', group: 'Events', name: 'Black hole binary', blurb: 'A star overflowing onto a black hole: a stream, a disc, and jets.', warp: 2 * DAY, view: 0.18, focus: 'Black hole' },
  { key: 'merger', group: 'Events', name: 'Black holes merging', blurb: 'Two 30-sun black holes, minutes from merging.', warp: 2e-6, view: 3e-4, focus: 'BH A' },
  { key: 'sgra', group: 'Events', name: 'Sagittarius A*', blurb: 'Four million suns, the S-stars, and a star on its way in.', warp: 0.02, view: 200, focus: 'Sgr A*' },
  { key: 'tde', group: 'Events', name: 'Star torn apart', blurb: 'A Sun-like star dives past a million-sun black hole: spaghettified into a stream, half of it falling back into a disc.', warp: 0.002, view: 3, focus: 'Black hole' },
  { key: 'spaghetti', group: 'Events', name: 'Spaghettification', blurb: 'Two Earths on eccentric orbits round a 10-sun black hole: one grazes the tidal limit and is stripped, one dives deep and is shredded.', warp: 1e-4, view: 0.03, focus: 'Black hole' },
  { key: 'quasar', group: 'Events', name: 'Quasar', blurb: 'A hundred-million-sun hole in a ring of hot gas, stars on wide orbits, one on its way to be torn apart.', warp: 1, view: 2500, focus: 'Quasar' },
  { key: 'kirkwood', group: 'Events', name: 'Kirkwood gaps', blurb: '3,000 asteroids, Mars, Jupiter and Saturn. Gaps open where the periods resonate.', warp: 30, view: 6, focus: 'Sun' },
];

const D2R = Math.PI / 180;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function hashName(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

type Kin = { x: number; y: number; z: number; vx: number; vy: number; vz: number };
function place(b: Body, host: Kin | null, el: Elements, mHost: number) {
  const { r, v } = stateFromElements(G * (mHost + b.m), el);
  const h = host ?? { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  b.setPos(h.x + r[0], h.y + r[1], h.z + r[2]);
  b.setVel(h.vx + v[0], h.vy + v[1], h.vz + v[2]);
  return b;
}

function world(key: string, name: string, m: number, rKm: number, dayHours: number, look?: Partial<Body['look']>) {
  const b = makeBody(key, hashName(name), name);
  b.m = m;
  if (rKm > 0) b.r = rKm * KM;
  b.spin = (2 * Math.PI) / (dayHours * HOUR);
  if (look) b.look = { ...b.look, ...look };
  refreshRoche(b);
  return b;
}

function star(key: string, name: string, m0: number, ageFrac: number) {
  const b = makeBody(key, hashName(name), name);
  b.star = newStar(m0, ageFrac);
  const st = structure(b.star);
  b.m = st.m; b.r = st.r; b.star.L = st.L; b.star.teff = teffOf(st.L, st.r);
  refreshRoche(b);
  return b;
}

/** Move everything into the centre-of-momentum frame. */
function barycentric(bodies: Body[]) {
  let m = 0, x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0;
  for (const b of bodies) { m += b.m; x += b.m * b.x; y += b.m * b.y; z += b.m * b.z; vx += b.m * b.vx; vy += b.m * b.vy; vz += b.m * b.vz; }
  for (const b of bodies) { b.x -= x / m; b.y -= y / m; b.z -= z / m; b.vx -= vx / m; b.vy -= vy / m; b.vz -= vz / m; }
}

/** semi-major axis from an orbital period */
const aFromP = (Mhost: number, m: number, Pdays: number) => Math.cbrt(G * (Mhost + m) * (Pdays * DAY / (2 * Math.PI)) ** 2);

// ------------------------------------------------------------ our system

function sun(w: World) {
  const s = makeBody('sun', 7, 'Sun');
  w.add(s);
  return s;
}

function belt(w: World, host: Body, n: number, aMin: number, aMax: number, seed: number, name = 'asteroid', eSig = 0.07, iSig = 8) {
  const r = rng(seed);
  for (let k = 0; k < n; k++) {
    const p = new Body({ name, kind: 'fragment', cls: 'debris', source: false, spin: 0,
      look: { style: 'rocky', seed: k, c1: name === 'asteroid' ? 0x8a7a6a : 0x8aa0b4, c2: 0x8a7a6a }, m: 1e-15, r: 10 * KM });
    const a = aMin + (aMax - aMin) * r();
    const g = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
    const e = Math.min(0.3, Math.abs(eSig * g()));
    const i = Math.abs(iSig * g());
    place(p, host, elementsDeg(a, e, i, 360 * r(), 360 * r(), 360 * r()), host.m);
    w.add(p);
  }
}

function dwarfPlanets(w: World, s: Body, inner: boolean, outer: boolean) {
  // J2000 elements from the JPL small-body database: a, e, i, Ω, ω, M, mass kg, radius km
  const D: [string, string, number, number, number, number, number, number, number, number][] = [
    ['Ceres', 'dwarf', 2.7675, 0.0758, 10.59, 80.31, 73.6, 95.99, 9.3835e20, 469.7],
    ['Vesta', 'asteroid', 2.3615, 0.0887, 7.14, 103.81, 151.2, 205.55, 2.59076e20, 262.7],
    ['Pallas', 'asteroid', 2.7724, 0.2306, 34.84, 173.08, 310.05, 78.2, 2.04e20, 256],
    ['Hygiea', 'asteroid', 3.1415, 0.1125, 3.83, 283.2, 312.3, 194.1, 8.74e19, 217],
    ['Eris', 'dwarf', 67.78, 0.4407, 44.04, 35.95, 151.64, 204.16, 1.6466e22, 1163],
    ['Haumea', 'dwarf', 43.13, 0.1913, 28.21, 121.79, 239.08, 218.2, 4.006e21, 816],
    ['Makemake', 'dwarf', 45.43, 0.1559, 29.01, 79.62, 294.83, 165.5, 3.1e21, 715],
  ];
  for (const [name, look, a, e, i, node, peri, M, kg, rkm] of D) {
    if ((a < 5 && !inner) || (a > 5 && !outer)) continue;
    const b = makeBody(look, hashName(name), name);
    b.m = kg / MSUN_KG; b.r = rkm * KM;
    if (name === 'Ceres') b.look = { ...b.look, style: 'barren', c1: 0x5a5856, c2: 0x8a8682 };
    if (a > 5) b.look = { ...b.look, style: 'ice', c1: 0x9a8a80, c2: 0xf0ebe6 };
    refreshRoche(b);
    place(b, s, elementsDeg(a, e, i, node, peri, M), s.m);
    w.add(b);
  }
}

function solarSystem(w: World, planets: string[], extras: { mainBelt?: number; kuiper?: number }) {
  const s = sun(w);
  for (const p of planets) addPlanetSystem(w, p, s.m);
  dwarfPlanets(w, s, !!extras.mainBelt, !!extras.kuiper);
  if (extras.mainBelt) belt(w, s, extras.mainBelt, 2.1, 3.3, 11);
  if (extras.kuiper) {
    // plutinos in the 3:2 with Neptune, and the cold classical belt beyond
    belt(w, s, Math.round(extras.kuiper * 0.3), 39.2, 39.7, 21, 'Kuiper belt object', 0.15, 10);
    belt(w, s, Math.round(extras.kuiper * 0.7), 42, 47.5, 23, 'Kuiper belt object', 0.05, 3);
  }
  barycentric(w.bodies);
}

const ALL = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];

function planetPreset(w: World, name: string) {
  const s = sun(w);
  addPlanetSystem(w, name, s.m);
  barycentric(w.bodies);
}

/** Earth with the Moon and a few of the machines we have put round it. */
function earth(w: World) {
  const s = sun(w);
  const e = addPlanetSystem(w, 'Earth', s.m)[0];
  // name, altitude km, inclination to the equator, node, phase
  const sats: [string, number, number, number, number][] = [
    ['ISS', 420, 51.64, 30, 0], ['Tiangong', 390, 41.47, 140, 90], ['Hubble', 540, 28.47, 250, 200],
    ['GPS IIF-1', 20180, 55, 0, 0], ['GPS IIF-2', 20180, 55, 60, 60], ['GPS IIF-3', 20180, 55, 120, 120],
    ['GPS IIF-4', 20180, 55, 180, 180], ['GPS IIF-5', 20180, 55, 240, 240], ['GPS IIF-6', 20180, 55, 300, 300],
    ['GOES-16', 35786, 0.05, 0, 75], ['Meteosat-11', 35786, 0.05, 0, 175], ['Himawari-9', 35786, 0.05, 0, 300],
  ];
  // satellite orbits are set against the equator, tilted 23.44° to the ecliptic
  const ob = 23.4392911 * D2R;
  const rot = (v: number[]) => [v[0], Math.cos(ob) * v[1] - Math.sin(ob) * v[2], Math.sin(ob) * v[1] + Math.cos(ob) * v[2]];
  for (const [name, alt, inc, node, ph] of sats) {
    const craft = name === 'ISS' || name === 'Tiangong' ? 'station' as const : name === 'Hubble' ? 'telescope' as const : 'sat' as const;
    const b = new Body({ name, kind: 'satellite', cls: 'rock', m: 1e4 / MSUN_KG, r: 0.02 * KM, source: false, spin: 0.1,
      look: { style: 'iron', seed: hashName(name), c1: 0xb0b4b8, c2: 0xe0e4e8, craft } });
    const st = stateFromElements(G * e.m, elementsDeg((6378 + alt) * KM, 0.0005, inc, node, 0, ph));
    const r = rot(st.r), v = rot(st.v);
    b.setPos(e.x + r[0], e.y + r[1], e.z + r[2]);
    b.setVel(e.vx + v[0], e.vy + v[1], e.vz + v[2]);
    w.add(b);
  }
  // JWST rides the Sun–Earth L2 point, 1.5 million km out, turning with the pair
  const L2 = lagrangePoints(e, s)[1];
  const jw = new Body({ name: 'JWST', kind: 'satellite', cls: 'rock', m: 6200 / MSUN_KG, r: 0.01 * KM, source: false, spin: 0.01,
    look: { style: 'iron', seed: 3, c1: 0xc8a040, c2: 0xffd870, craft: 'mirror' } });
  const rx = e.x - s.x, ry = e.y - s.y, rz = e.z - s.z, ux = e.vx - s.vx, uy = e.vy - s.vy, uz = e.vz - s.vz;
  const d2 = rx * rx + ry * ry + rz * rz;
  const wx = (ry * uz - rz * uy) / d2, wy = (rz * ux - rx * uz) / d2, wz = (rx * uy - ry * ux) / d2;
  const ox = L2[0] - s.x, oy = L2[1] - s.y, oz = L2[2] - s.z;
  jw.setPos(L2[0], L2[1], L2[2]);
  jw.setVel(s.vx + wy * oz - wz * oy, s.vy + wz * ox - wx * oz, s.vz + wx * oy - wy * ox);
  w.add(jw);
  barycentric(w.bodies);
}

// ------------------------------------------------------------ exoplanets

function trappist(w: World) {
  const st = star('reddwarf', 'TRAPPIST-1', 0.0898, 0.0007);
  w.add(st);
  // Agol et al. (2021): period in days, mass and radius in Earths
  const P: [string, number, number, number, string][] = [
    ['b', 1.510826, 1.374, 1.116, 'lava'], ['c', 2.421937, 1.308, 1.097, 'desert'], ['d', 4.049219, 0.388, 0.788, 'ocean'],
    ['e', 6.101013, 0.692, 0.92, 'terran'], ['f', 9.20754, 1.039, 1.045, 'ocean'], ['g', 12.352446, 1.321, 1.129, 'iceworld'],
    ['h', 18.772866, 0.326, 0.755, 'iceworld'],
  ];
  const lam = [0, 147, 289, 71, 222, 18, 196];
  P.forEach(([n, per, m, rr, look], k) => {
    const b = world(look, `TRAPPIST-1${n}`, m * M_EARTH, rr * R_EARTH / KM, 24 * per);
    place(b, st, elementsDeg(aFromP(st.m, b.m, per), 0.005, 0, 0, 0, lam[k]), st.m);
    w.add(b);
  });
  barycentric(w.bodies);
}

function kepler16(w: World) {
  // Doyle et al. (2011)
  const A = star('reddwarf', 'Kepler-16 A', 0.6897, 0.4);
  const B = star('reddwarf', 'Kepler-16 B', 0.20255, 0.04);
  A.m = 0.6897; B.m = 0.20255; A.r = 0.6489 * RS; B.r = 0.22623 * RS;
  const Mb = A.m + B.m;
  const rel = stateFromElements(G * Mb, elementsDeg(aFromP(A.m, B.m, 41.07922), 0.15944, 0, 0, 263.464, 0));
  const fA = B.m / Mb, fB = A.m / Mb;
  A.setPos(-fA * rel.r[0], -fA * rel.r[1], 0); A.setVel(-fA * rel.v[0], -fA * rel.v[1], 0);
  B.setPos(fB * rel.r[0], fB * rel.r[1], 0); B.setVel(fB * rel.v[0], fB * rel.v[1], 0);
  w.add(A); w.add(B);
  const p = world('saturn', 'Kepler-16 b', 0.333 * M_JUP, 0.7538 * R_JUP / KM, 12, { rings: undefined, c1: 0xa89070, c2: 0xe0d0b0 });
  place(p, null, elementsDeg(aFromP(Mb, p.m, 228.776), 0.0069, 0.3, 0, 318, 120), Mb);
  w.add(p);
  barycentric(w.bodies);
}

function hr8799(w: World) {
  // Marois et al. (2008, 2010); masses from Wang et al. (2018)
  const s = star('astar', 'HR 8799', 1.47, 0.03);
  w.add(s);
  const P: [string, number, number, number][] = [['e', 16.4, 7.2, 0], ['d', 26.7, 7.2, 110], ['c', 42.8, 7.2, 230], ['b', 68.0, 5.8, 330]];
  for (const [n, a, mj, M] of P) {
    const b = world('jupiter', `HR 8799 ${n}`, mj * M_JUP, 1.2 * R_JUP / KM, 10, { style: 'browndwarf', c1: 0x401818, c2: 0xb04828 });
    place(b, s, elementsDeg(a, 0.05, 0, 0, 0, M), s.m);
    w.add(b);
  }
  barycentric(w.bodies);
}

function cnc55(w: World) {
  // Bourrier et al. (2018); the giants' masses are minimum masses
  const s = star('sun', '55 Cancri A', 0.905, 0.85);
  w.add(s);
  const P: [string, number, number, number, string, number][] = [
    ['e', 0.7365417, 7.99, 1.875, 'lava', 0.05], ['b', 14.6516, 0.8306 * 317.8, 13, 'hotjupiter', 0.0],
    ['c', 44.3989, 0.1714 * 317.8, 7, 'icegiant', 0.03], ['f', 259.88, 0.1503 * 317.8, 7, 'icegiant', 0.08],
    ['d', 5574.2, 3.878 * 317.8, 12, 'jupiter', 0.13],
  ];
  P.forEach(([n, per, me, re, look, e], k) => {
    const b = world(look, `55 Cancri ${n}`, me * M_EARTH, re * R_EARTH / KM, 20);
    b.sizeGuess = n !== 'e';
    if (n === 'e') b.heat = 1;
    place(b, s, elementsDeg(aFromP(s.m, b.m, per), e, 0, 0, 40 * k, 70 * k), s.m);
    w.add(b);
  });
  barycentric(w.bodies);
}

function kepler90(w: World) {
  // Cabrera et al. (2014), Shallue & Vanderburg (2018). Only g and h have measured
  // masses (Liang et al. 2021); the rest come from the Chen & Kipping mass–radius relation.
  const s = star('sun', 'Kepler-90', 1.2, 0.3);
  w.add(s);
  const mr = (r: number) => (r < 1.23 ? r ** 3.58 : (r / 1.008) ** (1 / 0.589));
  const P: [string, number, number, number | null, string][] = [
    ['b', 7.008151, 1.31, null, 'lava'], ['c', 8.719375, 1.18, null, 'lava'], ['i', 14.44912, 1.32, null, 'desert'],
    ['d', 59.73667, 2.88, null, 'icegiant'], ['e', 91.93913, 2.67, null, 'icegiant'], ['f', 124.9144, 2.89, null, 'icegiant'],
    ['g', 210.60697, 8.13, 15, 'saturn'], ['h', 331.60059, 11.32, 203, 'jupiter'],
  ];
  P.forEach(([n, per, re, me, look], k) => {
    const b = world(look, `Kepler-90 ${n}`, (me ?? mr(re)) * M_EARTH, re * R_EARTH / KM, 20, look === 'saturn' ? { rings: undefined } : undefined);
    if (look === 'lava') b.heat = 1;
    b.sizeGuess = me === null;
    place(b, s, elementsDeg(aFromP(s.m, b.m, per), 0.01, 0, 0, 0, 97 * k), s.m);
    w.add(b);
  });
  barycentric(w.bodies);
}

function proxima(w: World) {
  // Faria et al. (2022): minimum masses
  const s = star('reddwarf', 'Proxima Centauri', 0.1221, 0.05);
  w.add(s);
  for (const [n, per, me, M] of [['d', 5.122, 0.26, 0], ['b', 11.1868, 1.07, 140]] as [string, number, number, number][]) {
    const b = world(n === 'd' ? 'moon' : 'terran', `Proxima ${n}`, me * M_EARTH, R_EARTH / KM * Math.cbrt(me), 24 * per);
    b.sizeGuess = true;
    place(b, s, elementsDeg(aFromP(s.m, b.m, per), 0.02, 0, 0, 0, M), s.m);
    w.add(b);
  }
  barycentric(w.bodies);
}

// ------------------------------------------------------------ events

/**
 * The canonical Moon-forming impact (Canup 2004): a proto-Earth of 0.89 Earth
 * masses and a Mars-sized Theia of 0.11 meet at a little over their mutual
 * escape speed, striking at 45°, a few hours after this starts. 1 AU from the Sun.
 */
function theia(w: World) {
  const s = sun(w);
  const E = world('terran', 'Proto-Earth', 0.89 * M_EARTH, 0, 5, { style: 'rocky', c1: 0x4a3a30, c2: 0x8a6a50, atmo: undefined });
  E.r = radiusFromDensity(E.m, 5.3);
  const T = world('desert', 'Theia', 0.11 * M_EARTH, 0, 20, { style: 'barren', c1: 0x5a4a3e, c2: 0xa08060, atmo: undefined });
  T.r = radiusFromDensity(T.m, 3.9);
  refreshRoche(E); refreshRoche(T);
  const h = planetHelio('Earth', s.m, E.m + T.m);
  const Mt = E.m + T.m, R = E.r + T.r;
  const vesc = Math.sqrt(2 * G * Mt / R);
  const vinf = 4 * KMS;
  const vimp = Math.sqrt(vesc * vesc + vinf * vinf);
  const L = R * Math.sin(45 * D2R) * vimp; // specific angular momentum at contact
  const d0 = 12 * R;
  const v0 = Math.sqrt(vinf * vinf + 2 * G * Mt / d0);
  const vt = L / d0, vr = -Math.sqrt(v0 * v0 - vt * vt);
  const fE = T.m / Mt, fT = E.m / Mt;
  E.setPos(h.r[0] - fE * d0, h.r[1], h.r[2]); E.setVel(h.v[0] - fE * vr, h.v[1] - fE * vt, h.v[2]);
  T.setPos(h.r[0] + fT * d0, h.r[1], h.r[2]); T.setVel(h.v[0] + fT * vr, h.v[1] + fT * vt, h.v[2]);
  w.add(E); w.add(T);
  barycentric(w.bodies);
}

/** An icy moon on an eccentric orbit whose closest pass dips inside its planet's Roche limit. */
function ringmaker(w: World) {
  const s = sun(w);
  const g = makePlanet('Saturn');
  g.name = 'Giant';
  g.look = { ...g.look, rings: undefined };
  setAxis(g, [0, 0, 1]);
  const h = planetHelio('Saturn', s.m, g.m);
  g.setPos(h.r[0], h.r[1], h.r[2]); g.setVel(h.v[0], h.v[1], h.v[2]);
  w.add(g);
  const m = makeBody('iceworld', 5, 'Doomed moon');
  m.m = 4e20 / MSUN_KG;
  m.r = radiusFromDensity(m.m, 1.1);
  m.look = { ...m.look, style: 'ice', c1: 0x9ab0c0, c2: 0xf4f8ff };
  refreshRoche(m);
  // Periapsis at 1.4 planet radii, inside the ~2.1-radius limit for ice. The orbit's
  // angular momentum settles the debris at a(1−e²) ≈ 1.9 radii — also inside, so it
  // can only become a ring; a wider orbit would put it outside, and it would re-form moons.
  const q = 1.4 * g.r, a = 2.2 * g.r;
  place(m, g, elementsDeg(a, 1 - q / a, 2, 0, 0, 180), g.m);
  w.add(m);
  barycentric(w.bodies);
}

/**
 * A 15-sun star near the end of its main sequence, close enough to a 10-sun
 * black hole to overflow its Roche lobe — the configuration of SS 433.
 */
function xrb(w: World) {
  const bh = makeBody('bh', 4, 'Black hole');
  const st = star('ostar', 'Donor star', 15, 0.9);
  const q = st.m / bh.m, q3 = Math.cbrt(q), q23 = q3 * q3;
  const rLa = 0.49 * q23 / (0.6 * q23 + Math.log(1 + q3));
  const a = st.r / (rLa * 1.015);
  const M = st.m + bh.m;
  const v = Math.sqrt(G * M / a);
  bh.setPos(-a * st.m / M, 0, 0); bh.setVel(0, -v * st.m / M, 0);
  st.setPos(a * bh.m / M, 0, 0); st.setVel(0, v * bh.m / M, 0);
  w.add(bh); w.add(st);
}

function merger(w: World) {
  const m = 30, a0 = 6e-5;
  const A = makeBody('bh', 1, 'BH A'), B = makeBody('bh', 2, 'BH B');
  A.m = B.m = m;
  A.r = B.r = schwarzschild(m);
  const v = Math.sqrt(G * 2 * m / a0) / 2;
  A.setPos(-a0 / 2, 0, 0); A.setVel(0, -v, 0);
  B.setPos(a0 / 2, 0, 0); B.setVel(0, v, 0);
  w.add(A); w.add(B);
}

function sgra(w: World) {
  const bh = makeBody('smbh', 1, 'Sgr A*');
  w.add(bh);
  // S2 (Gravity Collaboration 2020), then a handful of its neighbours (Gillessen et al. 2017)
  const S: [string, number, number, number, number, number, number, number][] = [
    ['S2', 1031, 0.884, 134.6, 228.2, 66.1, 340, 14], ['S1', 4900, 0.556, 119.1, 342.0, 122.3, 40, 12],
    ['S8', 2200, 0.803, 74.4, 315.4, 346.7, 200, 13], ['S12', 2500, 0.888, 33.6, 230.1, 317.9, 100, 7.6],
    ['S13', 1800, 0.425, 24.7, 74.5, 245.2, 280, 8], ['S14', 2300, 0.976, 100.6, 226.4, 334.6, 160, 9],
  ];
  for (const [name, a, e, i, node, peri, M, m0] of S) {
    const b = star('astar', name, m0, 0.2);
    place(b, bh, elementsDeg(a, e, i, node, peri, M), bh.m);
    w.add(b);
  }
  // a Sun-like star on a parabolic orbit whose periapsis is inside its tidal radius
  const v = makeBody('sun', 99, 'Doomed star');
  const q = 0.6, r0 = 250;
  const mu = G * (bh.m + v.m);
  const h = Math.sqrt(2 * mu * q);
  const vr = Math.sqrt(2 * mu / r0 - (h / r0) ** 2);
  const nu = Math.acos(Math.min(1, 2 * q / r0 - 1));
  v.setPos(r0 * Math.cos(nu), -r0 * Math.sin(nu), 0);
  const rh = [Math.cos(nu), -Math.sin(nu)], th = [Math.sin(nu), Math.cos(nu)];
  v.setVel(-vr * rh[0] + (h / r0) * th[0], -vr * rh[1] + (h / r0) * th[1], 0);
  w.add(v);
}

/** a body on a parabolic orbit about `host`, starting r0 out, with closest approach q */
function parabolic(b: Body, host: Body, q: number, r0: number) {
  const mu = G * (host.m + b.m);
  const h = Math.sqrt(2 * mu * q);
  const vr = Math.sqrt(Math.max(0, 2 * mu / r0 - (h / r0) ** 2));
  const nu = Math.acos(Math.min(1, 2 * q / r0 - 1));
  const rh = [Math.cos(nu), -Math.sin(nu)], th = [Math.sin(nu), Math.cos(nu)];
  b.setPos(host.x + r0 * rh[0], host.y + r0 * rh[1], host.z);
  b.setVel(host.vx - vr * rh[0] + (h / r0) * th[0], host.vy - vr * rh[1] + (h / r0) * th[1], host.vz);
}

/**
 * A tidal disruption event. The star's tidal radius is R (M/m)^⅓ ≈ 0.47 AU;
 * it passes at half that (β = 2), past the point of no return for a Sun-like
 * star. The spread of orbital energy across it, G M R / r_t², makes half the
 * debris bound — falling back over weeks to months — and half unbound.
 */
function tde(w: World) {
  const bh = makeBody('smbh', 3, 'Black hole');
  bh.m = 1e6; bh.r = schwarzschild(bh.m);
  w.add(bh);
  const st = makeBody('sun', 17, 'Doomed star');
  const rt = st.r * Math.cbrt(bh.m / st.m);
  parabolic(st, bh, rt / 2, 6 * rt);
  w.add(st);
}

/** Two Earths round a 10-sun hole: one at β ≈ 0.6 (stripped), one at β ≈ 2 (destroyed). */
function spaghetti(w: World) {
  const bh = makeBody('bh', 5, 'Black hole');
  w.add(bh);
  const mk = (name: string, beta: number, phase: number, seed: number) => {
    const e = makeBody('terran', seed, name);
    const rt = e.r * Math.cbrt(bh.m / e.m);
    const q = rt / beta, ecc = 0.85, a = q / (1 - ecc);
    place(e, bh, elementsDeg(a, ecc, 0, 0, phase, 200), bh.m);
    w.add(e);
  };
  mk('Grazing world', 0.62, 0, 41);
  mk('Plunging world', 2.2, 140, 42);
}

/**
 * A quasar: the hole feeds from a ring of gas whose viscosity lets it spiral
 * in, glowing; S-star-like orbits further out; and a red giant falling in.
 */
function quasar(w: World) {
  const bh = makeBody('quasar', 9, 'Quasar');
  w.add(bh);
  placeExtras(w, bh, { kind: 'agn', edd: 0.3, tilt: 50 }, 0);
  const rnd = rng(77);
  for (let k = 0; k < 8; k++) {
    const b = star('bstar', `Star ${k + 1}`, 4 + 8 * rnd(), 0.3);
    place(b, bh, elementsDeg(600 + 1600 * rnd(), 0.2 + 0.6 * rnd(), 180 * rnd(), 360 * rnd(), 360 * rnd(), 360 * rnd()), bh.m);
    w.add(b);
  }
  const g = star('redgiant', 'Falling giant', 1.2, 1.9);
  parabolic(g, bh, 40 * schwarzschild(bh.m), 1500);
  w.add(g);
}

function kirkwood(w: World) {
  const s = sun(w);
  for (const name of ['Mars', 'Jupiter', 'Saturn']) {
    const b = makePlanet(name);
    const h = planetHelio(name, s.m, b.m);
    b.setPos(h.r[0], h.r[1], h.r[2]); b.setVel(h.v[0], h.v[1], h.v[2]);
    w.add(b);
  }
  belt(w, s, 3000, 1.9, 3.6, 5);
  barycentric(w.bodies);
}

const BUILDERS: Record<string, (w: World) => void> = {
  solar: w => solarSystem(w, ALL, { mainBelt: 500, kuiper: 300 }),
  inner: w => solarSystem(w, ['Mercury', 'Venus', 'Earth', 'Mars'], { mainBelt: 800 }),
  outer: w => solarSystem(w, ['Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'], { kuiper: 600 }),
  earth,
  jupiter: w => planetPreset(w, 'Jupiter'), saturn: w => planetPreset(w, 'Saturn'),
  uranus: w => planetPreset(w, 'Uranus'), neptune: w => planetPreset(w, 'Neptune'), pluto: w => planetPreset(w, 'Pluto'),
  trappist, kepler16, hr8799, cnc55, kepler90, proxima,
  theia, ringmaker, xrb, merger, sgra, kirkwood, tde, spaghetti, quasar,
};

export function buildPreset(key: string, w = new World()): World {
  w.clear();
  BUILDERS[key]?.(w);
  return w;
}
