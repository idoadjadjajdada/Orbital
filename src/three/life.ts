import type { Body } from '../physics/body';
import { KM } from '../physics/units';

/**
 * Life on a world: whether it could be there, how far it has got, and the
 * species a landing party might find. Earth has a curated list of real
 * species; the solar system's candidates (Mars, Europa, Enceladus, Titan…)
 * say what has actually been measured; anything else is invented, the same
 * way every time from its seed, with pigments tuned to its star and sizes to
 * its gravity. The caller supplies the air and temperature, so this module
 * does not depend on how the atmosphere was worked out.
 */

export type LifeLevel = 'none' | 'prebiotic' | 'microbial' | 'simple' | 'complex' | 'civilisation';
export interface Form {
  shape: 'tree' | 'conifer' | 'palm' | 'shrub' | 'grass' | 'fungus' | 'frond' | 'crystalline' | 'mat' | 'reef' | 'grazer' | 'crawler' | 'walker' | 'flyer' | 'swimmer' | 'mound';
  color: number;   // 0xRRGGBB main colour
  color2: number;  // secondary colour (canopy vs trunk, belly vs back)
  height: number;  // typical height in metres
  density: number; // how many per hectare in its habitat
  moves: boolean;  // fauna wander
}
export interface Species {
  id: string;
  name: string;
  common: string;
  kind: 'microbe' | 'flora' | 'fauna';
  habitat: string;
  biome: string[];
  size: string;
  desc: string;
  form: Form;
}
export interface LifeFacts {
  surfaceK: number;
  surfaceBar: number;
  gases: { formula: string; frac: number }[];
  g: number;
  starTeff: number;
  ageGyr?: number;
}
export interface Biosphere {
  level: LifeLevel;
  confidence: 'confirmed' | 'possible' | 'none';
  where: string;
  habitable: boolean;
  reasons: string[];
  biosignatures: string[];
  summary: string;
  species: Species[];
}

type Shape = Form['shape'];
type Real = Omit<Biosphere, 'species'>;

const RANK: Record<LifeLevel, number> = { none: 0, prebiotic: 1, microbial: 2, simple: 3, complex: 4, civilisation: 5 };
const ALL_BIOMES = ['forest', 'grassland', 'desert', 'tundra', 'ice', 'ocean', 'shore', 'wetland', 'mountain', 'rock', 'lowland'];

// ---- small helpers ------------------------------------------------------

type Rng = () => number;
/** mulberry32: a tiny seeded generator, 0..1 */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length];
const span = (r: Rng, lo: number, hi: number) => lo + (hi - lo) * r();
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** two significant figures, without trailing noise */
const sig2 = (x: number) => String(Number(x.toPrecision(2)));

/** a length in metres, readably */
function fmtLen(m: number): string {
  if (m < 1e-3) return `${sig2(m * 1e6)} µm`;
  if (m < 0.01) return `${sig2(m * 1e3)} mm`;
  if (m < 1) return `${sig2(m * 100)} cm`;
  return `${sig2(m)} m`;
}

/** H₂O → H2O, so formulae can be matched however they were typed */
const plain = (f: string) => f.replace(/[₀-₉]/g, c => String(c.charCodeAt(0) - 0x2080));
function frac(f: LifeFacts, formula: string): number {
  return f.gases.filter(x => plain(x.formula) === formula).reduce((s, x) => s + x.frac, 0);
}
const GAS_NAME: Record<string, string> = {
  N2: 'nitrogen', O2: 'oxygen', CO2: 'carbon-dioxide', H2: 'hydrogen', He: 'helium', CH4: 'methane',
  H2O: 'steam', NH3: 'ammonia', Ar: 'argon', SO2: 'sulphur-dioxide', CO: 'carbon-monoxide', Ne: 'neon',
};
/** e.g. '2-bar nitrogen sky' */
function skyOf(f: LifeFacts): string {
  const top = [...f.gases].sort((a, b) => b.frac - a.frac)[0];
  const gas = top ? GAS_NAME[plain(top.formula)] ?? top.formula : '';
  return `${sig2(f.surfaceBar)}-bar ${gas ? gas + ' ' : ''}sky`;
}

function hsl(h: number, s: number, l: number): number {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const k = (v: number) => clamp(Math.round((v + m) * 255), 0, 255);
  return (k(r) << 16) | (k(g) << 8) | k(b);
}
/** a word for a colour, for common names */
function colourWord(c: number): string {
  const r = (c >> 16) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (l < 0.12) return 'sable';
  if (mx - mn < 0.08) return l > 0.7 ? 'pale' : 'ashen';
  const d = mx - mn;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const WORDS: [number, string][] = [[12, 'crimson'], [32, 'rust'], [48, 'ochre'], [64, 'golden'], [84, 'olive'], [120, 'green'], [150, 'jade'], [190, 'teal'], [225, 'blue'], [255, 'indigo'], [290, 'violet'], [335, 'purple'], [360, 'crimson']];
  return WORDS.find(([top]) => h < top)![1];
}

// ---- habitability -------------------------------------------------------

interface Verdict { ok: boolean; reasons: string[] }
const GIANT = ['gas', 'icegiant', 'hotjupiter', 'browndwarf'];
const COMPACT = ['star', 'wd', 'ns', 'bh'];

/** whether liquid water could stand on the surface, and why */
function surfaceVerdict(b: Body, f: LifeFacts): Verdict {
  const style = b.look.style;
  if (COMPACT.includes(b.cls) || COMPACT.includes(style)) return { ok: false, reasons: ['a star or stellar remnant: no surface, and far too hot'] };
  if (b.cls === 'gas' || GIANT.includes(style)) return { ok: false, reasons: ['no solid surface: the air thickens into a hot, crushing interior'] };
  const reasons: string[] = [];
  let ok = true;
  if (b.heat > 0.55) { ok = false; reasons.push('the surface is molten after an impact'); }
  const K = Math.round(f.surfaceK);
  if (f.surfaceK < 250) { ok = false; reasons.push(`mean surface ${K} K: below freezing almost everywhere`); }
  else if (f.surfaceK > 340) { ok = false; reasons.push(`mean surface ${K} K: too hot for liquid water to last`); }
  else reasons.push(`mean surface ${K} K: within liquid water’s range`);
  if (f.surfaceBar <= 0.006) { ok = false; reasons.push(f.surfaceBar > 0 ? `${sig2(f.surfaceBar)} bar: at or below water’s triple point (0.006 bar), so water boils or freezes` : 'airless: any water sublimates into space'); }
  else if (f.surfaceBar >= 500) { ok = false; reasons.push(`${sig2(f.surfaceBar)} bar: a crushing, supercritical envelope`); }
  else reasons.push(`${sig2(f.surfaceBar)} bar: above water’s triple point`);
  if (f.g < 0.2) { ok = false; reasons.push(`${sig2(f.g)} g: too weak to hold an atmosphere for long`); }
  else if (f.g > 4) { ok = false; reasons.push(`${sig2(f.g)} g: likely a gas-rich mini-Neptune rather than a rocky surface`); }
  if (!['terran', 'ocean', 'desert'].includes(style)) { ok = false; reasons.push(`${/^[aeiou]/.test(style) ? 'an' : 'a'} ${style} surface with no standing water`); }
  else if (style === 'desert') reasons.push('a desert world: water only in the soil and under the ground');
  return { ok, reasons };
}

