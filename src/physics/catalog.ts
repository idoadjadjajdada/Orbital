import { Body, type Cls, type Look, type Style } from './body';
import { KM, M_EARTH, M_JUP, M_MOON, MSUN_KG, R_EARTH, R_JUP, radiusFromDensity, schwarzschild, DAY, HOUR } from './units';
import { newStar, structure, wdRadius, NS_RADIUS, giantLife, teffOf, SUPERWIND } from './stellar';
import { SHAPES, GRID, shapeStats, makeShape } from './materials';

export type Shelf = 'Small' | 'Worlds' | 'Giants' | 'Stars' | 'Remnants' | 'Special' | 'Craft';
export const SHELVES: Shelf[] = ['Small', 'Worlds', 'Giants', 'Stars', 'Remnants', 'Special', 'Craft'];

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
  /** a ready-made outline (materials.ts) for bodies too small to be round, painted in one material */
  shape?: { key: string; mat: number };
  /** remnants: how long it has been cooling, yr */
  cooled?: number;
  /** what comes with it, so it arrives already doing what it does (extras.ts) */
  extra?: Extra;
  /** radiation-pressure to gravity ratio, for a sail */
  beta?: number;
}

export type Extra =
  /** an active nucleus: a ring of gas and a feeding inner disc at this Eddington fraction, its axis tilted by this many degrees from the line of sight */
  | { kind: 'agn'; edd: number; tilt: number }
  /** a companion star filling its Roche lobe, feeding it through L1 */
  | { kind: 'donor'; star: string; m0: number; age: number; edd: number }
  /** a second copy of itself on a tight orbit */
  | { kind: 'twin'; sepKm: number }
  /** a shell of gas thrown off earlier: mass, radius (AU), speed (km/s) */
  | { kind: 'shell'; m: number; r: number; v: number; color: number }
  /** a disc of dust and planetesimals: mass, inner and outer radius (AU) */
  | { kind: 'dust'; m: number; rIn: number; rOut: number }
  /** the other mouth */
  | { kind: 'wormhole' }
  /** feeding from an unresolved disc, nothing resolved round it */
  | { kind: 'feed'; edd: number };

const kg = (x: number) => x / MSUN_KG;
const look = (style: Style, c1: number, c2: number, extra: Partial<Look> = {}) => ({ style, c1, c2, ...extra });

// A dying star is placed where its envelope is about to go, so that the end
// of its life is something you can watch rather than something you wait for.
const nearEnd = (m0: number, yearsLeft: number) => 1 + 1 - yearsLeft / giantLife(m0);

