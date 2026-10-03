import type { Body } from '../physics/body';
import { AU_M, MSUN_KG, M_EARTH, M_JUP, densityOf } from '../physics/units';

/**
 * What a body's air and insides are made of. Real worlds (by `look.real`) use
 * published measurements; anything else is worked out from its mass, size,
 * style, seed and the starlight falling on it, the same way every time.
 */

export interface Gas { formula: string; name: string; frac: number }
export interface Atmosphere {
  exists: boolean;
  kind: 'none' | 'exosphere' | 'thin' | 'thick' | 'envelope';
  /** at the surface; for giants the 1-bar reference level; for an exosphere its (tiny) surface pressure; 0 if none */
  surfaceBar: number;
  surfaceK: number;
  scaleHeightKm: number;
  /** mean, g/mol */
  molarMass: number;
  gases: Gas[];
  trace: Gas[];
  /** altitude above the surface, or relative to 1 bar for giants (negative = deeper); `topKm` for a deck with depth */
  clouds: { name: string; altKm: number; color: number; topKm?: number }[];
  sky: [number, number, number];
  horizon: [number, number, number];
  sunset: [number, number, number];
  haze: number;
  measured: boolean;
  notes: string;
  /** K per km below the tropopause (negative: warmer with height, as on Pluto); 0 = isothermal */
  lapse?: number;
  /** temperature at the tropopause, above which the air is taken as isothermal */
  tropoK?: number;
}

export interface Layer { name: string; r0: number; r1: number; color: number; state: 'solid' | 'liquid' | 'gas' | 'ice' | 'metallic' | 'plasma' }
export interface Composition {
  layers: Layer[];
  surface: { name: string; frac: number }[];
  bulk: { name: string; frac: number }[];
  measured: boolean;
  notes: string;
}

type RGB = [number, number, number];
type Kind = Atmosphere['kind'];
type Cloud = Atmosphere['clouds'][number];
type State = Layer['state'];

const G_SI = 6.674e-11;
const RGAS = 8.314462618;
const BLACK: RGB = [0, 0, 0];

// ------------------------------------------------------------------ species

/** formula, name, molar mass (g/mol), Rayleigh cross-section relative to air */
const SP = {
  H2: ['H₂', 'hydrogen', 2.016, 0.21], He: ['He', 'helium', 4.0026, 0.014], H: ['H', 'atomic hydrogen', 1.008, 0.2],
  HD: ['HD', 'hydrogen deuteride', 3.022, 0.21], N2: ['N₂', 'nitrogen', 28.014, 1.0], O2: ['O₂', 'oxygen', 31.998, 0.86],
  O: ['O', 'atomic oxygen', 15.999, 0.3], N: ['N', 'atomic nitrogen', 14.007, 0.3], C: ['C', 'carbon', 12.011, 0.5],
  Ar: ['Ar', 'argon', 39.948, 0.9], Ne: ['Ne', 'neon', 20.18, 0.07], Kr: ['Kr', 'krypton', 83.798, 2], Xe: ['Xe', 'xenon', 131.29, 5],
  CO2: ['CO₂', 'carbon dioxide', 44.01, 2.45], H2O: ['H₂O', 'water vapour', 18.015, 0.75], CH4: ['CH₄', 'methane', 16.043, 2.2],
  NH3: ['NH₃', 'ammonia', 17.031, 1.7], CO: ['CO', 'carbon monoxide', 28.01, 1.2], SO2: ['SO₂', 'sulphur dioxide', 64.066, 3.5],
  SO: ['SO', 'sulphur monoxide', 48.06, 2], S2: ['S₂', 'disulphur', 64.13, 3], S: ['S', 'sulphur', 32.06, 1],
  N2O: ['N₂O', 'nitrous oxide', 44.013, 2.5], O3: ['O₃', 'ozone', 47.998, 2], NO: ['NO', 'nitric oxide', 30.006, 1],
  C2H6: ['C₂H₆', 'ethane', 30.07, 5], C2H2: ['C₂H₂', 'acetylene', 26.04, 3.5], C2H4: ['C₂H₄', 'ethylene', 28.05, 4],
  C3H8: ['C₃H₈', 'propane', 44.1, 8], HCN: ['HCN', 'hydrogen cyanide', 27.03, 2], PH3: ['PH₃', 'phosphine', 33.998, 3],
  GeH4: ['GeH₄', 'germane', 76.64, 4], H2S: ['H₂S', 'hydrogen sulphide', 34.08, 3], OCS: ['OCS', 'carbonyl sulphide', 60.07, 4],
  HCl: ['HCl', 'hydrogen chloride', 36.46, 2], HF: ['HF', 'hydrogen fluoride', 20.006, 1], Na: ['Na', 'sodium', 22.99, 1],
  K: ['K', 'potassium', 39.098, 1], Ca: ['Ca', 'calcium', 40.078, 1], Mg: ['Mg', 'magnesium', 24.305, 1], Fe: ['Fe', 'iron', 55.845, 1],
  Si: ['Si', 'silicon', 28.086, 1], SiO: ['SiO', 'silicon monoxide', 44.085, 2], TiO: ['TiO', 'titanium oxide', 63.87, 2],
  VO: ['VO', 'vanadium oxide', 66.94, 2], FeH: ['FeH', 'iron hydride', 56.85, 2], NaCl: ['NaCl', 'sodium chloride', 58.44, 2],
  KCl: ['KCl', 'potassium chloride', 74.55, 2],
} as const satisfies Record<string, readonly [string, string, number, number]>;
type Sp = keyof typeof SP;
type Mix = [Sp, number][];

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const clampRGB = (c: number[]): RGB => [clamp(c[0], 0, 1), clamp(c[1], 0, 1), clamp(c[2], 0, 1)];
const fin = (x: number, d = 0) => (Number.isFinite(x) ? x : d);

/** scaled so the fractions add to one */
function normalise(mix: Mix): Mix {
  const s = sum(mix.map(m => m[1]));
  return s > 0 ? mix.map(([k, f]) => [k, f / s]) : mix;
}
function setFrac(mix: Mix, sp: Sp, f: number): Mix {
  const rest = mix.filter(m => m[0] !== sp);
  const s = sum(rest.map(m => m[1]));
  return [...rest.map(([k, x]): [Sp, number] => [k, s > 0 ? (x * (1 - f)) / s : 0]), [sp, f]];
}
const fracOf = (mix: Mix, sp: Sp) => sum(mix.filter(m => m[0] === sp).map(m => m[1]));
/** mean molar mass, g/mol; an ionised gas counts its free electrons */
function molar(mix: Mix, ionised = 0) {
  const s = sum(mix.map(m => m[1]));
  return s > 0 ? sum(mix.map(([k, f]) => f * SP[k][2])) / s / (1 + ionised) : 0;
}
const gasOf = ([k, f]: [Sp, number]): Gas => ({ formula: SP[k][0], name: SP[k][1], frac: f });
/** major constituents (≥ 1e-4) and trace ones, each sorted, largest first */
function split(mix: Mix, allTrace: boolean): { gases: Gas[]; trace: Gas[] } {
  const by = (a: Gas, b: Gas) => b.frac - a.frac;
  const ok = mix.filter(m => m[1] > 0);
  if (allTrace) return { gases: [], trace: ok.map(gasOf).sort(by) };
  return { gases: ok.filter(m => m[1] >= 1e-4).map(gasOf).sort(by), trace: ok.filter(m => m[1] < 1e-4).map(gasOf).sort(by) };
}

// ------------------------------------------------------------------ helpers

/** deterministic 0..1 stream from a seed (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const span = (r: () => number, a: number, b: number) => a + (b - a) * r();
const logSpan = (r: () => number, a: number, b: number) => a * Math.pow(b / a, r());

/** surface gravity (m/s²) and escape speed (m/s) */
function gravity(b: Body) {
  const M = b.m * MSUN_KG, R = b.r * AU_M;
  if (!(R > 0) || !(M > 0)) return { g: 0, vesc: 0, R: Math.max(R, 0) };
  return { g: (G_SI * M) / (R * R), vesc: Math.sqrt((2 * G_SI * M) / R), R };
}

/** the starlight here: zero-albedo equilibrium temperature and its flux-weighted colour temperature */
function light(b: Body, stars: Body[]) {
  let flux = 0, ft = 0;
  for (const s of stars) {
    if (s === b) continue;
    const d2 = (s.x - b.x) ** 2 + (s.y - b.y) ** 2 + (s.z - b.z) ** 2;
    const f = (s.star?.L ?? 0) / Math.max(d2, 1e-12);
    if (!(f > 0)) continue;
    flux += f;
    ft += f * (s.star?.teff || 5772);
  }
  return { teq: 278.6 * Math.pow(flux, 0.25), starT: flux > 0 ? ft / flux : 5772 };
}

/** a blackbody's colour through R, G, B (610, 540, 465 nm), relative to the Sun's and normalised to its brightest channel */
function starColour(T: number): RGB {
  const planck = (lnm: number, t: number) => 1 / (Math.pow(lnm, 5) * (Math.exp(14387770 / (lnm * Math.max(t, 500))) - 1));
  const c = [610, 540, 465].map(l => planck(l, T) / planck(l, 5772));
  const m = Math.max(...c);
  return m > 0 ? clampRGB(c.map(x => x / m)) : [1, 1, 1];
}

/** saturation vapour pressure of water over liquid or ice, bar */
function psatWater(T: number) {
  const t = T - 273.15;
  return t >= 0 ? 6.1094e-3 * Math.exp((17.625 * t) / (t + 243.04)) : 6.1115e-3 * Math.exp((22.452 * t) / (t + 272.55));
}

/**
 * Grey infrared optical depth of the air, calibrated so that 1 bar of
 * N₂/O₂ with 420 ppm CO₂ and 0.4% water gives Earth's +33 K, 92 bar of CO₂
 * gives Venus's +505 K, Mars's 6 mbar about +5 K and Titan's N₂/CH₄ about +9 K.
 */
function greenhouseTau(mix: Mix, bar: number) {
  const p = (s: Sp) => fracOf(mix, s) * bar;
  const co2 = p('CO2'), h2o = p('H2O'), ch4 = p('CH4'), n2 = p('N2'), h2 = p('H2');
  let tau = 0;
  if (co2 > 0) tau += 4.66 * Math.pow(co2, 0.405) * Math.pow(bar, 0.341);
  if (h2o > 0) tau += 0.6 * Math.pow(h2o / 0.004, 0.3) * Math.pow(bar, 0.3);
  if (ch4 > 0) tau += 0.6 * Math.sqrt(ch4 / 0.084);
  tau += 0.01 * n2 * n2 + 0.5 * h2 * bar; // collision-induced absorption
  return tau;
}
const surfaceTemp = (tirr: number, tau: number) => tirr * Math.pow(1 + 0.75 * tau, 0.25);

/** aerosol: optical depth, single-scattering albedo per channel, colour and strength of the aureole round the sun */
interface Aer { tau: number; w: RGB; aur: RGB; aurK: number }
const CLEAR: Aer = { tau: 0.08, w: [0.95, 0.94, 0.93], aur: [1, 0.9, 0.8], aurK: 0.02 };
const DUST = (tau: number): Aer => ({ tau, w: [0.97, 0.78, 0.45], aur: [0.35, 0.55, 1], aurK: 1 });
const THOLIN = (tau: number): Aer => ({ tau, w: [0.95, 0.75, 0.45], aur: [1, 0.6, 0.25], aurK: 0.3 });
const SULPHURIC = (tau: number): Aer => ({ tau, w: [0.999, 0.995, 0.96], aur: [1, 0.85, 0.6], aurK: 0.02 });
const GIANT_HAZE = (tau: number): Aer => ({ tau, w: [0.98, 0.95, 0.88], aur: [1, 0.9, 0.75], aurK: 0.05 });

/**
 * Sky colours seen from the ground (linear RGB): Rayleigh scattering through
 * the column of gas, tinted by aerosols and by gas absorption (methane eats the
 * red), lit by the local starlight.
 */