// ---- the real solar system ----------------------------------------------

const REAL: Record<string, Real> = {
  Mars: {
    level: 'prebiotic', confidence: 'none', where: 'nowhere known', habitable: false,
    reasons: [
      'mean surface 210 K, with summer afternoons at the equator just above freezing',
      'about 0.006 bar, near water’s triple point: liquid water boils or freezes almost at once',
      'no global magnetic field and thin air: cosmic rays and solar UV reach the ground',
      'perchlorate-rich soil, toxic to most Earth microbes and destructive to organics under UV',
      'ancient lakebeds in Jezero and Gale craters: habitable 3.5–4 billion years ago',
    ],
    biosignatures: [
      'seasonal CH₄ plumes at Gale crater (disputed: orbiters see almost none)',
      'organic molecules in mudstone (thiophenes, benzene, long-chain alkanes) found by Curiosity',
      '“leopard spot” iron-phosphate and sulphide rims in the Cheyava Falls rock (Perseverance): a possible biosignature, unconfirmed',
    ],
    summary: 'No life has been found on Mars. Today its surface is too cold, dry, thin-aired and irradiated, but 3.5–4 billion years ago rivers fed lakes in Jezero and Gale and it was habitable — whether anything lived there is what the rovers were sent to find out.',
  },
  Venus: {
    level: 'none', confidence: 'none', where: 'nowhere known', habitable: false,
    reasons: [
      'surface 737 K under 92 bar of CO₂: hotter than a self-cleaning oven',
      'the clouds at 50–60 km have Earth-like temperature and pressure, but are concentrated sulphuric acid and far drier than any desert',
      'it may once have had oceans, lost as the greenhouse ran away',
    ],
    biosignatures: ['phosphine (PH₃) at ~20 ppb in the clouds (2020; disputed — re-analyses found far less or none)'],
    summary: 'No life is known on Venus. The 2020 claim of phosphine in its clouds briefly raised hopes of microbes in the temperate cloud layer, but the detection has not held up well.',
  },
  Europa: {
    level: 'prebiotic', confidence: 'possible', where: 'subsurface ocean', habitable: true,
    reasons: [
      'a salty ocean ~100 km deep under 15–25 km of ice, kept liquid by Jupiter’s tides',
      'the ocean touches a rocky sea floor: hydrothermal chemistry is possible',
      'oxidants (O₂, H₂O₂) made by radiation at the surface may be carried down into the ocean',
      'the surface itself is sterilised by Jupiter’s radiation',
    ],
    biosignatures: [
      'induced magnetic field from a conducting salty ocean (Galileo)',
      'sea salt (NaCl) on the surface, yellowed by radiation',
      'CO₂ concentrated in Tara Regio, sourced from the ocean (JWST)',
      'possible water-vapour plumes (Hubble; unconfirmed)',
    ],
    summary: 'Europa probably has twice Earth’s ocean water under its ice, with salt, rock and oxidants: one of the best places to look for life. Europa Clipper arrives in 2030.',
  },
  Enceladus: {
    level: 'prebiotic', confidence: 'possible', where: 'subsurface ocean', habitable: true,
    reasons: [
      'a global salty ocean under 20–40 km of ice, thinnest at the south pole, kept liquid by Saturn’s tides',
      'silica nanograins in the plumes point to hydrothermal vents above 90 °C',
      'water, chemical energy, organics, nitrogen and phosphorus have all been found',
    ],
    biosignatures: [
      'plumes from the tiger stripes, flown through and sampled by Cassini',
      'molecular H₂ in the plumes: an energy source methanogens could live on',
      'CO₂, CH₄ and NH₃ in the plume gas',
      'phosphates in E-ring ice grains',
      'complex macromolecular organics in the ice grains',
    ],
    summary: 'A small moon spraying its own ocean into space: Cassini found salt water, hydrogen, organics and phosphates — everything life as we know it needs. Nothing living has been seen.',
  },
  Titan: {
    level: 'prebiotic', confidence: 'possible', where: 'methane lakes and a subsurface water ocean', habitable: true,
    reasons: [
      'surface 94 K: water is rock, but methane and ethane rain, run in rivers and fill seas',
      '1.5 bar of nitrogen thick with organic haze (tholins)',
      'its tidal flexing points to a water–ammonia ocean under the ice',
    ],
    biosignatures: [
      'dunes and plains of complex organics',
      'H₂ and acetylene depleted near the surface: proposed as a hint of methane-based life, unexplained',
      'vinyl cyanide in the air: the azotosome hypothesis has it forming cell-like membranes in liquid methane (contested)',
    ],
    summary: 'Titan is a natural chemistry set: an Earth-like landscape of liquid hydrocarbons, prebiotic organics raining from the sky, and a water ocean below. Dragonfly lands in 2034.',
  },
  Ganymede: {
    level: 'prebiotic', confidence: 'possible', where: 'subsurface ocean', habitable: true,
    reasons: [
      'a salty ocean ~150 km below the ice, shown by its rocking aurorae (Hubble) and induced magnetic field',
      'the ocean may be sandwiched between ice layers, cut off from the rocky floor',
      'the only moon with its own magnetic field',
    ],
    biosignatures: ['induced magnetic field and aurora oscillation from a buried ocean', 'hydrated salts and organics in dark terrain (Juno, JWST)'],
    summary: 'The largest moon hides more water than Earth’s oceans, though high-pressure ice may seal it from the rock below. JUICE arrives in 2031.',
  },
  Callisto: {
    level: 'prebiotic', confidence: 'possible', where: 'subsurface ocean', habitable: true,
    reasons: ['Galileo’s magnetometer saw an induced field: perhaps a salty ocean 100–200 km down', 'little tidal heating: the ocean, if any, is cold and poor in energy'],
    biosignatures: ['induced magnetic field (Galileo)', 'CO₂ and organics on the surface'],
    summary: 'Callisto may have a deep, cold ocean, but with little heat to drive chemistry it is a long shot.',
  },
  Earth: {
    level: 'civilisation', confidence: 'confirmed', where: 'everywhere on the surface and in the seas, and kilometres down in the crust', habitable: true,
    reasons: [
      'mean 288 K: liquid water over 71% of the surface',
      '1.013 bar, well above water’s triple point',
      'a global magnetic field and an ozone layer shield the surface',
      'plate tectonics recycles carbon and keeps the climate stable',
    ],
    biosignatures: [
      'O₂ 21% with CH₄ in disequilibrium',
      'chlorophyll red edge at 700 nm',
      'ozone (O₃) absorption at 9.6 µm',
      'radio emissions and city lights on the night side',
      'industrial gases: CFCs and NO₂',
    ],
    summary: 'The only world known to have life: about 8.7 million species of eukaryotes and countless microbes, 3.5–4 billion years old, and one species that builds cities and radio telescopes.',
  },
};

// ---- Earth's species ----------------------------------------------------

function sp(name: string, common: string, kind: Species['kind'], habitat: string, biome: string[], size: string, desc: string,
  shape: Shape, color: number, color2: number, height: number, density: number): Species {
  const moves = kind === 'fauna' && shape !== 'reef';
  return { id: `earth-${slug(name)}`, name, common, kind, habitat, biome, size, desc, form: { shape, color, color2, height, density, moves } };
}

