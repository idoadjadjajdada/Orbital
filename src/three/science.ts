import type { Body } from '../physics/body';
import { AU_M, MSUN_KG, M_EARTH, densityOf } from '../physics/units';

/**
 * What the instruments find: the exact make-up of an atmosphere (and whether
 * there is one), the layers inside a world, what its ground is made of, how
 * habitable it is and what lives there.
 *
 * Real bodies use measured values (NASA planetary fact sheets, the Apollo,
 * Venera, Viking, Curiosity, Galileo, Cassini–Huygens, Juno, MESSENGER and
 * New Horizons results). Made-up worlds are worked out from what they are:
 * their style, mass, size and the starlight on them, with a seeded spread so
 * no two read the same. Life is only confirmed on the Earth; elsewhere in the
 * Solar System the scanner reports the real candidate biosignatures, none of
 * them confirmed. A made-up world in its star's habitable zone may have
 * life of its own, rolled from its seed and weighted by how habitable it is.
 */

/** a gas and its share by volume (0–1) */
export interface Gas { f: string; name: string; x: number }
export interface Atmosphere {
  /** surface pressure, bar (at the 1-bar level for a giant); 0 for none at all */
  bar: number;
  /** scale height, km */
  H: number;
  /** temperature at the surface (or the 1-bar level), K */
  T: number;
  gases: Gas[];
  /** 'none', 'exosphere' (a few atoms, no weather), 'thin', 'thick' or 'giant' */
  kind: 'none' | 'exosphere' | 'thin' | 'thick' | 'giant';
  /** a note on where the numbers come from, or what is odd about it */
  note: string;
  /** sky colour by day, 0xRRGGBB, and at sunset */
  sky: number; dusk: number;
  /** does the air carry dust or haze that cuts the view (0 clear – 1 opaque)? */
  haze: number;
  /** clouds and what they are made of */
  clouds: string;
}

export interface Layer { name: string; r0: number; r1: number; what: string; color: number }
export interface Interior { layers: Layer[]; note: string }
export interface Composition { rows: [string, number][]; note: string }

export interface Habitability {
  /** 0–1 */
  score: number;
  /** inside the star's habitable zone (Kopparapu et al. 2013, conservative edges) */
  inZone: boolean;
  zone: [number, number];
  /** distance from the star that lights it best, AU */
  dist: number;
  /** equilibrium-ish surface temperature, K */
  T: number;
  water: string;
  reasons: string[];
}

export type LifeTier = 'none' | 'candidate' | 'microbial' | 'plants' | 'animals' | 'intelligent' | 'earth';
export interface Life {
  tier: LifeTier;
  /** a one-line verdict */
  verdict: string;
  /** what was measured that bears on it */
  signs: string[];
  /** life forms found, for the made-up worlds that have them */
  forms: LifeForm[];
  /** plant pigment for this star, 0xRRGGBB */
  leaf: number;
}
export interface LifeForm { name: string; kind: 'microbe' | 'plant' | 'animal' | 'people'; about: string; size: number; color: number }

// ------------------------------------------------------------------ measured
const g = (f: string, name: string, x: number): Gas => ({ f, name, x });
const PPM = 1e-6;

