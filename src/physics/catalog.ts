import { Body, type Cls, type Look, type Style } from './body';
import { KM, M_EARTH, M_JUP, M_MOON, MSUN_KG, R_EARTH, R_JUP, radiusFromDensity, schwarzschild, DAY, HOUR } from './units';
import { newStar, structure, wdRadius, NS_RADIUS, giantLife, teffOf, SUPERWIND } from './stellar';

export type Shelf = 'Small' | 'Worlds' | 'Giants' | 'Stars' | 'Remnants';
export const SHELVES: Shelf[] = ['Small', 'Worlds', 'Giants', 'Stars', 'Remnants'];

export interface Entry {
  key: string;
  name: string;
  shelf: Shelf;
  cls: Cls;
  m: number;          // Msun
  r?: number;         // AU; if absent, from density
  rho?: number;       // g/cm³
  /** for stars: where in its life it starts — <0 contracting, 0..1 main sequence, >1 giant */
  ageFrac?: number;
  day: number;        // rotation period, yr (visual)
  tilt?: number;      // degrees (visual)
  look: Omit<Look, 'seed'>;
  blurb: string;
}

const kg = (x: number) => x / MSUN_KG;
const look = (style: Style, c1: number, c2: number, extra: Partial<Look> = {}) => ({ style, c1, c2, ...extra });

// A dying star is placed where its envelope is about to go, so that the end
// of its life is something you can watch rather than something you wait for.
const nearEnd = (m0: number, yearsLeft: number) => 1 + 1 - yearsLeft / giantLife(m0);