const EARTH: Species[] = [
  // trees
  sp('Quercus robur', 'English oak', 'flora', 'temperate forest', ['forest', 'lowland'], '25 m', 'A broadleaf that can live a thousand years; a single tree supports over 2,000 other species.', 'tree', 0x3d6b2a, 0x5a4632, 25, 150),
  sp('Pinus sylvestris', 'Scots pine', 'flora', 'boreal forest', ['forest', 'mountain'], '25 m', 'The most widespread pine on Earth, from Scotland to eastern Siberia; orange bark high on the trunk.', 'conifer', 0x2f5a32, 0xb06a3a, 25, 400),
  sp('Picea abies', 'Norway spruce', 'flora', 'boreal and mountain forest', ['forest', 'mountain', 'tundra'], '40 m', 'A dense, drooping conifer of northern Europe; one clone in Sweden has regrown from its roots for 9,500 years.', 'conifer', 0x24472a, 0x5a4030, 35, 500),
  sp('Betula pendula', 'silver birch', 'flora', 'temperate and boreal woodland', ['forest', 'tundra', 'lowland'], '20 m', 'A pioneer tree with white, papery bark that reflects sunlight; first to colonise cleared ground.', 'tree', 0x6d9a3a, 0xe8e4dc, 20, 300),
  sp('Sequoiadendron giganteum', 'giant sequoia', 'flora', 'Sierra Nevada mountain forest', ['forest', 'mountain'], '85 m', 'The most massive single trees on Earth; General Sherman holds about 1,500 m³ of wood.', 'conifer', 0x3b5e30, 0x8b4a2b, 85, 20),
  sp('Eucalyptus regnans', 'mountain ash', 'flora', 'cool temperate rainforest, Victoria and Tasmania', ['forest', 'mountain'], '90 m', 'The tallest flowering plant, past 100 m; it needs bushfire to clear space for its seedlings.', 'tree', 0x5a7a5a, 0xd0c8b8, 75, 60),
  sp('Ceiba pentandra', 'kapok tree', 'flora', 'tropical rainforest', ['forest', 'wetland'], '60 m', 'An emergent rainforest giant with buttress roots; its seed fibre once stuffed lifejackets.', 'tree', 0x2e6b2a, 0x9a9080, 60, 10),
  sp('Vachellia tortilis', 'umbrella thorn acacia', 'flora', 'African savanna', ['grassland', 'desert'], '10 m', 'The flat-topped tree of the savanna, armed with paired thorns against giraffes.', 'tree', 0x7a8f3a, 0x5a4a3a, 8, 20),
  sp('Adansonia digitata', 'baobab', 'flora', 'dry savanna', ['grassland', 'desert'], '20 m', 'A swollen trunk that stores up to 120,000 litres of water through the dry season.', 'tree', 0x6a8a3a, 0x9a8a7a, 18, 5),
  sp('Cocos nucifera', 'coconut palm', 'flora', 'tropical shores', ['shore', 'lowland'], '25 m', 'Its seeds float for months, which is how it reached nearly every tropical coast.', 'palm', 0x4f8a2e, 0x8a7350, 25, 100),
  sp('Rhizophora mangle', 'red mangrove', 'flora', 'tidal shores and estuaries', ['shore', 'wetland'], '6 m', 'Stands in salt water on arching prop roots, filtering out the salt.', 'tree', 0x3a6a30, 0x6a4a30, 6, 400),
  // grasses, shrubs, lower plants
  sp('Poa pratensis', 'Kentucky bluegrass', 'flora', 'temperate grassland', ['grassland', 'lowland'], '60 cm', 'A creeping meadow grass, now grown on lawns on every continent but Antarctica.', 'grass', 0x5f9a3a, 0x8aa860, 0.5, 900),
  sp('Triticum aestivum', 'bread wheat', 'flora', 'farmland', ['grassland', 'lowland'], '1 m', 'A hybrid of three wild grasses, bred over 10,000 years; it covers more land than any other crop.', 'grass', 0xc8a850, 0x8a9a40, 0.9, 900),
  sp('Phragmites australis', 'common reed', 'flora', 'marshes and lake margins', ['wetland', 'shore'], '3 m', 'One of the most widespread flowering plants, forming reedbeds that filter water.', 'grass', 0x7a8a4a, 0xa08a60, 3, 900),
  sp('Calluna vulgaris', 'heather', 'flora', 'heath and moorland', ['grassland', 'mountain', 'tundra'], '50 cm', 'A low evergreen shrub that turns moors purple in late summer.', 'shrub', 0x7a4a7a, 0x4a5a30, 0.4, 800),
  sp('Opuntia ficus-indica', 'prickly pear', 'flora', 'hot deserts and scrub', ['desert'], '3 m', 'A cactus of flat, jointed pads that photosynthesises at night to save water.', 'shrub', 0x5a8a4a, 0xc84a5a, 2.5, 60),
  sp('Welwitschia mirabilis', 'welwitschia', 'flora', 'the Namib desert', ['desert'], '1.5 m (leaves 4 m long)', 'Two strap leaves that grow for its whole life of over a thousand years, drinking coastal fog.', 'shrub', 0x6a7a3a, 0x7a5a3a, 0.8, 12),
  sp('Dryas octopetala', 'mountain avens', 'flora', 'arctic and alpine tundra', ['tundra', 'mountain'], '10 cm', 'A creeping arctic shrub whose white flowers track the Sun to warm their insects.', 'shrub', 0x4a6a3a, 0xf0f0e0, 0.1, 500),
  sp('Sphagnum palustre', 'bog moss', 'flora', 'peat bogs', ['wetland', 'tundra'], '10 cm', 'Holds twenty times its weight in water; its dead layers make peat, storing a third of soil carbon.', 'mat', 0x8aa040, 0xa05a40, 0.1, 900),
  sp('Cladonia rangiferina', 'reindeer lichen', 'flora', 'arctic tundra and boreal forest', ['tundra', 'rock'], '8 cm', 'A fungus and an alga living as one; grows a few millimetres a year and feeds the reindeer in winter.', 'mat', 0xc8c8b0, 0xa0a090, 0.08, 800),
  sp('Nymphaea alba', 'white water lily', 'flora', 'still fresh water', ['wetland'], '20 cm across', 'Floating leaves on long stalks from the mud; the flowers close at night.', 'frond', 0x3a7a3a, 0xf8f8f0, 0.1, 200),
  sp('Macrocystis pyrifera', 'giant kelp', 'flora', 'cool shallow seas', ['ocean', 'shore'], '45 m long', 'A brown alga that grows up to 60 cm a day, buoyed by gas bladders, forming undersea forests.', 'frond', 0x7a5a20, 0x5a4a1a, 30, 50),
  sp('Posidonia oceanica', 'Neptune grass', 'flora', 'Mediterranean seagrass meadows', ['ocean', 'shore'], '1 m', 'A flowering plant that returned to the sea; one clonal meadow may be 100,000 years old.', 'grass', 0x3a6a3a, 0x2a4a2a, 0.8, 800),
  // fungi
  sp('Amanita muscaria', 'fly agaric', 'flora', 'birch and pine woods', ['forest'], '20 cm', 'A fungus, not a plant: the red cap is the fruit of a web of threads wrapped round tree roots.', 'fungus', 0xd02a1a, 0xf0ece0, 0.2, 60),
  sp('Armillaria ostoyae', 'honey fungus', 'flora', 'conifer forest', ['forest'], '15 cm', 'One individual in Oregon spreads under 9.6 km² of forest: among the largest organisms on Earth.', 'fungus', 0xc89a50, 0x8a6a40, 0.12, 80),
  // microbes
  sp('Prochlorococcus marinus', 'Prochlorococcus', 'microbe', 'sunlit open ocean', ['ocean'], '0.6 µm', 'The smallest and most abundant photosynthesiser on Earth, about 3×10²⁷ cells, making a good share of the oxygen.', 'mat', 0x3a8a6a, 0x2a6a50, 6e-7, 900),
  sp('Pelagibacter ubique', 'SAR11', 'microbe', 'open ocean', ['ocean', 'shore'], '0.5 µm', 'Probably the most numerous organism on Earth, living on dissolved organic carbon with a minimal genome.', 'mat', 0xa0b0b0, 0x808a8a, 5e-7, 900),
  sp('Nostoc commune', 'star jelly', 'microbe', 'damp soil and rock', ['grassland', 'tundra', 'rock', 'desert', 'lowland', 'mountain'], '5 µm cells, jelly 5 cm', 'A cyanobacterium that dries to a crust for decades and swells back to life in rain; it fixes nitrogen.', 'mat', 0x5a6a2a, 0x8a7a3a, 5e-6, 700),
  sp('Escherichia coli', 'E. coli', 'microbe', 'animal guts, soil and water', ['lowland', 'grassland', 'forest', 'wetland'], '2 µm', 'A gut bacterium and the workhorse of molecular biology; it divides every 20 minutes when well fed.', 'mat', 0xb0a080, 0x8a7a60, 2e-6, 500),
  sp('Thermus aquaticus', 'Taq', 'microbe', 'hot springs', ['rock', 'mountain'], '5 µm', 'Lives at 70 °C in Yellowstone; its heat-proof DNA polymerase made PCR possible.', 'mat', 0xe0a030, 0xc06020, 5e-6, 500),
  sp('Deinococcus radiodurans', 'Conan the bacterium', 'microbe', 'dry soil, deserts', ['desert', 'rock', 'ice'], '2 µm', 'Survives a thousand times the radiation that kills a human by stitching its shattered DNA back together.', 'mat', 0xd06a5a, 0xa04a40, 2e-6, 300),
  // animals
  sp('Homo sapiens', 'human', 'fauna', 'everywhere', ['lowland', 'grassland', 'forest', 'shore', 'desert', 'mountain', 'tundra', 'wetland'], '1.7 m', 'A tool-making great ape, 8 billion strong, the only species known to build cities and leave its planet.', 'walker', 0xc08a6a, 0x3a2a20, 1.7, 0.6),
  sp('Bos taurus', 'cattle', 'fauna', 'farmland and pasture', ['grassland', 'lowland'], '1.4 m at the shoulder', 'Domesticated from the aurochs 10,000 years ago; there are about 1.5 billion.', 'grazer', 0x6a4a30, 0xf0f0f0, 1.4, 1),
  sp('Cervus elaphus', 'red deer', 'fauna', 'woodland and moor', ['forest', 'grassland', 'mountain'], '1.2 m at the shoulder', 'Stags grow and shed a new set of antlers every year, roaring to hold their hinds in autumn.', 'grazer', 0x8a4a2a, 0xc8a080, 1.2, 0.1),
  sp('Rangifer tarandus', 'reindeer', 'fauna', 'arctic tundra and taiga', ['tundra', 'forest'], '1.1 m at the shoulder', 'The only deer where both sexes grow antlers; herds migrate thousands of kilometres a year.', 'grazer', 0x8a7a68, 0xe0d8c8, 1.1, 0.3),
  sp('Loxodonta africana', 'African bush elephant', 'fauna', 'savanna', ['grassland', 'desert'], '3.2 m at the shoulder', 'The largest land animal, up to 6 tonnes, eating 150 kg of plants a day and reshaping the savanna.', 'grazer', 0x7a7470, 0x6a6460, 3.2, 0.05),
  sp('Camelus dromedarius', 'dromedary', 'fauna', 'hot deserts', ['desert'], '1.9 m at the shoulder', 'Stores fat, not water, in its hump; it can lose a quarter of its body water and drink 100 litres in minutes.', 'grazer', 0xc8a070, 0xb08858, 1.9, 0.1),
  sp('Panthera leo', 'lion', 'fauna', 'savanna', ['grassland'], '1.2 m at the shoulder', 'The only social cat: prides of related females hunt together.', 'walker', 0xc8a060, 0x8a6a40, 1.2, 0.05),
  sp('Ursus maritimus', 'polar bear', 'fauna', 'arctic sea ice', ['ice', 'tundra', 'shore'], '1.4 m at the shoulder', 'Hunts seals from the sea ice; its fur is translucent over black skin.', 'walker', 0xf0ece0, 0xd8d0c0, 1.4, 0.05),
  sp('Aptenodytes forsteri', 'emperor penguin', 'fauna', 'Antarctic sea ice', ['ice', 'shore'], '1.15 m', 'Breeds in the Antarctic winter at −40 °C, males huddling for two months with an egg on their feet.', 'walker', 0x202428, 0xf0f0f0, 1.15, 2),
  sp('Corvus corax', 'common raven', 'fauna', 'mountains, coasts, tundra and desert', ['mountain', 'tundra', 'forest', 'grassland', 'desert'], 'wingspan 1.3 m', 'Among the most intelligent birds: it plans ahead, plays and recognises faces.', 'flyer', 0x101418, 0x202830, 0.6, 0.2),
  sp('Aquila chrysaetos', 'golden eagle', 'fauna', 'mountains and open country', ['mountain', 'grassland', 'tundra'], 'wingspan 2.1 m', 'Stoops on prey at over 240 km/h.', 'flyer', 0x5a3a20, 0xc8a050, 0.9, 0.05),
  sp('Phoenicopterus roseus', 'greater flamingo', 'fauna', 'salt lagoons', ['wetland', 'shore'], '1.4 m', 'Pink from the carotenoids in the brine shrimp and algae it filters upside-down.', 'flyer', 0xf0a0a0, 0x202020, 1.4, 3),
  sp('Apis mellifera', 'western honey bee', 'fauna', 'meadows and farmland', ['grassland', 'forest', 'lowland'], '1.5 cm', 'Colonies of 50,000 that tell each other where flowers are by dancing.', 'flyer', 0xc89030, 0x302010, 0.015, 5),
  sp('Lumbricus terrestris', 'common earthworm', 'fauna', 'damp soil', ['grassland', 'forest', 'lowland'], '25 cm long', 'Pulls leaves into its burrows and turns over the soil, as Darwin measured.', 'crawler', 0xa06a60, 0xc08a80, 0.02, 5),
  sp('Balaenoptera musculus', 'blue whale', 'fauna', 'open ocean', ['ocean'], '30 m long', 'The largest animal that has ever lived, up to 190 tonnes, living on krill.', 'swimmer', 0x4a6a8a, 0x8a9aa8, 30, 0.05),
  sp('Thunnus thynnus', 'Atlantic bluefin tuna', 'fauna', 'open ocean', ['ocean'], '2.5 m long', 'A warm-blooded fish that crosses the Atlantic at up to 70 km/h.', 'swimmer', 0x2a3a5a, 0xc0c8d0, 2.5, 0.2),
  sp('Chelonia mydas', 'green sea turtle', 'fauna', 'tropical seas and beaches', ['ocean', 'shore'], '1.2 m long', 'Navigates by Earth’s magnetic field back to the beach where it hatched.', 'swimmer', 0x5a6a3a, 0xc8b080, 1.2, 0.1),
  sp('Acropora cervicornis', 'staghorn coral', 'fauna', 'tropical reefs', ['ocean', 'shore'], 'colonies 2 m across', 'An animal colony fed by algae living in its cells; it builds reefs of calcium carbonate.', 'reef', 0xc8a070, 0xe8d0a0, 1.5, 150),
];