function skyOf(bar: number, g: number, M: number, mix: Mix, aer: Aer, star: RGB) {
  if (!(bar > 0) || !(g > 0) || !(M > 0)) return { sky: BLACK, horizon: BLACK, sunset: BLACK, haze: 0 };
  const col = (bar / 1.01325) * (9.81 / g) * (28.97 / M);
  const sigma = sum(mix.map(([k, f]) => f * SP[k][3]));
  const tauR = 0.097 * col * sigma;
  const W = [0.45, 1, 2.3];
  const ch4 = col * fracOf(mix, 'CH4');
  const ABS = [12, 1.5, 0.3];
  const sky: number[] = [], hor: number[] = [], sun: number[] = [];
  for (let c = 0; c < 3; c++) {
    const t = tauR * W[c], a = ch4 * ABS[c];
    const e = t + aer.tau * 0.3 * aer.w[c];
    const D = 1 / (1 + t + aer.tau * 0.3);
    const lost = Math.exp(-aer.tau * (1 - aer.w[c]) - a);
    sky.push(star[c] * (1 - Math.exp(-e)) * D * lost);
    hor.push(star[c] * (1 - Math.exp(-10 * e)) * Math.sqrt(D) * lost);
    const direct = Math.exp(-Math.min(700, 25 * (t + aer.tau + a)));
    const aureole = aer.tau * aer.aurK * aer.aur[c] * Math.exp(-Math.min(700, t + 5 * a));
    sun.push(star[c] * (direct + aureole));
  }
  const m = Math.max(...sun);
  const bright = Math.min(1, 15 * (tauR + aer.tau)) / (1 + 0.5 * (tauR + aer.tau * 0.3));
  return {
    sky: clampRGB(sky.map(x => 3.6 * x)),
    horizon: clampRGB(hor.map(x => 0.85 * x)),
    sunset: m > 0 ? clampRGB(sun.map(x => (x / m) * bright)) : BLACK,
    haze: clamp(1 - Math.exp(-0.8 * (tauR + aer.tau)), 0, 0.92),
  };
}

interface Draft {
  kind: Kind; bar: number; K: number; mix: Mix; clouds?: Cloud[]; lapse?: number; tropoK?: number;
  sky?: RGB; horizon?: RGB; sunset?: RGB; haze?: number; aer?: Aer; ionised?: number; notes: string;
}

/** finish an atmosphere: split the gases, mean molar mass, scale height and (unless given) the sky */
function finish(b: Body, d: Draft, measured: boolean, star: RGB = [1, 1, 1]): Atmosphere {
  const { g } = gravity(b);
  const exists = d.kind === 'thin' || d.kind === 'thick' || d.kind === 'envelope';
  const mix = d.mix.filter(m => m[1] > 0);
  const M = mix.length ? molar(mix, d.ionised ?? 0) : 0;
  const bar = d.kind === 'none' ? 0 : Math.max(0, fin(d.bar));
  const K = Math.max(0, fin(d.K));
  const H = bar > 0 && M > 0 && g > 0 ? (RGAS * Math.max(K, 1)) / ((M / 1000) * g) / 1000 : 0;
  const auto = exists ? skyOf(bar, g, M, mix, d.aer ?? CLEAR, star) : { sky: BLACK, horizon: BLACK, sunset: BLACK, haze: 0 };
  return {
    exists, kind: d.kind, surfaceBar: bar, surfaceK: K, scaleHeightKm: fin(H), molarMass: fin(M),
    ...split(mix, !exists),
    clouds: d.clouds ?? [],
    sky: d.sky ?? auto.sky, horizon: d.horizon ?? auto.horizon, sunset: d.sunset ?? auto.sunset,
    haze: d.haze ?? auto.haze,
    measured, notes: d.notes,
    lapse: d.lapse ?? 0, tropoK: d.tropoK ?? K,
  };
}

// ------------------------------------------------------------------ measured air

const R = (r: number, g: number, b: number): RGB => [r, g, b];
const NONE = (K: number, notes: string): Draft => ({ kind: 'none', bar: 0, K, mix: [], notes });

