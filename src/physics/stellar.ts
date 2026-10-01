import type { Body, StarState } from './body';
import { R_SUN, KM, schwarzschild } from './units';

/*
 * Single-star evolution from a handful of fitted relations. Everything is a
 * function of the mass a star was born with and its age, so a star placed
 * near the end of its life behaves exactly like one that got there by waiting.
 *
 *  - ZAMS luminosity: the piecewise mass–luminosity relation (L ∝ M^4 near a
 *    solar mass, M^3.5 above, M^2.3 for red dwarfs, ∝ M near the Eddington limit).
 *  - Main-sequence lifetime: fuel ∝ M, burn rate ∝ L, normalised to 10 Gyr for the Sun.
 *  - Giant branch: about a tenth of the main-sequence life, radius and
 *    luminosity climbing steeply, the envelope lost mostly at the very end.
 *  - Remnant by initial mass: white dwarf below 8 M☉ (Kalirai 2008 initial–final
 *    mass relation), neutron star to 25 M☉, black hole above, with no explosion
 *    at all above 40 M☉.
 */

export const M_CH = 1.38;     // white dwarf: carbon ignition just under Chandrasekhar
export const M_TOV = 2.3;     // neutron star: maximum mass before collapse
export const M_SN = 8;        // lightest star that ends in core collapse
export const M_BH = 25;       // lightest star that leaves a black hole
export const M_DIRECT = 40;   // above this the core falls in without a supernova
export const M_FUSE = 0.075;  // hydrogen burning limit — below this, a brown dwarf
/** fraction of the giant phase at the very end in which most of the envelope goes */
export const SUPERWIND = 2e-4;

export function zamsL(m: number): number {
  if (m < 0.43) return 0.23 * m ** 2.3;
  if (m < 2) return m ** 4;
  if (m < 55) return 1.4 * m ** 3.5;
  return 32000 * m;
}
export function zamsR(m: number): number { return (m <= 1 ? m ** 0.8 : m ** 0.57) * R_SUN; }
export function msLife(m: number): number { return 1e10 * m / zamsL(m); }
export function giantLife(m: number): number { return 0.1 * msLife(m); }
export function preMSLife(m: number): number { return 3e7 * m ** -2.5; }

export function remnantMass(m0: number): number {
  if (m0 < M_SN) return Math.min(M_CH - 0.02, 0.109 * m0 + 0.394);
  if (m0 < M_BH) return 1.4;
  if (m0 < M_DIRECT) return 0.25 * m0;
  return 0.8 * m0;
}

/** Mass a dying star has left just before it ends (winds remove some of it first). */
function preDeathMass(m0: number): number {
  if (m0 < M_SN) return remnantMass(m0);
  return m0 * (m0 < M_BH ? 0.85 : 0.65);
}

function giantRmax(m0: number): number {
  if (m0 < M_SN) return 200 * m0 ** 0.6 * R_SUN;
  if (m0 < M_DIRECT) return 800 * (m0 / 10) ** 0.3 * R_SUN;
  return 60 * R_SUN; // the heaviest stay blue
}

export function wdRadius(m: number): number {
  const x = Math.min(m / 1.44, 0.999);
  return 0.0112 * R_SUN * Math.sqrt(x ** (-2 / 3) - x ** (2 / 3));
}
export const NS_RADIUS = 12 * KM;

export const teffOf = (L: number, r: number) => 5772 * (L / (r / R_SUN) ** 2) ** 0.25;

export function newStar(m0: number, ageFrac = 0): StarState {
  const s: StarState = { m0, age: 0, phase: 'ms', L: 1, teff: 5772, coreM: remnantMass(m0) };
  s.age = ageFrac < 0 ? ageFrac * preMSLife(m0) : ageFrac <= 1 ? ageFrac * msLife(m0) : msLife(m0) + (ageFrac - 1) * giantLife(m0);
  return s;
}