// ---- invented life ------------------------------------------------------

interface ShapeInfo { kind: 'flora' | 'fauna'; biome: string[]; habitat: string[]; h: number; dens: [number, number]; noun: string[]; sea?: string[] }
const SHAPES: Record<Shape, ShapeInfo> = {
  tree: { kind: 'flora', biome: ['forest', 'wetland', 'lowland'], habitat: ['lowland forest', 'temperate forest', 'river forest'], h: 20, dens: [100, 400], noun: ['spirebark', 'canopy tree', 'umbrellawood', 'pillar tree'] },
  conifer: { kind: 'flora', biome: ['forest', 'mountain', 'tundra'], habitat: ['cold upland forest', 'mountain slopes'], h: 25, dens: [200, 500], noun: ['needlespire', 'cone-pine', 'frostspire'] },
  palm: { kind: 'flora', biome: ['shore', 'lowland'], habitat: ['warm coasts', 'river deltas'], h: 15, dens: [40, 120], noun: ['fanpalm', 'tufttree', 'crownstalk'] },
  shrub: { kind: 'flora', biome: ['grassland', 'desert', 'mountain', 'lowland'], habitat: ['dry scrub', 'upland heath'], h: 1.5, dens: [100, 600], noun: ['thornbush', 'brushweed', 'cushion shrub'] },
  grass: { kind: 'flora', biome: ['grassland', 'lowland', 'tundra', 'wetland'], habitat: ['open plains', 'wet meadows'], h: 0.4, dens: [400, 900], noun: ['sedge', 'bladegrass', 'reed'] },
  fungus: { kind: 'flora', biome: ['forest', 'wetland'], habitat: ['forest floor', 'rotting wood'], h: 0.3, dens: [50, 300], noun: ['puffcap', 'shelf fungus', 'veilcap'] },
  frond: { kind: 'flora', biome: ['wetland', 'shore', 'ocean'], habitat: ['shallow seas', 'wetlands'], h: 2, dens: [50, 300], noun: ['sailfrond', 'ribbonweed', 'kelpfrond'], sea: ['ocean'] },
  crystalline: { kind: 'flora', biome: ['desert', 'rock', 'mountain'], habitat: ['bare rock and desert'], h: 1, dens: [20, 120], noun: ['glassbloom', 'silica fan', 'crystal stalk'] },
  mat: { kind: 'flora', biome: ['shore', 'wetland', 'desert', 'rock', 'tundra', 'lowland'], habitat: ['tidal flats', 'damp rock'], h: 0.01, dens: [200, 800], noun: ['mat', 'crust', 'film'], sea: ['shore', 'ocean'] },
  reef: { kind: 'flora', biome: ['ocean', 'shore'], habitat: ['warm shallow seas', 'sea-floor ridges'], h: 2, dens: [50, 200], noun: ['reefbuilder', 'tubebloom', 'stonebloom'], sea: ['ocean', 'shore'] },
  mound: { kind: 'flora', biome: ['desert', 'rock', 'shore'], habitat: ['salt flats and shores'], h: 0.8, dens: [20, 80], noun: ['mound', 'stromatolite', 'domecolony'], sea: ['shore', 'ocean'] },
  grazer: { kind: 'fauna', biome: ['grassland', 'lowland', 'tundra'], habitat: ['open plains'], h: 1.5, dens: [0.5, 5], noun: ['grazer', 'strider', 'browser'] },
  crawler: { kind: 'fauna', biome: ['forest', 'rock', 'desert', 'wetland'], habitat: ['forest floor and rock'], h: 0.3, dens: [1, 5], noun: ['crawler', 'carapace', 'burrower'] },
  walker: { kind: 'fauna', biome: ['forest', 'grassland', 'mountain', 'lowland'], habitat: ['forests and plains'], h: 2, dens: [0.05, 0.5], noun: ['stalker', 'hexapod', 'longstrider'] },
  flyer: { kind: 'fauna', biome: ['shore', 'forest', 'grassland', 'mountain'], habitat: ['coasts and uplands'], h: 0.5, dens: [0.2, 3], noun: ['glider', 'wingbeast', 'skimmer'] },
  swimmer: { kind: 'fauna', biome: ['ocean', 'shore'], habitat: ['open ocean', 'coastal waters'], h: 3, dens: [0.1, 2], noun: ['ray', 'eel', 'filter-whale', 'drifter'], sea: ['ocean'] },
};