/** mean temperature and pressure agree with survey.ts's FACTS */
const AIR: Record<string, Draft> = {
  Sun: {
    kind: 'envelope', bar: 0.1, K: 5772, lapse: 2.7, tropoK: 4400,
    mix: [['H', 0.9206], ['He', 0.0782], ['O', 4.5e-4], ['C', 2.5e-4], ['Ne', 7.8e-5], ['N', 6.2e-5], ['Mg', 3.7e-5], ['Si', 3.0e-5], ['Fe', 2.9e-5], ['S', 1.2e-5]],
    sky: R(1, 0.97, 0.92), horizon: R(1, 0.9, 0.75), sunset: R(1, 0.85, 0.65), haze: 1,
    notes: 'The photosphere, where the Sun turns opaque: about 0.1 bar, by number 92% hydrogen and 8% helium (Asplund et al. 2009). The gas cools to ~4,400 K some 500 km up, then heats through the chromosphere to the million-kelvin corona.',
  },
  Mercury: {
    kind: 'exosphere', bar: 5e-15, K: 440,
    mix: [['O', 0.42], ['Na', 0.29], ['H', 0.22], ['He', 0.06], ['K', 0.005], ['Ca', 0.003], ['Mg', 0.002]],
    notes: 'A surface-bounded exosphere, not an atmosphere: atoms knocked off the rock by sunlight, the solar wind and micrometeorites (MESSENGER). Radiation pressure blows the sodium into a tail millions of km long.',
  },
  Venus: {
    kind: 'thick', bar: 92, K: 737, lapse: 7.7, tropoK: 230,
    mix: [['CO2', 0.965], ['N2', 0.035], ['SO2', 150e-6], ['Ar', 70e-6], ['H2O', 20e-6], ['CO', 17e-6], ['He', 12e-6], ['Ne', 7e-6], ['OCS', 4e-6], ['HCl', 0.4e-6], ['HF', 0.005e-6]],
    clouds: [
      { name: 'lower haze', altKm: 31, topKm: 48, color: 0xd8c890 },
      { name: 'sulphuric acid cloud deck', altKm: 48, topKm: 70, color: 0xf0e0a8 },
      { name: 'upper haze', altKm: 70, topKm: 90, color: 0xf4ecd0 },
    ],
    sky: R(0.3, 0.2, 0.07), horizon: R(0.24, 0.15, 0.05), sunset: R(0.14, 0.07, 0.02), haze: 0.9,
    notes: 'Venera, Pioneer Venus and Vega probes. At the ground the CO₂ is supercritical, 65 times denser than Earth’s air; only 2–3% of the sunlight gets through the sulphuric acid deck, and what does is orange.',
  },
  Earth: {
    kind: 'thick', bar: 1.01325, K: 288, lapse: 6.5, tropoK: 216.65,
    mix: [['N2', 0.7808], ['O2', 0.2095], ['Ar', 0.00934], ['H2O', 0.004], ['CO2', 0.00042], ['Ne', 18.18e-6], ['He', 5.24e-6], ['CH4', 1.92e-6],
      ['Kr', 1.14e-6], ['H2', 0.55e-6], ['N2O', 0.336e-6], ['CO', 0.1e-6], ['Xe', 0.087e-6], ['O3', 0.04e-6]],
    clouds: [
      { name: 'water clouds (cumulus, stratus)', altKm: 2, topKm: 6, color: 0xffffff },
      { name: 'cirrus (ice crystals)', altKm: 9, topKm: 12, color: 0xf4f8ff },
      { name: 'noctilucent clouds', altKm: 83, color: 0xc8e0ff },
    ],
    sky: R(0.12, 0.3, 0.78), horizon: R(0.52, 0.66, 0.85), sunset: R(1, 0.45, 0.12), haze: 0.15,
    notes: 'Dry air by volume, with 0.4% water vapour on average (0–4% locally). The oxygen is kept there by photosynthesis; ozone peaks near 25 km and stops most of the Sun’s ultraviolet.',
  },
  Moon: {
    kind: 'exosphere', bar: 3e-15, K: 250,
    mix: [['He', 0.38], ['Ar', 0.38], ['Ne', 0.239], ['Na', 7e-4], ['K', 1.7e-4], ['H', 1e-4]],
    notes: 'An exosphere of some 10⁵ atoms per cm³ at night, about 25 tonnes in all: argon-40 seeps out of the rock, helium and neon arrive on the solar wind (Apollo 17 LACE, LADEE).',
  },
  Mars: {
    kind: 'thin', bar: 0.006, K: 210, lapse: 2.5, tropoK: 140,
    mix: [['CO2', 0.951], ['N2', 0.0259], ['Ar', 0.0194], ['O2', 0.0016], ['CO', 0.0006], ['H2O', 2.1e-4], ['NO', 1e-4], ['H2', 15e-6], ['Ne', 2.5e-6],
      ['Kr', 0.3e-6], ['O3', 0.1e-6], ['Xe', 0.08e-6], ['CH4', 0.4e-9]],
    clouds: [
      { name: 'suspended dust', altKm: 0, topKm: 30, color: 0xc89060 },
      { name: 'water-ice clouds', altKm: 20, color: 0xe8ecf4 },
      { name: 'CO₂-ice clouds', altKm: 70, color: 0xf0f4ff },
    ],
    sky: R(0.56, 0.34, 0.17), horizon: R(0.72, 0.5, 0.27), sunset: R(0.22, 0.38, 0.68), haze: 0.2,
    notes: 'Curiosity’s SAM at Gale crater (Franz et al. 2017). The pressure swings by a quarter over the year as CO₂ freezes onto the polar caps and comes back; methane comes and goes at a fraction of a part per billion. Fine dust scatters blue light forwards, so sunsets are blue.',
  },
  Ceres: {
    kind: 'exosphere', bar: 1e-15, K: 168, mix: [['H2O', 1]],
    notes: 'Herschel caught about 6 kg/s of water vapour coming off in 2014, perhaps ice warmed near perihelion: a transient, patchy exosphere.',
  },
  Phobos: NONE(233, 'No atmosphere: a few km/h would carry a molecule away.'),
  Deimos: NONE(233, 'No atmosphere: far too little gravity to keep any gas.'),
  Vesta: NONE(190, 'No atmosphere.'),
  Jupiter: {
    kind: 'envelope', bar: 1, K: 165, lapse: 2, tropoK: 110,
    mix: [['H2', 0.898], ['He', 0.102], ['CH4', 0.003], ['NH3', 2.6e-4], ['HD', 28e-6], ['C2H6', 5.8e-6], ['H2O', 4e-6], ['PH3', 0.7e-6], ['C2H2', 0.1e-6], ['GeH4', 0.7e-9]],
    clouds: [
      { name: 'stratospheric haze', altKm: 50, color: 0xb09070 },
      { name: 'ammonia ice', altKm: 8, color: 0xf4ecdc },
      { name: 'ammonium hydrosulphide', altKm: -20, color: 0xb07040 },
      { name: 'water ice and droplets', altKm: -50, color: 0xdce4f0 },
    ],
    sky: R(0.24, 0.34, 0.58), horizon: R(0.76, 0.66, 0.5), sunset: R(0.88, 0.5, 0.24), haze: 0.5,
    notes: 'Above the clouds, by volume (Galileo probe 1995; NASA). Water is cold-trapped below the clouds; Juno’s microwave sounding finds a few times the solar share deeper down. No surface: 1 bar is the reference level.',
  },
  Io: {
    kind: 'thin', bar: 1e-9, K: 110,
    mix: [['SO2', 0.9], ['SO', 0.05], ['S2', 0.03], ['O', 0.012], ['NaCl', 0.005], ['Na', 0.002], ['KCl', 5e-4], ['K', 2e-4]],
    clouds: [{ name: 'volcanic plumes', altKm: 100, topKm: 400, color: 0xe0d8c0 }],
    sky: R(0.003, 0.003, 0.002), horizon: R(0.01, 0.009, 0.006), sunset: R(0.02, 0.017, 0.01), haze: 0.01,
    notes: 'Patchy SO₂ about a nanobar thick, densest over the warm equator in daylight; it freezes out each time Io passes into Jupiter’s shadow and is resupplied by sublimation and volcanoes. Sodium escapes into a cloud round Jupiter.',
  },
  Europa: {
    kind: 'exosphere', bar: 1e-12, K: 102, mix: [['O2', 0.85], ['H2', 0.1], ['H2O', 0.042], ['Na', 0.007], ['K', 0.001]],
    notes: 'A tenuous O₂ exosphere, made as Jupiter’s radiation splits the surface ice (HST, Juno). Hubble has seen hints of water-vapour plumes from the ocean below.',
  },
  Ganymede: {
    kind: 'exosphere', bar: 1e-11, K: 110, mix: [['H2O', 0.5], ['O2', 0.45], ['H', 0.04], ['O', 0.01]],
    notes: 'O₂ from radiation splitting the ice, with water vapour subliming near the subsolar point (HST, Roth et al. 2021). Ganymede’s own magnetic field steers particles to its poles, where they glow as aurorae.',
  },
  Callisto: {
    kind: 'exosphere', bar: 7.5e-12, K: 134, mix: [['O2', 0.9], ['CO2', 0.08], ['H', 0.02]],
    notes: 'CO₂ seen by Galileo NIMS; perhaps a hundred times more O₂ is inferred from its ionosphere, and a hydrogen corona surrounds it.',
  },
  Saturn: {
    kind: 'envelope', bar: 1, K: 134, lapse: 0.85, tropoK: 82,
    mix: [['H2', 0.963], ['He', 0.0325], ['CH4', 0.0045], ['NH3', 1.25e-4], ['HD', 1.1e-4], ['C2H6', 7e-6], ['PH3', 3e-6]],
    clouds: [
      { name: 'photochemical haze', altKm: 40, color: 0xe0c890 },
      { name: 'ammonia ice', altKm: -15, color: 0xf4e8c8 },
      { name: 'ammonium hydrosulphide', altKm: -90, color: 0xc89860 },
      { name: 'water ice', altKm: -200, color: 0xdce4f0 },
    ],
    sky: R(0.42, 0.4, 0.42), horizon: R(0.8, 0.7, 0.48), sunset: R(0.86, 0.56, 0.3), haze: 0.6,
    notes: 'Voyager and Cassini, above the clouds. The helium share is uncertain (3–13% by volume) because helium is raining out into the interior. No surface: 1 bar is the reference level.',
  },
  Titan: {
    kind: 'thick', bar: 1.467, K: 93.7, lapse: 0.8, tropoK: 70.4,
    mix: [['N2', 0.984], ['CH4', 0.014], ['H2', 0.001], ['CO', 47e-6], ['Ar', 34e-6], ['C2H6', 10e-6], ['C2H2', 3e-6], ['HCN', 1e-6], ['C3H8', 0.5e-6]],
    clouds: [
      { name: 'methane clouds', altKm: 20, topKm: 30, color: 0xf0e8d8 },
      { name: 'ethane polar cloud', altKm: 40, color: 0xe8e0d0 },
      { name: 'organic haze', altKm: 100, topKm: 300, color: 0xd08a30 },
      { name: 'detached haze', altKm: 500, color: 0xc89040 },
    ],
    sky: R(0.3, 0.15, 0.04), horizon: R(0.4, 0.22, 0.07), sunset: R(0.24, 0.1, 0.02), haze: 0.85,
    notes: 'Huygens, 2005: 1.467 bar and 93.7 K at the ground. Methane is 1.4% in the stratosphere (the figure given) and rises to 5.7% near the surface, where it rains; sunlight breaks it into the orange organic haze.',
  },
  Enceladus: {
    kind: 'exosphere', bar: 1e-13, K: 75, mix: [['H2O', 0.975], ['H2', 0.009], ['NH3', 0.008], ['CO2', 0.006], ['CH4', 0.002]],
    notes: 'No atmosphere, but a plume: 100–1,000 kg/s of vapour and ice escapes from the “tiger stripes” at the south pole. Fractions are for the plume (Cassini INMS, Waite et al. 2017); the H₂ points to hydrothermal vents on the ocean floor.',
  },
  Mimas: NONE(64, 'No atmosphere.'),
  Tethys: NONE(86, 'No atmosphere detected.'),
  Dione: {
    kind: 'exosphere', bar: 1.2e-15, K: 87, mix: [['O2', 0.95], ['CO2', 0.05]],
    notes: 'Cassini picked up O₂ ions near Dione: about one molecule per 10 cm³, made by radiation hitting the ice (Tokar et al. 2012).',
  },
  Rhea: {
    kind: 'exosphere', bar: 7e-16, K: 76, mix: [['O2', 0.7], ['CO2', 0.3]],
    notes: 'Cassini flew through an exosphere of O₂ and CO₂ in 2010 (Teolis et al.), the first oxygen sampled directly at another world.',
  },
  Hyperion: NONE(93, 'No atmosphere.'),
  Iapetus: NONE(110, 'No atmosphere.'),
  Uranus: {
    kind: 'envelope', bar: 1, K: 76, lapse: 0.7, tropoK: 53,
    mix: [['H2', 0.825], ['He', 0.152], ['CH4', 0.023], ['HD', 1.48e-4], ['H2S', 0.8e-6], ['C2H6', 0.1e-6], ['CO', 0.03e-6]],
    clouds: [
      { name: 'methane ice', altKm: -10, color: 0xd8f0f0 },
      { name: 'hydrogen sulphide ice', altKm: -45, color: 0xa8b8a8 },
      { name: 'ammonium hydrosulphide', altKm: -120, color: 0x908070 },
    ],
    sky: R(0.16, 0.46, 0.54), horizon: R(0.44, 0.68, 0.72), sunset: R(0.52, 0.62, 0.42), haze: 0.45,
    notes: 'Voyager 2 and telescopes since. Methane absorbs red light, which gives the cyan colour; hydrogen sulphide lies under the clouds. No surface: 1 bar is the reference level.',
  },
  Miranda: NONE(60, 'No atmosphere.'),
  Ariel: NONE(60, 'No atmosphere detected.'),
  Umbriel: NONE(75, 'No atmosphere detected.'),
  Titania: NONE(70, 'No atmosphere: a stellar occultation in 2001 set an upper limit of 10–20 nbar.'),
  Oberon: NONE(75, 'No atmosphere detected.'),
  Neptune: {
    kind: 'envelope', bar: 1, K: 72, lapse: 0.7, tropoK: 52,
    mix: [['H2', 0.8], ['He', 0.19], ['CH4', 0.015], ['HD', 1.92e-4], ['C2H6', 1.5e-6], ['CO', 1e-6], ['H2S', 1e-6]],
    clouds: [
      { name: 'bright methane cirrus', altKm: 40, color: 0xffffff },
      { name: 'methane ice', altKm: -10, color: 0xe0f0f8 },
      { name: 'hydrogen sulphide ice', altKm: -40, color: 0xa0a8a0 },
      { name: 'ammonium hydrosulphide', altKm: -100, color: 0x808070 },
    ],
    sky: R(0.06, 0.18, 0.52), horizon: R(0.24, 0.4, 0.7), sunset: R(0.3, 0.4, 0.52), haze: 0.4,
    notes: 'Voyager 2. Methane absorbs the red, and the haze is thinner than Uranus’s, so it looks a deeper blue. Winds reach 2,000 km/h, the fastest in the Solar System.',
  },
  Triton: {
    kind: 'thin', bar: 1.4e-5, K: 38, lapse: 0, tropoK: 38,
    mix: [['N2', 0.9992], ['CO', 6e-4], ['CH4', 2e-4]],
    clouds: [
      { name: 'nitrogen-ice haze', altKm: 1, topKm: 8, color: 0xd0d8e0 },
      { name: 'geyser plumes', altKm: 8, color: 0x403830 },
    ],
    sky: R(0.015, 0.02, 0.035), horizon: R(0.04, 0.05, 0.075), sunset: R(0.06, 0.08, 0.14), haze: 0.02,
    notes: 'Voyager 2, 1989: 14 µbar of N₂ in vapour-pressure balance with the nitrogen frost (CO from Lellouch et al. 2010). Dark geyser plumes rise 8 km and drift downwind.',
  },
  Pluto: {
    kind: 'thin', bar: 1.1e-5, K: 44, lapse: -3.5, tropoK: 107,
    mix: [['N2', 0.997], ['CH4', 0.0025], ['CO', 5e-4], ['C2H2', 3e-6], ['C2H4', 2e-6], ['C2H6', 1e-6], ['HCN', 0.04e-6]],
    clouds: [{ name: 'blue tholin haze layers', altKm: 0, topKm: 200, color: 0x6080b0 }],
    sky: R(0.02, 0.03, 0.05), horizon: R(0.05, 0.07, 0.11), sunset: R(0.08, 0.12, 0.22), haze: 0.02,
    notes: 'New Horizons, 2015: about 11 µbar, in vapour-pressure balance with the nitrogen ice of Sputnik Planitia. The air warms to ~107 K 20–30 km up, and more than 20 blue haze layers reach past 200 km.',
  },
  Charon: NONE(53, 'No atmosphere; methane escaping from Pluto freezes onto Charon’s winter pole and is reddened into Mordor Macula.'),
  Eris: NONE(42, 'Its nitrogen and methane are frozen onto the ground this far out; a 2010 occultation set an upper limit of ~1 nbar. It may thaw into a Pluto-like atmosphere near perihelion in 2257.'),
  Makemake: NONE(40, 'A 2011 stellar occultation found no global atmosphere above 4–12 nbar.'),
  Haumea: NONE(50, 'A 2017 stellar occultation found no global atmosphere.'),
};

/** the measured-data key for a body: its `look.real`, or the Sun itself while it is still the Sun */
function realKey(b: Body): string | undefined {
  if (b.look.real) return b.look.real;
  if (b.kind === 'sun' && b.cls === 'star' && b.star?.phase === 'ms' && Math.abs(b.m - 1) < 0.02) return 'Sun';
  return undefined;
}

// ------------------------------------------------------------------ made-up air

const GIANT_STYLES = new Set(['gas', 'icegiant', 'hotjupiter', 'browndwarf']);
const isGiant = (b: Body) => b.cls === 'gas' || GIANT_STYLES.has(b.look.style);

/** condensates for giant cloud decks: name, condensation temperature (K), colour */
const DECKS: [string, number, number, 'hot' | 'cold' | 'ice'][] = [
  ['iron droplets', 2100, 0x585450, 'hot'], ['corundum', 1950, 0xd0a0a0, 'hot'], ['silicates (forsterite, enstatite)', 1750, 0xc8b090, 'hot'],
  ['manganese sulphide', 1300, 0xb09070, 'hot'], ['sodium sulphide', 1000, 0x9a7a6a, 'hot'], ['potassium chloride', 850, 0xd8d0c8, 'hot'],
  ['water ice and droplets', 270, 0xe8eef8, 'cold'], ['ammonium hydrosulphide', 205, 0xa06840, 'cold'], ['ammonia ice', 150, 0xf4ecdc, 'cold'],
  ['hydrogen sulphide ice', 110, 0xc0c0a8, 'ice'], ['methane ice', 80, 0xe0f4f8, 'ice'],
];

