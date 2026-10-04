/**
 * Places on real worlds where something is: the spacecraft that landed (and
 * what they left behind), the Earth's great cities, and the life you meet on
 * the Earth's ground, by biome; and the great mountains (peaks.ts). Latitudes north, longitudes east, degrees.
 */

import { PEAKS } from './peaks';

export type SiteKind = 'apollo' | 'lander' | 'rover' | 'probe' | 'city' | 'impact' | 'peak';
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
  // the great mountains (peaks.ts), to fly to and climb
  ...PEAKS.map(p => s(p.body, p.name, p.lat, p.lon, 'peak', 0, p.about)),
];

/** the sites on a world */
export const sitesOn = (real: string | undefined) => (real ? SITES.filter(x => x.body === real) : []);

// ------------------------------------------------------------------ life on the Earth
export type Biome = 'ocean' | 'ice' | 'tundra' | 'boreal' | 'temperate' | 'grassland' | 'desert' | 'tropical' | 'mountain' | 'city';
export interface Species { name: string; latin: string; biome: Biome[]; kind: 'plant' | 'animal' | 'fungus' | 'microbe'; size: number; color: number }

const sp = (name: string, latin: string, biome: Biome[], kind: Species['kind'], size: number, color: number): Species => ({ name, latin, biome, kind, size, color });