const G_START = ['Vel', 'Ox', 'Thal', 'Cor', 'Phyr', 'Ny', 'Sil', 'Xan', 'Mor', 'Brach', 'Cten', 'Dor', 'Ery', 'Gly', 'Hel', 'Lam', 'Pel', 'Rhod', 'Scy', 'Tor', 'Zyg', 'Ast', 'Cal', 'Lyc', 'Myx', 'Pter', 'Ser', 'Chlor', 'Amb', 'Neb'];
const G_MID = ['a', 'e', 'i', 'o', 'u', 'ar', 'ell', 'ith', 'on', 'yr', 'ad', 'os', 'um', 'ac'];
const G_END: Record<Species['kind'], string[]> = {
  flora: ['phyton', 'aria', 'anthus', 'ella', 'opsis', 'ium', 'ia', 'ites', 'phyllum', 'dendron'],
  fauna: ['odon', 'ops', 'erus', 'ides', 'ax', 'ornis', 'ichthys', 'pus', 'therium', 'onyx'],
  microbe: ['coccus', 'bacter', 'monas', 'spira', 'bacillus', 'archaeum', 'thrix'],
};
const EPITHET = ['gracilis', 'maximus', 'minor', 'vulgaris', 'nitida', 'obscura', 'tenebrosa', 'lucida', 'ferrea', 'robusta', 'velox', 'errans', 'communis', 'tardus'];
const BIOME_EPITHET: Record<string, string> = {
  forest: 'silvestris', grassland: 'pratensis', desert: 'deserti', tundra: 'borealis', ice: 'glacialis', ocean: 'pelagica',
  shore: 'litoralis', wetland: 'palustris', mountain: 'montana', rock: 'saxatilis', lowland: 'campestris',
};
const COLOUR_EPITHET: Record<string, string> = {
  crimson: 'rubens', rust: 'ferruginea', ochre: 'ochrae', golden: 'aurea', olive: 'olivacea', green: 'viridis', jade: 'smaragdina',
  teal: 'thalassina', blue: 'caerulea', indigo: 'indigofera', violet: 'violacea', purple: 'purpurea', sable: 'nigra', ashen: 'cinerea', pale: 'pallida',
};
const TRAIT: Record<Species['kind'], string[]> = {
  flora: ['giant', 'dwarf', 'whip', 'spiral', 'tufted', 'weeping', 'feathered', 'banded'],
  fauna: ['giant', 'crested', 'long-necked', 'six-legged', 'armoured', 'banded', 'horned', 'spotted'],
  microbe: ['deep', 'salt-loving', 'slow', 'chain-forming'],
};