function giantAir(b: Body, teq: number, star: RGB): Atmosphere {
  const r = rng(b.look.seed ^ 0x9e3779b9);
  const style = b.look.style;
  const { g } = gravity(b);
  const mJ = b.m / M_JUP;
  const icy = style === 'icegiant';
  const A = style === 'hotjupiter' ? 0.05 : icy ? 0.3 : 0.34;
  const tirr = teq * Math.pow(1 - A, 0.25);
  const tint = icy ? span(r, 35, 55) : 100 * Math.pow(Math.max(mJ, 1e-3), 0.6) * span(r, 0.8, 1.2);
  const teff = Math.pow(tirr ** 4 + tint ** 4, 0.25);
  const T1 = 1.3 * teff;
  const metal = logSpan(r, 0.5, 3);
  let mix: Mix;
  if (icy) {
    mix = [['H2', 0.8], ['He', span(r, 0.15, 0.19)], ['CH4', span(r, 0.01, 0.035)], ['HD', 1.6e-4], ['H2S', 1e-6], ['CO', 1e-6], ['C2H6', 1e-6]];
  } else {
    mix = [['H2', 0.86], ['He', span(r, 0.12, 0.145)], ['HD', 3e-5]];
    if (T1 < 1100) mix.push(['CH4', 0.003 * metal * (T1 < 700 ? 1 : (1100 - T1) / 400)]);
    if (T1 > 700) mix.push(['CO', 6e-4 * metal * Math.min(1, (T1 - 700) / 400)], ['CH4', 1e-6]);
    mix.push(['H2O', T1 < 300 ? 5e-6 : 5e-4 * metal]);
    if (T1 < 1300) mix.push(['NH3', T1 < 130 ? 2e-6 : (T1 < 600 ? 2e-4 : 3e-5) * metal]);
    if (T1 < 400) mix.push(['PH3', 1e-6], ['C2H6', 5e-6]);
    if (T1 > 800) mix.push(['Na', 2e-6 * metal], ['K', 1e-7 * metal]);
    if (T1 > 1700) mix.push(['TiO', 1e-7 * metal], ['VO', 1e-8 * metal], ['FeH', 1e-8 * metal]);
    if (T1 > 2500) mix.push(['H', 0.01 * Math.min(1, (T1 - 2500) / 1500)]);
  }
  mix = normalise(mix);
  const M = molar(mix);
  const lapse = (g * M) / (3.5 * RGAS); // dry adiabat, K/km (M in g/mol, so ×1000/1000)
  const tropoK = 0.84 * teff;
  const clouds: Cloud[] = [];
  const zDeep = -400;
  for (const [name, Tc, color, set] of DECKS) {
    const ok = icy ? set !== 'hot' && name !== 'ammonia ice' : set === 'hot' || set === 'cold' || (name === 'methane ice' && tropoK < 80);
    if (!ok || Tc < tropoK || lapse <= 0) continue;
    const z = (T1 - Tc) / lapse;
    if (z < zDeep || z > 100) continue;
    clouds.push({ name, altKm: Math.round(z), color });
  }
  const hazeTau = T1 > 1000 ? span(r, 1, 3) : span(r, 0.5, 2);
  const aer = T1 > 1000 ? { ...GIANT_HAZE(hazeTau), w: [0.9, 0.7, 0.5] as RGB } : GIANT_HAZE(hazeTau);
  const kindName = style === 'browndwarf' ? 'brown dwarf' : style === 'hotjupiter' ? 'hot Jupiter' : icy ? 'ice giant' : 'gas giant';
  return finish(b, {
    kind: 'envelope', bar: 1, K: T1, mix, clouds, lapse, tropoK, aer,
    notes: `Estimated for a ${kindName}: about ${Math.round(teff)} K effective temperature (${Math.round(tint)} K of it internal heat), ${Math.round(T1)} K at the 1-bar level.` +
      (T1 > 1100 ? ' Too hot for methane: carbon is in CO, and metal vapours and oxides colour the air.' : ''),
  }, false, star);
}

function starAir(b: Body): Atmosphere {
  const { g } = gravity(b);
  const T = b.star?.teff || 5772;
  const kappa = T < 7000 ? 0.03 : T < 30000 ? 1 : 0.04; // photospheric opacity, m²/kg
  const bar = (g / kappa) / 1e5;
  const ion = clamp((T - 7000) / 8000, 0, 1);
  let mix: Mix = [['H', 0.9206], ['He', 0.0782], ['O', 4.5e-4], ['C', 2.5e-4], ['Ne', 7.8e-5], ['N', 6.2e-5], ['Mg', 3.7e-5], ['Si', 3e-5], ['Fe', 2.9e-5], ['S', 1.2e-5]];
  if (T < 4000) mix = mix.concat([['H2', 0.02], ['CO', 4e-4], ['H2O', 1e-5], ['TiO', 1e-7]]);
  mix = normalise(mix);
  const M = molar(mix, ion);
  const H = g > 0 ? (RGAS * T) / ((M / 1000) * g) / 1000 : 0;
  const c = starColour(T);
  return finish(b, {
    kind: 'envelope', bar, K: T, mix, ionised: ion, lapse: H > 0 ? (0.25 * T) / (3.5 * H) : 0, tropoK: 0.75 * T,
    sky: c, horizon: clampRGB(c.map(x => x * 0.95)), sunset: clampRGB(c.map(x => x * 0.9)), haze: 1,
    notes: `A stellar photosphere at ${Math.round(T).toLocaleString('en-US')} K, assumed solar in make-up.` + (T < 4000 ? ' Cool enough for molecules: TiO and water bands.' : T > 10000 ? ' Hot enough to ionise most of the hydrogen.' : ''),
  }, false);
}

function remnantAir(b: Body): Atmosphere {
  if (b.cls === 'bh') return finish(b, NONE(0, 'No surface and no atmosphere: whatever falls in is gone.'), false);
  const { g } = gravity(b);
  const T = b.star?.teff || (b.cls === 'ns' ? 1e6 : 6000);
  const r = rng(b.look.seed ^ 0x5bd1e995);
  if (b.cls === 'ns') {
    const carbon = r() < 0.3;
    return finish(b, {
      kind: 'thin', bar: (g / 0.04) / 1e5, K: T, mix: carbon ? [['C', 1]] : [['H', 1]], ionised: carbon ? 0 : 1,
      sky: starColour(T), horizon: starColour(T), sunset: starColour(T), haze: 1,
      notes: `A ${carbon ? 'carbon' : 'hydrogen'} atmosphere a few centimetres deep, crushed by gravity a hundred billion times Earth’s; it shapes the X-rays we see.`,
    }, false);
  }
  const da = r() < 0.8;
  return finish(b, {
    kind: 'thin', bar: (g / (T > 7000 ? 1 : 0.03)) / 1e5, K: T, mix: da ? [['H', 0.9999], ['He', 1e-4]] : [['He', 0.999], ['C', 1e-3]], ionised: clamp((T - 7000) / 8000, 0, 1),
    sky: starColour(T), horizon: starColour(T), sunset: starColour(T), haze: 1,
    notes: da ? 'A DA white dwarf: gravity has sunk everything heavier, leaving a skin of pure hydrogen.' : 'A DB white dwarf: a helium skin with a trace of dredged-up carbon.',
  }, false);
}

const ROCK_VAPOUR: Mix = [['Na', 0.35], ['O2', 0.2], ['O', 0.1], ['SiO', 0.15], ['K', 0.06], ['Fe', 0.04], ['Mg', 0.03], ['SO2', 0.02]];
/** vapour pressure over molten silicate, bar */
const rockVapourBar = (T: number) => clamp(1e-4 * Math.exp((T - 1500) / 250), 1e-7, 0.5);

function solidAir(b: Body, teq: number, star: RGB): Atmosphere {
  const r = rng(b.look.seed ^ 0x27d4eb2f);
  const style = b.look.style;
  const { g, vesc } = gravity(b);
  const mE = b.m / M_EARTH;
  /** Jeans: keeps a gas of molar mass mu (g/mol) if escape speed is six times its mean thermal speed */
  const holds = (mu: number, T = teq) => vesc > 6 * Math.sqrt((3 * RGAS * Math.max(T, 1)) / (mu / 1000));
  const molten = style === 'lava' || b.heat > 0.55;
  const Thot = style === 'lava' ? 1200 + 600 * clamp(b.heat, 0, 1) : 1200 + 1300 * clamp((b.heat - 0.55) / 0.45, 0, 1);
  const albedo: Record<string, number> = { terran: span(r, 0.25, 0.35), ocean: 0.28, desert: 0.25, ice: 0.6, lava: 0.1, rocky: 0.15, barren: 0.12, iron: 0.1, carbon: 0.05 };
  let A = albedo[style] ?? 0.15;
  const tirr = () => teq * Math.pow(1 - A, 0.25);

  let d: Draft | null = null;
  const wet = (mix: Mix, bar: number, rh: number, cap: number) => {
    let T = tirr(), m = mix;
    for (let i = 0; i < 8; i++) {
      m = setFrac(m, 'H2O', clamp((rh * psatWater(T)) / bar, 1e-6, cap));
      T = surfaceTemp(tirr(), greenhouseTau(m, bar));
    }
    return { mix: m, K: T };
  };
  const lapseFor = (mix: Mix, T: number, moist: number) => {
    const co2 = fracOf(mix, 'CO2');
    const cpR = 3.5 * (1 - co2) + co2 * (4.5 + 1.5 * clamp((T - 300) / 400, 0, 1));
    return ((g * molar(mix)) / (cpR * RGAS)) * moist;
  };

  if (style === 'terran' && holds(28)) {
    const bar = logSpan(r, 0.5, 2);
    const base: Mix = [['N2', 1], ['O2', span(r, 0.1, 0.3)], ['Ar', span(r, 0.005, 0.015)], ['CO2', logSpan(r, 2e-4, 1.5e-3)],
      ['Ne', 18e-6], ['He', 5e-6], ['CH4', span(r, 1, 3) * 1e-6], ['Kr', 1.1e-6], ['H2', 0.5e-6], ['N2O', 0.3e-6], ['CO', 0.1e-6], ['Xe', 0.09e-6], ['O3', 0.04e-6]];
    const o2 = base[1][1], ar = base[2][1], co2 = base[3][1];
    base[0][1] = 1 - o2 - ar - co2 - 3e-5;
    const w = wet(base, bar, 0.25, 0.04);
    d = {
      kind: 'thick', bar, K: w.K, mix: w.mix, lapse: lapseFor(w.mix, w.K, 0.66), tropoK: 0.84 * tirr(), aer: { ...CLEAR, tau: span(r, 0.06, 0.15) },
      clouds: [{ name: 'water clouds', altKm: span(r, 1.5, 3), topKm: span(r, 5, 8), color: 0xffffff }, { name: 'cirrus (ice crystals)', altKm: span(r, 8, 12), color: 0xf4f8ff }],
      notes: 'Presumed Earth-like: nitrogen with oxygen kept up by photosynthesis, a little argon and CO₂, water vapour set by the temperature.',
    };
  } else if (style === 'ocean' && holds(28)) {
    const bar = span(r, 1, 5);
    const co2 = logSpan(r, 0.003, 0.03);
    const base: Mix = [['N2', 1 - co2 - 0.01], ['CO2', co2], ['Ar', 0.01], ['O2', 1e-5], ['Ne', 15e-6], ['He', 5e-6], ['CH4', 1e-6]];
    const w = wet(base, bar, 0.6, 0.1);
    d = {
      kind: 'thick', bar, K: w.K, mix: w.mix, lapse: lapseFor(w.mix, w.K, 0.6), tropoK: 0.84 * tirr(), aer: { ...CLEAR, tau: span(r, 0.1, 0.25) },
      clouds: [{ name: 'water clouds', altKm: span(r, 1, 3), topKm: span(r, 6, 10), color: 0xffffff }, { name: 'high ice cloud', altKm: span(r, 10, 15), color: 0xf0f4ff }],
      notes: 'Presumed for a global ocean: nitrogen and a lot of water vapour, CO₂ dissolved and outgassed by the sea; no life is assumed, so almost no oxygen.',
    };
  } else if (style === 'desert' && holds(44)) {
    const bar = logSpan(r, 0.01, 0.3);
    const mix: Mix = normalise([['CO2', span(r, 0.85, 0.97)], ['N2', span(r, 0.02, 0.1)], ['Ar', span(r, 0.01, 0.03)], ['O2', 0.0015], ['CO', 7e-4],
      ['H2O', logSpan(r, 1e-4, 5e-4)], ['Ne', 2.5e-6], ['Kr', 3e-7], ['Xe', 8e-8], ['O3', 1e-7]]);
    const K = surfaceTemp(tirr(), greenhouseTau(mix, bar));
    const clouds: Cloud[] = [{ name: 'suspended dust', altKm: 0, topKm: 30, color: 0xc89060 }];
    if (K < 260) clouds.push({ name: 'water-ice clouds', altKm: span(r, 15, 25), color: 0xe8ecf4 });
    if (K < 230) clouds.push({ name: 'CO₂-ice clouds', altKm: span(r, 50, 80), color: 0xf0f4ff });
    d = { kind: 'thin', bar, K, mix, clouds, lapse: lapseFor(mix, K, 0.6), tropoK: 0.7 * K, aer: DUST(span(r, 0.2, 0.6)), notes: 'Presumed Mars-like: thin CO₂ with nitrogen and argon, dusty enough to turn the sky butterscotch and the sunsets blue.' };
  } else if (style === 'ice' || b.cls === 'ice') {
    A = style === 'ice' ? 0.6 : A;
    const T = tirr();
    const n2bar = Math.exp(11.75 - 871 / Math.max(T, 1));
    if (T < 63 && holds(28) && n2bar > 1e-9) {
      const mix = normalise([['N2', 1], ['CH4', span(r, 0.002, 0.005)], ['CO', span(r, 2e-4, 8e-4)], ['C2H6', 1e-6], ['C2H2', 2e-6]]);
      d = {
        kind: 'thin', bar: n2bar, K: T, mix, lapse: -span(r, 2, 4), tropoK: span(r, 90, 110), aer: THOLIN(0.02),
        clouds: [{ name: 'tholin haze layers', altKm: 0, topKm: 200, color: 0x6080b0 }],
        sky: R(0.02, 0.03, 0.05), horizon: R(0.05, 0.07, 0.11), sunset: R(0.08, 0.12, 0.22), haze: 0.02,
        notes: 'Presumed Pluto-like: nitrogen in vapour-pressure balance with its own frost, so the pressure rises steeply with temperature.',
      };
    } else if (T >= 63 && T < 120 && holds(16) && mE > 0.01) {
      const bar = span(r, 0.5, 3);
      const mix = normalise([['N2', 1], ['CH4', span(r, 0.01, 0.05)], ['H2', 0.001], ['CO', 5e-5], ['Ar', 3e-5], ['C2H6', 1e-5], ['C2H2', 3e-6], ['HCN', 1e-6]]);
      const K = surfaceTemp(tirr(), greenhouseTau(mix, bar));
      d = {
        kind: 'thick', bar, K, mix, lapse: 0.8, tropoK: 0.75 * K, aer: THOLIN(span(r, 2, 5)),
        clouds: [{ name: 'methane clouds', altKm: span(r, 15, 25), color: 0xf0e8d8 }, { name: 'organic haze', altKm: 100, topKm: 300, color: 0xd08a30 }],
        notes: 'Presumed Titan-like: nitrogen with methane that rains, and an orange haze made from it by sunlight.',
      };
    } else if (mE > 1e-4 && holds(32)) {
      d = { kind: 'exosphere', bar: 1e-12, K: T, mix: T > 120 ? [['H2O', 0.6], ['O2', 0.35], ['H2', 0.05]] : [['O2', 0.85], ['H2', 0.1], ['H2O', 0.05]], notes: 'An exosphere of oxygen and water knocked off the ice by sunlight and radiation.' };
    } else d = NONE(T, 'Too small or too warm to keep any gas.');
  }
  if (!d && mE >= 0.5 && holds(44) && holds(28) && style !== 'lava') {
    if (tirr() > 300 || teq > 320) {
      A = 0.75;
      const bar = span(r, 30, 100);
      const mix: Mix = [['CO2', 0.965], ['N2', 0.035], ['SO2', 150e-6], ['Ar', 70e-6], ['H2O', 20e-6], ['CO', 17e-6], ['He', 12e-6], ['Ne', 7e-6], ['OCS', 4e-6]];
      const K = surfaceTemp(tirr(), greenhouseTau(mix, bar));
      d = {
        kind: 'thick', bar, K, mix, lapse: lapseFor(mix, K, 0.9), tropoK: Math.max(0.84 * tirr(), 180), aer: SULPHURIC(span(r, 25, 35)),
        clouds: [{ name: 'sulphuric acid cloud deck', altKm: span(r, 44, 50), topKm: span(r, 65, 72), color: 0xf0e0a8 }],
        notes: 'Presumed Venus-like: too warm to keep its water, so the CO₂ stays in the air and a runaway greenhouse bakes the ground.',
      };
    } else {
      const bar = logSpan(r, 0.1, 10);
      const carbon = style === 'carbon';
      const co2 = span(r, 0.3, 0.97);
      const mix: Mix = normalise(carbon
        ? [['CO', co2 * 0.7], ['CH4', co2 * 0.3], ['N2', 1 - co2], ['Ar', 0.01], ['H2', 0.005]]
        : [['CO2', co2], ['N2', 1 - co2], ['Ar', span(r, 0.005, 0.02)], ['H2O', 1e-4], ['CO', 1e-4], ['Ne', 5e-6]]);
      const K = surfaceTemp(tirr(), greenhouseTau(mix, bar));
      d = {
        kind: bar >= 0.3 ? 'thick' : 'thin', bar, K, mix, lapse: lapseFor(mix, K, 0.8), tropoK: 0.84 * tirr(), aer: carbon ? THOLIN(span(r, 0.5, 2)) : DUST(span(r, 0.05, 0.2)),
        notes: carbon ? 'Presumed for a carbon world: carbon monoxide and methane rather than CO₂, under an organic haze.' : 'Presumed: outgassed CO₂ and nitrogen, held by a planet heavy enough to keep them.',
      };
    }
  }
  if (!d && (style === 'lava' || molten)) d = { kind: 'none', bar: 0, K: tirr(), mix: [], notes: '' }; // vapour added below
  if (!d) {
    const T = tirr();
    if (mE >= 0.005 && T > 100) d = { kind: 'exosphere', bar: 1e-14, K: T, mix: [['O', 0.4], ['Na', 0.25], ['He', 0.15], ['H', 0.1], ['Ar', 0.08], ['K', 0.01], ['Ca', 0.005], ['Mg', 0.005]], notes: 'An exosphere of atoms knocked off the rock by starlight, the stellar wind and micrometeorites.' };
    else d = NONE(T, 'No atmosphere: too small to keep any gas.');
  }

  // a molten surface boils rock into the air
  if (molten) {
    const T = Math.max(d.K, Thot, tirr());
    if (holds(44, T)) {
      const pv = rockVapourBar(T);
      const seedSO2 = r() < 0.4;
      let vap = ROCK_VAPOUR.map(([k, f]): [Sp, number] => [k, k === 'SO2' && seedSO2 ? 0.3 : f]);
      vap = normalise(vap);
      if (d.kind === 'thick' || d.kind === 'thin') {
        const bar = d.bar + pv;
        const mix = normalise([...d.mix.map(([k, f]): [Sp, number] => [k, (f * d!.bar) / bar]), ...vap.map(([k, f]): [Sp, number] => [k, (f * pv) / bar])]);
        d = { ...d, bar, K: Math.max(d.K, T), mix, notes: d.notes + ' The surface is molten, adding rock vapour.' };
      } else {
        d = { kind: 'thin', bar: pv, K: T, mix: vap, lapse: 0, tropoK: T, aer: { tau: 0.2, w: [0.9, 0.8, 0.6], aur: [1, 0.8, 0.5], aurK: 0.2 }, notes: 'A thin, scorching air of rock vapour boiled off the magma: sodium, oxygen, silicon monoxide and potassium.' };
      }
    } else if (d.kind === 'none') {
      d = { kind: 'exosphere', bar: 1e-13, K: T, mix: normalise(ROCK_VAPOUR), notes: 'Rock vapour boils off the molten surface faster than gravity can hold it.' };
    }
  }
  return finish(b, d, false, star);
}