/** real atmospheres, by volume, near the surface */
const ATMO: Record<string, Omit<Atmosphere, 'kind'>> = {
  Mercury: { bar: 5e-15, H: 0, T: 440, gases: [g('O', 'atomic oxygen', 0.42), g('Na', 'sodium', 0.29), g('H₂', 'hydrogen', 0.22), g('He', 'helium', 0.06), g('K', 'potassium', 0.005)], note: 'A surface-bounded exosphere: atoms knocked off the ground by sunlight and the solar wind (MESSENGER).', sky: 0x000000, dusk: 0x000000, haze: 0, clouds: 'none' },
  Venus: { bar: 92, H: 15.9, T: 737, gases: [g('CO₂', 'carbon dioxide', 0.965), g('N₂', 'nitrogen', 0.035), g('SO₂', 'sulphur dioxide', 150 * PPM), g('Ar', 'argon', 70 * PPM), g('H₂O', 'water vapour', 20 * PPM), g('CO', 'carbon monoxide', 17 * PPM), g('He', 'helium', 12 * PPM), g('Ne', 'neon', 7 * PPM)], note: 'Pioneer Venus, Venera and Vega. A runaway greenhouse: the hottest surface in the Solar System, under 92 bar.', sky: 0xd8a860, dusk: 0x8a5a30, haze: 0.75, clouds: 'sulphuric acid, 48–70 km up, wall to wall' },
  Earth: { bar: 1.01325, H: 8.5, T: 288, gases: [g('N₂', 'nitrogen', 0.78084), g('O₂', 'oxygen', 0.20946), g('Ar', 'argon', 0.00934), g('H₂O', 'water vapour (varies 0–4%)', 0.004), g('CO₂', 'carbon dioxide', 421 * PPM), g('Ne', 'neon', 18.18 * PPM), g('He', 'helium', 5.24 * PPM), g('CH₄', 'methane', 1.92 * PPM), g('Kr', 'krypton', 1.14 * PPM), g('H₂', 'hydrogen', 0.55 * PPM)], note: 'Dry air plus average water vapour. The oxygen is made by life.', sky: 0x6ea8ff, dusk: 0xff8a50, haze: 0.08, clouds: 'water droplets and ice' },
  Moon: { bar: 3e-15, H: 0, T: 250, gases: [g('He', 'helium', 0.38), g('Ar', 'argon-40', 0.38), g('Ne', 'neon', 0.2), g('Na', 'sodium', 0.02), g('K', 'potassium', 0.02)], note: 'An exosphere of about 10⁵ atoms per cm³ by night (LADEE, Apollo 17 LACE).', sky: 0x000000, dusk: 0x000000, haze: 0, clouds: 'none' },
  Mars: { bar: 0.00636, H: 11.1, T: 210, gases: [g('CO₂', 'carbon dioxide', 0.951), g('N₂', 'nitrogen', 0.0259), g('Ar', 'argon', 0.0194), g('O₂', 'oxygen', 0.0016), g('CO', 'carbon monoxide', 0.0006), g('H₂O', 'water vapour', 210 * PPM), g('NO', 'nitric oxide', 100 * PPM), g('Ne', 'neon', 2.5 * PPM), g('Kr', 'krypton', 0.3 * PPM), g('CH₄', 'methane (seasonal, ppb)', 0.4e-9)], note: 'Viking and Curiosity SAM. Dust in the air makes the sky butterscotch and the sunsets blue.', sky: 0xc89a70, dusk: 0x6a8ab8, haze: 0.25, clouds: 'water-ice and CO₂-ice, thin' },
  Io: { bar: 1e-9, H: 0, T: 110, gases: [g('SO₂', 'sulphur dioxide', 0.9), g('SO', 'sulphur monoxide', 0.05), g('S₂', 'sulphur', 0.03), g('NaCl', 'salt', 0.01), g('O', 'oxygen', 0.01)], note: 'Fed by the volcanoes; it freezes out each time Io passes into Jupiter’s shadow.', sky: 0x000000, dusk: 0x000000, haze: 0, clouds: 'volcanic plumes up to 400 km' },
  Europa: { bar: 1e-12, H: 0, T: 102, gases: [g('O₂', 'oxygen', 0.9), g('H₂', 'hydrogen', 0.08), g('H₂O', 'water', 0.02)], note: 'Radiolysis: Jupiter’s radiation splits the ice; the hydrogen escapes, the oxygen lingers.', sky: 0x000000, dusk: 0x000000, haze: 0, clouds: 'none' },
  Ganymede: { bar: 1e-11, H: 0, T: 110, gases: [g('O₂', 'oxygen', 0.85), g('H₂O', 'water', 0.1), g('H', 'hydrogen', 0.05)], note: 'A thin oxygen exosphere, with aurorae from its own magnetic field (Hubble).', sky: 0x000000, dusk: 0x000000, haze: 0, clouds: 'none' },
  Callisto: { bar: 7.5e-12, H: 0, T: 134, gases: [g('CO₂', 'carbon dioxide', 0.6), g('O₂', 'oxygen', 0.4)], note: 'Galileo NIMS and Hubble.', sky: 0x000000, dusk: 0x000000, haze: 0, clouds: 'none' },
  Titan: { bar: 1.467, H: 21, T: 93.7, gases: [g('N₂', 'nitrogen', 0.942), g('CH₄', 'methane', 0.0565), g('H₂', 'hydrogen', 0.00099), g('C₂H₆', 'ethane', 10 * PPM), g('Ar', 'argon-36', 28 * PPM), g('C₂H₂', 'acetylene', 3 * PPM)], note: 'Huygens GCMS at the surface, 14 January 2005. Thicker than Earth’s, and four times as dense.', sky: 0xd08a3a, dusk: 0x6a3a18, haze: 0.85, clouds: 'methane, with a photochemical orange haze above' },
  Enceladus: { bar: 0, H: 0, T: 75, gases: [g('H₂O', 'water', 0.965), g('CO₂', 'carbon dioxide', 0.006), g('NH₃', 'ammonia', 0.009), g('H₂', 'hydrogen', 0.009), g('CH₄', 'methane', 0.002)], note: 'No atmosphere: these are the south-pole plumes, sampled by Cassini INMS flying through them.', sky: 0x000000, dusk: 0x000000, haze: 0, clouds: 'geyser plumes over the tiger stripes' },
  Triton: { bar: 1.4e-5, H: 14, T: 38, gases: [g('N₂', 'nitrogen', 0.9991), g('CO', 'carbon monoxide', 0.0007), g('CH₄', 'methane', 0.0002)], note: 'Voyager 2, 1989. Thin enough that the geysers’ plumes rise 8 km and drift.', sky: 0x000000, dusk: 0x000000, haze: 0.05, clouds: 'thin nitrogen-ice haze' },
  Pluto: { bar: 1.1e-5, H: 60, T: 44, gases: [g('N₂', 'nitrogen', 0.99), g('CH₄', 'methane', 0.005), g('CO', 'carbon monoxide', 0.0005)], note: 'New Horizons, 2015: blue haze layers 200 km deep.', sky: 0x101830, dusk: 0x3050a0, haze: 0.1, clouds: 'tholin haze in some twenty layers' },
  Eris: { bar: 0, H: 0, T: 42, gases: [], note: 'Frozen onto the ground at this distance from the Sun.', sky: 0x000000, dusk: 0x000000, haze: 0, clouds: 'none' },
  Ceres: { bar: 0, H: 0, T: 168, gases: [g('H₂O', 'water vapour (transient)', 1)], note: 'Herschel saw water vapour venting now and then; no lasting atmosphere.', sky: 0x000000, dusk: 0x000000, haze: 0, clouds: 'none' },
  Jupiter: { bar: 1, H: 27, T: 165, gases: [g('H₂', 'hydrogen', 0.898), g('He', 'helium', 0.102), g('CH₄', 'methane', 0.003), g('NH₃', 'ammonia', 260 * PPM), g('HD', 'hydrogen deuteride', 28 * PPM), g('C₂H₆', 'ethane', 5.8 * PPM), g('H₂O', 'water (deep, variable)', 4 * PPM)], note: 'Galileo probe, 1995: it fell 150 km below the cloud tops and lasted 58 minutes, to 23 bar.', sky: 0xc8a878, dusk: 0x704830, haze: 0.5, clouds: 'ammonia ice (0.7 bar), ammonium hydrosulphide (2 bar), water (5 bar)' },
  Saturn: { bar: 1, H: 59.5, T: 134, gases: [g('H₂', 'hydrogen', 0.963), g('He', 'helium', 0.0325), g('CH₄', 'methane', 0.0045), g('NH₃', 'ammonia', 125 * PPM), g('HD', 'hydrogen deuteride', 110 * PPM), g('C₂H₆', 'ethane', 7 * PPM)], note: 'Voyager and Cassini; the helium has partly rained out into the interior.', sky: 0xd8c090, dusk: 0x806040, haze: 0.55, clouds: 'ammonia ice, ammonium hydrosulphide, water, deeper than Jupiter’s' },
  Uranus: { bar: 1, H: 27.7, T: 76, gases: [g('H₂', 'hydrogen', 0.825), g('He', 'helium', 0.152), g('CH₄', 'methane', 0.023), g('HD', 'hydrogen deuteride', 148 * PPM)], note: 'Voyager 2. The methane absorbs red light: hence the cyan.', sky: 0x9fe0e8, dusk: 0x305868, haze: 0.45, clouds: 'methane ice, hydrogen sulphide below' },
  Neptune: { bar: 1, H: 19.7, T: 72, gases: [g('H₂', 'hydrogen', 0.8), g('He', 'helium', 0.19), g('CH₄', 'methane', 0.015), g('HD', 'hydrogen deuteride', 192 * PPM), g('C₂H₆', 'ethane', 1.5 * PPM)], note: 'Voyager 2. The fastest winds measured anywhere, 2,100 km/h.', sky: 0x4a78e0, dusk: 0x182c60, haze: 0.4, clouds: 'methane ice streaks, hydrogen sulphide below' },
};