/** how a star's light shapes its plants' pigments */
interface Pigment { hues: [number, number][]; sat: [number, number]; light: [number, number]; why: string; edge: number }
function pigmentFor(teff: number): Pigment {
  if (teff >= 6500) return { hues: [[160, 195], [45, 60]], sat: [0.45, 0.7], light: [0.3, 0.5], why: 'pale and glossy against the harsh blue light of its hot white sun', edge: 670 };
  if (teff >= 5000) return { hues: [[85, 140]], sat: [0.35, 0.65], light: [0.22, 0.42], why: 'tuned to take the red and blue of a Sun-like star and reflect the green, as Earth’s plants do', edge: 700 };
  if (teff >= 4000) return { hues: [[20, 75]], sat: [0.45, 0.75], light: [0.25, 0.42], why: 'warm-hued to soak up the orange-red light of its K-dwarf sun', edge: 740 };
  return { hues: [[265, 320], [330, 360]], sat: [0.3, 0.6], light: [0.07, 0.2], why: 'dark to drink every photon of its dim red dwarf, infrared included', edge: 1050 };
}
function plantColour(r: Rng, p: Pigment): number {
  const [lo, hi] = pick(r, p.hues);
  return hsl(span(r, lo, hi), span(r, ...p.sat), span(r, ...p.light));
}

interface Gen { r: Rng; f: LifeFacts; sea: boolean; pig: Pigment; names: Set<string>; commons: Set<string>; flora: Species[] }

function binomial(w: Gen, kind: Species['kind'], biome: string, colour: string): string {
  for (let i = 0; i < 20; i++) {
    const genus = pick(w.r, G_START) + (w.r() < 0.6 ? pick(w.r, G_MID) : '') + pick(w.r, G_END[kind]);
    const roll = w.r();
    const ep = roll < 0.4 ? COLOUR_EPITHET[colour] ?? pick(w.r, EPITHET) : roll < 0.7 ? BIOME_EPITHET[biome] ?? pick(w.r, EPITHET) : pick(w.r, EPITHET);
    const name = `${genus} ${ep}`;
    if (!w.names.has(name)) { w.names.add(name); return name; }
  }
  const name = `${pick(w.r, G_START)}${pick(w.r, G_END[kind])} ${pick(w.r, EPITHET)} ${w.names.size}`;
  w.names.add(name);
  return name;
}
function commonName(w: Gen, kind: Species['kind'], colour: string, nouns: string[]): string {
  for (let i = 0; i < 20; i++) {
    const name = `${i > 3 || w.r() < 0.35 ? pick(w.r, TRAIT[kind]) + ' ' : ''}${colour} ${pick(w.r, nouns)}`;
    if (!w.commons.has(name)) { w.commons.add(name); return name; }
  }
  const name = `${colour} ${pick(w.r, nouns)} ${w.commons.size}`;
  w.commons.add(name);
  return name;
}

/** taller and bigger in weak gravity, squat in strong */
const gravScale = (g: number) => clamp(1 / Math.max(g, 0.05), 0.25, 4) ** 0.6;

function sizeText(shape: Shape, h: number, sea: boolean): string {
  const s = fmtLen(h);
  if (shape === 'mat') return `crusts ${s} thick`;
  if (shape === 'reef') return `colonies ${s} across`;
  if (shape === 'frond' && sea) return `${s} long`;
  if (shape === 'grazer' || shape === 'walker') return `${s} at the shoulder`;
  if (shape === 'crawler' || shape === 'swimmer') return `${s} long`;
  if (shape === 'flyer') return `wingspan ${s}`;
  return s;
}

function gravNote(g: number, flora: boolean): string {
  if (g < 0.6) return flora ? ` It grows tall and spindly in ${sig2(g)} g.` : ` Long-limbed and light-boned in ${sig2(g)} g.`;
  if (g > 1.6) return flora ? ` Squat and thick-stemmed against ${sig2(g)} g.` : ` Low-slung and heavy-legged against ${sig2(g)} g.`;
  return '';
}

function floraDesc(w: Gen, shape: Shape, colour: string): string {
  const what: Partial<Record<Shape, string>> = {
    fungus: `A decomposer that feeds on fallen growth rather than light; its ${colour} caps release spores into the ${skyOf(w.f)}.`,
    crystalline: `Builds a lattice of silica around its living tissue; the ${colour} pigment behind the facets is ${w.pig.why}.`,
    mat: `Layered colonies of phototrophs on wet ground; their ${colour} pigment is ${w.pig.why}.`,
    reef: `A sessile colony that lays down mineral skeletons; symbionts in its ${colour} tissue photosynthesise under the ${skyOf(w.f)}.`,
    mound: `Grows as stacked mineral layers trapped by a ${colour} living skin, like Earth’s stromatolites.`,
  };
  const base = what[shape] ?? `Its ${colour} leaves are ${w.pig.why}.`;
  const co2 = frac(w.f, 'CO2');
  const air = co2 > 0.01 && w.r() < 0.35 ? ` It fixes carbon from a sky that is ${sig2(co2 * 100)}% CO₂.` : '';
  return base + air + (['tree', 'conifer', 'palm', 'shrub', 'grass', 'frond', 'fungus'].includes(shape) ? gravNote(w.f.g, true) : '');
}

function faunaDesc(w: Gen, shape: Shape): string {
  const food = w.flora.length ? pick(w.r, w.flora).common : 'drifting plankton';
  const o2 = frac(w.f, 'O2');
  const breath = o2 >= 0.05 ? `breathes a ${skyOf(w.f)} with ${sig2(o2 * 100)}% oxygen` : `lives without free oxygen under a ${skyOf(w.f)}, fermenting what it eats`;
  const what: Record<string, string> = {
    grazer: `A herd grazer that crops the ${food} and ${breath}.`,
    crawler: `A many-legged scavenger that burrows among the ${food} and ${breath}.`,
    walker: `A predator that stalks the grazers through the ${food}; it ${breath}.`,
    flyer: w.f.surfaceBar > 2 ? `Glides on the dense ${skyOf(w.f)}, rarely needing to flap, and feeds on the ${food}.` : `A flier that ${breath} and nests among the ${food}.`,
    swimmer: o2 >= 0.05 ? `Filters the water round the ${food}, its gills drawing oxygen dissolved from a ${skyOf(w.f)}.` : `Filters the water round the ${food}; it ${breath}.`,
  };
  return (what[shape] ?? `It ${breath}.`) + gravNote(w.f.g, false);
}

