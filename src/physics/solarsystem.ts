import { Body, type Look } from './body';
import type { World } from './world';
import { makeBody, refreshRoche } from './catalog';
import { G, KM, MSUN_KG, HOUR, DAY } from './units';
import { stateFromElements, elementsDeg, type V3 } from './orbit';
import { MOONS, type MoonRow } from './data/moons';

const D2R = Math.PI / 180;
const OBLIQUITY = 23.4392911 * D2R;
export const GM_SUN_KM = 1.32712440018e11; // km³/s²

/** ICRF equatorial → ecliptic J2000 */
function eqToEcl(v: V3): V3 {
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
  return [v[0], c * v[1] + s * v[2], -s * v[1] + c * v[2]];
}
function poleVec(raDeg: number, decDeg: number): V3 {
  const a = raDeg * D2R, d = decDeg * D2R;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}
const norm3 = (v: V3): V3 => { const n = Math.hypot(...v); return [v[0] / n, v[1] / n, v[2] / n]; };
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Point a body's spin axis along an ecliptic-frame unit vector. */
export function setAxis(b: Body, a: V3) {
  b.tilt = Math.acos(Math.max(-1, Math.min(1, a[2])));
  b.node = Math.atan2(a[0], -a[1]);
}

// IAU rotation poles (RA, Dec of the north pole, ICRF), radius km, rotation period h (negative: retrograde)
export const PLANETS: Record<string, {
  look: string; a: number; e: number; I: number; L: number; wbar: number; node: number; invMass: number; r: number; day: number; pole: [number, number];
}> = {
  // J2000 mean elements (Standish, JPL); masses as 1/M in solar masses
  Mercury: { look: 'iron', a: 0.38709927, e: 0.20563593, I: 7.00497902, L: 252.2503235, wbar: 77.45779628, node: 48.33076593, invMass: 6023600, r: 2439.7, day: 1407.6, pole: [281.01, 61.41] },
  Venus: { look: 'desert', a: 0.72333566, e: 0.00677672, I: 3.39467605, L: 181.9790995, wbar: 131.60246718, node: 76.67984255, invMass: 408523.71, r: 6051.8, day: -5832.5, pole: [272.76, 67.16] },
  Earth: { look: 'terran', a: 1.00000261, e: 0.01671123, I: -0.00001531, L: 100.46457166, wbar: 102.93768193, node: 0, invMass: 332946.0487, r: 6371.0, day: 23.934, pole: [0, 90] },
  Mars: { look: 'desert', a: 1.52371034, e: 0.0933941, I: 1.84969142, L: -4.55343205, wbar: -23.94362959, node: 49.55953891, invMass: 3098703.6, r: 3389.5, day: 24.623, pole: [317.68, 52.89] },
  Jupiter: { look: 'jupiter', a: 5.202887, e: 0.04838624, I: 1.30439695, L: 34.39644051, wbar: 14.72847983, node: 100.47390909, invMass: 1047.348644, r: 69911, day: 9.925, pole: [268.06, 64.5] },
  Saturn: { look: 'saturn', a: 9.53667594, e: 0.05386179, I: 2.48599187, L: 49.95424423, wbar: 92.59887831, node: 113.66242448, invMass: 3497.9018, r: 58232, day: 10.656, pole: [40.59, 83.54] },
  Uranus: { look: 'icegiant', a: 19.18916464, e: 0.04725744, I: 0.77263783, L: 313.23810451, wbar: 170.9542763, node: 74.01692503, invMass: 22902.98, r: 25362, day: -17.24, pole: [257.31, -15.18] },
  Neptune: { look: 'icegiant', a: 30.06992276, e: 0.00859048, I: 1.77004347, L: -55.12002969, wbar: 44.96476227, node: 131.78422574, invMass: 19412.26, r: 24622, day: 16.11, pole: [299.36, 43.46] },
  // Pluto's mass alone; Charon is added as its own body
  Pluto: { look: 'dwarf', a: 39.48211675, e: 0.2488273, I: 17.14001206, L: 238.92903833, wbar: 224.06891629, node: 110.30393684, invMass: 152331000, r: 1188.3, day: -153.29, pole: [132.99, -6.16] },
};

