import { Body } from './body';
import { World } from './world';
import { makeBody, refreshRoche } from './catalog';
import { G, KM, M_EARTH, MSUN_KG, DAY, HOUR, R_EARTH, schwarzschild } from './units';
import { stateFromElements, elementsDeg, type Elements } from './orbit';
import { newStar, structure, teffOf } from './stellar';

export interface PresetInfo {
  key: string;
  name: string;
  blurb: string;
  /** suggested clock, years per real second */
  warp: number;
  /** suggested view radius, AU */
  view: number;
  focus: string;
}

export const PRESETS: PresetInfo[] = [
  { key: 'solar', name: 'Solar system', blurb: 'Every planet at its J2000 position, 13 moons, the main belt.', warp: 0.25, view: 6, focus: 'Sun' },
  { key: 'trappist', name: 'TRAPPIST-1', blurb: 'Seven Earths round an ultracool dwarf, chained in resonance.', warp: 0.02, view: 0.08, focus: 'TRAPPIST-1' },
  { key: 'galilean', name: 'Galilean moons', blurb: 'Io, Europa and Ganymede locked 1:2:4 — the Laplace resonance.', warp: 0.05, view: 0.03, focus: 'Jupiter' },
  { key: 'kirkwood', name: 'Kirkwood gaps', blurb: '3,000 asteroids, Jupiter and Saturn. Gaps open where the periods resonate.', warp: 200, view: 6, focus: 'Sun' },
  { key: 'sgra', name: 'Sagittarius A*', blurb: 'Four million suns, the S-stars, and a star on its way in.', warp: 0.02, view: 200, focus: 'Sgr A*' },
  { key: 'merger', name: 'Black hole merger', blurb: 'Two 30-sun black holes, minutes from merging.', warp: 2e-6, view: 3e-4, focus: 'BH A' },
];

const D2R = Math.PI / 180;
const kg = (x: number) => x / MSUN_KG;

// Deterministic randomness so presets come out the same every time.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function place(b: Body, host: { x: number; y: number; z: number; vx: number; vy: number; vz: number; m: number } | null, el: Elements, mHost: number) {
  const mu = G * (mHost + b.m);
  const { r, v } = stateFromElements(mu, el);
  const h = host ?? { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  b.setPos(h.x + r[0], h.y + r[1], h.z + r[2]);
  b.setVel(h.vx + v[0], h.vy + v[1], h.vz + v[2]);
  return b;
}

