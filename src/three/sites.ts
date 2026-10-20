/**
 * Places on real worlds where something is: the spacecraft that landed (and
 * what they left behind), the Earth's great cities, and the life you meet on
 * the Earth's ground, by biome; and the great mountains (peaks.ts). Latitudes north, longitudes east, degrees.
 */

import { PEAKS } from './peaks';

export type SiteKind = 'apollo' | 'lander' | 'rover' | 'probe' | 'city' | 'impact' | 'peak' | 'landmark';
export interface Site {
  body: string;
  name: string;
  lat: number; lon: number;
  kind: SiteKind;
  /** when, and a line about it */
  year: number;
  about: string;
  /** for a city: millions of people */
  pop?: number;
}

const s = (body: string, name: string, lat: number, lon: number, kind: SiteKind, year: number, about: string, pop?: number): Site => ({ body, name, lat, lon, kind, year, about, pop });

export const SITES: Site[] = [
  // ---- the Moon
  s('Moon', 'Apollo 11 · Tranquility Base', 0.67408, 23.47297, 'apollo', 1969, 'Armstrong and Aldrin, 20 July 1969: the first people on another world. The descent stage, the flag, the seismometer and the laser reflector are still there.'),
  s('Moon', 'Apollo 12 · Ocean of Storms', -3.01239, -23.42157, 'apollo', 1969, 'Conrad and Bean landed 160 m from Surveyor 3 and brought pieces of it home.'),
  s('Moon', 'Apollo 14 · Fra Mauro', -3.6453, -17.47136, 'apollo', 1971, 'Shepard hit two golf balls here.'),
  s('Moon', 'Apollo 15 · Hadley–Apennine', 26.13222, 3.63386, 'apollo', 1971, 'The first Lunar Roving Vehicle, at the foot of the Apennines by Hadley Rille. Found the Genesis Rock.'),
  s('Moon', 'Apollo 16 · Descartes Highlands', -8.97301, 15.50019, 'apollo', 1972, 'The only landing in the highlands.'),
  s('Moon', 'Apollo 17 · Taurus–Littrow', 20.1908, 30.77168, 'apollo', 1972, 'Cernan and Schmitt, the last people on the Moon so far. Orange soil at Shorty crater.'),
  s('Moon', 'Luna 9', 7.08, -64.37, 'lander', 1966, 'The first soft landing on another world, and the first pictures from its surface.'),
  s('Moon', 'Lunokhod 1', 38.24, -35.0, 'rover', 1970, 'The first rover on another world, driven by remote control from Crimea for ten months.'),
  s('Moon', 'Chang’e 3 · Yutu', 44.12, -19.51, 'rover', 2013, 'China’s first lunar lander and rover, in Mare Imbrium.'),
  s('Moon', 'Chang’e 4 · Yutu-2', -45.44, 177.6, 'rover', 2019, 'The first landing on the far side, in Von Kármán crater; talks home through a relay satellite.'),
  s('Moon', 'Chang’e 5', 43.06, -51.92, 'lander', 2020, 'Brought 1.7 kg of young basalt home.'),
  s('Moon', 'Chandrayaan-3 · Vikram', -69.37, 32.32, 'lander', 2023, 'India’s lander, the closest yet to the south pole; the Pragyan rover found sulphur.'),
  s('Moon', 'SLIM', -13.3, 25.25, 'lander', 2024, 'Japan’s pinpoint lander, within 55 m of its target, on its nose.'),
  s('Moon', 'IM-1 Odysseus', -80.13, 1.44, 'lander', 2024, 'The first commercial lander; it tipped over on touchdown.'),
  // ---- Mars
  s('Mars', 'Viking 1 · Chryse Planitia', 22.27, -47.95, 'lander', 1976, 'The first successful Mars landing; its life experiments gave puzzling results.'),
  s('Mars', 'Viking 2 · Utopia Planitia', 47.64, 134.29, 'lander', 1976, 'Photographed frost on the ground.'),
  s('Mars', 'Pathfinder · Sojourner', 19.13, -33.22, 'rover', 1997, 'Bounced down on airbags; Sojourner was the first Mars rover.'),
  s('Mars', 'Spirit · Gusev crater', -14.57, 175.47, 'rover', 2004, 'Found silica laid down by hot springs.'),
  s('Mars', 'Opportunity · Meridiani Planum', -1.95, -5.53, 'rover', 2004, 'Planned for 90 days, it drove 45 km over fourteen years.'),
  s('Mars', 'Phoenix', 68.22, -125.75, 'lander', 2008, 'Dug up water ice and found perchlorate.'),
  s('Mars', 'Curiosity · Gale crater', -4.59, 137.44, 'rover', 2012, 'Still climbing Mount Sharp, reading an ancient lake in its layers.'),
  s('Mars', 'InSight · Elysium Planitia', 4.5, 135.62, 'lander', 2018, 'Listened to marsquakes and measured the core.'),
  s('Mars', 'Perseverance · Jezero crater', 18.44, 77.45, 'rover', 2021, 'Collecting cores for return to Earth; flew Ingenuity, the first aircraft on another world.'),
  s('Mars', 'Zhurong · Utopia Planitia', 25.07, 109.93, 'rover', 2021, 'China’s first Mars rover.'),
  // ---- Venus
  s('Venus', 'Venera 7', -5, -9, 'lander', 1970, 'The first signal from the surface of another planet: 23 minutes at 475 °C.'),
  s('Venus', 'Venera 9', 31.01, -68.36, 'lander', 1975, 'The first pictures from the surface of Venus.'),
  s('Venus', 'Venera 13', -7.5, -57, 'lander', 1982, 'Colour pictures and a drill sample; it lasted 127 minutes.'),
  s('Venus', 'Venera 14', -13.25, -50, 'lander', 1982, 'Its drill sampled basalt; its compressibility probe landed on its own lens cap.'),
  s('Venus', 'Vega 1', 7.2, 177.8, 'lander', 1985, 'Dropped a balloon into the clouds on the way down.'),
  // ---- Titan, Mercury
  s('Titan', 'Huygens', -10.25, -167.7, 'probe', 2005, 'The most distant landing ever: a plain of icy cobbles, damp with methane.'),
  s('Mercury', 'MESSENGER impact site', 54.4, -149.9, 'impact', 2015, 'It ran out of fuel and struck the surface at 3.9 km/s, leaving a 16 m crater.'),
  // ---- Earth: the largest cities (metropolitan populations, millions)
  ...([
    ['Tokyo', 35.68, 139.69, 37.1], ['Delhi', 28.61, 77.21, 33.8], ['Shanghai', 31.23, 121.47, 29.9], ['Dhaka', 23.81, 90.41, 23.9], ['São Paulo', -23.55, -46.63, 22.8],
    ['Cairo', 30.04, 31.24, 22.6], ['Mexico City', 19.43, -99.13, 22.5], ['Beijing', 39.9, 116.4, 21.8], ['Mumbai', 19.08, 72.88, 21.3], ['Osaka', 34.69, 135.5, 19],
    ['Chongqing', 29.56, 106.55, 17.8], ['Karachi', 24.86, 67.0, 17.6], ['Kinshasa', -4.44, 15.27, 17], ['Lagos', 6.52, 3.38, 16.5], ['Istanbul', 41.01, 28.98, 15.9],
    ['Buenos Aires', -34.6, -58.38, 15.5], ['Kolkata', 22.57, 88.36, 15.5], ['Manila', 14.6, 120.98, 14.9], ['Guangzhou', 23.13, 113.26, 14.3], ['Lahore', 31.55, 74.34, 14.1],
    ['Rio de Janeiro', -22.91, -43.17, 13.7], ['Moscow', 55.76, 37.62, 12.7], ['Los Angeles', 34.05, -118.24, 12.5], ['Paris', 48.86, 2.35, 11.3], ['Bangkok', 13.76, 100.5, 11.2],
    ['Jakarta', -6.21, 106.85, 11.2], ['Lima', -12.05, -77.04, 11.2], ['London', 51.51, -0.13, 9.6], ['New York', 40.71, -74.01, 18.9], ['Seoul', 37.57, 126.98, 10],
    ['Tehran', 35.69, 51.39, 9.5], ['Nairobi', -1.29, 36.82, 5.3], ['Johannesburg', -26.2, 28.05, 6.2], ['Sydney', -33.87, 151.21, 5.4], ['Toronto', 43.65, -79.38, 6.4],
    ['Chicago', 41.88, -87.63, 8.9], ['Singapore', 1.35, 103.82, 6], ['Riyadh', 24.71, 46.68, 7.7], ['Madrid', 40.42, -3.7, 6.8], ['Berlin', 52.52, 13.4, 3.6],
    ['Rome', 41.9, 12.5, 4.3], ['Reykjavík', 64.15, -21.94, 0.24],
  ] as [string, number, number, number][]).map(([n, la, lo, p]) => s('Earth', n, la, lo, 'city', 0, `${p} million people.`, p)),
  // and where people launch from
  s('Earth', 'Kennedy Space Center', 28.57, -80.65, 'lander', 1962, 'Where Apollo, the Shuttle and Artemis left from.'),
  s('Earth', 'Baikonur Cosmodrome', 45.96, 63.31, 'lander', 1957, 'Sputnik and Gagarin left from here.'),
  // the great monuments of the ancient world, built where they stand and as big (landmarks.ts)
  s('Earth', 'The pyramids of Giza', 29.9792, 31.1342, 'landmark', -2560, 'Khufu’s Great Pyramid, 230 m square and 139 m high, the tallest thing people built for nearly four thousand years; Khafre’s with its cap of casing, Menkaure’s, and the Sphinx looking east.'),
  s('Earth', 'Stonehenge', 51.1789, -1.8262, 'landmark', -2500, 'Sarsens raised about 2500 BC in a ring 33 m across, the trilithons inside it, the bluestones brought 230 km from Wales; its axis lines up with the midsummer sunrise.'),
  s('Earth', 'Chichén Itzá · El Castillo', 20.6829, -88.5686, 'landmark', 1000, 'The Maya temple of Kukulcán: nine terraces, four stairs of 91 steps and one more at the top, 365 in all. At the equinoxes a serpent of shadow slides down its north stair.'),
  s('Earth', 'Ahu Tongariki', -27.1257, -109.2768, 'landmark', 1400, 'Fifteen moai on Rapa Nui’s largest platform, up to 8.7 m tall, their backs to the Pacific; toppled by a tsunami in 1960 and raised again in the 1990s.'),
  // the great mountains (peaks.ts), to fly to and climb
  ...PEAKS.map(p => s(p.body, p.name, p.lat, p.lon, 'peak', 0, p.about)),
];