/** Radius and luminosity a star of this initial mass has at this age, and the mass it should be carrying. */
export function structure(s: StarState): { r: number; L: number; m: number; phase: StarState['phase'] } {
  const m0 = s.m0, tms = msLife(m0);
  const L0 = zamsL(m0), R0 = zamsR(m0);
  if (s.age < 0) {
    const f = Math.min(1, -s.age / preMSLife(m0));
    return { r: R0 * (1 + 2.5 * f), L: L0 * (1 + 4 * f), m: m0, phase: 'proto' };
  }
  // The mass–luminosity relation describes stars partway through their lives:
  // a star starts dimmer and smaller and brightens as helium builds up in its
  // core. Calibrated on the Sun: 0.7 L☉ / 0.89 R☉ at birth, 1 / 1 at 4.6 Gyr.
  if (s.age <= tms) {
    const f = s.age / tms;
    return { r: R0 * (0.89 + 0.24 * f + 0.47 * f ** 3), L: L0 * (0.7 + 0.65 * f + 0.45 * f ** 3), m: m0, phase: 'ms' };
  }
  const g = Math.min(1, (s.age - tms) / giantLife(m0));
  const Rend = R0 * 1.6, Lend = L0 * 1.8;
  const Rmax = giantRmax(m0);
  const Ltip = Math.max(Lend * 1.5, 3000 * m0 ** 1.5);
  const mEnd = preDeathMass(m0);
  return {
    r: Rend * (Rmax / Rend) ** Math.pow(g, 1.5),
    L: Lend * (Ltip / Lend) ** Math.pow(g, 1.2),
    m: m0 - (m0 - mEnd) * (0.3 * g * g + 0.7 * Math.min(1, Math.max(0, (g - 1 + SUPERWIND) / SUPERWIND))),
    phase: g > 0.9 && m0 < M_SN ? 'agb' : 'giant',
  };
}

export type StarEvent = 'none' | 'wd' | 'sn' | 'collapse' | 'ia' | 'ns-collapse';

/**
 * Age a star by `dt` years. Updates its radius, luminosity and the mass it
 * holds; returns how much mass it shed (the caller turns that into a wind) and
 * whether its life ended this step.
 */
export function evolve(b: Body, dt: number): { shed: number; ev: StarEvent } {
  const s = b.star!;
  if (s.phase === 'remnant') {
    s.age += dt;
    if (b.cls === 'wd') {
      // Mestel cooling, L ∝ t^-7/5 from a hot start
      s.L = 30 * (1 + s.age / 1e5) ** -1.4;
      s.teff = teffOf(s.L, b.r);
      if (b.m > M_CH) return { shed: 0, ev: 'ia' };
    }
    if (b.cls === 'ns' && b.m > M_TOV) return { shed: 0, ev: 'ns-collapse' };
    return { shed: 0, ev: 'none' };
  }
  s.age += dt;
  const st = structure(s);
  s.phase = st.phase;
  s.L = st.L;
  b.r = st.r;
  s.teff = teffOf(st.L, st.r);
  let shed = 0;
  if (st.m < b.m) { shed = b.m - st.m; b.m = st.m; }
  if (s.age >= msLife(s.m0) + giantLife(s.m0)) {
    if (s.m0 < M_SN) return { shed, ev: 'wd' };
    if (s.m0 < M_DIRECT) return { shed, ev: 'sn' };
    return { shed, ev: 'collapse' };
  }
  return { shed, ev: 'none' };
}

/** Turn a body into a compact remnant in place. */
const REMNANT_NAME = { wd: 'White dwarf', ns: 'Neutron star', bh: 'Black hole' };

export function becomeRemnant(b: Body, cls: 'wd' | 'ns' | 'bh', m: number) {
  if (b.cls !== cls) {
    // a catalogue name described the star; a named star keeps its name
    const generic = b.cls === 'star' || b.cls === 'wd' || b.cls === 'ns' ? /^(Red supergiant|Dying giant|O-type star|A-type star|Sun-like|Red dwarf|Protostar|Custom star|White dwarf|Neutron star|Pulsar)$/.test(b.name) : false;
    b.name = generic ? REMNANT_NAME[cls] : `${b.name} (${REMNANT_NAME[cls].toLowerCase()})`;
  }
  b.cls = cls;
  b.m = m;
  b.look = { ...b.look, style: cls };
  b.r = cls === 'wd' ? wdRadius(m) : cls === 'ns' ? NS_RADIUS : schwarzschild(m);
  const s = b.star!;
  s.phase = 'remnant';
  s.age = 0;
  s.L = cls === 'wd' ? 30 : 0;
  s.teff = cls === 'wd' ? teffOf(s.L, b.r) : cls === 'ns' ? 1e6 : 0;
  b.rocheK = 0;
}

/** Time until the next thing that happens to this star, for the "age it" button. */
export function timeToNextStage(s: StarState): number {
  const tms = msLife(s.m0), tg = giantLife(s.m0);
  if (s.phase === 'remnant') return Infinity;
  if (s.age < 0) return -s.age;
  if (s.age < tms) return tms - s.age;
  return tms + tg - s.age;
}

/** Blackbody colour for a temperature, as linear-ish RGB 0..1 (Tanner Helland's fit). */
export function blackbody(T: number): [number, number, number] {
  const t = Math.max(1000, Math.min(40000, T)) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) { r = 255; g = 99.4708 * Math.log(t) - 161.1196; }
  else { r = 329.699 * (t - 60) ** -0.1332; g = 288.1222 * (t - 60) ** -0.0755; }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177 * Math.log(t - 10) - 305.0448;
  const c = (x: number) => Math.max(0, Math.min(255, x)) / 255;
  return [c(r), c(g), c(b)];
}