/** some of the life you meet on the ground (and in the sea), by biome; size in metres */
export const SPECIES: Species[] = [
  sp('Blue whale', 'Balaenoptera musculus', ['ocean'], 'animal', 25, 0x4a5a70), sp('Bottlenose dolphin', 'Tursiops truncatus', ['ocean'], 'animal', 3, 0x7a8a98),
  sp('Green sea turtle', 'Chelonia mydas', ['ocean'], 'animal', 1.2, 0x5a6a40), sp('Giant kelp', 'Macrocystis pyrifera', ['ocean'], 'plant', 30, 0x6a5a20),
  sp('Prochlorococcus', 'Prochlorococcus marinus', ['ocean'], 'microbe', 0, 0x40a060), sp('Great white shark', 'Carcharodon carcharias', ['ocean'], 'animal', 5, 0x8090a0),
  sp('Emperor penguin', 'Aptenodytes forsteri', ['ice'], 'animal', 1.1, 0x202428), sp('Polar bear', 'Ursus maritimus', ['ice', 'tundra'], 'animal', 2.4, 0xf0ece0),
  sp('Arctic fox', 'Vulpes lagopus', ['tundra', 'ice'], 'animal', 0.6, 0xe8e8e8), sp('Reindeer', 'Rangifer tarandus', ['tundra', 'boreal'], 'animal', 1.8, 0x7a6450),
  sp('Reindeer lichen', 'Cladonia rangiferina', ['tundra'], 'fungus', 0.1, 0xd0d4c0), sp('Arctic willow', 'Salix arctica', ['tundra'], 'plant', 0.15, 0x6a8a40),
  sp('Norway spruce', 'Picea abies', ['boreal', 'mountain'], 'plant', 40, 0x2a4a2a), sp('Grey wolf', 'Canis lupus', ['boreal', 'temperate', 'tundra'], 'animal', 1.5, 0x8a8478),
  sp('Moose', 'Alces alces', ['boreal'], 'animal', 3, 0x4a3a2a), sp('Brown bear', 'Ursus arctos', ['boreal', 'mountain', 'temperate'], 'animal', 2.2, 0x5a3a24),
  sp('Fly agaric', 'Amanita muscaria', ['boreal', 'temperate'], 'fungus', 0.2, 0xd03020), sp('English oak', 'Quercus robur', ['temperate'], 'plant', 30, 0x3a6a2a),
  sp('Red deer', 'Cervus elaphus', ['temperate', 'mountain'], 'animal', 2, 0x8a5030), sp('Red fox', 'Vulpes vulpes', ['temperate', 'grassland', 'city'], 'animal', 0.8, 0xc06030),
  sp('European robin', 'Erithacus rubecula', ['temperate', 'city'], 'animal', 0.14, 0xb06030), sp('Honey bee', 'Apis mellifera', ['temperate', 'grassland', 'city'], 'animal', 0.015, 0xd0a030),
  sp('Giant sequoia', 'Sequoiadendron giganteum', ['mountain', 'temperate'], 'plant', 85, 0x7a4a2a), sp('African elephant', 'Loxodonta africana', ['grassland'], 'animal', 6.5, 0x8a8480),
  sp('Lion', 'Panthera leo', ['grassland'], 'animal', 2.5, 0xc0a060), sp('Reticulated giraffe', 'Giraffa reticulata', ['grassland'], 'animal', 5.5, 0xc89050),
  sp('Plains zebra', 'Equus quagga', ['grassland'], 'animal', 2.3, 0xe0e0e0), sp('Baobab', 'Adansonia digitata', ['grassland'], 'plant', 20, 0x8a7a5a),
  sp('Bison', 'Bison bison', ['grassland'], 'animal', 3, 0x4a3420), sp('Big bluestem', 'Andropogon gerardi', ['grassland'], 'plant', 2, 0x7a8a50),
  sp('Dromedary', 'Camelus dromedarius', ['desert'], 'animal', 3, 0xc0a070), sp('Fennec fox', 'Vulpes zerda', ['desert'], 'animal', 0.4, 0xe0c890),
  sp('Saguaro', 'Carnegiea gigantea', ['desert'], 'plant', 12, 0x4a7a40), sp('Deathstalker scorpion', 'Leiurus quinquestriatus', ['desert'], 'animal', 0.1, 0xd0c060),
  sp('Welwitschia', 'Welwitschia mirabilis', ['desert'], 'plant', 1.5, 0x5a6a30), sp('Thorny devil', 'Moloch horridus', ['desert'], 'animal', 0.2, 0xb08040),
  sp('Bornean orangutan', 'Pongo pygmaeus', ['tropical'], 'animal', 1.4, 0xa04a20), sp('Jaguar', 'Panthera onca', ['tropical'], 'animal', 2.2, 0xd0a040),
  sp('Scarlet macaw', 'Ara macao', ['tropical'], 'animal', 0.9, 0xd02020), sp('Kapok tree', 'Ceiba pentandra', ['tropical'], 'plant', 60, 0x3a6a30),
  sp('Leafcutter ant', 'Atta cephalotes', ['tropical'], 'animal', 0.015, 0x8a3a20), sp('Corpse flower', 'Rafflesia arnoldii', ['tropical'], 'plant', 1, 0xa03020),
  sp('Poison dart frog', 'Dendrobates tinctorius', ['tropical'], 'animal', 0.05, 0x3060d0), sp('Mountain gorilla', 'Gorilla beringei beringei', ['tropical', 'mountain'], 'animal', 1.7, 0x2a2a2a),
  sp('Snow leopard', 'Panthera uncia', ['mountain'], 'animal', 2, 0xc8c8c0), sp('Andean condor', 'Vultur gryphus', ['mountain'], 'animal', 3.2, 0x202020),
  sp('Alpine ibex', 'Capra ibex', ['mountain'], 'animal', 1.6, 0x8a7a60), sp('Edelweiss', 'Leontopodium nivale', ['mountain'], 'plant', 0.1, 0xe8e8d8),
  sp('Rock pigeon', 'Columba livia', ['city'], 'animal', 0.33, 0x7a7a8a), sp('Brown rat', 'Rattus norvegicus', ['city'], 'animal', 0.25, 0x6a5a4a),
  sp('Human', 'Homo sapiens', ['city', 'temperate', 'grassland', 'tropical', 'desert', 'boreal'], 'animal', 1.7, 0xc89a78), sp('London plane', 'Platanus × acerifolia', ['city'], 'plant', 30, 0x5a7a3a),
];

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

/** what lives in a biome */
export const speciesIn = (b: Biome) => SPECIES.filter(x => x.biome.includes(b));