function custom(key: string, name: string, m: number, rKm: number, dayHours: number, tiltDeg = 0, look?: Partial<Body['look']>) {
  const b = makeBody(key, hashName(name), name);
  b.m = m;
  b.r = rKm * KM;
  b.spin = 2 * Math.PI / (dayHours * HOUR);
  b.tilt = tiltDeg * D2R;
  if (look) b.look = { ...b.look, ...look };
  refreshRoche(b);
  return b;
}
function hashName(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

/** Move everything into the centre-of-momentum frame. */
function barycentric(bodies: Body[]) {
  let m = 0, x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0;
  for (const b of bodies) { m += b.m; x += b.m * b.x; y += b.m * b.y; z += b.m * b.z; vx += b.m * b.vx; vy += b.m * b.vy; vz += b.m * b.vz; }
  for (const b of bodies) { b.x -= x / m; b.y -= y / m; b.z -= z / m; b.vx -= vx / m; b.vy -= vy / m; b.vz -= vz / m; }
}

// J2000 mean elements (Standish, JPL): a, e, I, L, long. perihelion, long. node — and mass as 1/M.
const PLANETS: [string, string, number, number, number, number, number, number, number, number, number, number][] = [
  // name, catalogue look, a, e, I, L, ϖ, Ω, 1/mass, radius km, day h, tilt°
  ['Mercury', 'iron', 0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593, 6023600, 2439.7, 1407.6, 0.03],
  ['Venus', 'desert', 0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255, 408523.71, 6051.8, -5832.5, 177.4],
  ['Earth', 'terran', 1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0, 332946.0487, 6371.0, 23.93, 23.44],
  ['Mars', 'desert', 1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 3098703.6, 3389.5, 24.62, 25.19],
  ['Jupiter', 'jupiter', 5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, 1047.348644, 69911, 9.93, 3.13],
  ['Saturn', 'saturn', 9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, 3497.9018, 58232, 10.66, 26.73],
  ['Uranus', 'icegiant', 19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503, 22902.98, 25362, -17.24, 97.77],
  ['Neptune', 'icegiant', 30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574, 19412.26, 24622, 16.11, 28.32],
  ['Pluto', 'dwarf', 39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684, 136047200, 1188.3, -153.3, 122.5],
];

// Moons: host, name, look, a km, e, inclination to the host's equator°, mass kg, radius km
const MOONS: [string, string, string, number, number, number, number, number][] = [
  ['Jupiter', 'Io', 'lava', 421700, 0.0041, 0.05, 8.931938e22, 1821.6],
  ['Jupiter', 'Europa', 'iceworld', 671034, 0.009, 0.47, 4.799844e22, 1560.8],
  ['Jupiter', 'Ganymede', 'iceworld', 1070412, 0.0013, 0.2, 1.4819e23, 2634.1],
  ['Jupiter', 'Callisto', 'moon', 1882709, 0.0074, 0.19, 1.075938e23, 2410.3],
  ['Saturn', 'Rhea', 'iceworld', 527108, 0.0012, 0.35, 2.306518e21, 763.8],
  ['Saturn', 'Titan', 'desert', 1221870, 0.0288, 0.35, 1.3452e23, 2574.7],
  ['Saturn', 'Iapetus', 'moon', 3560820, 0.0286, 15.47, 1.805635e21, 734.5],
  ['Uranus', 'Titania', 'iceworld', 435910, 0.0011, 0.34, 3.4e21, 788.9],
  ['Uranus', 'Oberon', 'moon', 583520, 0.0014, 0.06, 3.076e21, 761.4],
  ['Neptune', 'Triton', 'iceworld', 354759, 0.000016, 156.885, 2.139e22, 1353.4],
];

function solar(w: World, belt = 600) {
  const sun = makeBody('sun', 7, 'Sun');
  w.add(sun);
  const planets = new Map<string, Body>();
  for (const [name, look, a, e, I, L, wbar, node, inv, rkm, dayh, tilt] of PLANETS) {
    const b = custom(look, name, 1 / inv, rkm, Math.abs(dayh), tilt);
    if (name === 'Venus') b.look = { ...b.look, style: 'desert', c1: 0xc8a060, c2: 0xf0dcb0, atmo: 0xf0e0c0 };
    if (name === 'Mercury') b.look = { ...b.look, style: 'barren', c1: 0x5a5450, c2: 0xa09890 };
    if (name === 'Uranus') b.look = { ...b.look, c1: 0x80c8d8, c2: 0xb8eef0, atmo: 0xa0e0f0, rings: { inner: 1.6, outer: 2.0, color: 0x8090a0, opacity: 0.25 } };
    if (name === 'Neptune') b.look = { ...b.look, c1: 0x2040b0, c2: 0x5080e0 };
    if (name === 'Jupiter') b.look = { ...b.look, rings: { inner: 1.4, outer: 1.8, color: 0x806850, opacity: 0.08 } };
    if (dayh < 0) b.spin = -b.spin;
    const el = elementsDeg(a, e, I, node, wbar - node, L - wbar);
    if (name === 'Earth') {
      // these are the elements of the Earth–Moon barycentre; split the pair about it
      const moon = custom('moon', 'Moon', kg(7.342e22), 1737.4, 655.7, 6.68);
      const emb = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, m: b.m + moon.m };
      const st = stateFromElements(G * (1 + emb.m), el);
      const rel = stateFromElements(G * emb.m, elementsDeg(384400 * KM, 0.0549, 5.145, 125.08, 318.15, 135.27));
      const fE = moon.m / emb.m, fM = b.m / emb.m;
      b.setPos(st.r[0] - fE * rel.r[0], st.r[1] - fE * rel.r[1], st.r[2] - fE * rel.r[2]);
      b.setVel(st.v[0] - fE * rel.v[0], st.v[1] - fE * rel.v[1], st.v[2] - fE * rel.v[2]);
      moon.setPos(st.r[0] + fM * rel.r[0], st.r[1] + fM * rel.r[1], st.r[2] + fM * rel.r[2]);
      moon.setVel(st.v[0] + fM * rel.v[0], st.v[1] + fM * rel.v[1], st.v[2] + fM * rel.v[2]);
      w.add(b); w.add(moon);
    } else {
      place(b, null, el, sun.m);
      w.add(b);
    }
    planets.set(name, b);
  }
  addMoons(w, planets);
  for (const [name, a, e, I, node, peri, M, mass, rkm] of [
    ['Ceres', 2.7675, 0.0758, 10.59, 80.31, 73.6, 95.99, 9.3835e20, 469.7],
    ['Vesta', 2.3615, 0.0887, 7.14, 103.81, 151.2, 205.55, 2.59076e20, 262.7],
  ] as [string, number, number, number, number, number, number, number, number][]) {
    const b = custom(name === 'Ceres' ? 'dwarf' : 'asteroid', name, kg(mass), rkm, 9);
    if (name === 'Ceres') b.look = { ...b.look, style: 'barren', c1: 0x5a5856, c2: 0x8a8682 };
    place(b, null, elementsDeg(a, e, I, node, peri, M), sun.m);
    w.add(b);
  }
  asteroidBelt(w, sun, belt, 1.9, 3.4, 11);
  barycentric(w.bodies);
}