export const CATALOG: Entry[] = [
  // ---- Small ----
  { key: 'comet', name: 'Comet', shelf: 'Small', cls: 'ice', m: kg(2.2e14), r: 5.5 * KM, day: 52 * HOUR, shape: { key: 'potato', mat: 6 },
    look: look('ice', 0x5a5550, 0x9a948c), blurb: "Halley's mass and size: a dirty snowball 11 km across." },
  { key: 'asteroid', name: 'Asteroid', shelf: 'Small', cls: 'rock', m: kg(2.59e20), r: 262.7 * KM, day: 5.34 * HOUR,
    look: look('barren', 0x6e665e, 0xa69c8e), blurb: 'Vesta: the second-largest thing in the main belt.' },
  { key: 'moon', name: 'Moon', shelf: 'Small', cls: 'rock', m: M_MOON, r: 1737.4 * KM, day: 27.32 * DAY, tilt: 6.7,
    look: look('barren', 0x5d5a57, 0xb8b2a8), blurb: 'Our Moon: 1.2% of an Earth, a quarter of its width.' },
  { key: 'dwarf', name: 'Dwarf planet', shelf: 'Small', cls: 'ice', m: kg(1.303e22), r: 1188.3 * KM, day: 6.39 * DAY, tilt: 122,
    look: look('ice', 0x8a6a50, 0xe8d8c4), blurb: 'Pluto: nitrogen ice over a rocky core.' },

  { key: 'metal', name: 'Metal asteroid', shelf: 'Small', cls: 'rock', m: kg(2.29e19), r: 113 * KM, day: 4.2 * HOUR, shape: { key: 'potato', mat: 1 },
    look: look('iron', 0x6a6460, 0xb4aea8), blurb: 'Psyche: a 226 km lump of iron and nickel, perhaps a planet’s exposed core.' },
  { key: 'kbo', name: 'Kuiper object', shelf: 'Small', cls: 'ice', m: kg(7.5e14), r: 9 * KM, day: 15.9 * HOUR, shape: { key: 'contact', mat: 6 },
    look: look('ice', 0x6a3a2a, 0xb06a4a), blurb: 'Arrokoth: two lumps of reddened ice that touched gently 4.5 billion years ago.' },
  { key: 'kleopatra', name: 'Dog-bone asteroid', shelf: 'Small', cls: 'rock', m: kg(2.97e18), r: 61 * KM, day: 5.39 * HOUR, shape: { key: 'dogbone', mat: 1 },
    look: look('iron', 0x5a5450, 0xa8a29c), blurb: '216 Kleopatra: a 270 km metal bone with two little moons, strong enough to keep its shape.' },
  { key: 'rubble', name: 'Rubble pile', shelf: 'Small', cls: 'rock', m: kg(3.5e10), r: 0.165 * KM, day: 4.3 * HOUR, shape: { key: 'potato', mat: 5 },
    look: look('barren', 0x5a5248, 0x9a8e7e), blurb: 'Itokawa: boulders and gravel held together by almost nothing. Tides pull it apart easily.' },
  { key: 'centaur', name: 'Ringed centaur', shelf: 'Small', cls: 'ice', m: kg(7e18), r: 124 * KM, day: 7 * HOUR,
    look: look('ice', 0x3a3430, 0x6a625a, { rings: { inner: 3.1, outer: 3.25, color: 0xb0a898, opacity: 0.5 } }),
    blurb: 'Chariklo: 250 km across, between Saturn and Uranus, with two narrow rings of its own.' },
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
    look: look('iron', 0x6a6460, 0xb4aea8), blurb: 'Two thirds metal: what is left when a mantle is blasted off.' },
  { key: 'superearth', name: 'Super-Earth', shelf: 'Worlds', cls: 'rock', m: 5 * M_EARTH, r: 1.6 * R_EARTH, day: 18 * HOUR, tilt: 12,
    look: look('rocky', 0x6a5a48, 0x9aa070, { atmo: 0xb0c8e8 }), blurb: 'Five Earths at 1.6 Earth widths: the commonest kind of planet we find.' },
  { key: 'carbon', name: 'Carbon world', shelf: 'Worlds', cls: 'rock', m: 3 * M_EARTH, rho: 5.0, day: 26 * HOUR,
    look: look('carbon', 0x34323c, 0x8a8496), blurb: 'Graphite and carbide crust with diamond underneath.' },
  { key: 'core', name: 'Stripped core', shelf: 'Worlds', cls: 'rock', m: 10 * M_EARTH, rho: 7.5, day: 1 * DAY,
    look: look('iron', 0x5a3a30, 0xc06a3a), blurb: 'The heavy heart of a giant that lost its gas to its star.' },

  { key: 'hycean', name: 'Hycean world', shelf: 'Worlds', cls: 'ice', m: 8.6 * M_EARTH, r: 2.6 * R_EARTH, day: 33 * DAY,
    look: look('ocean', 0x0a3058, 0x3a8ab0, { atmo: 0xa0d0e8 }), blurb: 'K2-18 b: perhaps a deep ocean under a hydrogen sky, 8.6 Earths at 2.6 Earth widths.' },
  { key: 'eyeball', name: 'Eyeball world', shelf: 'Worlds', cls: 'ice', m: 1.2 * M_EARTH, rho: 4.5, day: 10 * DAY,
    look: look('ocean', 0x10406a, 0xe8f4ff, { atmo: 0x9ac8ff }), blurb: 'Tidally locked to a red dwarf: frozen almost everywhere, one ocean facing its sun.' },
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

  { key: 'minineptune', name: 'Mini-Neptune', shelf: 'Giants', cls: 'gas', m: 6 * M_EARTH, r: 2.4 * R_EARTH, day: 20 * HOUR,
    look: look('icegiant', 0x3a7a9a, 0x8ac8d8, { atmo: 0x9ad8e8 }), blurb: 'Six Earths under a thick hydrogen envelope — common out there, absent here.' },
  { key: 'superpuff', name: 'Super-puff', shelf: 'Giants', cls: 'gas', m: 3.7 * M_EARTH, r: 7.1 * R_EARTH, day: 30 * HOUR,
    look: look('gas', 0x8a7a6a, 0xd8ccb8, { atmo: 0xe0d0b8 }), blurb: 'Kepler-51b: Jupiter-sized at four Earths, a hundredth of the density of water.' },
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

  { key: 'kdwarf', name: 'K dwarf', shelf: 'Stars', cls: 'star', m: 0.75, ageFrac: 0.2, day: 30 * DAY,
    look: look('star', 0, 0), blurb: 'An orange dwarf: three quarters of a Sun, lives thirty billion years.' },
  { key: 'fstar', name: 'F-type star', shelf: 'Stars', cls: 'star', m: 1.4, ageFrac: 0.3, day: 4 * DAY,
    look: look('star', 0, 0), blurb: 'Procyon A’s class: a little hotter and whiter than the Sun.' },
  { key: 'bstar', name: 'B-type star', shelf: 'Stars', cls: 'star', m: 6, ageFrac: 0.3, day: 1 * DAY,
    look: look('star', 0, 0), blurb: 'Six suns, blue-white, a thousand times the light; ends as a white dwarf.' },
  { key: 'bluesg', name: 'Blue supergiant', shelf: 'Stars', cls: 'star', m: 21, ageFrac: 1.004, day: 20 * DAY,
    look: look('star', 0, 0), blurb: 'Rigel: just off the main sequence, swelling toward red supergiant.' },
  { key: 'hypergiant', name: 'Red hypergiant', shelf: 'Stars', cls: 'star', m: 35, ageFrac: nearEnd(35, 2000), day: 50 * 365.25 * DAY,
    look: look('star', 0, 0), blurb: 'A star wider than Jupiter’s orbit, a few thousand years from collapse.' },
  { key: 'lbv', name: 'Eta Carinae-class', shelf: 'Stars', cls: 'star', m: 100, ageFrac: 0.6, day: 5 * DAY,
    look: look('star', 0, 0), blurb: 'A hundred suns, five million times the light. Too heavy to explode: it will collapse.' },
  { key: 'tzo', name: 'Thorne–Żytkow object', shelf: 'Stars', cls: 'star', m: 15, ageFrac: nearEnd(15, 20000), day: 30 * 365.25 * DAY,
    look: look('star', 0, 0), blurb: 'A red supergiant with a neutron star sunk in its core: the strangest kind of star proposed, perhaps HV 2112.' },
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
  { key: 'magnetar', name: 'Magnetar', shelf: 'Remnants', cls: 'ns', m: 1.5, day: 5 / 3600 * HOUR,
    look: look('ns', 0, 0, { pulsar: true, magnetar: true }), blurb: 'A neutron star with a 10¹¹-tesla field. Now and then its crust cracks and it flares brighter than a galaxy for a tenth of a second.' },
  { key: 'heavywd', name: 'Heavy white dwarf', shelf: 'Remnants', cls: 'wd', m: 1.36, day: 0.2 * HOUR,
    look: look('wd', 0, 0), blurb: '1.36 suns in the size of the Moon — a whisker under the Chandrasekhar limit.' },
  { key: 'imbh', name: 'Intermediate BH', shelf: 'Remnants', cls: 'bh', m: 1e3, day: 1,
    look: look('bh', 0, 0), blurb: 'A thousand suns: the missing link between stellar and supermassive holes.' },
  { key: 'blackdwarf', name: 'Black dwarf', shelf: 'Remnants', cls: 'wd', m: 0.6, day: 1 * HOUR, cooled: 1e15,
    look: look('wd', 0, 0), blurb: 'A white dwarf after a quadrillion years: cold, dark carbon. The universe is too young for one to exist yet.' },
  { key: 'hewd', name: 'Helium white dwarf', shelf: 'Remnants', cls: 'wd', m: 0.3, day: 2 * HOUR, cooled: 3e8,
    look: look('wd', 0, 0), blurb: 'A light white dwarf whose companion stripped it before it could burn helium.' },
  { key: 'msp', name: 'Millisecond pulsar', shelf: 'Remnants', cls: 'ns', m: 1.6, day: (1 / 716) / 3600 * HOUR,
    look: look('ns', 0, 0, { pulsar: true }), blurb: 'PSR J1748−2446ad: spun up to 716 turns a second by gas from a companion.' },
  { key: 'quark', name: 'Quark star', shelf: 'Remnants', cls: 'ns', m: 1.4, r: 9 * KM, day: 1 / 3600 * HOUR,
    look: look('ns', 0, 0), blurb: 'Hypothetical: a neutron star whose core has dissolved into free quarks, smaller and denser still.' },
  { key: 'gwbh', name: 'Merged black hole', shelf: 'Remnants', cls: 'bh', m: 62, day: 1,
    look: look('bh', 0, 0), blurb: 'The 62-sun hole left by GW150914, the first black-hole merger ever heard: three suns went out as gravitational waves.' },
  { key: 'microquasar', name: 'Microquasar', shelf: 'Remnants', cls: 'bh', m: 10, day: 1, extra: { kind: 'donor', star: 'ostar', m0: 15, age: 0.9, edd: 1 },
    look: look('bh', 0, 0), blurb: 'SS 433: a 10-sun hole eating a 15-sun star that already overfills its Roche lobe. Stream, disc and jets from the start.' },
  { key: 'xpulsar', name: 'X-ray pulsar', shelf: 'Remnants', cls: 'ns', m: 1.4, day: 1.24 / 3600 * HOUR, extra: { kind: 'donor', star: 'astar', m0: 2, age: 0.95, edd: 0.3 },
    look: look('ns', 0, 0, { pulsar: true }), blurb: 'Her X-1: a pulsar fed by a companion overflowing its lobe; the gas is funnelled onto its magnetic poles.' },
  { key: 'cv', name: 'Cataclysmic variable', shelf: 'Remnants', cls: 'wd', m: 0.8, day: 1 * HOUR, cooled: 1e8, extra: { kind: 'donor', star: 'reddwarf', m0: 0.3, age: 0.5, edd: 0.01 },
    look: look('wd', 0, 0), blurb: 'A white dwarf stripping a red dwarf on a two-hour orbit: a stream, a hot disc, and in time a nova.' },
  { key: 'nsmerger', name: 'Merging neutron stars', shelf: 'Remnants', cls: 'ns', m: 1.4, day: 1 / 3600 * HOUR, extra: { kind: 'twin', sepKm: 1500 },
    look: look('ns', 0, 0), blurb: 'Two neutron stars 1,500 km apart, losing orbit to gravitational waves: a kilonova in a few hours. Places both.' },
  { key: 'bhbinary', name: 'Binary black hole', shelf: 'Remnants', cls: 'bh', m: 30, day: 1, extra: { kind: 'twin', sepKm: 1200 },
    look: look('bh', 0, 0), blurb: 'Two 30-sun holes 1,200 km apart, under a second from merging, as LIGO heard them. Places both.' },
  { key: 'doublepulsar', name: 'Double pulsar', shelf: 'Remnants', cls: 'ns', m: 1.3, day: 0.0227 / 3600 * HOUR, extra: { kind: 'twin', sepKm: 9e5 },
    look: look('ns', 0, 0, { pulsar: true }), blurb: 'PSR J0737−3039: two pulsars on a 2.4-hour orbit, the best test of general relativity there is. Places both.' },
  // ---- Special ----
  { key: 'quasar', name: 'Quasar', shelf: 'Special', cls: 'bh', m: 1e8, day: 1, extra: { kind: 'agn', edd: 0.3, tilt: 50 },
    look: look('bh', 0, 0), blurb: 'A hundred-million-sun hole already feeding at a third of the Eddington limit: a ring of gas, a hot inner disc, two jets.' },
  { key: 'blazar', name: 'Blazar', shelf: 'Special', cls: 'bh', m: 5e8, day: 1, extra: { kind: 'agn', edd: 0.5, tilt: 3 },
    look: look('bh', 0, 0), blurb: 'A quasar whose jet points almost straight at us: the beamed jet outshines everything round it.' },
  { key: 'm87', name: 'M87*', shelf: 'Special', cls: 'bh', m: 6.5e9, day: 1, extra: { kind: 'agn', edd: 0.02, tilt: 70 },
    look: look('bh', 0, 0), blurb: 'The first black hole ever imaged: 6.5 billion suns, feeding slowly but driving a jet thousands of light-years long.' },
  { key: 'whitehole', name: 'White hole', shelf: 'Special', cls: 'bh', m: 10, day: 1,
    look: look('bh', 0, 0, { white: true }), blurb: 'Hypothetical: a black hole run backwards. It pulls like one, but nothing can enter — matter only pours out.' },
  { key: 'wormhole', name: 'Wormhole', shelf: 'Special', cls: 'bh', m: 1e-6, r: 1000 * KM, day: 1, extra: { kind: 'wormhole' },
    look: look('bh', 0, 0, { wormhole: true }), blurb: 'Hypothetical: two mouths joined through space. What goes in one comes out the other, still moving. Places both.' },
  { key: 'pne', name: 'Planetary nebula', shelf: 'Special', cls: 'wd', m: 0.6, day: 1 * HOUR, cooled: 1e4, extra: { kind: 'shell', m: 0.2, r: 3000, v: 25, color: 0x60c0d0 },
    look: look('wd', 0, 0), blurb: 'A newborn white dwarf, still at 100,000 K, inside the envelope it threw off ten thousand years ago.' },
  { key: 'snr', name: 'Supernova remnant', shelf: 'Special', cls: 'ns', m: 1.4, day: 0.033 / 3600 * HOUR, extra: { kind: 'shell', m: 4.6, r: 3.5e5, v: 1500, color: 0xa0c8ff },
    look: look('ns', 0, 0, { pulsar: true }), blurb: 'The Crab: a pulsar 30 times a second inside the debris of the supernova seen in 1054.' },
  { key: 'ppdisc', name: 'Protoplanetary disc', shelf: 'Special', cls: 'star', m: 1, ageFrac: -0.3, day: 3 * DAY, extra: { kind: 'dust', m: 0.01, rIn: 0.3, rOut: 30 },
    look: look('star', 0, 0), blurb: 'A young Sun in a disc of dust and planetesimals: the pieces settle, collide and gather where they can.' },
  { key: 'microbh', name: 'Evaporating BH', shelf: 'Special', cls: 'bh', m: 1e-22, day: 1,
    look: look('bh', 0, 0), blurb: 'A black hole of 200,000 tonnes, smaller than a proton: Hawking radiation boils it away in about twenty years.' },
  { key: 'rogue', name: 'Rogue planet', shelf: 'Special', cls: 'gas', m: M_JUP, r: R_JUP, day: 10 * HOUR,
    look: look('gas', 0x2a2830, 0x5a5670), blurb: 'A Jupiter thrown out of its system, cold and dark, drifting between the stars.' },
  { key: 'oumuamua', name: 'Interstellar object', shelf: 'Special', cls: 'rock', m: kg(8e9), r: 0.1 * KM, day: 8 * HOUR, shape: { key: 'cigar', mat: 2 },
    look: look('barren', 0x6a4a3a, 0xa07a5a), blurb: 'ʻOumuamua: a few hundred metres of something from another star. Throw it fast.' },
  { key: 'pbh', name: 'Primordial BH', shelf: 'Special', cls: 'bh', m: 1e-12, day: 1,
    look: look('bh', 0, 0), blurb: 'A hypothetical black hole from the Big Bang, the mass of an asteroid and the size of an atom.' },
  { key: 'ton618', name: 'TON 618', shelf: 'Special', cls: 'bh', m: 6.6e10, day: 1, extra: { kind: 'agn', edd: 0.4, tilt: 40 },
    look: look('bh', 0, 0), blurb: '66 billion suns, one of the brightest quasars known: a ring of gas and jets as big as the hole is heavy.' },
  // ---- Craft ----
  { key: 'iss', name: 'ISS', shelf: 'Craft', cls: 'rock', m: kg(4.2e5), r: 0.055 * KM, day: 92.7 / 60 * HOUR, look: look('iron', 0xb0b4b8, 0xe8ecf0, { craft: 'station' }),
    blurb: 'The International Space Station: 420 tonnes, 109 m across, crewed since 2000.' },
  { key: 'tiangong', name: 'Tiangong', shelf: 'Craft', cls: 'rock', m: kg(1e5), r: 0.027 * KM, day: 91 / 60 * HOUR, look: look('iron', 0xb8b4a8, 0xe8e4d8, { craft: 'station' }),
    blurb: 'China’s space station: three modules, 100 tonnes.' },
  { key: 'hubble', name: 'Hubble', shelf: 'Craft', cls: 'rock', m: kg(11110), r: 0.0066 * KM, day: 95 / 60 * HOUR, look: look('iron', 0xc0c4c8, 0xf0f0f0, { craft: 'telescope' }),
    blurb: 'A 2.4 m telescope in low orbit since 1990.' },
  { key: 'jwst', name: 'JWST', shelf: 'Craft', cls: 'rock', m: kg(6200), r: 0.011 * KM, day: 1, look: look('iron', 0xc8a040, 0xffd870, { craft: 'mirror' }),
    blurb: 'A 6.5 m gold mirror behind a tennis-court sunshield, parked at Sun–Earth L2.' },
  { key: 'voyager', name: 'Voyager 1', shelf: 'Craft', cls: 'rock', m: kg(825), r: 0.0018 * KM, day: 1, look: look('iron', 0xa0a0a0, 0xe0e0e0, { craft: 'probe' }),
    blurb: 'Launched 1977, now in interstellar space at 17 km/s. Throw it out of the system.' },
  { key: 'newhorizons', name: 'New Horizons', shelf: 'Craft', cls: 'rock', m: kg(478), r: 0.0013 * KM, day: 1, look: look('iron', 0xb0a080, 0xe8d8b0, { craft: 'probe' }),
    blurb: 'The fastest launch ever: Pluto in 2015, Arrokoth in 2019.' },
  { key: 'parker', name: 'Parker Solar Probe', shelf: 'Craft', cls: 'rock', m: kg(685), r: 0.0015 * KM, day: 1, look: look('iron', 0x504840, 0xf0e8d8, { craft: 'probe' }),
    blurb: 'Dives to 6.9 million km from the Sun behind a carbon heat shield, at 190 km/s.' },
  { key: 'cassini', name: 'Cassini', shelf: 'Craft', cls: 'rock', m: kg(2523), r: 0.0034 * KM, day: 1, look: look('iron', 0x9a8a60, 0xd8c890, { craft: 'probe' }),
    blurb: 'Thirteen years at Saturn, ending in a dive into its atmosphere.' },
  { key: 'gps', name: 'GPS satellite', shelf: 'Craft', cls: 'rock', m: kg(2000), r: 0.0025 * KM, day: 12 * HOUR, look: look('iron', 0x8090a8, 0xc8d4e8, { craft: 'sat' }),
    blurb: 'Navigation: one of 31, each on a 12-hour orbit 20,200 km up, clocks corrected for relativity.' },
  { key: 'starlink', name: 'Starlink', shelf: 'Craft', cls: 'rock', m: kg(800), r: 0.0042 * KM, day: 95 / 60 * HOUR, look: look('iron', 0x707888, 0xb8c0d0, { craft: 'sat' }),
    blurb: 'A flat-packed internet satellite 550 km up; thousands fly in shells.' },
  { key: 'sail', name: 'Solar sail', shelf: 'Craft', cls: 'rock', m: kg(10), r: 0.01 * KM, day: 1, beta: 0.05, look: look('iron', 0xd0d8e8, 0xffffff, { craft: 'sail' }),
    blurb: 'Ten kilograms under 400 m² of film: sunlight pushes it with a twentieth of the Sun’s pull, so it can climb out with no fuel.' },
  { key: 'lander', name: 'Lander', shelf: 'Craft', cls: 'rock', m: kg(1025), r: 0.0015 * KM, day: 1, look: look('iron', 0xb0a090, 0xe0d0b0, { craft: 'lander' }),
    blurb: 'Perseverance-class: drop it onto a world. On one with air it survives where a rock that size would burn.' },
];