/** what a body's air is made of, its temperature, pressure, clouds and sky */
export function atmosphereOf(b: Body, stars: Body[]): Atmosphere {
  const key = realKey(b);
  if (key && Object.hasOwn(AIR, key)) {
    const d = AIR[key];
    if (key === 'Sun' && b.star?.teff) return finish(b, { ...d, K: b.star.teff }, true);
    return finish(b, d, true);
  }
  if (b.isParticle || b.look.craft || b.look.wormhole) return finish(b, NONE(light(b, stars).teq, 'Too small for an atmosphere.'), false);
  if (b.cls === 'star') return starAir(b);
  if (b.compact) return remnantAir(b);
  const { teq, starT } = light(b, stars);
  const star = starColour(starT);
  return isGiant(b) ? giantAir(b, teq, star) : solidAir(b, teq, star);
}

/** pressure (bar), temperature (K) and density (kg/m³) at a height (m) above the surface, or above the 1-bar level for a giant (negative = deeper, where it gets hotter and denser) */
export function airAt(a: Atmosphere, b: Body, altM: number): { bar: number; K: number; rho: number } {
  const T0 = Math.max(fin(a.surfaceK, 0), 1);
  if (!(a.surfaceBar > 0) || !(a.molarMass > 0)) return { bar: 0, K: a.surfaceK, rho: 0 };
  const { g, R } = gravity(b);
  if (!(g > 0) || !(R > 0)) return { bar: 0, K: a.surfaceK, rho: 0 };
  const deep = a.kind === 'envelope';
  // below a solid surface only as far as real basins go; into a giant as deep as asked (to half its radius)
  let z = fin(altM, 0);
  z = Math.max(z, deep ? -0.5 * R : -Math.min(0.1 * R, 20e3));
  const zp = (z * R) / (R + z); // geopotential height: gravity weakens with height
  const M = a.molarMass / 1000;
  const k = (g * M) / RGAS; // K per m
  const lapse = fin(a.lapse ?? 0) / 1000;
  const Tt = Math.max(fin(a.tropoK ?? T0, T0), 1);
  const lnP0 = Math.log(a.surfaceBar);
  let T: number, lnP: number;
  if (zp < 0) {
    const gd = deep ? lapse : Math.max(lapse, 0);
    if (gd > 0) { T = T0 - gd * zp; lnP = lnP0 + (k / gd) * Math.log(T / T0); }
    else { T = T0; lnP = lnP0 - (k * zp) / T0; }
  } else if (lapse !== 0 && (lapse > 0 ? Tt < T0 : Tt > T0)) {
    const zt = (T0 - Tt) / lapse;
    if (zp <= zt) { T = T0 - lapse * zp; lnP = lnP0 + (k / lapse) * Math.log(T / T0); }
    else { T = Tt; lnP = lnP0 + (k / lapse) * Math.log(Tt / T0) - (k * (zp - zt)) / Tt; }
  } else { T = T0; lnP = lnP0 - (k * zp) / T0; }
  const bar = Math.exp(Math.min(fin(lnP, -1000), 69));
  const rho = (bar * 1e5 * M) / (RGAS * T);
  return { bar: fin(bar), K: fin(T, T0), rho: fin(rho) };
}

// ------------------------------------------------------------------ insides

type LayerRow = [string, number, number, State];
/** layers from rows of [name, outer radius fraction, colour, state], innermost first, made contiguous */
function stack(rows: LayerRow[]): Layer[] {
  const out: Layer[] = [];
  let r0 = 0;
  rows.forEach(([name, r1, color, state], i) => {
    const top = i === rows.length - 1 ? 1 : clamp(r1, r0, 1);
    if (top <= r0) return;
    out.push({ name, r0, r1: top, color, state });
    r0 = top;
  });
  if (out.length) out[out.length - 1].r1 = 1;
  return out;
}
type Parts = [string, number][];
const parts = (p: Parts) => p.map(([name, frac]) => ({ name, frac }));
function normParts(p: Parts): Parts {
  const s = sum(p.map(x => x[1]));
  return s > 0 ? p.filter(x => x[1] > 0).map(([n, f]) => [n, f / s]) : p;
}

interface RealInside { layers: LayerRow[]; surface: Parts; bulk: Parts; notes: string }

// colours
const FE_IN = 0xfff0c0, FE_OUT = 0xffa040, MANTLE = 0xc04020, UMANTLE = 0xe06030, CRUST = 0x806040, ROCK = 0x8a6a50, HROCK = 0x6a5a48;
const ICE = 0xdcecf8, HPICE = 0xa8c8e0, OCEAN = 0x2060b0, MOLH = 0xe8d8b0, ENV = 0xc8e0e8;