function addMoons(w: World, planets: Map<string, Body>) {
  for (const [hostName, name, look, akm, e, inc, mkg, rkm] of MOONS) {
    const host = planets.get(hostName);
    if (!host) continue;
    const b = custom(look, name, kg(mkg), rkm, 24);
    const a = akm * KM;
    // tidally locked: one turn per orbit
    const P = 2 * Math.PI * Math.sqrt(a ** 3 / (G * (host.m + b.m)));
    b.spin = 2 * Math.PI / P;
    // orbits are measured from the host's equator, which is tilted by its obliquity
    const r = rng(hashName(name));
    place(b, host, elementsDeg(a, e, inc + host.tilt / D2R, host.node / D2R, 360 * r(), 360 * r()), host.m);
    if (name === 'Io') b.heat = 0.6;
    w.add(b);
  }
}

function asteroidBelt(w: World, sun: Body, n: number, aMin: number, aMax: number, seed: number) {
  const r = rng(seed);
  for (let k = 0; k < n; k++) {
    const p = new Body({ name: 'asteroid', kind: 'fragment', cls: 'debris', source: false, spin: 0,
      look: { style: 'rocky', seed: k, c1: 0x8a7a6a, c2: 0x8a7a6a }, m: 1e-15, r: 10 * KM });
    const a = aMin + (aMax - aMin) * r();
    const e = Math.min(0.3, Math.abs(0.07 * Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())));
    const i = Math.abs(8 * Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()));
    place(p, sun, elementsDeg(a, e, i, 360 * r(), 360 * r(), 360 * r()), sun.m);
    w.add(p);
  }
}

function trappist(w: World) {
  const star = makeBody('reddwarf', 3, 'TRAPPIST-1');
  star.star = newStar(0.0898, 0.0007);
  const st = structure(star.star);
  star.m = st.m; star.r = st.r; star.star.L = st.L; star.star.teff = teffOf(st.L, st.r);
  refreshRoche(star);
  w.add(star);
  // Agol et al. (2021): period in days, mass and radius in Earths
  const P: [string, number, number, number, string][] = [
    ['b', 1.510826, 1.374, 1.116, 'lava'], ['c', 2.421937, 1.308, 1.097, 'desert'], ['d', 4.049219, 0.388, 0.788, 'ocean'],
    ['e', 6.101013, 0.692, 0.92, 'terran'], ['f', 9.20754, 1.039, 1.045, 'ocean'], ['g', 12.352446, 1.321, 1.129, 'iceworld'],
    ['h', 18.772866, 0.326, 0.755, 'iceworld'],
  ];
  // mean longitudes chosen so neighbours sit near their observed conjunction pattern
  const lam = [0, 147, 289, 71, 222, 18, 196];
  P.forEach(([n, per, m, rr, look], k) => {
    const b = custom(look, `TRAPPIST-1${n}`, m * M_EARTH, rr * R_EARTH / KM, 24 * per);
    const a = Math.cbrt(G * (star.m + b.m) * (per * DAY / (2 * Math.PI)) ** 2);
    place(b, star, elementsDeg(a, 0.005, 0, 0, 0, lam[k]), star.m);
    w.add(b);
  });
  barycentric(w.bodies);
}