/** the sites on a world */
export const sitesOn = (real: string | undefined) => (real ? SITES.filter(x => x.body === real) : []);

// ------------------------------------------------------------------ life on the Earth
export type Biome = 'ocean' | 'ice' | 'tundra' | 'boreal' | 'temperate' | 'grassland' | 'desert' | 'tropical' | 'mountain' | 'city';
/** where a species lives: boxes of [lat min, lat max, lon min, lon max], degrees (none: anywhere its biome is) */
export type Range = [number, number, number, number][];
export interface Species { name: string; latin: string; biome: Biome[]; kind: 'plant' | 'animal' | 'fungus' | 'microbe'; size: number; color: number; range?: Range }

// the realms, roughly
const NA: Range = [[14, 72, -170, -52]], SA: Range = [[-56, 13, -82, -34]], EU: Range = [[35, 72, -25, 45]];
const SUBSAHARA: Range = [[-35, 15, -18, 52]], SAHARA_ARABIA: Range = [[12, 37, -18, 60]];
const ASIA: Range = [[5, 78, 45, 180], [-11, 5, 95, 141]], OCEANIA: Range = [[-48, -10, 112, 180]], AUSTRALIA: Range = [[-39, -10, 112, 154]];
const HOLARCTIC: Range = [[30, 90, -180, 180]], NORTH: Range = [[50, 90, -180, 180]];
const NEOTROPICS: Range = [[-35, 30, -118, -34]], SE_ASIA_WET: Range = [[-11, 25, 92, 141]];