export const CATALOG: Entry[] = [
  // ---- Small ----
  { key: 'comet', name: 'Comet', shelf: 'Small', cls: 'ice', m: kg(2.2e14), r: 5.5 * KM, day: 52 * HOUR,
    look: look('ice', 0x5a5550, 0x9a948c), blurb: "Halley's mass and size: a dirty snowball 11 km across." },
  { key: 'asteroid', name: 'Asteroid', shelf: 'Small', cls: 'rock', m: kg(2.59e20), r: 262.7 * KM, day: 5.34 * HOUR,
    look: look('barren', 0x6e665e, 0xa69c8e), blurb: 'Vesta: the second-largest thing in the main belt.' },
  { key: 'moon', name: 'Moon', shelf: 'Small', cls: 'rock', m: M_MOON, r: 1737.4 * KM, day: 27.32 * DAY, tilt: 6.7,
    look: look('barren', 0x5d5a57, 0xb8b2a8), blurb: 'Our Moon: 1.2% of an Earth, a quarter of its width.' },
  { key: 'dwarf', name: 'Dwarf planet', shelf: 'Small', cls: 'ice', m: kg(1.303e22), r: 1188.3 * KM, day: 6.39 * DAY, tilt: 122,
    look: look('ice', 0x8a6a50, 0xe8d8c4), blurb: 'Pluto: nitrogen ice over a rocky core.' },

  // ---- Worlds ----
  { key: 'terran', name: 'Earth-like', shelf: 'Worlds', cls: 'rock', m: M_EARTH, r: R_EARTH, day: 23.93 * HOUR, tilt: 23.4,
    look: look('terran', 0x1d4f8c, 0x4f8a3c, { atmo: 0x6aa8ff }), blurb: 'One Earth: oceans, continents, a thin blue sky.' },
  { key: 'desert', name: 'Desert world', shelf: 'Worlds', cls: 'rock', m: 0.107 * M_EARTH, r: 3389.5 * KM, day: 24.6 * HOUR, tilt: 25,
    look: look('desert', 0x8a3e1c, 0xd08a52, { atmo: 0xd8a080 }), blurb: 'Mars: a tenth of an Earth, rusted and dry.' },
  { key: 'iceworld', name: 'Ice world', shelf: 'Worlds', cls: 'ice', m: 0.5 * M_EARTH, rho: 2.2, day: 30 * HOUR,
    look: look('ice', 0x6a9cc0, 0xeaf6ff), blurb: 'Half an Earth of ice and rock, frozen solid.' },
  { key: 'ocean', name: 'Ocean world', shelf: 'Worlds', cls: 'ice', m: 2 * M_EARTH, rho: 3.4, day: 20 * HOUR,
    look: look('ocean', 0x0c3a78, 0x2a7cc0, { atmo: 0x80c0ff }), blurb: 'A global ocean hundreds of km deep over ice.' },
  { key: 'lava', name: 'Molten world', shelf: 'Worlds', cls: 'rock', m: 1.5 * M_EARTH, rho: 5.6, day: 1 * DAY,
    look: look('lava', 0x1c0e0c, 0xff6a1a), blurb: 'A rock world close enough to its star to stay liquid on top.' },
  { key: 'iron', name: 'Iron world', shelf: 'Worlds', cls: 'rock', m: 0.4 * M_EARTH, rho: 8.0, day: 58 * DAY,
    look: look('iron', 0x403c3a, 0x8a8480), blurb: 'Two thirds metal: what is left when a mantle is blasted off.' },
  { key: 'superearth', name: 'Super-Earth', shelf: 'Worlds', cls: 'rock', m: 5 * M_EARTH, r: 1.6 * R_EARTH, day: 18 * HOUR, tilt: 12,
    look: look('rocky', 0x6a5a48, 0x9aa070, { atmo: 0xb0c8e8 }), blurb: 'Five Earths at 1.6 Earth widths: the commonest kind of planet we find.' },
  { key: 'carbon', name: 'Carbon world', shelf: 'Worlds', cls: 'rock', m: 3 * M_EARTH, rho: 5.0, day: 26 * HOUR,
    look: look('carbon', 0x15141a, 0x4a4450), blurb: 'Graphite and carbide crust with diamond underneath.' },
  { key: 'core', name: 'Stripped core', shelf: 'Worlds', cls: 'rock', m: 10 * M_EARTH, rho: 7.5, day: 1 * DAY,
    look: look('iron', 0x3a2420, 0xb05a30), blurb: 'The heavy heart of a giant that lost its gas to its star.' },

  // ---- Giants ----
  { key: 'jupiter', name: 'Gas giant', shelf: 'Giants', cls: 'gas', m: M_JUP, r: R_JUP, day: 9.93 * HOUR, tilt: 3.1,
    look: look('gas', 0xb08860, 0xf0e0c8, { atmo: 0xf0d8b0 }), blurb: 'Jupiter: 318 Earths, mostly hydrogen.' },
  { key: 'saturn', name: 'Ringed giant', shelf: 'Giants', cls: 'gas', m: 95.16 * M_EARTH, r: 58232 * KM, day: 10.7 * HOUR, tilt: 26.7,
    look: look('gas', 0xc8a870, 0xf4e6c0, { atmo: 0xf0e0b0, rings: { inner: 1.24, outer: 2.27, color: 0xd8c8a0, opacity: 0.8 } }),
    blurb: 'Saturn: less dense than water, rings of ice inside its Roche limit.' },
  { key: 'icegiant', name: 'Ice giant', shelf: 'Giants', cls: 'gas', m: 17.15 * M_EARTH, r: 24622 * KM, day: 16.1 * HOUR, tilt: 28.3,
    look: look('icegiant', 0x2a50c0, 0x6aa0f0, { atmo: 0x80b0ff }), blurb: 'Neptune: water, ammonia and methane under hydrogen.' },
  { key: 'hotjupiter', name: 'Hot Jupiter', shelf: 'Giants', cls: 'gas', m: M_JUP, r: 1.6 * R_JUP, day: 3.5 * DAY,
    look: look('hotjupiter', 0x401818, 0xe07030, { atmo: 0xff9060 }), blurb: 'A Jupiter puffed to 1.6 times its width by its star.' },
  { key: 'browndwarf', name: 'Brown dwarf', shelf: 'Giants', cls: 'gas', m: 50 * M_JUP, r: 0.9 * R_JUP, day: 5 * HOUR,
    look: look('browndwarf', 0x3a0c10, 0xc04020), blurb: 'Fifty Jupiters: too light to fuse hydrogen, glowing from its own contraction.' },

  // ---- Stars ----
  { key: 'protostar', name: 'Protostar', shelf: 'Stars', cls: 'star', m: 1, ageFrac: -0.5, day: 3 * DAY,
    look: look('star', 0, 0), blurb: 'A Sun still contracting toward the main sequence.' },
  { key: 'reddwarf', name: 'Red dwarf', shelf: 'Stars', cls: 'star', m: 0.2, ageFrac: 0.01, day: 40 * DAY,
    look: look('star', 0, 0), blurb: 'An M dwarf: 0.2 suns, a two-hundredth of the light, lasts a trillion years.' },
  { key: 'sun', name: 'Sun-like', shelf: 'Stars', cls: 'star', m: 1, ageFrac: 0.46, day: 25.4 * DAY, tilt: 7.25,
    look: look('star', 0, 0), blurb: 'The Sun at its present age, 4.6 billion years.' },
  { key: 'astar', name: 'A-type star', shelf: 'Stars', cls: 'star', m: 2.06, ageFrac: 0.2, day: 1 * DAY,
    look: look('star', 0, 0), blurb: "Sirius A: twice the Sun's mass, 25 times its light." },
  { key: 'ostar', name: 'O-type star', shelf: 'Stars', cls: 'star', m: 30, ageFrac: 0.3, day: 2 * DAY,
    look: look('star', 0, 0), blurb: 'Thirty suns, a hundred thousand times the light; lives six million years and leaves a black hole.' },
  { key: 'redgiant', name: 'Dying giant', shelf: 'Stars', cls: 'star', m: 1.2, ageFrac: nearEnd(1.2, 0.35 * SUPERWIND * giantLife(1.2)), day: 1 * 365.25 * DAY,
    look: look('star', 0, 0), blurb: 'A Sun-like star at the tip of the giant branch, about to blow off its envelope and leave a white dwarf.' },
  { key: 'supergiant', name: 'Red supergiant', shelf: 'Stars', cls: 'star', m: 20, ageFrac: nearEnd(20, 400), day: 30 * 365.25 * DAY,
    look: look('star', 0, 0), blurb: 'A Betelgeuse a few centuries from core collapse.' },

  // ---- Remnants ----
  { key: 'wd', name: 'White dwarf', shelf: 'Remnants', cls: 'wd', m: 0.6, day: 1 * HOUR,
    look: look('wd', 0, 0), blurb: "0.6 suns in an Earth's width. Push it past 1.38 and it detonates." },
  { key: 'ns', name: 'Neutron star', shelf: 'Remnants', cls: 'ns', m: 1.4, day: 1 / 3600 * HOUR,
    look: look('ns', 0, 0), blurb: '1.4 suns, 24 km across. Past 2.3 it falls into a black hole.' },
  { key: 'pulsar', name: 'Pulsar', shelf: 'Remnants', cls: 'ns', m: 1.4, day: 0.033 / 3600 * HOUR,
    look: look('ns', 0, 0, { pulsar: true }), blurb: 'A neutron star sweeping two beams round 30 times a second.' },
  { key: 'bh', name: 'Black hole', shelf: 'Remnants', cls: 'bh', m: 10, day: 1,
    look: look('bh', 0, 0), blurb: 'Ten suns inside 30 km. Nothing gets out from inside three times that.' },
  { key: 'smbh', name: 'Supermassive', shelf: 'Remnants', cls: 'bh', m: 4.15e6, day: 1,
    look: look('bh', 0, 0), blurb: "Sagittarius A*: four million suns, 0.08 AU across." },
];