const LAYERS: Record<string, [string, number, string, number][]> = {
  // name, outer radius as a fraction of the whole, what it is, colour
  Mercury: [['Solid inner core', 0.41, 'iron–nickel', 0xd8d0c0], ['Liquid outer core', 0.83, 'molten iron with sulphur', 0xe0a050], ['FeS layer', 0.84, 'iron sulphide', 0xa08040], ['Mantle', 0.986, 'silicates', 0x9a6a4a], ['Crust', 1, 'magnesium-rich silicate, 35 km', 0x8a8a88]],
  Venus: [['Core', 0.53, 'iron–nickel, perhaps partly liquid', 0xe0a050], ['Mantle', 0.993, 'silicate rock', 0xb0603a], ['Crust', 1, 'basalt, 30–50 km', 0x8a7060]],
  Earth: [['Inner core', 0.192, 'solid iron–nickel, 5,400 °C', 0xf0e0b0], ['Outer core', 0.546, 'liquid iron–nickel: the dynamo', 0xf0a040], ['Lower mantle', 0.895, 'bridgmanite and ferropericlase', 0xc05030], ['Upper mantle', 0.9945, 'peridotite (olivine, pyroxene)', 0xd07040], ['Crust', 1, 'granite continents, basalt ocean floor', 0x6a7a5a]],
  Moon: [['Inner core', 0.14, 'solid iron', 0xe8d8b0], ['Outer core', 0.19, 'liquid iron', 0xe0a050], ['Partial melt', 0.28, 'semi-molten mantle base', 0xc06040], ['Mantle', 0.977, 'olivine and pyroxene', 0x9a7050], ['Crust', 1, 'anorthosite, about 40 km', 0xb0aea8]],
  Mars: [['Core', 0.54, 'liquid iron with sulphur (InSight)', 0xe0a050], ['Mantle', 0.985, 'iron-rich silicates', 0xa05030], ['Crust', 1, 'basalt, 24–72 km', 0xb06a40]],
  Io: [['Core', 0.52, 'iron and iron sulphide', 0xe0a050], ['Mantle', 0.97, 'silicate rock, a partly molten magma ocean near the top', 0xd06030], ['Crust', 1, 'sulphur-coated silicate, 30–50 km', 0xe0d060]],
  Europa: [['Core', 0.4, 'iron–nickel', 0xe0a050], ['Mantle', 0.9, 'rock', 0x8a6a50], ['Ocean', 0.987, 'salty liquid water, about 100 km deep', 0x3a6aa0], ['Ice shell', 1, 'water ice, 15–25 km', 0xd8e4ec]],
  Ganymede: [['Core', 0.25, 'iron, liquid outer part (it has a magnetic field)', 0xe0a050], ['Mantle', 0.6, 'silicate rock', 0x8a6a50], ['High-pressure ice', 0.82, 'ice VI and V', 0xa0b8d0], ['Ocean', 0.93, 'salty water, sandwiched between ices', 0x3a6aa0], ['Ice crust', 1, 'ice I, about 150 km', 0xc8d0d8]],
  Callisto: [['Rock-and-ice interior', 0.85, 'only partly separated', 0x6a6050], ['Ocean?', 0.94, 'a possible thin salty ocean', 0x3a5a80], ['Ice crust', 1, 'dark ice and rock, 150–200 km', 0x5a5450]],
  Titan: [['Core', 0.68, 'hydrated silicate rock', 0x8a6a50], ['High-pressure ice', 0.82, 'ice VI', 0xa0b8d0], ['Ocean', 0.95, 'water with ammonia', 0x3a6aa0], ['Ice shell', 1, 'water ice under hydrocarbons, 50–100 km', 0xc0a880]],
  Enceladus: [['Rocky core', 0.73, 'porous rock, hydrothermally warmed', 0x8a6a50], ['Ocean', 0.92, 'global salty water ocean', 0x3a6aa0], ['Ice shell', 1, 'water ice, 5 km at the south pole, 35 km elsewhere', 0xeef4f8]],
  Pluto: [['Core', 0.7, 'rock', 0x8a6a50], ['Ocean?', 0.84, 'a possible liquid water layer', 0x3a5a80], ['Ice shell', 1, 'water ice, nitrogen and methane frost on top', 0xd8c0a0]],
  Charon: [['Core', 0.65, 'rock', 0x8a6a50], ['Mantle', 1, 'water ice', 0xb0b0b0]],
  Triton: [['Core', 0.6, 'rock and metal', 0x8a6a50], ['Mantle', 0.9, 'water ice, possibly a liquid layer', 0x7090b0], ['Crust', 1, 'nitrogen and water ice', 0xe0d0d0]],
  Ceres: [['Core', 0.75, 'hydrated rock and mud', 0x6a5a4a], ['Brine layer', 0.86, 'salty brine pockets', 0x4a6a80], ['Crust', 1, 'ice, salts, clays', 0x7a7470]],
  Jupiter: [['Dilute core', 0.45, 'rock and ice dissolved in metallic hydrogen (Juno)', 0xc08050], ['Metallic hydrogen', 0.83, 'liquid metallic hydrogen and helium: the magnetic field', 0x9090a8], ['Molecular hydrogen', 0.999, 'hydrogen and helium, liquid deep down, gas above', 0xc8a878], ['Cloud deck', 1, 'ammonia, ammonium hydrosulphide and water clouds', 0xe0c090]],
  Saturn: [['Dilute core', 0.6, 'rock and ice smeared into hydrogen (ring seismology)', 0xb08050], ['Metallic hydrogen', 0.75, 'helium rain falls through it', 0x9090a8], ['Molecular hydrogen', 0.999, 'hydrogen and helium', 0xd8c090], ['Cloud deck', 1, 'ammonia and water clouds', 0xe8d8a8]],
  Uranus: [['Rocky core', 0.2, 'rock and iron', 0x8a6a50], ['Icy mantle', 0.75, 'a hot, dense fluid of water, ammonia and methane', 0x4a8a9a], ['Envelope', 1, 'hydrogen, helium, methane', 0x9fe0e8]],
  Neptune: [['Rocky core', 0.25, 'rock and iron', 0x8a6a50], ['Icy mantle', 0.8, 'water, ammonia and methane under pressure (perhaps raining diamonds)', 0x3a6aa0], ['Envelope', 1, 'hydrogen, helium, methane', 0x4a78e0]],
};

/** the ground, oxide or ice weight %, from the landers and orbiters */
const GROUND: Record<string, Composition> = {
  Mercury: { rows: [['SiO₂', 51], ['MgO', 25], ['Al₂O₃', 12], ['CaO', 6], ['Na₂O', 3], ['S', 2.5], ['FeO', 1.5]], note: 'MESSENGER X-ray and gamma-ray spectrometers: very little iron at the surface, lots of sulphur.' },
  Venus: { rows: [['SiO₂', 48.7], ['Al₂O₃', 17.9], ['CaO', 10.3], ['FeO', 8.8], ['MgO', 8.1], ['Na₂O', 2.4], ['TiO₂', 1.25], ['K₂O', 0.2]], note: 'Venera 14 drill sample: tholeiitic basalt.' },
  Earth: { rows: [['SiO₂', 60.6], ['Al₂O₃', 15.9], ['FeO', 6.7], ['CaO', 6.4], ['MgO', 4.7], ['Na₂O', 3.1], ['K₂O', 1.8], ['TiO₂', 0.7]], note: 'Average continental crust (Rudnick & Gao 2003).' },
  Moon: { rows: [['SiO₂', 45], ['Al₂O₃', 20], ['CaO', 13], ['FeO', 11], ['MgO', 8], ['TiO₂', 2], ['Na₂O', 0.5]], note: 'Apollo regolith, highlands and maria averaged. The maria are basalt with more iron and titanium.' },
  Mars: { rows: [['SiO₂', 43], ['FeO', 19], ['Al₂O₃', 9.4], ['MgO', 8.7], ['CaO', 7.3], ['SO₃', 6], ['Na₂O', 2.7], ['TiO₂', 1], ['P₂O₅', 0.9], ['Cl', 0.7]], note: 'Curiosity APXS, Gale crater soil. Rust (iron oxide) dust makes it red; perchlorate salts in the soil.' },
  Io: { rows: [['S, SO₂ frost', 45], ['Silicates (basalt)', 50], ['NaCl, KCl', 5]], note: 'Galileo: lava at 1,500 K, high-magnesium silicate.' },
  Europa: { rows: [['H₂O ice', 90], ['Hydrated salts (NaCl, MgSO₄)', 8], ['Sulphuric acid hydrate', 2]], note: 'Galileo NIMS and JWST. The salt is from the ocean below.' },
  Ganymede: { rows: [['H₂O ice', 60], ['Hydrated silicates', 35], ['CO₂, salts', 5]], note: 'Galileo and Juno.' },
  Callisto: { rows: [['H₂O ice', 50], ['Rock and dust', 45], ['CO₂', 5]], note: 'Galileo NIMS.' },
  Titan: { rows: [['H₂O ice (bedrock)', 55], ['Organics (tholins)', 35], ['Methane/ethane liquid', 10]], note: 'Huygens landed on a damp, cobbled plain like wet sand.' },
  Enceladus: { rows: [['H₂O ice', 98], ['Salts (NaCl, Na₂CO₃)', 1.5], ['Organics, silica, phosphates', 0.5]], note: 'Cassini, from the plume grains.' },
  Pluto: { rows: [['N₂ ice', 70], ['CH₄ ice', 15], ['CO ice', 5], ['H₂O ice (bedrock)', 10]], note: 'New Horizons LEISA.' },
  Charon: { rows: [['H₂O ice', 90], ['NH₃ hydrates', 5], ['Tholins (red cap)', 5]], note: 'New Horizons.' },
  Triton: { rows: [['N₂ ice', 55], ['H₂O ice', 30], ['CO₂ ice', 10], ['CH₄, CO', 5]], note: 'Voyager 2 and ground spectra.' },
  Ceres: { rows: [['Phyllosilicates (clays)', 55], ['Carbonates', 15], ['H₂O ice', 20], ['Organics', 5], ['NaCl, NH₄Cl', 5]], note: 'Dawn: bright sodium carbonate in Occator crater.' },
  Phobos: { rows: [['Carbonaceous rock', 70], ['Fine dust', 30]], note: 'Like a carbonaceous chondrite, or perhaps Mars ejecta.' },
  Vesta: { rows: [['Pyroxene basalt (eucrite)', 75], ['Olivine', 10], ['Dark carbonaceous', 15]], note: 'Dawn; the HED meteorites come from here.' },
};