const sp = (name: string, latin: string, biome: Biome[], kind: Species['kind'], size: number, color: number, range?: Range): Species => ({ name, latin, biome, kind, size, color, range });

/** some of the life you meet on the ground (and in the sea), by biome and by where it really lives; size in metres, colour its leaves' or coat's */
export const SPECIES: Species[] = [
  sp('Blue whale', 'Balaenoptera musculus', ['ocean'], 'animal', 25, 0x4a5a70), sp('Bottlenose dolphin', 'Tursiops truncatus', ['ocean'], 'animal', 3, 0x7a8a98),
  sp('Green sea turtle', 'Chelonia mydas', ['ocean'], 'animal', 1.2, 0x5a6a40, [[-40, 40, -180, 180]]), sp('Giant kelp', 'Macrocystis pyrifera', ['ocean'], 'plant', 30, 0x6a5a20),
  sp('Prochlorococcus', 'Prochlorococcus marinus', ['ocean'], 'microbe', 0, 0x40a060), sp('Great white shark', 'Carcharodon carcharias', ['ocean'], 'animal', 5, 0x8090a0),
  sp('Emperor penguin', 'Aptenodytes forsteri', ['ice'], 'animal', 1.1, 0x202428, [[-90, -60, -180, 180]]), sp('Polar bear', 'Ursus maritimus', ['ice', 'tundra'], 'animal', 2.4, 0xf0ece0, [[55, 90, -180, 180]]),
  sp('Arctic fox', 'Vulpes lagopus', ['tundra', 'ice'], 'animal', 0.6, 0xe8e8e8, NORTH), sp('Reindeer', 'Rangifer tarandus', ['tundra', 'boreal'], 'animal', 1.8, 0x7a6450, NORTH),
  sp('Reindeer lichen', 'Cladonia rangiferina', ['tundra'], 'fungus', 0.1, 0xd0d4c0), sp('Arctic willow', 'Salix arctica', ['tundra'], 'plant', 0.15, 0x6a8a40, NORTH),
  sp('Norway spruce', 'Picea abies', ['boreal', 'mountain'], 'plant', 40, 0x2a4a2a, EU), sp('Grey wolf', 'Canis lupus', ['boreal', 'temperate', 'tundra'], 'animal', 1.5, 0x8a8478, HOLARCTIC),
  sp('Black spruce', 'Picea mariana', ['boreal'], 'plant', 15, 0x24402a, NA), sp('Siberian larch', 'Larix sibirica', ['boreal', 'mountain'], 'plant', 30, 0x4a6a2a, ASIA),
  sp('Moose', 'Alces alces', ['boreal'], 'animal', 3, 0x4a3a2a, [[43, 72, -170, 180]]), sp('Brown bear', 'Ursus arctos', ['boreal', 'mountain', 'temperate'], 'animal', 2.2, 0x5a3a24, HOLARCTIC),
  sp('Fly agaric', 'Amanita muscaria', ['boreal', 'temperate'], 'fungus', 0.2, 0xd03020, HOLARCTIC), sp('English oak', 'Quercus robur', ['temperate'], 'plant', 30, 0x3a6a2a, EU),
  sp('Silver birch', 'Betula pendula', ['temperate', 'boreal'], 'plant', 22, 0x5a7a32, EU),
  sp('Sugar maple', 'Acer saccharum', ['temperate'], 'plant', 30, 0x4a7a2a, NA), sp('Eastern white pine', 'Pinus strobus', ['temperate', 'boreal'], 'plant', 40, 0x2e4c2c, NA),
  sp('Japanese cedar', 'Cryptomeria japonica', ['temperate', 'mountain'], 'plant', 40, 0x2c4a2a, ASIA), sp('Mongolian oak', 'Quercus mongolica', ['temperate'], 'plant', 25, 0x3e6a2c, ASIA),
  sp('Mountain ash', 'Eucalyptus regnans', ['temperate'], 'plant', 70, 0x5a7050, OCEANIA), sp('Southern beech', 'Nothofagus antarctica', ['temperate', 'mountain'], 'plant', 25, 0x3e602c, [...SA, ...OCEANIA]),
  sp('Red deer', 'Cervus elaphus', ['temperate', 'mountain'], 'animal', 2, 0x8a5030, [[30, 70, -10, 120]]), sp('White-tailed deer', 'Odocoileus virginianus', ['temperate', 'boreal'], 'animal', 1.8, 0x9a6a40, NA),
  sp('Red fox', 'Vulpes vulpes', ['temperate', 'grassland', 'city'], 'animal', 0.8, 0xc06030, [...HOLARCTIC, ...AUSTRALIA]),
  sp('European robin', 'Erithacus rubecula', ['temperate', 'city'], 'animal', 0.14, 0xb06030, EU), sp('Honey bee', 'Apis mellifera', ['temperate', 'grassland', 'city'], 'animal', 0.015, 0xd0a030),
  sp('Giant sequoia', 'Sequoiadendron giganteum', ['mountain', 'temperate'], 'plant', 85, 0x3e5a2e, [[35.7, 38.9, -120.9, -118.4]]),
  sp('Douglas fir', 'Pseudotsuga menziesii', ['mountain', 'temperate'], 'plant', 60, 0x2a462a, [[32, 56, -130, -103]]),
  sp('Swiss stone pine', 'Pinus cembra', ['mountain'], 'plant', 25, 0x2e4c2c, [[43, 50, 5, 30]]),
  sp('African elephant', 'Loxodonta africana', ['grassland'], 'animal', 6.5, 0x8a8480, SUBSAHARA), sp('Lion', 'Panthera leo', ['grassland'], 'animal', 2.5, 0xc0a060, SUBSAHARA),
  sp('Reticulated giraffe', 'Giraffa reticulata', ['grassland'], 'animal', 5.5, 0xc89050, [[-5, 10, 30, 45]]), sp('Plains zebra', 'Equus quagga', ['grassland'], 'animal', 2.3, 0xe0e0e0, [[-35, 5, 10, 45]]),
  sp('Baobab', 'Adansonia digitata', ['grassland'], 'plant', 20, 0x5a7038, SUBSAHARA), sp('Umbrella thorn acacia', 'Vachellia tortilis', ['grassland', 'desert'], 'plant', 12, 0x5a7a34, [...SUBSAHARA, ...SAHARA_ARABIA]),
  sp('Bison', 'Bison bison', ['grassland'], 'animal', 3, 0x4a3420, NA), sp('Big bluestem', 'Andropogon gerardi', ['grassland'], 'plant', 2, 0x7a8a50, NA),
  sp('Bur oak', 'Quercus macrocarpa', ['grassland'], 'plant', 25, 0x3e662c, NA), sp('Feather grass', 'Stipa capillata', ['grassland'], 'plant', 0.8, 0xa8a870, [[35, 60, 20, 130]]),
  sp('Ombú', 'Phytolacca dioica', ['grassland'], 'plant', 15, 0x3e6a2c, SA), sp('River red gum', 'Eucalyptus camaldulensis', ['grassland', 'desert'], 'plant', 30, 0x5a7050, AUSTRALIA),
  sp('Red kangaroo', 'Osphranter rufus', ['grassland', 'desert'], 'animal', 1.6, 0xb06a40, AUSTRALIA), sp('Saiga antelope', 'Saiga tatarica', ['grassland'], 'animal', 1.3, 0xc0a070, [[40, 55, 45, 100]]),
  sp('Dromedary', 'Camelus dromedarius', ['desert'], 'animal', 3, 0xc0a070, SAHARA_ARABIA), sp('Fennec fox', 'Vulpes zerda', ['desert'], 'animal', 0.4, 0xe0c890, [[15, 35, -18, 35]]),
  sp('Date palm', 'Phoenix dactylifera', ['desert'], 'plant', 20, 0x4e6e2a, SAHARA_ARABIA), sp('Joshua tree', 'Yucca brevifolia', ['desert'], 'plant', 10, 0x5a7040, [[33.5, 37.5, -118.5, -113]]),
  sp('Saguaro', 'Carnegiea gigantea', ['desert'], 'plant', 12, 0x4a7a40, [[27, 35, -115, -109]]), sp('Deathstalker scorpion', 'Leiurus quinquestriatus', ['desert'], 'animal', 0.1, 0xd0c060, SAHARA_ARABIA),
  sp('Welwitschia', 'Welwitschia mirabilis', ['desert'], 'plant', 1.5, 0x5a6a30, [[-24, -14, 11, 16]]), sp('Thorny devil', 'Moloch horridus', ['desert'], 'animal', 0.2, 0xb08040, AUSTRALIA),
  sp('Desert oak', 'Allocasuarina decaisneana', ['desert'], 'plant', 12, 0x4e6a40, AUSTRALIA), sp('Coyote', 'Canis latrans', ['desert', 'grassland'], 'animal', 1.2, 0x9a8060, NA),
  sp('Bornean orangutan', 'Pongo pygmaeus', ['tropical'], 'animal', 1.4, 0xa04a20, [[-4.5, 7.5, 108, 119.5]]), sp('Jaguar', 'Panthera onca', ['tropical'], 'animal', 2.2, 0xd0a040, NEOTROPICS),
  sp('Scarlet macaw', 'Ara macao', ['tropical'], 'animal', 0.9, 0xd02020, [[-20, 22, -100, -34]]), sp('Kapok tree', 'Ceiba pentandra', ['tropical'], 'plant', 60, 0x3a6a30, [...NEOTROPICS, [-10, 15, -18, 30]]),
  sp('Meranti', 'Shorea leprosula', ['tropical'], 'plant', 60, 0x36622c, SE_ASIA_WET), sp('African mahogany', 'Khaya ivorensis', ['tropical'], 'plant', 45, 0x386430, [[-10, 12, -18, 35]]),
  sp('Bengal tiger', 'Panthera tigris tigris', ['tropical', 'temperate'], 'animal', 3, 0xd07a30, [[8, 30, 70, 95]]), sp('Asian elephant', 'Elephas maximus', ['tropical'], 'animal', 3, 0x7a7470, [[5, 30, 70, 110]]),
  sp('Leafcutter ant', 'Atta cephalotes', ['tropical'], 'animal', 0.015, 0x8a3a20, NEOTROPICS), sp('Corpse flower', 'Rafflesia arnoldii', ['tropical'], 'plant', 1, 0xa03020, [[-6, 7, 95, 119]]),
  sp('Poison dart frog', 'Dendrobates tinctorius', ['tropical'], 'animal', 0.05, 0x3060d0, [[-20, 15, -85, -34]]), sp('Mountain gorilla', 'Gorilla beringei beringei', ['tropical', 'mountain'], 'animal', 1.7, 0x2a2a2a, [[-2.5, 0.5, 29, 30.5]]),
  sp('Coconut palm', 'Cocos nucifera', ['tropical'], 'plant', 25, 0x4e7030, [[-23, 23, -180, 180]]),
  sp('Snow leopard', 'Panthera uncia', ['mountain'], 'animal', 2, 0xc8c8c0, [[27, 50, 65, 105]]), sp('Andean condor', 'Vultur gryphus', ['mountain'], 'animal', 3.2, 0x202020, [[-55, 10, -82, -62]]),
  sp('Alpine ibex', 'Capra ibex', ['mountain'], 'animal', 1.6, 0x8a7a60, [[43.5, 47.5, 5, 16]]), sp('Edelweiss', 'Leontopodium nivale', ['mountain'], 'plant', 0.1, 0xe8e8d8, [[35, 50, -5, 120]]),
  sp('Mountain goat', 'Oreamnos americanus', ['mountain'], 'animal', 1.5, 0xf0eee6, [[37, 62, -150, -105]]),
  sp('Rock pigeon', 'Columba livia', ['city'], 'animal', 0.33, 0x7a7a8a), sp('Brown rat', 'Rattus norvegicus', ['city'], 'animal', 0.25, 0x6a5a4a),
  sp('Human', 'Homo sapiens', ['city', 'temperate', 'grassland', 'tropical', 'desert', 'boreal'], 'animal', 1.7, 0xc89a78), sp('London plane', 'Platanus × acerifolia', ['city'], 'plant', 30, 0x5a7a3a),
];