function galilean(w: World) {
  const jup = custom('jupiter', 'Jupiter', 1 / 1047.348644, 69911, 9.93, 0);
  w.add(jup);
  const planets = new Map([['Jupiter', jup]]);
  addMoons(w, planets);
  // Laplace resonance: λ_Io − 3λ_Europa + 2λ_Ganymede = 180°
  const [io, eu, ga] = ['Io', 'Europa', 'Ganymede'].map(n => w.bodies.find(b => b.name === n)!);
  const lam = { Io: 0, Europa: 300, Ganymede: 0 } as Record<string, number>;
  for (const [b, e] of [[io, 0.0041], [eu, 0.009], [ga, 0.0013]] as [Body, number][]) {
    const a = MOONS.find(m => m[1] === b.name)![3] * KM;
    place(b, jup, elementsDeg(a, e, 0, 0, 0, lam[b.name]), jup.m);
  }
  barycentric(w.bodies);
}

function kirkwood(w: World) {
  const sun = makeBody('sun', 7, 'Sun');
  w.add(sun);
  for (const [name, look, a, e, I, L, wbar, node, inv, rkm, dayh, tilt] of PLANETS) {
    if (name !== 'Mars' && name !== 'Jupiter' && name !== 'Saturn') continue;
    const b = custom(look, name, 1 / inv, rkm, dayh, tilt);
    place(b, null, elementsDeg(a, e, I, node, wbar - node, L - wbar), sun.m);
    w.add(b);
  }
  asteroidBelt(w, sun, 3000, 1.9, 3.6, 5);
  barycentric(w.bodies);
}

function sgra(w: World) {
  const bh = makeBody('smbh', 1, 'Sgr A*');
  w.add(bh);
  // S2 (Gravity Collaboration 2020), then a handful of its neighbours
  const S: [string, number, number, number, number, number, number, number][] = [
    ['S2', 1031, 0.884, 134.6, 228.2, 66.1, 340, 14],
    ['S1', 4900, 0.556, 119.1, 342.0, 122.3, 40, 12],
    ['S8', 2200, 0.803, 74.4, 315.4, 346.7, 200, 13],
    ['S12', 2500, 0.888, 33.6, 230.1, 317.9, 100, 7.6],
    ['S13', 1800, 0.425, 24.7, 74.5, 245.2, 280, 8],
    ['S14', 2300, 0.976, 100.6, 226.4, 334.6, 160, 9],
  ];
  for (const [name, a, e, i, node, peri, M, m0] of S) {
    const b = makeBody('astar', hashName(name), name);
    b.star = newStar(m0, 0.2);
    const st = structure(b.star);
    b.m = st.m; b.r = st.r; b.star.L = st.L; b.star.teff = teffOf(st.L, st.r);
    refreshRoche(b);
    place(b, bh, elementsDeg(a, e, i, node, peri, M), bh.m);
    w.add(b);
  }
  // a Sun-like star on a parabolic orbit whose periapsis is inside its tidal radius
  const v = makeBody('sun', 99, 'Victim');
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

function merger(w: World) {
  const m = 30;
  const a0 = 6e-5;
  const A = makeBody('bh', 1, 'BH A'), B = makeBody('bh', 2, 'BH B');
  A.m = B.m = m;
  A.r = B.r = schwarzschild(m);
  const v = Math.sqrt(G * 2 * m / a0) / 2;
  A.setPos(-a0 / 2, 0, 0); A.setVel(0, -v, 0);
  B.setPos(a0 / 2, 0, 0); B.setVel(0, v, 0);
  w.add(A); w.add(B);
}

export function buildPreset(key: string, w = new World()): World {
  w.clear();
  ({ solar, trappist, galilean, kirkwood, sgra, merger } as Record<string, (w: World) => void>)[key]?.(w);
  return w;
}
