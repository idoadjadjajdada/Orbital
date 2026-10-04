/**
 * Real mountains, shaped where the maps are too coarse to hold them.
 *
 * The Earth's elevation map has a texel every 20 km and Mars' the same, so a
 * mountain there is a smooth swelling: the Himalaya stand high, but Everest
 * is not a peak. Each mountain here is raised out of the ground round it to
 * its measured height, in its own shape: a pyramid with sharp arêtes for a
 * horn (Everest, K2, the Matterhorn), a broad dome for a massif (Mont Blanc,
 * Denali), the concave slopes and summit crater of a stratovolcano (Fuji,
 * Kilimanjaro), a shield's gentle swell (Mauna Kea), the sheer sides of an
 * inselberg (Uluru). Olympus Mons is drawn whole (terrain.ts): its caldera,
 * its shield and the cliffs round its foot.
 *
 * Heights are metres above sea level (the Earth) or the datum; where a
 * mountain's height above its own surroundings is what is known (on the Moon),
 * `rise` gives that instead. Latitudes north, longitudes east, degrees; `r` is
 * how far the mountain's slopes reach, km.
 */
export type PeakShape = 'horn' | 'massif' | 'cone' | 'shield' | 'inselberg';
export interface Peak {
  body: string; name: string;
  lat: number; lon: number;
  /** summit height, m (or `rise` above the ground round it) */
  h?: number; rise?: number;
  r: number;
  shape: PeakShape;
  about: string;
}

const p = (body: string, name: string, lat: number, lon: number, h: number, r: number, shape: PeakShape, about: string): Peak => ({ body, name, lat, lon, h, r, shape, about });

export const PEAKS: Peak[] = [
  p('Earth', 'Mount Everest', 27.9881, 86.925, 8849, 14, 'horn', 'Sagarmatha, Chomolungma: the highest point on Earth, 8,849 m. First climbed by Tenzing Norgay and Edmund Hillary in 1953.'),
  p('Earth', 'K2', 35.8817, 76.5133, 8611, 12, 'horn', 'The second highest, in the Karakoram: steeper, colder and deadlier than Everest.'),
  p('Earth', 'Kangchenjunga', 27.7025, 88.1475, 8586, 12, 'massif', 'The third highest: five summits on one great massif.'),
  p('Earth', 'Makalu', 27.8897, 87.0889, 8485, 8, 'horn', 'A four-sided granite pyramid, 19 km from Everest.'),
  p('Earth', 'Aconcagua', -32.6532, -70.0109, 6961, 14, 'massif', 'The highest mountain outside Asia, in the Andes of Argentina.'),
  p('Earth', 'Chimborazo', -1.4693, -78.8169, 6263, 18, 'cone', 'Its summit is the point on Earth furthest from the centre: the equatorial bulge lifts it 2 km past Everest’s.'),
  p('Earth', 'Denali', 63.0692, -151.007, 6190, 16, 'massif', 'North America’s highest, rising 5.5 km from the lowlands round it: a bigger rise than Everest’s.'),
  p('Earth', 'Kilimanjaro', -3.0674, 37.3556, 5895, 40, 'cone', 'Africa’s highest, a lone volcano standing out of the savanna, with the remains of its ice cap round Kibo crater.'),
  p('Earth', 'Mount Kenya', -0.1521, 37.3084, 5199, 25, 'cone', 'An old volcano worn down to its sharp core, right on the equator.'),
  p('Earth', 'Mount Elbrus', 43.3499, 42.4453, 5642, 18, 'cone', 'A dormant double-summited volcano, Europe’s highest.'),
  p('Earth', 'Mount Ararat', 39.7019, 44.2983, 5137, 20, 'cone', 'A snow-capped volcano over the Armenian plateau.'),
  p('Earth', 'Vinson Massif', -78.5254, -85.6171, 4892, 14, 'massif', 'Antarctica’s highest, in the Ellsworth Mountains.'),
  p('Earth', 'Puncak Jaya', -4.0833, 137.1833, 4884, 10, 'massif', 'Oceania’s highest, with the last tropical glaciers of New Guinea.'),
  p('Earth', 'Mont Blanc', 45.8326, 6.8652, 4808, 10, 'massif', 'The roof of the Alps, between France and Italy.'),
  p('Earth', 'Matterhorn', 45.9763, 7.6586, 4478, 5, 'horn', 'The Alps’ most famous horn: four faces and four ridges, carved by glaciers on every side.'),
  p('Earth', 'Mount Whitney', 36.5785, -118.2923, 4421, 8, 'massif', 'The highest in the contiguous United States, 136 km from Death Valley, the lowest.'),
  p('Earth', 'Mount Rainier', 46.8523, -121.7603, 4392, 16, 'cone', 'A heavily glaciated volcano over Seattle.'),
  p('Earth', 'Mauna Kea', 19.8207, -155.4681, 4207, 40, 'shield', 'Over 10 km from its foot on the sea floor: the tallest mountain on Earth. Its summit holds the world’s great telescopes.'),
  p('Earth', 'Mauna Loa', 19.4721, -155.5922, 4169, 50, 'shield', 'The largest active volcano on Earth by volume.'),
  p('Earth', 'Mount Fuji', 35.3606, 138.7274, 3776, 22, 'cone', 'Japan’s highest: a near-perfect stratovolcano, last erupted in 1707.'),
  p('Earth', 'Aoraki / Mount Cook', -43.595, 170.1418, 3724, 8, 'horn', 'New Zealand’s highest, in the Southern Alps.'),
  p('Earth', 'Mount Etna', 37.751, 14.9934, 3357, 20, 'cone', 'Europe’s most active volcano, on Sicily.'),
  p('Earth', 'Mount Olympus', 40.0859, 22.3583, 2918, 10, 'massif', 'Home of the Greek gods.'),
  p('Earth', 'Ben Nevis', 56.7969, -5.0036, 1345, 5, 'massif', 'The highest in the British Isles.'),
  p('Earth', 'Mount Vesuvius', 40.821, 14.426, 1281, 6, 'cone', 'The volcano that buried Pompeii and Herculaneum in 79 AD.'),
  p('Earth', 'Uluru', -25.3444, 131.0369, 863, 2.2, 'inselberg', 'A single great sandstone monolith, 348 m high, in the red centre of Australia.'),
  { body: 'Mars', name: 'Olympus Mons', lat: 18.65, lon: -133.8, h: 21900, r: 300, shape: 'shield', about: 'The tallest volcano in the solar system: 22 km above the datum, 600 km across, ringed by cliffs up to 8 km high, with a caldera 80 km wide.' },
  { body: 'Mars', name: 'Aeolis Mons (Mount Sharp)', lat: -5.08, lon: 137.85, rise: 5000, r: 45, shape: 'massif', about: 'A 5 km mound of layered sediment in Gale crater that Curiosity is climbing, reading Mars’ drying in its layers.' },
  { body: 'Moon', name: 'Mons Hadley', lat: 26.7, lon: 4.1, rise: 4500, r: 15, shape: 'massif', about: 'The massif over Apollo 15’s landing site, 4.5 km above the plain.' },
  { body: 'Moon', name: 'Mons Huygens', lat: 19.92, lon: -2.86, rise: 5000, r: 20, shape: 'massif', about: 'The highest of the Montes Apenninus, the rim of the Imbrium basin.' },
];

export const peaksOn = (body: string | undefined) => PEAKS.filter(k => k.body === body);