const INSIDE: Record<string, RealInside> = {
  Sun: {
    layers: [['core (hydrogen fusing to helium)', 0.25, 0xffffe0, 'plasma'], ['radiative zone', 0.713, 0xffc060, 'plasma'], ['convective zone', 1, 0xff8020, 'plasma']],
    surface: [['hydrogen', 0.7381], ['helium', 0.2485], ['heavier elements (O, C, Ne, Fe…)', 0.0134]],
    bulk: [['hydrogen', 0.705], ['helium', 0.28], ['heavier elements', 0.015]],
    notes: 'Helioseismology puts the base of the convective zone at 0.713 R☉. The surface figures are photospheric mass fractions (Asplund et al. 2009); the core has burned to ~65% helium.',
  },
  Mercury: {
    layers: [['solid inner core', 0.41, FE_IN, 'solid'], ['liquid iron outer core', 0.828, FE_OUT, 'liquid'], ['silicate mantle', 0.986, MANTLE, 'solid'], ['crust', 1, CRUST, 'solid']],
    surface: [['magnesian pyroxene and olivine', 0.45], ['plagioclase feldspar', 0.35], ['glass and other silicates', 0.12], ['calcium and magnesium sulphides', 0.05], ['graphite (low-reflectance material)', 0.03]],
    bulk: [['iron–nickel core', 0.7], ['silicate mantle and crust', 0.3]],
    notes: 'MESSENGER: the core reaches 2,020 km of the 2,440 km radius. The surface has almost no iron but is unusually rich in sulphur, potassium and dark graphite.',
  },
  Venus: {
    layers: [['iron core (state unknown)', 0.53, FE_OUT, 'liquid'], ['silicate mantle', 0.992, MANTLE, 'solid'], ['basaltic crust', 1, CRUST, 'solid']],
    surface: [['tholeiitic basalt plains', 0.8], ['alkaline basalt and lava flows', 0.1], ['tessera highlands (possibly felsic)', 0.08], ['metal frost on the peaks', 0.02]],
    bulk: [['iron–nickel core', 0.3], ['silicate mantle and crust', 0.7]],
    notes: 'Structure inferred by analogy with Earth; Venera and Vega landers found basalt. No magnetic field, so the core may not convect.',
  },
  Earth: {
    layers: [['solid inner core', 0.192, FE_IN, 'solid'], ['liquid outer core', 0.546, FE_OUT, 'liquid'], ['lower mantle', 0.896, MANTLE, 'solid'], ['upper mantle', 0.995, UMANTLE, 'solid'], ['crust', 1, CRUST, 'solid']],
    surface: [['ocean water', 0.708], ['soil and vegetated land', 0.17], ['bare rock and desert sand', 0.093], ['glacial ice', 0.029]],
    bulk: [['iron–nickel core', 0.325], ['silicate mantle', 0.67], ['crust', 0.0047], ['oceans and air', 0.00024]],
    notes: 'Seismology (PREM): the inner core is 1,221 km across, the outer core reaches 3,480 km. By element: Fe 32%, O 30%, Si 16%, Mg 15% (McDonough 2003).',
  },
  Moon: {
    layers: [['solid inner core', 0.138, FE_IN, 'solid'], ['fluid outer core', 0.19, FE_OUT, 'liquid'], ['partially molten layer', 0.276, 0xd05030, 'liquid'], ['mantle', 0.977, MANTLE, 'solid'], ['anorthosite crust', 1, 0xb0a898, 'solid']],
    surface: [['plagioclase (anorthosite highlands)', 0.52], ['pyroxene', 0.25], ['agglutinate glass', 0.13], ['olivine', 0.06], ['ilmenite (mare basalts)', 0.03], ['iron metal and troilite', 0.01]],
    bulk: [['iron core', 0.016], ['silicate mantle', 0.934], ['crust', 0.05]],
    notes: 'Apollo seismometers (Weber et al. 2011): a 240 km solid core in a 330 km fluid one. The dark maria, 16% of the surface, are ilmenite-rich basalt.',
  },
  Mars: {
    layers: [['liquid iron–sulphur core', 0.49, FE_OUT, 'liquid'], ['molten silicate layer', 0.54, 0xd05030, 'liquid'], ['mantle', 0.987, MANTLE, 'solid'], ['crust', 1, CRUST, 'solid']],
    surface: [['basalt (pyroxene, plagioclase, olivine)', 0.6], ['iron-oxide dust', 0.28], ['sulphates and clays', 0.08], ['water ice (polar caps)', 0.02], ['CO₂ frost (seasonal)', 0.01], ['perchlorate salts', 0.01]],
    bulk: [['iron–sulphur core', 0.25], ['silicate mantle', 0.72], ['crust', 0.03]],
    notes: 'InSight seismology: a liquid core of ~1,650 km under a molten silicate layer (Khan, Samuel et al. 2023). The red is nanophase iron oxide in the dust.',
  },
  Phobos: {
    layers: [['porous rubble interior', 0.97, HROCK, 'solid'], ['dusty regolith', 1, 0x4a4440, 'solid']],
    surface: [['dark carbon-rich regolith', 0.85], ['fresher blue-unit material', 0.15]],
    bulk: [['silicate rock', 0.85], ['carbon compounds', 0.1], ['water ice (possible)', 0.05]],
    notes: 'Density 1.86 g/cm³: perhaps a third empty space. Captured asteroid or debris from an impact on Mars; JAXA’s MMX is to bring back a sample.',
  },
  Deimos: {
    layers: [['porous rubble interior', 0.99, HROCK, 'solid'], ['smooth regolith blanket', 1, 0x6a625a, 'solid']],
    surface: [['dark carbon-rich regolith', 0.95], ['brighter crater streaks', 0.05]],
    bulk: [['silicate rock', 0.85], ['carbon compounds', 0.1], ['water ice (possible)', 0.05]],
    notes: 'Density 1.47 g/cm³, its craters half buried in fine regolith.',
  },
  Ceres: {
    layers: [['brine-soaked hydrated-rock interior', 0.915, 0x5a5048, 'solid'], ['icy crust (ice, salts, clathrates)', 1, 0x8a8682, 'ice']],
    surface: [['ammoniated clays (phyllosilicates)', 0.45], ['dark carbonaceous material', 0.35], ['magnesium and calcium carbonates', 0.15], ['organics', 0.03], ['exposed water ice', 0.01], ['sodium carbonate (Occator faculae)', 0.01]],
    bulk: [['hydrated silicates and carbonates', 0.73], ['water (ice and brine)', 0.25], ['organics', 0.02]],
    notes: 'Dawn: a 40 km crust over a dense, wet interior, with brine still reaching the surface at Occator crater.',
  },
  Vesta: {
    layers: [['iron core', 0.42, FE_OUT, 'solid'], ['olivine–pyroxene mantle', 0.92, MANTLE, 'solid'], ['basaltic (eucrite) crust', 1, 0x7a6e60, 'solid']],
    surface: [['howardite regolith', 0.55], ['eucrite basalt', 0.3], ['diogenite (orthopyroxene)', 0.12], ['dark carbonaceous infall', 0.03]],
    bulk: [['silicate mantle', 0.7], ['iron core', 0.18], ['basaltic crust', 0.12]],
    notes: 'Dawn: a differentiated protoplanet with a 110 km core. One meteorite in twenty that falls on Earth (the HEDs) came from it.',
  },
  Jupiter: {
    layers: [['dilute core: heavy elements in metallic hydrogen', 0.3, 0xa08060, 'metallic'], ['liquid metallic hydrogen', 0.78, 0x908070, 'metallic'], ['molecular hydrogen (helium rain at the base)', 0.996, MOLH, 'liquid'], ['weather layer', 1, 0xf0e0c8, 'gas']],
    surface: [['ammonia ice cloud tops', 0.6], ['ammonium hydrosulphide (belts)', 0.3], ['chromophores (sulphur, phosphorus, organics)', 0.1]],
    bulk: [['hydrogen', 0.69], ['helium', 0.25], ['heavy elements (rock, ice)', 0.06]],
    notes: 'Juno gravity data: the core is not compact but dissolved out to a third or more of the radius. Hydrogen turns metallic at about 2 Mbar.',
  },
  Io: {
    layers: [['iron–iron-sulphide core', 0.52, FE_OUT, 'liquid'], ['silicate mantle', 0.94, MANTLE, 'solid'], ['partly molten asthenosphere', 0.978, 0xff6020, 'liquid'], ['crust', 1, 0xc8b040, 'solid']],
    surface: [['sulphur and its allotropes', 0.35], ['SO₂ frost', 0.3], ['silicate lava (basaltic to ultramafic)', 0.3], ['chlorides and other salts', 0.05]],
    bulk: [['silicate rock', 0.8], ['iron–iron-sulphide core', 0.2]],
    notes: 'Tidal heating from Jupiter keeps 400 volcanoes going; Juno’s gravity data (2024) argue against a global magma ocean, favouring a hot, partly molten mantle.',
  },
  Europa: {
    layers: [['iron core', 0.27, FE_OUT, 'liquid'], ['rocky mantle', 0.935, ROCK, 'solid'], ['salty ocean', 0.985, OCEAN, 'liquid'], ['ice shell', 1, ICE, 'ice']],
    surface: [['water ice', 0.75], ['hydrated salts (Mg/Na sulphates, NaCl)', 0.15], ['sulphuric acid hydrate', 0.08], ['CO₂ and organics', 0.02]],
    bulk: [['silicate rock', 0.8], ['iron core', 0.12], ['water (ice and ocean)', 0.08]],
    notes: 'Galileo: an induced magnetic field means a conducting ocean, about 100 km deep under some 20 km of ice; twice the water of Earth’s oceans.',
  },
  Ganymede: {
    layers: [['iron core (dynamo)', 0.26, FE_OUT, 'liquid'], ['silicate mantle', 0.68, ROCK, 'solid'], ['high-pressure ice', 0.886, HPICE, 'ice'], ['salty ocean', 0.943, OCEAN, 'liquid'], ['ice-I shell', 1, ICE, 'ice']],
    surface: [['water ice (bright grooved terrain)', 0.65], ['dark material: hydrated silicates, organics', 0.3], ['CO₂ and salts', 0.05]],
    bulk: [['water (ice and ocean)', 0.46], ['silicate rock', 0.44], ['iron core', 0.1]],
    notes: 'The only moon with its own magnetic field. Its aurorae rock less than they would without an ocean, which sits ~150 km down (HST, Saur et al. 2015).',
  },
  Callisto: {
    layers: [['rock-rich interior', 0.25, ROCK, 'solid'], ['mixed rock and ice', 0.89, 0x6a6058, 'ice'], ['possible salty ocean', 0.93, OCEAN, 'liquid'], ['icy lithosphere', 1, 0x8a8070, 'ice']],
    surface: [['dark rock–ice regolith (silicates, organics, CO₂)', 0.8], ['bright water-ice frost', 0.2]],
    bulk: [['silicate rock', 0.55], ['water ice', 0.45]],
    notes: 'Only partly differentiated: rock and ice never fully separated. Galileo’s magnetometer hints at an ocean 100–200 km down.',
  },
  Saturn: {
    layers: [['dilute rock–ice core', 0.2, 0xa08060, 'liquid'], ['liquid metallic hydrogen (helium rain)', 0.5, 0x908070, 'metallic'], ['molecular hydrogen', 0.996, MOLH, 'liquid'], ['weather layer', 1, 0xf4e6c0, 'gas']],
    surface: [['ammonia ice cloud tops', 0.7], ['photochemical haze', 0.25], ['ammonium hydrosulphide', 0.05]],
    bulk: [['hydrogen', 0.61], ['helium', 0.22], ['heavy elements (rock, ice)', 0.17]],
    notes: 'Ring seismology (Mankovich & Fuller 2021): a diffuse core of ~17 Earth masses. Helium raining out releases heat, which is why Saturn glows more than it should.',
  },
  Mimas: {
    layers: [['rock–ice core', 0.45, ROCK, 'solid'], ['ice mantle', 0.75, HPICE, 'ice'], ['young subsurface ocean', 0.86, OCEAN, 'liquid'], ['ice shell', 1, ICE, 'ice']],
    surface: [['water ice', 0.98], ['silicate dust', 0.02]],
    bulk: [['water ice', 0.75], ['silicate rock', 0.25]],
    notes: 'Its wobble and orbit point to an ocean 20–30 km down that formed only in the last 25 million years (Lainey et al. 2024).',
  },
  Enceladus: {
    layers: [['porous rocky core', 0.75, ROCK, 'solid'], ['global salty ocean', 0.91, OCEAN, 'liquid'], ['ice shell', 1, ICE, 'ice']],
    surface: [['fresh water ice', 0.98], ['salts (NaCl) and silica', 0.01], ['CO₂, ammonia and organics', 0.01]],
    bulk: [['silicate rock', 0.6], ['water (ice and ocean)', 0.4]],
    notes: 'Cassini: a 40 km ocean under ~20 km of ice, thinner at the south pole where it vents. Phosphates and silica grains point to warm rock–water reactions.',
  },
  Tethys: {
    layers: [['small rocky centre', 0.3, ROCK, 'solid'], ['water ice', 1, ICE, 'ice']],
    surface: [['water ice', 0.99], ['other', 0.01]],
    bulk: [['water ice', 0.94], ['silicate rock', 0.06]],
    notes: 'Density 0.98 g/cm³: almost pure ice.',
  },
  Dione: {
    layers: [['rocky core', 0.71, ROCK, 'solid'], ['possible ocean', 0.82, OCEAN, 'liquid'], ['ice crust', 1, ICE, 'ice']],
    surface: [['water ice', 0.95], ['dark material', 0.05]],
    bulk: [['silicate rock', 0.5], ['water ice', 0.5]],
    notes: 'Cassini gravity suggests a 65 km ocean under a 100 km crust (Beuthe et al. 2016).',
  },
  Rhea: {
    layers: [['rock-enriched centre', 0.4, ROCK, 'solid'], ['ice–rock mixture', 1, ICE, 'ice']],
    surface: [['water ice', 0.95], ['dark material (organics, CO₂)', 0.05]],
    bulk: [['water ice', 0.67], ['silicate rock', 0.33]],
    notes: 'Density 1.24 g/cm³; its gravity field suggests rock and ice only partly separated.',
  },
  Titan: {
    layers: [['hydrated silicate core', 0.78, ROCK, 'solid'], ['high-pressure ice', 0.86, HPICE, 'ice'], ['salty water ocean', 0.96, OCEAN, 'liquid'], ['ice-I shell', 1, ICE, 'ice']],
    surface: [['organic sediment plains', 0.65], ['tholin sand dunes', 0.17], ['water-ice-rich hummocky bedrock', 0.14], ['methane–ethane lakes and seas', 0.015], ['eroded organic labyrinths', 0.015], ['crater ejecta', 0.01]],
    bulk: [['silicate rock', 0.56], ['water (ice and ocean)', 0.43], ['organics and volatiles', 0.01]],
    notes: 'Cassini: Titan’s tidal flexing needs an ocean under 50–100 km of ice. Surface units from Lopes et al. (2020); the seas hold hundreds of times Earth’s oil and gas reserves.',
  },
  Hyperion: {
    layers: [['porous ice rubble', 1, 0xb8a890, 'ice']],
    surface: [['water ice', 0.7], ['dark CO₂ and organics', 0.3]],
    bulk: [['water ice', 0.75], ['rock and dark material', 0.25]],
    notes: 'Density 0.54 g/cm³: nearly half empty space, like a sponge.',
  },
  Iapetus: {
    layers: [['rock–ice core', 0.4, ROCK, 'solid'], ['water ice', 1, ICE, 'ice']],
    surface: [['water ice', 0.6], ['dark organic lag (Cassini Regio)', 0.4]],
    bulk: [['water ice', 0.8], ['silicate rock', 0.2]],
    notes: 'Its leading side sweeps up dark dust from Phoebe; the dark ground warms, its ice moves to the bright side, and the contrast runs away.',
  },
  Uranus: {
    layers: [['rocky core', 0.2, HROCK, 'solid'], ['water–ammonia–methane ionic fluid', 0.75, 0x60a0c0, 'liquid'], ['hydrogen–helium–methane envelope', 1, ENV, 'gas']],
    surface: [['methane ice haze', 0.5], ['hydrogen sulphide ice', 0.45], ['hydrocarbon haze', 0.05]],
    bulk: [['water, ammonia and methane “ices”', 0.62], ['rock', 0.23], ['hydrogen and helium', 0.15]],
    notes: 'Models fitted to Voyager gravity; the “ices” are a hot, electrically conducting fluid that makes the lopsided magnetic field.',
  },
  Miranda: {
    layers: [['rocky core', 0.45, ROCK, 'solid'], ['ice mantle', 1, ICE, 'ice']],
    surface: [['water ice', 0.9], ['dark material', 0.1]],
    bulk: [['water ice', 0.6], ['silicate rock', 0.4]],
    notes: 'A patchwork of terrains; Verona Rupes is a 20 km cliff.',
  },
  Ariel: {
    layers: [['rocky core', 0.64, ROCK, 'solid'], ['ice mantle', 1, ICE, 'ice']],
    surface: [['water ice', 0.8], ['CO₂ ice (trailing side)', 0.1], ['ammonia-bearing and dark material', 0.1]],
    bulk: [['silicate rock', 0.55], ['water ice', 0.45]],
    notes: 'JWST found CO₂ ice and carbonates, perhaps from an ocean below.',
  },
  Umbriel: {
    layers: [['rocky core', 0.54, ROCK, 'solid'], ['ice mantle', 1, ICE, 'ice']],
    surface: [['water ice', 0.7], ['dark carbon-rich material', 0.28], ['CO₂ ice', 0.02]],
    bulk: [['water ice', 0.55], ['silicate rock', 0.45]],
    notes: 'The darkest of Uranus’s large moons.',
  },
  Titania: {
    layers: [['rocky core', 0.66, ROCK, 'solid'], ['possible thin ocean', 0.7, OCEAN, 'liquid'], ['ice mantle', 1, ICE, 'ice']],
    surface: [['water ice', 0.75], ['dark material', 0.2], ['CO₂ ice', 0.05]],
    bulk: [['silicate rock', 0.55], ['water ice', 0.45]],
    notes: 'Uranus’s largest moon; models allow a thin ocean at the core boundary.',
  },
  Oberon: {
    layers: [['rocky core', 0.63, ROCK, 'solid'], ['ice mantle', 1, ICE, 'ice']],
    surface: [['water ice', 0.7], ['dark material', 0.3]],
    bulk: [['silicate rock', 0.55], ['water ice', 0.45]],
    notes: 'Old, heavily cratered, with dark material on its crater floors.',
  },
  Neptune: {
    layers: [['rocky core', 0.25, HROCK, 'solid'], ['water–ammonia–methane ionic fluid', 0.8, 0x4070c0, 'liquid'], ['hydrogen–helium–methane envelope', 1, 0x6090e0, 'gas']],
    surface: [['hydrogen sulphide ice', 0.55], ['methane ice', 0.35], ['hydrocarbon haze', 0.1]],
    bulk: [['water, ammonia and methane “ices”', 0.65], ['rock', 0.25], ['hydrogen and helium', 0.1]],
    notes: 'Like Uranus but warmer inside: it gives out 2.6 times the heat it gets from the Sun.',
  },
  Triton: {
    layers: [['rock–metal core', 0.7, ROCK, 'solid'], ['possible ocean', 0.8, OCEAN, 'liquid'], ['water-ice shell', 1, ICE, 'ice']],
    surface: [['nitrogen ice', 0.55], ['water ice', 0.2], ['CO₂ ice', 0.2], ['methane ice', 0.03], ['CO ice', 0.01], ['dark plume deposits', 0.01]],
    bulk: [['silicate rock and metal', 0.68], ['water ice', 0.3], ['volatile ices', 0.02]],
    notes: 'Probably a captured Kuiper belt object, orbiting backwards; Voyager 2 saw a young surface with active geysers.',
  },
  Pluto: {
    layers: [['rocky core', 0.72, ROCK, 'solid'], ['possible ocean', 0.86, OCEAN, 'liquid'], ['water-ice shell', 1, ICE, 'ice']],
    surface: [['nitrogen ice (with CO and CH₄)', 0.4], ['tholins (Cthulhu)', 0.25], ['methane ice', 0.18], ['water ice (mountains, bedrock)', 0.15], ['CO ice', 0.01], ['ammonia hydrates', 0.01]],
    bulk: [['silicate rock', 0.66], ['water ice', 0.33], ['volatile ices', 0.01]],
    notes: 'New Horizons: Sputnik Planitia, a basin of nitrogen ice, sits over a likely ocean that keeps it lined up with Charon.',
  },
  Charon: {
    layers: [['rocky core', 0.7, ROCK, 'solid'], ['water-ice mantle (a frozen ocean)', 1, ICE, 'ice']],
    surface: [['crystalline water ice', 0.85], ['tholins (Mordor Macula)', 0.08], ['ammonia hydrates', 0.05], ['CO₂ and H₂O₂', 0.02]],
    bulk: [['silicate rock', 0.6], ['water ice', 0.4]],
    notes: 'Its old ocean froze and split the crust open into vast canyons; JWST found CO₂ and hydrogen peroxide.',
  },
  Eris: {
    layers: [['rocky core', 0.78, ROCK, 'solid'], ['water-ice mantle', 0.97, ICE, 'ice'], ['nitrogen–methane ice crust', 1, 0xf0ebe6, 'ice']],
    surface: [['methane frost', 0.6], ['nitrogen ice', 0.35], ['tholins and water ice', 0.05]],
    bulk: [['silicate rock', 0.85], ['water ice', 0.14], ['volatile ices', 0.01]],
    notes: 'Denser than Pluto (2.43 g/cm³), so more rock; one of the most reflective bodies known.',
  },
  Makemake: {
    layers: [['rocky core', 0.7, ROCK, 'solid'], ['water-ice mantle', 0.98, ICE, 'ice'], ['methane–ethane ice crust', 1, 0xc8a890, 'ice']],
    surface: [['methane ice', 0.75], ['tholins', 0.1], ['ethane ice', 0.1], ['nitrogen ice', 0.05]],
    bulk: [['silicate rock', 0.65], ['water ice', 0.34], ['volatile ices', 0.01]],
    notes: 'Red-brown methane-covered surface; JWST saw hints of methane gas, perhaps from plumes.',
  },
  Haumea: {
    layers: [['rocky core', 0.75, ROCK, 'solid'], ['crystalline water-ice mantle', 1, ICE, 'ice']],
    surface: [['crystalline water ice', 0.9], ['hydrated minerals and organics (red spot)', 0.1]],
    bulk: [['silicate rock', 0.8], ['water ice', 0.2]],
    notes: 'Spun into an egg by a 3.9-hour day; a giant impact stripped most of its ice into a family of fragments and a ring.',
  },
};