const LOOKS: Partial<Record<string, Partial<Look>>> = {
  Mercury: { style: 'barren', c1: 0x5a5450, c2: 0xa09890 },
  Venus: { style: 'desert', c1: 0xc8a060, c2: 0xf0dcb0, atmo: 0xf0e0c0 },
  Uranus: { c1: 0x80c8d8, c2: 0xb8eef0, atmo: 0xa0e0f0, rings: { inner: 1.64, outer: 2.0, color: 0x7a8088, opacity: 0.35, kind: 'uranus' } },
  Neptune: { c1: 0x2040b0, c2: 0x5080e0, rings: { inner: 1.68, outer: 2.55, color: 0x6a6460, opacity: 0.12, kind: 'neptune' } },
  Jupiter: { rings: { inner: 1.29, outer: 3.2, color: 0x806850, opacity: 0.1, kind: 'jupiter' } },
  Saturn: { rings: { inner: 1.11, outer: 2.33, color: 0xd8c8a0, opacity: 0.9, kind: 'saturn' } },
};

/** Looks for the moons worth recognising; everything else is grey rock. */
const MOON_LOOK: Record<string, [string, number, number, number?]> = {
  Moon: ['barren', 0x5d5a57, 0xb8b2a8], Phobos: ['barren', 0x4a4440, 0x6e6660], Deimos: ['barren', 0x6a625a, 0x8a8070],
  Io: ['lava', 0xc8b040, 0xff7020], Europa: ['ice', 0x9a7a5a, 0xf0e8dc], Ganymede: ['ice', 0x5a5048, 0xc8c0b4], Callisto: ['barren', 0x3a342e, 0x8a8070],
  Amalthea: ['barren', 0x7a3020, 0xb06040], Mimas: ['ice', 0x9a9a98, 0xe0e0dc], Enceladus: ['ice', 0xc8dce8, 0xffffff], Tethys: ['ice', 0xb8b8b4, 0xf0f0ec],
  Dione: ['ice', 0x9a9a96, 0xe8e8e4], Rhea: ['ice', 0x8a8884, 0xdcdcd8], Titan: ['desert', 0xb07a2a, 0xe0a850, 0xe0a050], Hyperion: ['barren', 0x7a6a58, 0xb8a890],
  Iapetus: ['ice', 0x2a2018, 0xf0ece4], Phoebe: ['barren', 0x2e2a26, 0x504840], Miranda: ['ice', 0x7a7a7a, 0xc8c8c4], Ariel: ['ice', 0x8a8a88, 0xd0d0cc],
  Umbriel: ['barren', 0x3a3a3a, 0x6a6a68], Titania: ['ice', 0x7a7470, 0xc0b8b0], Oberon: ['barren', 0x6a5e54, 0xa89888], Triton: ['ice', 0xb08878, 0xf0e0d8],
  Proteus: ['barren', 0x3a3836, 0x6a6662], Nereid: ['barren', 0x5a5856, 0x8a8682], Charon: ['ice', 0x6a625c, 0xb0a8a0],
};