export const ENTRY = new Map(CATALOG.map(e => [e.key, e]));

/** Roche factor: fluid bodies (gas, stars, white dwarfs) are torn at 2.44, rubble at ~1.5. */
export function rocheFactor(b: Body): number {
  if (b.cls === 'gas' || b.cls === 'star' || b.cls === 'wd') return 2.44;
  // past a few hundred km a body is held together by its own gravity, not its
  // strength, and is torn apart like a fluid; smaller ones are rubble piles
  if ((b.cls === 'rock' || b.cls === 'ice' || (b.cls === 'debris' && b.source)) && b.r > 200 * KM) return 2.44;
  if ((b.cls === 'rock' || b.cls === 'ice' || (b.cls === 'debris' && b.source)) && b.r > 0.5 * KM) return 1.5;
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
  const preset = e.shape ? SHAPES.find(x => x.key === e.shape!.key) : undefined;
  let m = e.m;
  let star;
  if (e.cls === 'star') {
    star = newStar(e.m, e.ageFrac ?? 0);
    const st = structure(star);
    r = st.r; m = st.m;
    star.L = st.L; star.phase = st.phase;
  } else if (e.cls === 'wd' || e.cls === 'ns' || e.cls === 'bh') {
    star = { m0: e.m, age: 1e6, phase: 'remnant' as const, L: 0, teff: 0, coreM: e.m };
    star.age = e.cooled ?? 1e6;
    r = e.cls === 'wd' ? wdRadius(m) : e.cls === 'ns' ? e.r ?? NS_RADIUS : e.r ?? schwarzschild(m);
    if (e.cls === 'wd') star.L = 30 * (1 + star.age / 1e5) ** -1.4;
  }
  const b = new Body({
    name: name ?? e.name, kind: key, cls: e.cls, look: { ...e.look, seed }, m, r,
    spin: (2 * Math.PI) / e.day, tilt: ((e.tilt ?? 0) * Math.PI) / 180, star,
    // spacecraft are far too light to pull on anything
    source: e.shelf !== 'Craft',
  });
  if (e.beta) b.beta = e.beta;
  if (star) star.teff = e.cls === 'ns' ? 1e6 : e.cls === 'bh' ? 0 : teffOf(star.L, r);
  if (e.key === 'lava') b.heat = 1;
  if (preset && e.shape) {
    // the outline in its material, sized so its equivalent radius is the body's
    const cells = preset.make().map(c => (c ? e.shape!.mat : 0));
    const n = cells.reduce((k, c) => k + (c ? 1 : 0), 0);
    const sizeKm = (r / KM) * GRID / Math.sqrt(n / Math.PI);
    const st = shapeStats(cells, sizeKm);
    b.shape = makeShape(cells, st);
  }
  refreshRoche(b);
  return b;
}