function starInside(b: Body): Composition {
  const s = b.star;
  const m = s?.m0 ?? b.m;
  const phase = s?.phase ?? 'ms';
  const he = phase === 'giant' || phase === 'agb' ? 0.35 : 0.27;
  const bulk = normParts([['hydrogen', 1 - he - 0.015], ['helium', he], ['heavier elements', 0.015]]);
  const surface = parts([['hydrogen', 0.7381], ['helium', 0.2485], ['heavier elements', 0.0134]]);
  let layers: LayerRow[];
  let notes: string;
  if (phase === 'giant' || phase === 'agb') {
    layers = [
      [phase === 'agb' ? 'carbon–oxygen core' : 'degenerate helium core', 0.0005, 0xffffff, 'plasma'],
      [phase === 'agb' ? 'helium- and hydrogen-burning shells' : 'hydrogen-burning shell', 0.001, 0xffffe0, 'plasma'],
      ['radiative zone', 0.1, 0xffc060, 'plasma'], ['deep convective envelope', 1, 0xff6020, 'plasma'],
    ];
    notes = 'A giant: a core the size of the Earth inside an envelope that convects all the way down, dredging up the products of burning.';
  } else if (phase === 'proto') {
    layers = [['contracting core', 0.2, 0xffd080, 'plasma'], ['fully convective interior', 1, 0xff8040, 'plasma']];
    notes = 'Still contracting: not yet fusing hydrogen, heated by its own collapse and convective throughout.';
  } else if (m < 0.35) {
    layers = [['core (hydrogen fusing)', 0.2, 0xffe0a0, 'plasma'], ['fully convective interior', 1, 0xff7030, 'plasma']];
    notes = 'A red dwarf: convective throughout, so it mixes all its hydrogen into the core and lives for trillions of years.';
  } else if (m < 1.3) {
    const rcz = clamp(0.6 + 0.25 * (m - 0.5), 0.6, 0.95);
    layers = [['core (hydrogen fusing)', 0.25, 0xffffe0, 'plasma'], ['radiative zone', rcz, 0xffc060, 'plasma'], ['convective zone', 1, 0xff8020, 'plasma']];
    notes = 'Built like the Sun: energy leaves the core as light, then by convection through the outer layers.';
  } else {
    layers = [['convective core (CNO cycle)', 0.2, 0xe0f0ff, 'plasma'], ['radiative envelope', 1, 0xa0c8ff, 'plasma']];
    notes = 'A massive star: the CNO cycle burns so fast that the core convects, while the envelope carries energy as light.';
  }
  return { layers: stack(layers), surface, bulk: parts(bulk), measured: false, notes };
}