const inRange = (r: Range | undefined, lat: number, lon: number) => !r || r.some(([a, b, c, d]) => lat >= a && lat <= b && lon >= c && lon <= d);

/** the Earth's biome at a place, from its latitude, its ground colour and whether it is sea */
export function earthBiome(latD: number, rgb: [number, number, number], sea: boolean, heightM: number, nearCity: boolean): Biome {
  const a = Math.abs(latD), [r, g, b] = rgb;
  if (nearCity) return 'city';
  if (sea) return a > 70 ? 'ice' : 'ocean';
  if (r > 0.8 && g > 0.82 && b > 0.85) return a > 55 || heightM > 3000 ? 'ice' : 'mountain';
  if (heightM > 2500) return 'mountain';
  if (r > g * 1.08 && r > 0.45) return 'desert';
  if (a > 64) return 'tundra';
  if (a > 50) return 'boreal';
  if (a < 15 && g > r) return 'tropical';
  if (a < 35 && r > 0.35) return 'grassland';
  return g > r * 1.15 ? 'temperate' : 'grassland';
}

/** what lives in a biome, at a place (degrees north and east): only what really lives there */
export const speciesIn = (b: Biome, lat: number, lon: number) => SPECIES.filter(x => x.biome.includes(b) && inRange(x.range, lat, lon));