export const ENTRY = new Map(CATALOG.map(e => [e.key, e]));

/** Roche factor: fluid bodies (gas, stars, white dwarfs) are torn at 2.44, rubble at ~1.5. */
export function rocheFactor(b: Body): number {
  if (b.cls === 'gas' || b.cls === 'star' || b.cls === 'wd') return 2.44;
  if ((b.cls === 'rock' || b.cls === 'ice') && b.r > 0.5 * KM) return 1.5;
  return 0;
}
export function refreshRoche(b: Body) {
  const f = rocheFactor(b);
  b.rocheK = f > 0 ? f * b.r / Math.cbrt(b.m) : 0;
}

export function makeBody(key: string, seed = Math.floor(Math.random() * 1e9), name?: string): Body {
  const e = ENTRY.get(key);
  if (!e) throw new Error(`no catalogue entry ${key}`);
  let r = e.r ?? (e.rho ? radiusFromDensity(e.m, e.rho) : 0);
  let m = e.m;
  let star;
  if (e.cls === 'star') {
    star = newStar(e.m, e.ageFrac ?? 0);
    const st = structure(star);
    r = st.r; m = st.m;
    star.L = st.L; star.phase = st.phase;
  } else if (e.cls === 'wd' || e.cls === 'ns' || e.cls === 'bh') {
    star = { m0: e.m, age: 1e6, phase: 'remnant' as const, L: 0, teff: 0, coreM: e.m };
    r = e.cls === 'wd' ? wdRadius(m) : e.cls === 'ns' ? NS_RADIUS : schwarzschild(m);
    if (e.cls === 'wd') star.L = 30 * (1 + 1e6 / 1e5) ** -1.4;
  }
  const b = new Body({
    name: name ?? e.name, kind: key, cls: e.cls, look: { ...e.look, seed }, m, r,
    spin: (2 * Math.PI) / e.day, tilt: ((e.tilt ?? 0) * Math.PI) / 180, star,
  });
  if (star) star.teff = e.cls === 'ns' ? 1e6 : e.cls === 'bh' ? 0 : teffOf(star.L, r);
  if (e.key === 'lava') b.heat = 1;
  refreshRoche(b);
  return b;
}