function hashName(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

/** a moon heavier than this pulls on the others; lighter ones are test particles */
const SOURCE_MASS = 1e-11; // M☉, ~2×10¹⁹ kg

export function makePlanet(name: string): Body {
  const p = PLANETS[name];
  const b = makeBody(p.look, hashName(name), name);
  b.m = 1 / p.invMass;
  b.r = p.r * KM;
  b.spin = (2 * Math.PI) / ((Math.abs(p.day) * HOUR)) * Math.sign(p.day);
  const L = LOOKS[name];
  if (L) b.look = { ...b.look, ...L } as Look;
  if (name === 'Saturn' && b.look.rings) b.look.rings = { ...b.look.rings };
  setAxis(b, eqToEcl(poleVec(...p.pole)));
  refreshRoche(b);
  return b;
}

export function planetHelio(name: string, mSun: number, mPlanet: number) {
  const p = PLANETS[name];
  return stateFromElements(G * (mSun + mPlanet), elementsDeg(p.a, p.e, p.I, p.node, p.wbar - p.node, p.L - p.wbar));
}

function moonFrame(row: MoonRow): [V3, V3, V3] | null {
  const [planet, , frame] = row;
  if (frame === 'ecliptic') return null;
  let pole: V3;
  if (frame === 'Laplace' && row[11] !== null && row[12] !== null) pole = poleVec(row[11], row[12]);
  else pole = poleVec(...PLANETS[planet].pole);
  const n = norm3(cross3([0, 0, 1], pole));
  const q = cross3(pole, n);
  return [n, q, pole];
}

function epochDays(epoch: string) {
  const [y, m, d] = epoch.split('-').map(Number);
  return (Date.UTC(y, m - 1, Math.floor(d)) - Date.UTC(2000, 0, 1)) / 864e5 + (d % 1) - 0.5;
}

/** One moon from the JPL table, placed about its planet at J2000. */
export function makeMoon(row: MoonRow, host: Body): Body {
  const [, name, , epoch, aKm, e, w, M0, i, node, P, , , gm, rKm] = row;
  // carry the mean anomaly back to J2000 when the table's epoch is later
  const dt = epochDays(epoch);
  const M = M0 - (360 * dt) / P;
  let m: number, r: number;
  const known = gm !== null && gm > 0;
  if (known) m = gm! / GM_SUN_KM;
  // no measured mass: assume 1.5 g/cm³, and 2 km across if even the size is unknown
  else m = ((4 / 3) * Math.PI * ((rKm ?? 2) * 1e3) ** 3 * 1500) / MSUN_KG;
  r = (rKm ?? (known ? Math.cbrt((3 * m * MSUN_KG) / (4 * Math.PI * 1500)) / 1e3 : 2)) * KM;
  const look = MOON_LOOK[name] ?? ['barren', 0x4e4a46, 0x8a847c];
  const src = m > SOURCE_MASS;
  const b = new Body({
    name, kind: 'moon', cls: look[0] === 'ice' ? 'ice' : 'rock', m, r, source: src,
    look: { style: look[0] as Look['style'], seed: hashName(name), c1: look[1], c2: look[2], atmo: look[3] },
  });
  b.sizeGuess = !known;
  const mu = G * (host.m + m);
  const st = stateFromElements(mu, elementsDeg(aKm * KM, e, i, node, w, M));
  const F = moonFrame(row);
  const toEcl = (v: V3): V3 => {
    if (!F) return v;
    const [n, q, p] = F;
    return eqToEcl([n[0] * v[0] + q[0] * v[1] + p[0] * v[2], n[1] * v[0] + q[1] * v[1] + p[1] * v[2], n[2] * v[0] + q[2] * v[1] + p[2] * v[2]]);
  };
  const rr = toEcl(st.r), vv = toEcl(st.v);
  b.setPos(host.x + rr[0], host.y + rr[1], host.z + rr[2]);
  b.setVel(host.vx + vv[0], host.vy + vv[1], host.vz + vv[2]);
  // tidally locked: one turn per orbit, about the orbit normal
  b.spin = (2 * Math.PI) / (P * DAY);
  setAxis(b, norm3(cross3(rr, vv)));
  if (name === 'Io') b.heat = 0.5;
  refreshRoche(b);
  return b;
}

export function moonsOf(planet: string) { return MOONS.filter(m => m[0] === planet); }

/**
 * A planet with every moon in the JPL table. If `helio` the planet is put on
 * its J2000 orbit round a Sun of mass `mSun`; otherwise at rest at the origin.
 * Moons are placed relative to the planet, then the planet is moved so the
 * system's centre of mass is where the planet would have been.
 */
export function addPlanetSystem(w: World, name: string, mSun: number | null): Body[] {
  const pl = makePlanet(name);
  const moons = moonsOf(name).map(row => makeMoon(row, pl));
  const out = [pl, ...moons];
  // shift so the barycentre of planet + moons sits on the planet's heliocentric orbit
  let M = 0, x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0;
  for (const b of out) { M += b.m; x += b.m * b.x; y += b.m * b.y; z += b.m * b.z; vx += b.m * b.vx; vy += b.m * b.vy; vz += b.m * b.vz; }
  let h = { r: [0, 0, 0] as V3, v: [0, 0, 0] as V3 };
  if (mSun !== null) h = planetHelio(name, mSun, M);
  for (const b of out) {
    b.x += h.r[0] - x / M; b.y += h.r[1] - y / M; b.z += h.r[2] - z / M;
    b.vx += h.v[0] - vx / M; b.vy += h.v[1] - vy / M; b.vz += h.v[2] - vz / M;
    w.add(b);
  }
  return out;
}