function remnantInside(b: Body): Composition {
  if (b.cls === 'bh') return { layers: [], surface: [], bulk: parts([['mass–energy (nothing else can be known)', 1]]), measured: false, notes: 'Behind the event horizon nothing can be seen or said; a black hole has only mass, spin and charge.' };
  if (b.cls === 'ns') {
    const quark = b.kind === 'quark';
    if (quark) return { layers: stack([['strange quark matter', 0.999, 0xff60c0, 'liquid'], ['thin crust of normal nuclei', 1, 0xc0c0d0, 'solid']]), surface: parts([['iron-group nuclei', 1]]), bulk: parts([['up, down and strange quarks', 1]]), measured: false, notes: 'Hypothetical: matter compressed past neutrons into free quarks.' };
    return {
      layers: stack([['inner core (hyperons or quark matter?)', 0.4, 0xff80ff, 'liquid'], ['outer core: superfluid neutrons', 0.92, 0xc080ff, 'liquid'],
        ['inner crust: nuclei in a neutron sea (“pasta”)', 0.975, 0x8080c0, 'solid'], ['outer crust: iron-group lattice', 0.9995, 0xa0a0b0, 'solid'], ['ocean and atmosphere', 1, 0xffffff, 'plasma']]),
      surface: parts([['iron-group nuclei', 0.9], ['light elements (H, He, C)', 0.1]]),
      bulk: parts([['neutrons', 0.9], ['protons and electrons', 0.08], ['exotic matter (uncertain)', 0.02]]),
      measured: false, notes: 'A sugar cube of it weighs as much as a mountain; the crust is a kilometre thick and stronger than steel by a billion times.',
    };
  }
  const he = b.m < 0.45, one = b.m > 1.05;
  return {
    layers: stack([[he ? 'degenerate helium core' : one ? 'oxygen–neon core' : 'carbon–oxygen core (crystallising as it cools)', 0.98, 0xf0f0ff, (b.star?.age ?? 0) > 1e9 ? 'solid' : 'plasma'],
      ['helium layer', 0.995, 0xe0e8ff, 'plasma'], ['hydrogen skin', 1, 0xc8d8ff, 'plasma']]),
    surface: parts([['hydrogen', 0.8], ['helium', 0.2]]),
    bulk: parts(he ? [['helium', 0.99], ['hydrogen', 0.01]] : one ? [['oxygen', 0.6], ['neon', 0.3], ['magnesium', 0.1]] : [['carbon', 0.4], ['oxygen', 0.58], ['helium and hydrogen', 0.02]]),
    measured: false, notes: 'A white dwarf: the exposed core of a dead star, held up by electron degeneracy, slowly cooling.',
  };
}

function giantInside(b: Body): Composition {
  const r = rng(b.look.seed ^ 0x85ebca6b);
  const style = b.look.style;
  const mE = b.m / M_EARTH, mJ = b.m / M_JUP;
  const rho = densityOf(b.m, b.r);
  if (style === 'icegiant') {
    const dense = rho > 2;
    const core = dense ? 0.45 : span(r, 0.18, 0.27), mantle = dense ? 0.7 : span(r, 0.72, 0.82);
    const hhe = dense ? 0.05 : span(r, 0.08, 0.2);
    return {
      layers: stack([['rock and iron core', core, HROCK, 'solid'], ['water–ammonia–methane ionic fluid', mantle, 0x4080c0, 'liquid'], ['hydrogen–helium–methane envelope', 1, ENV, 'gas']]),
      surface: parts([['methane ice', 0.4], ['hydrogen sulphide ice', 0.45], ['hydrocarbon haze', 0.15]]),
      bulk: parts(normParts([['water, ammonia and methane “ices”', (1 - hhe) * 0.7], ['rock and iron', (1 - hhe) * 0.3], ['hydrogen and helium', hhe]])),
      measured: false, notes: 'Estimated for an ice giant: mostly hot “ices” under a hydrogen envelope.',
    };
  }
  const Z = clamp((10 + span(r, -3, 5)) / Math.max(mE, 1e-3) + 0.02, 0.015, 0.85);
  const brown = style === 'browndwarf' || mJ > 13;
  const coreKg = Math.min(10 * M_EARTH, 0.9 * Z * b.m) * MSUN_KG;
  const rCore = brown ? 0 : clamp(Math.cbrt((3 * coreKg) / (4 * Math.PI * 10000)) / (b.r * AU_M), 0.05, 0.6);
  const rMet = brown ? 0.92 : clamp((0.78 + 0.53 * Math.log10(Math.max(mJ, 1e-3))) * Math.min(1, 1.1 * (69911 * 1000) / (b.r * AU_M)), 0, 0.85);
  const rows: LayerRow[] = [];
  if (!brown) rows.push(['rock–ice core', rCore, 0xa08060, 'liquid']);
  if (rMet > rCore + 0.02) rows.push([brown ? 'degenerate metallic hydrogen–helium' : 'liquid metallic hydrogen', rMet, 0x908070, 'metallic']);
  rows.push(['molecular hydrogen', 0.996, MOLH, 'liquid'], ['weather layer', 1, 0xf0e0c8, 'gas']);
  const hot = style === 'hotjupiter';
  return {
    layers: stack(rows),
    surface: parts(brown ? (r() < 0.5 ? [['silicate and iron clouds', 0.7], ['clear patches', 0.3]] : [['sulphide and chloride hazes', 0.6], ['methane-cleared gaps', 0.4]])
      : hot ? [['silicate clouds', 0.5], ['iron droplets', 0.2], ['clear hot gas', 0.3]] : [['ammonia ice cloud tops', 0.6], ['ammonium hydrosulphide', 0.3], ['chromophores', 0.1]]),
    bulk: parts(brown ? [['hydrogen', 0.73], ['helium', 0.255], ['heavier elements', 0.015]] : normParts([['hydrogen', (1 - Z) * 0.73], ['helium', (1 - Z) * 0.27], ['heavy elements (rock, ice)', Z]])),
    measured: false,
    notes: brown ? 'Estimated for a brown dwarf: too light to fuse hydrogen, held up by degenerate electrons.' : `Estimated for a giant of ${Math.round(mE)} Earth masses, about ${Math.round(Z * 100)}% heavy elements.`,
  };
}

const SURFACE: Record<string, Parts> = {
  terran: [['ocean water', 0.7], ['soil and vegetated land', 0.17], ['bare rock and desert sand', 0.09], ['glacial ice', 0.04]],
  ocean: [['liquid water', 0.95], ['sea ice', 0.05]],
  rocky: [['basaltic rock', 0.6], ['regolith', 0.3], ['other silicates', 0.1]],
  barren: [['impact regolith', 0.6], ['basaltic and anorthositic bedrock', 0.3], ['impact glass', 0.1]],
  ice: [['water ice', 0.7], ['volatile ices (N₂, CH₄, CO, CO₂)', 0.15], ['dark organics (tholins)', 0.15]],
  lava: [['molten silicate (magma ocean)', 0.7], ['quenched glass crust', 0.3]],
  iron: [['iron–nickel metal', 0.6], ['silicate regolith', 0.3], ['troilite (FeS)', 0.1]],
  carbon: [['graphite', 0.5], ['silicon carbide', 0.3], ['hydrocarbon tar', 0.1], ['diamond-bearing rock', 0.1]],
  desert: [['basaltic sand', 0.5], ['iron-oxide dust', 0.35], ['salts and sulphates', 0.1], ['polar ice', 0.05]],
};

function solidInside(b: Body): Composition {
  const r = rng(b.look.seed ^ 0xc2b2ae35);
  const style = b.look.style;
  const mE = b.m / M_EARTH;
  const rKm = (b.r * AU_M) / 1000;
  const rho = b.cls === 'debris' ? b.dens : densityOf(b.m, b.r);
  const f = 1 + 0.36 * Math.sqrt(Math.min(mE, 40));
  const rho0 = rho / f;
  let xFe = 0, xIce = 0;
  if (rho0 >= 3.3) xFe = clamp((1 / 3.3 - 1 / rho0) / (1 / 3.3 - 1 / 7.9), 0, 0.95);
  else {
    xIce = clamp((1 / Math.max(rho0, 0.3) - 1 / 3.3) / (1 / 0.94 - 1 / 3.3), 0, 0.98);
    if (b.cls === 'rock' && rKm < 300 && style !== 'ice') xIce = 0; // a porous rock, not an icy one
    xFe = Math.min(0.15, xIce * 1.5) * (1 - xIce);
  }
  if (style === 'iron') xFe = Math.max(xFe, 0.6);
  const xRock = Math.max(0, 1 - xFe - xIce);
  const bulk = normParts([['iron–nickel', xFe], ['silicate rock', xRock], ['water and volatile ices', xIce]]);
  let surface = normParts((SURFACE[style] ?? SURFACE.rocky).map(([n, x]): [string, number] => [n, x * span(r, 0.7, 1.3)]));
  if (b.heat > 0.55 && style !== 'lava') surface = [['molten rock after an impact', 0.8], ['quenched glass', 0.2]];

  let layers: LayerRow[];
  if (rKm < 200 || b.cls === 'debris') {
    const what = xFe > 0.5 ? 'iron–nickel' : xIce > 0.3 ? 'ice and rock' : style === 'carbon' || style === 'barren' ? 'carbonaceous rock' : 'silicate rock';
    layers = [[`${rKm < 50 ? 'rubble pile' : 'interior'} of ${what}`, 0.97, xFe > 0.5 ? 0x8a8480 : xIce > 0.3 ? 0xa0a8b0 : HROCK, xIce > 0.3 ? 'ice' : 'solid'], ['regolith', 1, 0x6a625a, 'solid']];
  } else {
    layers = [];
    const rc = xFe > 0.01 ? clamp(Math.cbrt((xFe * rho) / (7.9 * Math.pow(f, 1.3))), 0.08, 0.92) : 0;
    if (rc > 0) {
      if (mE > 0.3) layers.push(['solid inner core', rc * 0.35, FE_IN, 'solid'], ['liquid outer core', rc, FE_OUT, 'liquid']);
      else layers.push(['iron core', rc, FE_OUT, mE > 0.05 ? 'liquid' : 'solid']);
    }
    const rm = xIce > 0 ? clamp(Math.cbrt(Math.max(0, 1 - (xIce * rho) / 1.2)), rc + 0.02, 0.97) : 1;
    const crust = clamp(40 / rKm, 0.005, 0.1);
    if (xIce <= 0.02) {
      const top = style === 'lava' || b.heat > 0.55 ? 'magma ocean' : style === 'terran' || style === 'ocean' ? 'crust and oceans' : 'crust';
      layers.push(['silicate mantle', 1 - crust, MANTLE, 'solid'], [top, 1, top === 'magma ocean' ? 0xff6a1a : CRUST, top === 'magma ocean' ? 'liquid' : 'solid']);
    } else {
      layers.push([rc > 0 ? 'rocky mantle' : 'rock core', rm, ROCK, 'solid']);
      if (style === 'ocean') layers.push(['high-pressure ice', rm + (1 - rm) * 0.5, HPICE, 'ice'], ['global ocean', 1, OCEAN, 'liquid']);
      else if (rKm > 600 && r() < 0.6) {
        const o0 = rm + (1 - rm) * span(r, 0.5, 0.7), o1 = o0 + (1 - o0) * span(r, 0.3, 0.6);
        layers.push(['ice mantle', o0, HPICE, 'ice'], ['possible subsurface ocean', o1, OCEAN, 'liquid'], ['ice shell', 1, ICE, 'ice']);
      } else layers.push(['ice mantle', 1, ICE, 'ice']);
    }
  }
  const label = xFe > 0.45 ? 'iron-rich' : xIce > 0.3 ? 'ice-rich' : 'rocky';
  return {
    layers: stack(layers), surface: parts(surface), bulk: parts(bulk), measured: false,
    notes: `Estimated from a density of ${rho.toFixed(2)} g/cm³ (about ${rho0.toFixed(2)} uncompressed): ${label}.`,
  };
}

/** what a body is made of, layer by layer, at the surface and in bulk */
export function compositionOf(b: Body): Composition {
  const key = realKey(b);
  if (key && Object.hasOwn(INSIDE, key)) {
    const d = INSIDE[key];
    return { layers: stack(d.layers), surface: parts(d.surface), bulk: parts(d.bulk), measured: true, notes: d.notes };
  }
  if (b.cls === 'gasp') return { layers: stack([['gas cloud', 1, 0xc0d0e0, 'gas']]), surface: parts([['hydrogen', 0.74], ['helium', 0.25], ['heavier elements', 0.01]]), bulk: parts([['hydrogen', 0.74], ['helium', 0.25], ['heavier elements', 0.01]]), measured: false, notes: 'A parcel of gas.' };
  if (b.cls === 'star') return starInside(b);
  if (b.compact) return remnantInside(b);
  if (isGiant(b)) return giantInside(b);
  return solidInside(b);
}