function makeSpecies(w: Gen, shape: Shape, n: number): Species {
  const info = SHAPES[shape];
  const flora = info.kind === 'flora';
  const color = flora ? (shape === 'reef' ? hsl(w.r() * 360, 0.6, 0.5) : plantColour(w.r, w.pig)) : hsl(w.r() * 360, span(w.r, 0.2, 0.5), span(w.r, 0.25, 0.45));
  const color2 = flora
    ? (['tree', 'conifer', 'palm'].includes(shape) ? hsl(span(w.r, 15, 40), 0.35, span(w.r, 0.15, 0.35)) : hsl(span(w.r, 0, 360), 0.3, span(w.r, 0.3, 0.7)))
    : hsl(span(w.r, 20, 60), 0.25, span(w.r, 0.55, 0.8));
  const biome = w.sea ? info.sea ?? ['ocean'] : info.biome;
  const height = info.h * gravScale(w.f.g) * span(w.r, 0.6, 1.6);
  const density = Number(span(w.r, ...info.dens).toPrecision(2));
  const colour = colourWord(color);
  const name = binomial(w, info.kind, biome[0], colour);
  const common = commonName(w, info.kind, colour, info.noun);
  const habitat = w.sea && info.sea ? (shape === 'swimmer' ? 'open ocean' : shape === 'frond' ? 'sunlit upper ocean' : 'sea-floor ridges and shallows') : pick(w.r, info.habitat);
  const desc = flora ? floraDesc(w, shape, colour) : faunaDesc(w, shape);
  return {
    id: `sp${n}-${slug(name)}`, name, common, kind: info.kind, habitat, biome, size: sizeText(shape, height, w.sea), desc,
    form: { shape, color, color2, height: Number(height.toPrecision(3)), density, moves: info.kind === 'fauna' },
  };
}

function makeMicrobe(w: Gen, n: number, subsurface: boolean): Species {
  const f = w.f;
  const opts: [string, string][] = [];
  if (subsurface) opts.push(['hydrothermal vents', 'A chemolithotroph that lives on H₂ from water–rock reactions at the sea floor, far from any light.']);
  else {
    opts.push(['shallow water and damp soil', `Forms slimy photosynthetic films in the shallows; its pigment is ${w.pig.why}.`]);
    if (frac(f, 'CO2') > 0 || frac(f, 'H2') > 0) opts.push(['sediments and hot springs', 'An archaeon-like methanogen that combines H₂ and CO₂ into methane, venting it into the air.']);
    if (w.sea) opts.push(['sea-floor vents', 'A chemolithotroph that lives on H₂ and H₂S from hot vents on the sea floor.']);
    else opts.push(['volcanic springs', 'Oxidises sulphur compounds at hot springs, staining the rock yellow and orange.']);
    if (!w.sea) opts.push(['iron-rich pools', 'Oxidises dissolved iron, leaving rust-red banded sediments behind.']);
    if (!w.sea) opts.push(f.surfaceK < 275 ? ['ice and permafrost', 'A cold-loving cell that keeps its membranes fluid with antifreeze sugars in brine veins.'] : ['inside rocks', 'An endolith living in the pores of rock, shielded from ultraviolet.']);
  }
  const [habitat, desc] = pick(w.r, opts);
  const color = subsurface ? hsl(span(w.r, 20, 60), 0.2, 0.6) : plantColour(w.r, w.pig);
  const name = binomial(w, 'microbe', 'lowland', colourWord(color));
  const cell = span(w.r, 0.4, 8) * 1e-6;
  return {
    id: `sp${n}-${slug(name)}`, name, common: commonName(w, 'microbe', colourWord(color), ['film', 'mat', 'bloom', 'cell']), kind: 'microbe', habitat,
    biome: subsurface ? [] : w.sea ? ['ocean', 'shore'] : ALL_BIOMES.filter(b => b !== 'ice' || f.surfaceK < 275),
    size: fmtLen(cell), desc,
    form: { shape: 'mat', color, color2: hsl(span(w.r, 0, 360), 0.2, 0.4), height: Number(cell.toPrecision(2)), density: Math.round(span(w.r, 200, 900)), moves: false },
  };
}