// ------------------------------------------------------------------ helpers
const isGiant = (b: Body) => b.cls === 'gas' || ['gas', 'icegiant', 'hotjupiter', 'browndwarf'].includes(b.look.style);
const isCompact = (b: Body) => ['star', 'wd', 'ns', 'bh'].includes(b.cls);
const realOf = (b: Body) => (b.look.real && Object.hasOwn(ATMO, b.look.real) || b.look.real && Object.hasOwn(LAYERS, b.look.real) || b.look.real && Object.hasOwn(GROUND, b.look.real)) ? b.look.real : undefined;

/** a deterministic random stream from a body's seed and a salt */
export function rng(seed: number, salt = 0) {
  let s = (Math.imul(seed | 0, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** surface gravity, m/s² */
export function gravity(b: Body) {
  const R = b.r * AU_M;
  return R > 0 ? 6.674e-11 * b.m * MSUN_KG / (R * R) : 0;
}

/** the star that lights a body best: it, the flux (Earth = 1) and distance (AU) */
export function lightOf(b: Body, stars: Body[]) {
  let best: Body | null = null, f = 0, flux = 0;
  for (const s of stars) {
    if (s === b) continue;
    const d2 = Math.max((s.x - b.x) ** 2 + (s.y - b.y) ** 2 + (s.z - b.z) ** 2, 1e-12);
    const q = (s.star?.L ?? 0) / d2;
    flux += q;
    if (q > f) { f = q; best = s; }
  }
  const dist = best ? Math.hypot(best.x - b.x, best.y - b.y, best.z - b.z) : Infinity;
  return { star: best, flux, dist };
}

/** the temperature a ball with an Earth-like albedo settles at under that flux, K (255 K at 1 AU from the Sun) */
const teq = (flux: number) => 278.6 * Math.pow(Math.max(flux, 0), 0.25) * 0.917;

/** the surface temperature, K: measured, or worked out with a greenhouse for the air it has */
export function surfaceT(b: Body, stars: Body[]) {
  const a = ATMO[b.look.real ?? ''];
  if (a) return a.T;
  const { flux } = lightOf(b, stars);
  if (b.heat > 0.55) return Math.max(1200, teq(flux));
  const st = b.look.style;
  const green = st === 'terran' ? 33 : st === 'ocean' ? 40 : st === 'lava' ? 400 : st === 'desert' ? 8 : 0;
  return teq(flux) + green;
}

// ------------------------------------------------------------------ atmosphere
const SKY: Record<string, [number, number]> = {
  terran: [0x6ea8ff, 0xff8a50], ocean: [0x7ab4ff, 0xff9a60], desert: [0xd0b090, 0x8090c0], lava: [0x8a4a30, 0xff5020],
  rocky: [0x000000, 0x000000], barren: [0x000000, 0x000000], ice: [0x000000, 0x000000], iron: [0x000000, 0x000000], carbon: [0x000000, 0x000000],
  gas: [0xc8a878, 0x704830], icegiant: [0x80c8e0, 0x204860], hotjupiter: [0x6a3020, 0x200808], browndwarf: [0x6a1810, 0x200404],
};

/** normalise shares to sum to 1, and sort by share */
function norm(gs: Gas[]) {
  const s = gs.reduce((a, x) => a + x.x, 0) || 1;
  return gs.map(x => ({ ...x, x: x.x / s })).sort((a, c) => c.x - a.x);
}

/** the atmosphere: measured, or worked out from what the world is */
export function atmosphere(b: Body, stars: Body[]): Atmosphere {
  if (isCompact(b)) {
    const T = b.star?.teff ?? 0;
    return { bar: 0, H: 0, T, kind: b.cls === 'star' ? 'giant' : 'none', gases: b.cls === 'star' ? [g('H', 'hydrogen', 0.921), g('He', 'helium', 0.078), g('O, C, Ne, Fe…', 'metals', 0.001)] : [], note: b.cls === 'star' ? 'A photosphere, by number of atoms.' : 'No atmosphere to speak of.', sky: 0, dusk: 0, haze: 0, clouds: 'none' };
  }
  const real = ATMO[b.look.real ?? ''];
  if (real) return { ...real, gases: norm(real.gases), kind: kindOf(real.bar, isGiant(b)) };
  const st = b.look.style, r = rng(b.look.seed, 7), T = surfaceT(b, stars);
  const gs = gravity(b), vesc = Math.sqrt(2 * gs * b.r * AU_M);
  const [sky, dusk] = SKY[st] ?? [0, 0];
  if (isGiant(b)) {
    const hot = st === 'hotjupiter' || st === 'browndwarf' || T > 900;
    const he = 0.1 + 0.06 * r();
    const gases = hot
      ? [g('H₂', 'hydrogen', 1 - he - 0.003), g('He', 'helium', he), g('H₂O', 'water vapour', 0.0012 + 0.001 * r()), g('CO', 'carbon monoxide', 0.0008 + 0.0008 * r()), g('Na', 'sodium', 2e-6), g('K', 'potassium', 1.5e-7), ...(st === 'browndwarf' ? [g('CH₄', 'methane', 0.0004)] : [g('TiO', 'titanium oxide', 1e-7)])]
      : st === 'icegiant'
        ? [g('H₂', 'hydrogen', 0.8 - 0.05 * r()), g('He', 'helium', he + 0.06), g('CH₄', 'methane', 0.012 + 0.015 * r()), g('HD', 'hydrogen deuteride', 170 * PPM)]
        : [g('H₂', 'hydrogen', 1 - he - 0.004), g('He', 'helium', he), g('CH₄', 'methane', 0.002 + 0.003 * r()), g('NH₃', 'ammonia', 100 * PPM + 300 * PPM * r()), g('H₂O', 'water', 5 * PPM)];
    const Tg = hot ? Math.max(T, 1200) : Math.max(T, 50);
    return { bar: 1, H: (8.314 * Tg) / (2.3e-3 * Math.max(gs, 1)) / 1000, T: Tg, kind: 'giant', gases: norm(gases), note: 'Worked out from its mass and the light on it: a solar mix of hydrogen and helium.', sky, dusk, haze: 0.5, clouds: hot ? 'silicate and iron clouds; it rains glass' : st === 'icegiant' ? 'methane ice' : 'ammonia and water ice' };
  }
  // can it hold any air at all? a gas is kept for billions of years if escape speed is over ~6× its thermal speed
  const holds = (mu: number) => vesc > 6 * Math.sqrt((3 * 1.38e-23 * Math.max(T, 30) * 1.5) / (mu * 1.66e-27));
  if (b.r * AU_M < 3e5 || !holds(28)) {
    return { bar: 0, H: 0, T, kind: b.r * AU_M > 1e6 ? 'exosphere' : 'none', gases: b.r * AU_M > 1e6 ? norm([g('He', 'helium', 0.4), g('Ar', 'argon', 0.35), g('Na', 'sodium', 0.15), g('Ne', 'neon', 0.1)]) : [], note: b.r * AU_M > 1e6 ? 'Too light (or too hot) to keep an atmosphere: a few atoms from the rock and the stellar wind.' : 'Too small to hold any gas at all.', sky: 0, dusk: 0, haze: 0, clouds: 'none' };
  }
  const life = lifeRoll(b, stars);
  const mass = b.m / M_EARTH;
  let gases: Gas[], bar: number, clouds: string, haze = 0.08;
  if (st === 'terran' || st === 'ocean') {
    const o2 = life.tier === 'plants' || life.tier === 'animals' || life.tier === 'intelligent' ? 0.12 + 0.18 * r() : 0;
    const co2 = o2 ? 200 * PPM + 2000 * PPM * r() : 0.005 + 0.05 * r();
    const h2o = Math.max(0.001, Math.min(0.04, 0.004 * Math.exp((T - 288) / 15)));
    gases = [g('N₂', 'nitrogen', 1 - o2 - co2 - h2o - 0.01), g('O₂', 'oxygen', o2), g('Ar', 'argon', 0.005 + 0.01 * r()), g('H₂O', 'water vapour', h2o), g('CO₂', 'carbon dioxide', co2)];
    if (life.tier !== 'none' && life.tier !== 'candidate') gases.push(g('CH₄', 'methane (biogenic)', 2 * PPM + 20 * PPM * r()));
    bar = Math.max(0.3, Math.min(8, (st === 'ocean' ? 1.5 : 1) * Math.pow(mass, 0.7) * (0.5 + r())));
    clouds = 'water droplets and ice';
  } else if (st === 'desert') {
    gases = [g('CO₂', 'carbon dioxide', 0.9 + 0.07 * r()), g('N₂', 'nitrogen', 0.02 + 0.03 * r()), g('Ar', 'argon', 0.01 + 0.01 * r()), g('O₂', 'oxygen', 0.001), g('H₂O', 'water vapour', 300 * PPM)];
    bar = Math.max(0.004, Math.min(0.5, 0.02 * Math.pow(mass, 1.2) * (0.5 + 2 * r())));
    clouds = 'thin water-ice and dust'; haze = 0.3;
  } else if (st === 'lava') {
    gases = [g('Na', 'sodium vapour', 0.4 + 0.1 * r()), g('O₂', 'oxygen', 0.2), g('SiO', 'silicon monoxide', 0.15), g('SO₂', 'sulphur dioxide', 0.1 + 0.1 * r()), g('K', 'potassium', 0.05), g('Fe', 'iron vapour', 0.02)];
    bar = 0.01 + 0.2 * r();
    clouds = 'rock vapour condensing as it rises'; haze = 0.5;
  } else if (b.kind === 'hycean' || (st === 'ice' && mass > 3)) {
    gases = [g('H₂', 'hydrogen', 0.85 + 0.08 * r()), g('He', 'helium', 0.08), g('H₂O', 'water vapour', 0.02 + 0.02 * r()), g('CH₄', 'methane', 0.01 + 0.01 * r()), g('CO₂', 'carbon dioxide', 0.01 * r())];
    bar = 10 + 90 * r();
    clouds = 'water'; haze = 0.4;
  } else if (st === 'ice' && T < 120) {
    gases = [g('N₂', 'nitrogen', 0.98), g('CH₄', 'methane', 0.015), g('CO', 'carbon monoxide', 0.005)];
    bar = mass > 0.01 ? 1e-5 * (1 + 10 * r()) : 0;
    clouds = 'nitrogen haze'; haze = 0.05;
  } else {
    gases = [g('CO₂', 'carbon dioxide', 0.7 + 0.25 * r()), g('N₂', 'nitrogen', 0.05 + 0.2 * r()), g('SO₂', 'sulphur dioxide', 0.01 * r()), g('Ar', 'argon', 0.01)];
    bar = mass > 0.2 ? 0.01 + 0.5 * r() * mass : 0;
    clouds = 'thin';
  }
  if (bar === 0) return { bar: 0, H: 0, T, kind: 'exosphere', gases: norm([g('He', 'helium', 0.5), g('Ar', 'argon', 0.3), g('Na', 'sodium', 0.2)]), note: 'Too little to measure but a trace of atoms.', sky: 0, dusk: 0, haze: 0, clouds: 'none' };
  const mu = gases.reduce((a, x) => a + x.x * (MU[x.f] ?? 29), 0) / (gases.reduce((a, x) => a + x.x, 0) || 1);
  const Hs = (8.314 * T) / (mu / 1000 * Math.max(gs, 0.05)) / 1000;
  return { bar, H: Hs, T, kind: kindOf(bar, false), gases: norm(gases), note: life.tier !== 'none' && gases.some(x => x.f === 'O₂' && x.x > 0) ? 'Worked out from its mass, temperature and seed. The free oxygen is a sign of photosynthesis.' : 'Worked out from its mass, temperature and seed.', sky: bar > 0.05 ? sky : 0, dusk: bar > 0.05 ? dusk : 0, haze, clouds };
}

const MU: Record<string, number> = { 'N₂': 28, 'O₂': 32, 'Ar': 40, 'H₂O': 18, 'CO₂': 44, 'CH₄': 16, 'H₂': 2, 'He': 4, 'SO₂': 64, 'Na': 23, 'SiO': 44, 'K': 39, 'Fe': 56, 'CO': 28 };

function kindOf(bar: number, giant: boolean): Atmosphere['kind'] {
  if (giant) return 'giant';
  if (bar <= 1e-6) return bar > 0 ? 'exosphere' : 'none';
  return bar < 0.1 ? 'thin' : 'thick';
}

// ------------------------------------------------------------------ interior and ground
/** the layers inside, from the centre out */
export function interior(b: Body): Interior {
  const real = LAYERS[b.look.real ?? ''];
  const lay = (rows: [string, number, string, number][]) => rows.map((x, k) => ({ name: x[0], r0: k ? rows[k - 1][1] : 0, r1: x[1], what: x[2], color: x[3] }));
  if (real) return { layers: lay(real), note: 'From gravity, moment of inertia, seismology and magnetic fields measured by spacecraft.' };
  if (isCompact(b)) {
    if (b.cls === 'star') return { layers: lay([['Core', 0.25, 'fusing hydrogen into helium', 0xfff0a0], ['Radiative zone', 0.7, 'light takes 100,000 years to cross it', 0xffc060], ['Convective zone', 1, 'boiling plasma', 0xff8030]]), note: 'A standard stellar model.' };
    if (b.cls === 'wd') return { layers: lay([['Carbon–oxygen core', 0.99, 'electron-degenerate, crystallising as it cools', 0xe0e8ff], ['Helium and hydrogen', 1, 'a thin skin', 0xffffff]]), note: 'Held up by electron degeneracy.' };
    if (b.cls === 'ns') return { layers: lay([['Inner core', 0.5, 'unknown: hyperons, or free quarks', 0xa080ff], ['Outer core', 0.9, 'neutron superfluid', 0x8090ff], ['Inner crust', 0.97, 'nuclear pasta', 0xc0c0ff], ['Outer crust', 1, 'iron nuclei lattice', 0xe0e0e0]]), note: 'Held up by neutron degeneracy.' };
    return { layers: lay([['Singularity', 0.001, 'where the known laws stop', 0x000000], ['Inside the horizon', 1, 'every path leads inward', 0x101010]]), note: 'Nothing inside the event horizon can be measured.' };
  }
  const st = b.look.style, rho = densityOf(b.m, b.r);
  if (isGiant(b)) {
    if (st === 'icegiant') return { layers: lay([['Rocky core', 0.22, 'rock and iron', 0x8a6a50], ['Icy mantle', 0.78, 'superionic water, ammonia, methane', 0x4a8a9a], ['Envelope', 1, 'hydrogen and helium', 0x9fe0e8]]), note: 'Worked out from its mass and density.' };
    if (st === 'browndwarf') return { layers: lay([['Core', 0.3, 'degenerate hydrogen, deuterium burned out', 0xff8040], ['Convective interior', 1, 'fully convective hydrogen and helium', 0xb04030]]), note: 'Too light to fuse hydrogen.' };
    return { layers: lay([['Core', 0.15 + 0.1 * Math.min(1, rho), 'rock and ice', 0xa07050], ['Metallic hydrogen', 0.8, 'liquid metal', 0x9090a8], ['Molecular hydrogen', 1, 'hydrogen and helium', 0xd0b080]]), note: 'Worked out from its mass and density.' };
  }
  if (st === 'iron') return { layers: lay([['Core', 0.85, 'iron–nickel', 0xd0c8b8], ['Mantle', 1, 'thin silicate', 0x8a7a6a]]), note: `Density ${rho.toFixed(1)} g/cm³: mostly metal, like Psyche or a stripped core.` };
  if (st === 'ice' || rho < 2.2) return { layers: lay([['Rock core', rho < 1.5 ? 0.45 : 0.62, 'silicate rock', 0x8a6a50], ...(b.r * AU_M > 5e5 ? [['Ocean?', 0.86, 'a possible layer of liquid water, warmed by tides and decay', 0x3a6aa0] as [string, number, string, number]] : []), ['Ice', 1, 'water ice with volatile frosts', 0xd0dce8]]), note: `Density ${rho.toFixed(2)} g/cm³: rock and ice.` };
  const core = Math.max(0.2, Math.min(0.75, 0.25 + (rho - 3) * 0.12));
  return { layers: lay([['Core', core, 'iron–nickel', 0xe0a050], ['Mantle', 0.98, 'silicate rock', 0xb0603a], ['Crust', 1, st === 'lava' ? 'a thin skin over a magma ocean' : st === 'carbon' ? 'graphite and silicon carbide' : 'basalt and granite', st === 'lava' ? 0xff6020 : 0x8a7a6a]]), note: `Density ${rho.toFixed(2)} g/cm³: worked out from it.` };
}

/** what the ground is made of */
export function composition(b: Body): Composition {
  const real = GROUND[b.look.real ?? ''];
  if (real) return real;
  const st = b.look.style, r = rng(b.look.seed, 13);
  const jig = (rows: [string, number][]) => {
    const j = rows.map(([k, v]) => [k, v * (0.8 + 0.4 * r())] as [string, number]);
    const s = j.reduce((a, x) => a + x[1], 0);
    return j.map(([k, v]) => [k, Math.round((v / s) * 1000) / 10] as [string, number]).sort((a, c) => c[1] - a[1]);
  };
  if (isGiant(b) || isCompact(b)) return { rows: [], note: 'No solid surface.' };
  const table: Record<string, [string, number][]> = {
    terran: [['SiO₂', 60], ['Al₂O₃', 16], ['FeO', 7], ['CaO', 6], ['MgO', 5], ['Na₂O', 3], ['K₂O', 2]],
    ocean: [['H₂O (ocean)', 90], ['Basalt sea floor', 8], ['Salts', 2]],
    desert: [['SiO₂', 48], ['FeO (rust)', 16], ['Al₂O₃', 10], ['MgO', 9], ['CaO', 7], ['SO₃ (sulphates)', 6]],
    rocky: [['SiO₂', 47], ['MgO', 18], ['FeO', 14], ['Al₂O₃', 11], ['CaO', 8]],
    barren: [['SiO₂', 45], ['Al₂O₃', 18], ['CaO', 12], ['FeO', 12], ['MgO', 9]],
    ice: [['H₂O ice', 75], ['Rock dust', 15], ['CO₂ ice', 5], ['NH₃ hydrate', 5]],
    lava: [['Molten silicate', 70], ['MgO', 15], ['FeO', 10], ['Na, K vapour deposits', 5]],
    iron: [['Fe', 85], ['Ni', 9], ['FeS (troilite)', 4], ['Silicate', 2]],
    carbon: [['Graphite', 35], ['SiC', 30], ['TiC', 10], ['Diamond (deep)', 10], ['Silicate', 15]],
  };
  return { rows: jig(table[st] ?? table.rocky), note: 'Estimated from its style and density; the lander measures it for real.' };
}

// ------------------------------------------------------------------ habitability and life
/** the conservative habitable zone for a star (Kopparapu et al. 2013), AU */
export function habitableZone(L: number, teff = 5780): [number, number] {
  const t = teff - 5780;
  const seff = (s0: number, a: number, b: number) => s0 + a * t + b * t * t;
  return [Math.sqrt(L / seff(1.107, 1.332e-4, 1.58e-8)), Math.sqrt(L / seff(0.356, 6.171e-5, 1.698e-9))];
}

export function habitability(b: Body, stars: Body[]): Habitability {
  const { star, dist } = lightOf(b, stars);
  const zone = star ? habitableZone(star.star!.L, star.star!.teff) : [0, 0] as [number, number];
  // a moon is in the zone if its planet is: use its distance from the star
  const inZone = !!star && dist >= zone[0] && dist <= zone[1];
  const T = surfaceT(b, stars);
  const st = b.look.style, mass = b.m / M_EARTH;
  const reasons: string[] = [];
  let s = 1;
  if (isCompact(b) || isGiant(b)) return { score: 0, inZone, zone, dist, T, water: 'none', reasons: [isGiant(b) ? 'No surface to live on' : 'A star or remnant'] };
  if (!star) { s *= 0.05; reasons.push('No star to warm it'); }
  else if (!inZone) { s *= 0.3; reasons.push(dist < zone[0] ? 'Inside its star’s habitable zone: too hot for oceans' : 'Beyond its star’s habitable zone: too cold for surface water'); }
  else reasons.push('In its star’s habitable zone');
  const liquid = T > 255 && T < 380;
  if (!liquid) { s *= 0.15; reasons.push(T >= 380 ? `${Math.round(T)} K: surface water would boil` : `${Math.round(T)} K: surface water would freeze`); }
  const water = st === 'ocean' ? 'a global ocean' : st === 'terran' ? 'oceans and land' : st === 'ice' ? 'ice; maybe an ocean underneath' : st === 'desert' ? 'traces, frozen or underground' : 'none at the surface';
  if (st !== 'terran' && st !== 'ocean') { s *= st === 'desert' ? 0.3 : st === 'ice' ? 0.2 : 0.05; reasons.push(`Water: ${water}`); }
  if (mass < 0.1) { s *= 0.3; reasons.push('Too small to keep a thick atmosphere for long'); }
  if (mass > 10) { s *= 0.3; reasons.push('Heavy enough to hold a crushing hydrogen envelope'); }
  if (star && star.star!.teff < 3500) { s *= 0.7; reasons.push('A red dwarf: flares, and probably tidally locked'); }
  if (b.heat > 0.55) { s *= 0.01; reasons.push('The surface is molten'); }
  return { score: Math.max(0, Math.min(1, s)), inZone, zone, dist, T, water, reasons };
}

/** the pigment a plant evolves to use its star's light (Kiang et al. 2007) */
export function leafColor(teff: number): number {
  if (teff > 6500) return 0x3a7a9a; // F stars: blue-green, reflecting the violet excess
  if (teff > 5300) return 0x3a8a34; // G: green, as here
  if (teff > 4000) return 0x8a7a24; // K: yellow-orange
  if (teff > 3000) return 0x4a1e3a; // M: dark purple to black, to drink every photon
  return 0x201418;
}

const SYL = ['ka', 'ru', 'ven', 'tho', 'il', 'mar', 'sa', 'qu', 'or', 'zel', 'bri', 'dun', 'ae', 'phy', 'lo', 'nix', 'ter', 'u', 'gal', 'om', 'sti', 'vor', 'ny', 'ce'];
const PLANT_KIND = ['frond-tree', 'umbrella tree', 'spire moss', 'creeping mat', 'bladder reed', 'fan coral-plant', 'glass grass', 'tower fungus'];
const ANIMAL_KIND = ['six-legged grazer', 'gliding membrane-wing', 'burrowing coil-worm', 'shelled wader', 'pack hunter', 'floating gasbag', 'stilt-walker', 'tunnelling digger'];

function name(r: () => number, n = 2 + Math.floor(r() * 2)) {
  let s = '';
  for (let k = 0; k < n; k++) s += SYL[Math.floor(r() * SYL.length)];
  return s[0].toUpperCase() + s.slice(1);
}

/** the life a made-up world has, rolled from its seed and weighted by how habitable it is */
function lifeRoll(b: Body, stars: Body[]): { tier: LifeTier; hab: number } {
  const st = b.look.style;
  if (isGiant(b) || isCompact(b) || b.look.craft || b.cls === 'debris') return { tier: 'none', hab: 0 };
  // surfaceT calls atmosphere only for the measured ones, so this does not loop
  const { flux } = lightOf(b, stars);
  const T = teq(flux) + (st === 'terran' ? 33 : st === 'ocean' ? 40 : 0);
  const zoneish = T > 250 && T < 360;
  const mass = b.m / M_EARTH;
  const water = st === 'terran' || st === 'ocean' ? 1 : st === 'ice' ? 0.25 : st === 'desert' ? 0.2 : 0;
  const hab = (zoneish ? 1 : 0.1) * water * (mass > 0.1 && mass < 10 ? 1 : 0.2) * (b.heat > 0.55 ? 0 : 1);
  const r = rng(b.look.seed, 99)();
  if (hab < 0.05) return { tier: r < 0.08 && water > 0 ? 'candidate' : 'none', hab };
  // odds rise with habitability: a temperate ocean world is likely alive; intelligence is rare
  const tiers: [LifeTier, number][] = [['intelligent', 0.12 * hab], ['animals', 0.35 * hab], ['plants', 0.55 * hab], ['microbial', 0.8 * hab]];
  let acc = 0;
  for (const [t, p] of tiers) { acc = p; if (r < acc) return { tier: t, hab }; }
  return { tier: r < 0.9 ? 'candidate' : 'none', hab };
}

const SOLAR: Record<string, { tier: LifeTier; verdict: string; signs: string[] }> = {
  Earth: { tier: 'earth', verdict: 'Life confirmed: about 8.7 million species of eukaryote, and far more microbes.', signs: ['21% free oxygen and methane together: out of chemical equilibrium', 'The red edge: vegetation reflects strongly just past 700 nm', 'Radio and light at night: technology'] },
  Mars: { tier: 'candidate', verdict: 'Not found. Possible: microbes underground, where there is ice and shelter from radiation.', signs: ['Methane that comes and goes (Curiosity, a few parts per billion)', '“Leopard spot” reaction fronts in Cheyava Falls rock (Perseverance, 2024): a potential biosignature, not proof', 'Organic molecules in 3.5-billion-year-old mudstone (Curiosity)', 'Ancient lakes and rivers: Jezero and Gale were habitable once', 'Perchlorate in the soil, harsh UV and radiation at the surface'] },
  Venus: { tier: 'candidate', verdict: 'Not found. Speculative: microbes in the cloud layer, 50–60 km up, where it is 30 °C and 1 bar.', signs: ['Phosphine reported in the clouds (2020), disputed since', 'Unknown UV absorber in the clouds', 'The surface, at 464 °C, is sterile'] },
  Europa: { tier: 'candidate', verdict: 'Not found. One of the best places to look: a salty ocean twice the volume of Earth’s, on a rocky floor.', signs: ['Salt (NaCl) from the ocean on the surface (JWST)', 'CO₂ from inside, in Tara Regio', 'Possible water plumes (Hubble)', 'Oxidants made at the surface could feed the ocean'] },
  Enceladus: { tier: 'candidate', verdict: 'Not found. All the ingredients: liquid water, energy, organics and phosphorus.', signs: ['Molecular hydrogen in the plume: food for methanogens', 'Complex organic molecules in the ice grains', 'Phosphates in the plume grains (2023)', 'Silica nanoparticles: hydrothermal vents at 90 °C'] },
  Titan: { tier: 'candidate', verdict: 'Not found. Water-based life would be in the ocean below; methane-based life, if possible at all, in the lakes.', signs: ['Hydrogen flowing down into the surface, and too little acetylene: hypothetical methane-breathers', 'Complex organics everywhere', 'A subsurface water ocean'] },
  Ganymede: { tier: 'candidate', verdict: 'Not found. Its ocean is sealed between ice layers, away from rock: less promising.', signs: ['A salty ocean, from the aurorae’s rocking'] },
  Callisto: { tier: 'none', verdict: 'Not found, and unlikely: any ocean is thin and cold.', signs: [] },
  Ceres: { tier: 'candidate', verdict: 'Not found. Brine and organics near the surface.', signs: ['Aliphatic organics (Dawn)', 'Brine reservoir under Occator'] },
  Io: { tier: 'none', verdict: 'Not found: too volcanic, too irradiated, no water.', signs: [] },
  Moon: { tier: 'none', verdict: 'None: no air, no liquid water, sterilised by radiation.', signs: ['Water ice in permanently shadowed polar craters (but nothing living)'] },
  Mercury: { tier: 'none', verdict: 'None.', signs: [] },
  Pluto: { tier: 'none', verdict: 'Not found; a possible ocean deep down, very cold.', signs: [] },
  Triton: { tier: 'none', verdict: 'Not found; a possible ocean.', signs: [] },
};

/** what lives here (or might) */
export function life(b: Body, stars: Body[]): Life {
  const { star } = lightOf(b, stars);
  const leaf = leafColor(star?.star?.teff ?? 5780);
  const real = b.look.real ? SOLAR[b.look.real] : undefined;
  if (real) return { ...real, forms: [], leaf };
  if (isCompact(b)) return { tier: 'none', verdict: 'Nothing could live here.', signs: [], forms: [], leaf };
  if (isGiant(b)) return { tier: 'none', verdict: 'Not found. Floating organisms in the upper clouds have been imagined (Sagan & Salpeter 1976); none detected.', signs: [], forms: [], leaf };
  const { tier, hab } = lifeRoll(b, stars);
  const r = rng(b.look.seed, 31);
  const forms: LifeForm[] = [];
  const signs: string[] = [];
  if (tier === 'candidate') signs.push('Ambiguous chemistry: a trace gas out of equilibrium, but abiotic sources fit too');
  if (tier === 'microbial' || tier === 'plants' || tier === 'animals' || tier === 'intelligent') {
    signs.push('Methane alongside the oxidised gases: out of equilibrium');
    for (let k = 0; k < 2; k++) forms.push({ name: `${name(r)} mats`, kind: 'microbe', about: ['photosynthetic mats in the shallows', 'chemosynthetic slime round vents', 'rock-eating endoliths'][Math.floor(r() * 3)], size: 0, color: leaf });
  }
  if (tier === 'plants' || tier === 'animals' || tier === 'intelligent') {
    signs.push('Free oxygen in the air, and a “red edge” in the reflected light, shifted to suit this star');
    const n = 3 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) forms.push({ name: name(r), kind: 'plant', about: PLANT_KIND[Math.floor(r() * PLANT_KIND.length)], size: 0.5 + r() * 25 / Math.max(0.4, Math.sqrt(gravity(b) / 9.81)), color: leaf });
  }
  if (tier === 'animals' || tier === 'intelligent') {
    const n = 3 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) forms.push({ name: name(r), kind: 'animal', about: ANIMAL_KIND[Math.floor(r() * ANIMAL_KIND.length)], size: 0.2 + r() * 3 / Math.max(0.4, Math.sqrt(gravity(b) / 9.81)), color: (Math.floor(r() * 0xffffff)) | 0x404040 });
  }
  if (tier === 'intelligent') {
    signs.push('Artificial lights on the night side and narrow-band radio');
    forms.push({ name: `The ${name(r, 2)}`, kind: 'people', about: ['builders of terraced towns', 'tower-dwellers of the river plains', 'a seafaring people of the archipelagos'][Math.floor(r() * 3)], size: 1.2 + r(), color: 0xd0c0a0 });
  }
  const verdict = {
    none: 'Nothing found.',
    candidate: 'Inconclusive: a possible biosignature that something non-living could also explain.',
    microbial: 'Life found: single-celled, in the water and on the rocks.',
    plants: 'Life found: plants of its own, coloured for its star.',
    animals: 'Life found: plants and animals.',
    intelligent: 'Life found, and a civilisation: towns, roads and lights at night.',
    earth: '',
  }[tier];
  if (hab > 0 && tier === 'none') signs.push('Habitable conditions, but no signs of life');
  return { tier, verdict, signs, forms, leaf };
}

// ------------------------------------------------------------------ crushing depth for the giants
/** pressure (bar) at a depth (km) below the 1-bar level of a giant, from its scale height and an adiabat */
export function giantPressure(a: Atmosphere, depthKm: number) {
  if (depthKm <= 0) return a.bar * Math.exp(depthKm / Math.max(a.H, 1));
  // the temperature climbs at the dry lapse rate Γ = g/cp, so T = T0 (1 + z/z0) with z0 = T0/Γ = 3.5 H for a
  // diatomic gas, and P ∝ T^(γ/(γ−1)) = T^3.5. For Jupiter: 425 K and 22 bar at 150 km, as Galileo measured
  const z0 = a.H * 3.5;
  return a.bar * Math.pow(1 + depthKm / z0, 3.5);
}
/**
 * pressure (bar) and temperature (K) at a height z (km) over a solid world's
 * datum: an exponential atmosphere with a troposphere cooling at the dry
 * lapse rate, down to a cold upper atmosphere
 */
export function airAt(a: Atmosphere, gSurf: number, zKm: number) {
  if (a.bar <= 0 || a.H <= 0) return { bar: 0, T: a.T };
  const mu = a.gases.reduce((s, x) => s + x.x * (MU[x.f] ?? 29), 0) || 29;
  const lapse = (gSurf * mu / 1000) / (3.5 * 8.314) * 1000;
  return { bar: a.bar * Math.exp(-zKm / a.H), T: Math.max(a.T * 0.55, a.T - lapse * Math.max(0, zKm)) };
}

/** temperature (K) at that depth, on the dry adiabat */
export function giantTemp(a: Atmosphere, depthKm: number) {
  if (depthKm <= 0) return a.T;
  const z0 = a.H * 3.5;
  return a.T * (1 + depthKm / z0);
}
/** the cloud decks a descent passes through: depth below 1 bar (km), what they are, colour */
export function cloudDecks(b: Body, a: Atmosphere): { depth: number; what: string; color: number }[] {
  const st = b.look.style;
  const at = (bar: number) => {
    // invert giantPressure for bar ≥ 1, the scale height for less
    if (bar < 1) return a.H * Math.log(bar);
    const z0 = a.H * 3.5;
    return z0 * (Math.pow(bar, 1 / 3.5) - 1);
  };
  if (b.look.real === 'Uranus' || b.look.real === 'Neptune' || st === 'icegiant') return [{ depth: at(1.2), what: 'methane ice', color: 0xd0f0f8 }, { depth: at(4), what: 'hydrogen sulphide ice', color: 0xa0c0c8 }, { depth: at(40), what: 'water and ammonia', color: 0x7090a0 }];
  if (st === 'hotjupiter' || st === 'browndwarf') return [{ depth: at(0.1), what: 'silicate (glass) cloud', color: 0x9a6a50 }, { depth: at(3), what: 'iron cloud', color: 0x6a4a40 }];
  return [{ depth: at(0.7), what: 'ammonia ice', color: 0xf0e8d8 }, { depth: at(2), what: 'ammonium hydrosulphide', color: 0xc89060 }, { depth: at(5), what: 'water ice and droplets: lightning', color: 0x8a90a0 }];
}

/** how long a day is and which way the wind blows at a latitude on a giant, m/s eastward (Jupiter-like jets) */
export function giantWind(b: Body, latRad: number) {
  const real = b.look.real;
  const peak = real === 'Neptune' ? 400 : real === 'Saturn' ? 450 : real === 'Uranus' ? 250 : 150;
  if (real === 'Uranus' || real === 'Neptune' || b.look.style === 'icegiant') return peak * (1.5 * Math.sin(latRad) ** 2 - 0.5) * 1.2;
  // alternating jets every ~15°, the strongest at the equator
  return peak * (0.5 * Math.cos(latRad * 12) + 0.6 * Math.exp(-((latRad * 180 / Math.PI / 12) ** 2)));
}

/** whether a world has measured or derived data at all, for the survey */
export const hasMeasured = (b: Body) => !!realOf(b);