/** a shuffled copy */
function shuffle<T>(r: Rng, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** n shapes: the must-haves first, then the pool shuffled and cycled */
function shapes(r: Rng, first: Shape[], pool: Shape[], n: number): Shape[] {
  const out = first.slice(0, n);
  let deck: Shape[] = [];
  while (out.length < n) {
    if (!deck.length) deck = shuffle(r, pool);
    out.push(deck.pop()!);
  }
  return out;
}

function generate(r: Rng, f: LifeFacts, level: LifeLevel, sea: boolean, subsurface: boolean): Species[] {
  const w: Gen = { r, f, sea, pig: pigmentFor(f.starTeff), names: new Set(), commons: new Set(), flora: [] };
  const out: Species[] = [];
  const nMicrobe = level === 'microbial' ? 1 + Math.floor(r() * 4) : level === 'simple' ? 1 : level === 'complex' ? 2 : 0;
  for (let i = 0; i < nMicrobe; i++) out.push(makeMicrobe(w, out.length, subsurface));
  if (RANK[level] < RANK.simple) return out;
  let nFlora: number, nFauna = 0, florals: Shape[], fauna: Shape[] = [];
  if (level === 'simple') {
    nFlora = 5 + Math.floor(r() * 5);
    florals = shapes(r, sea ? ['mat'] : ['mat', 'frond'], sea ? ['mat', 'mound', 'frond', 'reef'] : ['mat', 'mound', 'frond', 'fungus', 'grass', 'shrub', 'crystalline', 'reef'], nFlora);
  } else {
    const total = (sea ? 10 : 12) + Math.floor(r() * 7) - nMicrobe;
    nFauna = Math.round(total * 0.4);
    nFlora = total - nFauna;
    florals = sea ? shapes(r, ['frond', 'reef'], ['frond', 'reef'], nFlora) : shapes(r, ['tree', 'grass', 'frond'], ['tree', 'conifer', 'palm', 'shrub', 'grass', 'fungus', 'frond', 'crystalline', 'mat', 'reef', 'mound'], nFlora);
    fauna = sea ? shapes(r, ['swimmer'], ['swimmer'], nFauna) : shapes(r, ['grazer', 'swimmer', 'walker'], ['grazer', 'crawler', 'walker', 'flyer', 'swimmer', 'grazer', 'crawler'], nFauna);
  }
  for (const s of florals) { const x = makeSpecies(w, s, out.length); out.push(x); w.flora.push(x); }
  for (const s of fauna) out.push(makeSpecies(w, s, out.length));
  return out;
}

/** a level drawn from the odds for the kind of world */
function drawLevel(r: Rng, style: string): LifeLevel {
  const x = r();
  if (style === 'terran') return x < 0.05 ? 'prebiotic' : x < 0.25 ? 'microbial' : x < 0.55 ? 'simple' : 'complex';
  if (style === 'ocean') return x < 0.05 ? 'prebiotic' : x < 0.4 ? 'microbial' : x < 0.75 ? 'simple' : 'complex';
  return x < 0.3 ? 'microbial' : 'prebiotic';
}
/** young worlds have not had time */
function ageCap(level: LifeLevel, age?: number): LifeLevel {
  if (age === undefined) return level;
  const cap: LifeLevel = age < 0.5 ? 'prebiotic' : age < 1 ? 'microbial' : age < 2 ? 'simple' : 'complex';
  return RANK[level] > RANK[cap] ? cap : level;
}

function signsOf(f: LifeFacts, level: LifeLevel, pig: Pigment, subsurface: boolean): string[] {
  if (subsurface) return level === 'microbial' ? ['H₂ and CH₄ in vented plumes, out of balance with the ocean chemistry'] : ['salts and simple organics where the ice has cracked'];
  const out: string[] = [];
  const o2 = frac(f, 'O2'), ch4 = frac(f, 'CH4');
  if (o2 > 0.01) out.push(RANK[level] < RANK.simple ? `O₂ ${sig2(o2 * 100)}%, probably abiotic: water split by starlight` : `O₂ ${sig2(o2 * 100)}%${ch4 > 0 ? ' with CH₄ in disequilibrium' : ', kept up by photosynthesis'}`);
  if (RANK[level] >= RANK.simple) out.push(`pigment absorption edge near ${pig.edge} nm`);
  if (level === 'microbial') out.push(ch4 > 0 ? 'CH₄ above what volcanoes can supply' : 'seasonal swings in trace gases');
  if (level === 'prebiotic') out.push('amino acids and sugars in surface samples, but no cells');
  return out;
}

function whereOf(level: LifeLevel, style: string): string {
  if (level === 'none') return 'nowhere known';
  if (level === 'prebiotic') return 'nowhere: chemistry only, in tidal pools and vents';
  if (style === 'ocean') return level === 'complex' ? 'throughout the ocean' : level === 'simple' ? 'the sunlit upper ocean and the sea floor' : 'the seas and sea-floor vents';
  if (style === 'desert') return 'beneath the soil and inside rocks';
  return level === 'complex' ? 'on land and in the seas' : level === 'simple' ? 'shallow seas and wet lowlands' : 'the seas, soils and hot springs';
}

const LEVEL_TEXT: Record<LifeLevel, string> = {
  none: 'No life', prebiotic: 'Prebiotic chemistry but no life', microbial: 'Microbial life', simple: 'Simple multicellular life',
  complex: 'A complex biosphere of plants and animals', civilisation: 'A technological civilisation',
};

function procedural(b: Body, f: LifeFacts): Biosphere {
  const r = mulberry32((b.look.seed ^ 0x5eed1fe) >>> 0);
  const style = b.look.style;
  const v = surfaceVerdict(b, f);
  if (v.ok) {
    let level = drawLevel(r, style);
    if (style === 'desert' || f.surfaceBar < 0.1) level = RANK[level] > RANK.microbial ? 'microbial' : level;
    level = ageCap(level, f.ageGyr);
    if (style === 'terran' && frac(f, 'O2') > 0.05 && RANK[level] < RANK.simple) level = 'simple';
    const species = generate(r, f, level, style === 'ocean', false);
    const pig = pigmentFor(f.starTeff);
    const flora = species.find(s => s.kind === 'flora');
    return {
      level, confidence: RANK[level] >= RANK.microbial ? 'confirmed' : 'possible', where: whereOf(level, style), habitable: true,
      reasons: v.reasons, biosignatures: signsOf(f, level, pig, false),
      summary: `${LEVEL_TEXT[level]}${flora ? `, its plants ${colourWord(flora.form.color)} under a ${Math.round(f.starTeff)} K star` : ''}.`,
      species,
    };
  }
  const iceKm = b.r / KM;
  const icy = (b.cls === 'ice' || style === 'ice') && !GIANT.includes(style) && b.cls !== 'gas';
  if (icy && iceKm > 500 && r() < Math.min(0.8, 0.3 + iceKm / 5000)) {
    const level: LifeLevel = ageCap(r() < 0.35 ? 'microbial' : 'prebiotic', f.ageGyr);
    return {
      level, confidence: 'possible', where: 'subsurface ocean', habitable: true,
      reasons: [...v.reasons, 'an ice shell over a possible liquid-water ocean, warmed by tides and radioactive decay'],
      biosignatures: signsOf(f, level, pigmentFor(f.starTeff), true),
      summary: `The surface is dead, but an ocean may lie under the ice: ${level === 'microbial' ? 'vent microbes are possible there' : 'chemistry, perhaps, but no sign of life'}.`,
      species: generate(r, f, level, true, true),
    };
  }
  return { level: 'none', confidence: 'none', where: 'nowhere known', habitable: false, reasons: v.reasons, biosignatures: [], summary: 'No life: nowhere on or in it could hold liquid water.', species: [] };
}

/** what lives on a body, given what the caller knows of its air and warmth */
export function biosphereOf(b: Body, f: LifeFacts): Biosphere {
  const real = b.look.real;
  if (real && Object.hasOwn(REAL, real)) {
    const r = REAL[real];
    return { ...r, reasons: [...r.reasons], biosignatures: [...r.biosignatures], species: real === 'Earth' ? EARTH.map(s => ({ ...s, biome: [...s.biome], form: { ...s.form } })) : [] };
  }
  if (real) {
    const v = surfaceVerdict(b, f);
    return { level: 'none', confidence: 'none', where: 'nowhere known', habitable: false, reasons: v.reasons, biosignatures: [], summary: `No life is known on ${real}, and nothing suggests any.`, species: [] };
  }
  return procedural(b, f);
}

/** the species likely to be found at a spot: biome name and a 0..1 random draw; deterministic */
export function speciesAt(bio: Biosphere, biome: string, roll: number): Species | null {
  const here = bio.species.filter(s => s.biome.includes(biome));
  let pool = here.filter(s => s.kind !== 'microbe');
  if (!pool.length) pool = here;
  if (!pool.length) return null;
  const total = pool.reduce((s, x) => s + x.form.density, 0);
  let t = clamp(roll, 0, 0.999999) * total;
  for (const s of pool) { t -= s.form.density; if (t < 0) return s; }
  return pool[pool.length - 1];
}

/** a biome name from what the surface looks like: map colour (linear 0..1), whether it is sea, latitude in degrees, height above the datum in metres */
export function biomeOf(rgb: [number, number, number], sea: boolean, latDeg: number, heightM: number, surfaceK: number): string {
  if (sea) return 'ocean';
  const [r, g, b] = rgb;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const grey = mx - mn < 0.06 * Math.max(mx, 0.05) + 0.02;
  const lat = Math.abs(latDeg), s = Math.sin((lat * Math.PI) / 180);
  // a rough local temperature: warmer at the equator, colder up high
  const localK = surfaceK + 12 - 50 * s * s - 0.0065 * Math.max(heightM, 0);
  if (localK < 240 || (lum > 0.5 && grey && (lat > 60 || heightM > 4000 || localK < 265))) return 'ice';
  if (heightM > 3000) return 'mountain';
  if (lat > 60 || localK < 268) return 'tundra';
  if (g >= r && g >= b && !grey) return lum < 0.12 && r < 0.75 * g ? 'forest' : 'grassland';
  if (r >= g && g >= b && !grey && lum > 0.15 && r - b > 0.06) return 'desert';
  if (lum < 0.2) return 'rock';
  return 'lowland';
}
