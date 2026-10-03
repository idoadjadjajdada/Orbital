/**
 * Places on real worlds worth landing beside: where spacecraft came down,
 * where people walked, the great cities and the landmarks. Latitudes are
 * planetocentric degrees north, longitudes degrees east (−180..180), from
 * the published landing solutions and gazetteers; a site's `body` matches
 * the `look.real` of the world it is on.
 */

export interface Site {
  body: string;
  name: string;
  lat: number;
  lon: number;
  kind: 'crewed' | 'lander' | 'rover' | 'probe' | 'impact' | 'city' | 'base' | 'feature';
  model: 'lm' | 'lrv' | 'rover-small' | 'rover-mid' | 'rover-big' | 'lander' | 'venera' | 'probe' | 'heli' | 'flag' | 'city' | 'none';
  year?: number;
  by?: string;
  desc: string;
  /** for cities, the built-up radius in km; for features, their radius in km */
  size?: number;
}

const MOON: Site[] = [
  { body: 'Moon', name: 'Apollo 11 · Tranquility Base', lat: 0.6741, lon: 23.4730, kind: 'crewed', model: 'lm', year: 1969, by: 'NASA', desc: 'Armstrong and Aldrin, the first people on another world, spent 21½ hours here on 20–21 July 1969.' },
  { body: 'Moon', name: 'Apollo 12 · Ocean of Storms', lat: -3.0124, lon: -23.4216, kind: 'crewed', model: 'lm', year: 1969, by: 'NASA', desc: 'A pinpoint landing 180 m from Surveyor 3, whose camera Conrad and Bean brought home.' },
  { body: 'Moon', name: 'Apollo 14 · Fra Mauro', lat: -3.6453, lon: -17.4714, kind: 'crewed', model: 'lm', year: 1971, by: 'NASA', desc: 'Shepard and Mitchell sampled ejecta from the Imbrium impact; Shepard hit two golf balls.' },
  { body: 'Moon', name: 'Apollo 15 · Hadley–Apennine', lat: 26.1322, lon: 3.6339, kind: 'crewed', model: 'lm', year: 1971, by: 'NASA', desc: 'The first long stay with a rover, at the foot of the Apennines beside Hadley Rille; Scott and Irwin found the Genesis Rock.' },
  { body: 'Moon', name: 'Apollo 15 · Lunar Roving Vehicle', lat: 26.1325, lon: 3.6375, kind: 'rover', model: 'lrv', year: 1971, by: 'NASA', desc: 'The first car on the Moon, parked east of the lunar module after 28 km of driving.' },
  { body: 'Moon', name: 'Apollo 16 · Descartes Highlands', lat: -8.9730, lon: 15.5002, kind: 'crewed', model: 'lm', year: 1972, by: 'NASA', desc: 'Young and Duke explored the central highlands, which turned out to be impact breccias rather than volcanic rock.' },
  { body: 'Moon', name: 'Apollo 16 · Lunar Roving Vehicle', lat: -8.9738, lon: 15.5040, kind: 'rover', model: 'lrv', year: 1972, by: 'NASA', desc: 'Left facing the lunar module so its camera could film the ascent.' },
  { body: 'Moon', name: 'Apollo 17 · Taurus–Littrow', lat: 20.1908, lon: 30.7717, kind: 'crewed', model: 'lm', year: 1972, by: 'NASA', desc: 'The last crewed landing: Cernan and Schmitt, the only geologist to walk on the Moon, found orange volcanic glass.' },
  { body: 'Moon', name: 'Apollo 17 · Lunar Roving Vehicle', lat: 20.1904, lon: 30.7765, kind: 'rover', model: 'lrv', year: 1972, by: 'NASA', desc: 'Parked about 150 m east of the lunar module after 36 km of driving through the valley.' },
  { body: 'Moon', name: 'Luna 2', lat: 29.1, lon: 0, kind: 'impact', model: 'none', year: 1959, by: 'USSR', desc: 'The first human-made object to reach another world, striking near Archimedes crater.' },
  { body: 'Moon', name: 'Luna 9', lat: 7.08, lon: -64.37, kind: 'lander', model: 'lander', year: 1966, by: 'USSR', desc: 'The first soft landing on another world, in Oceanus Procellarum; it sent back the first photographs from the surface.' },
  { body: 'Moon', name: 'Surveyor 1', lat: -2.474, lon: -43.339, kind: 'lander', model: 'lander', year: 1966, by: 'NASA', desc: 'America’s first soft landing, proving the regolith would bear a lunar module.' },
  { body: 'Moon', name: 'Surveyor 3', lat: -3.0160, lon: -23.4182, kind: 'lander', model: 'lander', year: 1967, by: 'NASA', desc: 'Visited by the Apollo 12 crew 31 months later; parts of it are in the Smithsonian.' },
  { body: 'Moon', name: 'Lunokhod 1', lat: 38.3150, lon: -35.0081, kind: 'rover', model: 'rover-small', year: 1970, by: 'USSR', desc: 'The first rover on another world, driven from Earth for 10 months across Mare Imbrium; its retroreflector still returns laser pulses.' },
  { body: 'Moon', name: 'Lunokhod 2', lat: 25.8323, lon: 30.9221, kind: 'rover', model: 'rover-small', year: 1973, by: 'USSR', desc: 'Drove 39 km in Le Monnier crater, a record that stood for 41 years.' },
  { body: 'Moon', name: 'Chang’e 3', lat: 44.1214, lon: -19.5116, kind: 'lander', model: 'lander', year: 2013, by: 'CNSA', desc: 'China’s first lunar landing, in northern Mare Imbrium; the lander’s ultraviolet telescope worked for years.' },
  { body: 'Moon', name: 'Yutu', lat: 44.1206, lon: -19.5130, kind: 'rover', model: 'rover-small', year: 2013, by: 'CNSA', desc: 'Jade Rabbit drove about 114 m before a fault stopped it.' },
  { body: 'Moon', name: 'Chang’e 4', lat: -45.4446, lon: 177.5991, kind: 'lander', model: 'lander', year: 2019, by: 'CNSA', desc: 'The first landing on the far side, in Von Kármán crater, talking to Earth through the Queqiao relay.' },
  { body: 'Moon', name: 'Yutu-2', lat: -45.4380, lon: 177.5800, kind: 'rover', model: 'rover-small', year: 2019, by: 'CNSA', desc: 'The longest-lived lunar rover, still crossing the floor of Von Kármán years after landing.' },
  { body: 'Moon', name: 'Chang’e 5', lat: 43.0576, lon: -51.9161, kind: 'lander', model: 'lander', year: 2020, by: 'CNSA', desc: 'Brought home 1.7 kg of young basalt from near Mons Rümker, only about 2 billion years old.' },
  { body: 'Moon', name: 'Chandrayaan-3 · Vikram', lat: -69.3733, lon: 32.3191, kind: 'lander', model: 'lander', year: 2023, by: 'ISRO', desc: 'India’s first lunar landing and the first near the south pole; the site is named Shiv Shakti point.' },
  { body: 'Moon', name: 'Pragyan', lat: -69.3735, lon: 32.3175, kind: 'rover', model: 'rover-small', year: 2023, by: 'ISRO', desc: 'A six-wheeled rover that confirmed sulphur in the polar regolith.' },
  { body: 'Moon', name: 'Chang’e 6', lat: -41.6385, lon: -153.9852, kind: 'lander', model: 'lander', year: 2024, by: 'CNSA', desc: 'The first sample return from the far side, from the Apollo basin inside South Pole–Aitken.' },
  { body: 'Moon', name: 'Tycho', lat: -43.31, lon: -11.36, kind: 'feature', model: 'none', size: 43, desc: 'A young crater, about 108 million years old, whose bright rays stretch across the near side.' },
  { body: 'Moon', name: 'Copernicus', lat: 9.62, lon: -20.08, kind: 'feature', model: 'none', size: 47, desc: 'The “monarch of the Moon”: terraced walls and central peaks, about 800 million years old.' },
  { body: 'Moon', name: 'Mare Tranquillitatis', lat: 8.5, lon: 31.4, kind: 'feature', model: 'none', size: 437, desc: 'A basalt plain filling an ancient impact basin; Apollo 11 landed on its south-west edge.' },
  { body: 'Moon', name: 'Shackleton crater', lat: -89.67, lon: 129.78, kind: 'feature', model: 'none', size: 10.5, desc: 'On the south pole: its floor never sees sunlight, and its rim is lit most of the year — a candidate site for a base.' },
];

const MARS: Site[] = [
  { body: 'Mars', name: 'Mars 3', lat: -45, lon: -158, kind: 'lander', model: 'lander', year: 1971, by: 'USSR', desc: 'The first soft landing on Mars, in Terra Sirenum; it fell silent after about 20 seconds, perhaps in a dust storm.' },
  { body: 'Mars', name: 'Viking 1', lat: 22.27, lon: -47.95, kind: 'lander', model: 'lander', year: 1976, by: 'NASA', desc: 'The first long-lived lander, in Chryse Planitia; its biology experiments gave tantalising but inconclusive results.' },
  { body: 'Mars', name: 'Viking 2', lat: 47.64, lon: -134.29, kind: 'lander', model: 'lander', year: 1976, by: 'NASA', desc: 'Landed in Utopia Planitia and photographed frost on the ground through the winter.' },
  { body: 'Mars', name: 'Mars Pathfinder · Carl Sagan Memorial Station', lat: 19.13, lon: -33.22, kind: 'lander', model: 'lander', year: 1997, by: 'NASA', desc: 'Bounced down on airbags in Ares Vallis, an ancient flood channel.' },
  { body: 'Mars', name: 'Sojourner', lat: 19.1302, lon: -33.2205, kind: 'rover', model: 'rover-small', year: 1997, by: 'NASA', desc: 'The first rover on Mars, 65 cm long; it never strayed more than 12 m from the lander.' },
  { body: 'Mars', name: 'Beagle 2', lat: 11.5265, lon: 90.4295, kind: 'lander', model: 'lander', year: 2003, by: 'ESA / UK', desc: 'Lost on Christmas Day 2003; found intact in 2015 by orbiter photos, its solar panels only partly unfolded.' },
  { body: 'Mars', name: 'Spirit', lat: -14.5684, lon: 175.4726, kind: 'rover', model: 'rover-mid', year: 2004, by: 'NASA', desc: 'Landed in Gusev crater and found near-pure silica at Home Plate, the mark of ancient hot springs.' },
  { body: 'Mars', name: 'Opportunity', lat: -1.9462, lon: -5.5266, kind: 'rover', model: 'rover-mid', year: 2004, by: 'NASA', desc: 'Planned for 90 sols, it drove 45 km over 14 years from Eagle crater to Endeavour, finding haematite “blueberries” formed in water.' },
  { body: 'Mars', name: 'Phoenix', lat: 68.22, lon: -125.75, kind: 'lander', model: 'lander', year: 2008, by: 'NASA', desc: 'Scraped up water ice just under the arctic soil and found perchlorate.' },
  { body: 'Mars', name: 'Curiosity · Mount Sharp', lat: -4.78, lon: 137.40, kind: 'rover', model: 'rover-big', year: 2012, by: 'NASA', desc: 'Landed at Bradbury in Gale crater and has climbed Mount Sharp since, reading its layers like a history of a drying world.' },
  { body: 'Mars', name: 'InSight', lat: 4.502, lon: 135.623, kind: 'lander', model: 'lander', year: 2018, by: 'NASA', desc: 'A seismometer on Elysium Planitia that heard over 1,300 marsquakes and measured the planet’s core.' },
  { body: 'Mars', name: 'Perseverance · Octavia E. Butler Landing', lat: 18.4447, lon: 77.4508, kind: 'rover', model: 'rover-big', year: 2021, by: 'NASA', desc: 'Collecting sealed rock cores in Jezero crater’s river delta for a future return to Earth.' },
  { body: 'Mars', name: 'Ingenuity · Wright Brothers Field', lat: 18.4448, lon: 77.4512, kind: 'probe', model: 'heli', year: 2021, by: 'NASA', desc: 'The first powered flight on another planet, on 19 April 2021; it flew 72 times.' },
  { body: 'Mars', name: 'Zhurong', lat: 25.066, lon: 109.925, kind: 'rover', model: 'rover-mid', year: 2021, by: 'CNSA', desc: 'China’s first Mars rover, in southern Utopia Planitia, looking for buried ice and an ancient shoreline.' },
  { body: 'Mars', name: 'Olympus Mons', lat: 18.65, lon: -133.8, kind: 'feature', model: 'none', size: 300, desc: 'The tallest volcano in the solar system: 22 km above its plains, as wide as France.' },
  { body: 'Mars', name: 'Valles Marineris · Melas Chasma', lat: -10.5, lon: -72.5, kind: 'feature', model: 'none', size: 200, desc: 'The widest part of a canyon system 4,000 km long and up to 7 km deep.' },
  { body: 'Mars', name: 'Hellas Planitia', lat: -42.4, lon: 70.5, kind: 'feature', model: 'none', size: 1150, desc: 'An impact basin 2,300 km across and 7 km deep, where the air pressure is highest on Mars.' },
  { body: 'Mars', name: 'Gale crater', lat: -5.4, lon: 137.8, kind: 'feature', model: 'none', size: 77, desc: 'A 154 km crater holding a lake 3.5 billion years ago; Mount Sharp rises 5 km from its centre.' },
  { body: 'Mars', name: 'Jezero crater', lat: 18.38, lon: 77.58, kind: 'feature', model: 'none', size: 22.5, desc: 'A former lake 45 km across, fed by a river that left a fan-shaped delta.' },
];

const VENUS: Site[] = [
  { body: 'Venus', name: 'Venera 7', lat: -5, lon: -9, kind: 'lander', model: 'venera', year: 1970, by: 'USSR', desc: 'The first spacecraft to transmit from the surface of another planet: 23 minutes of faint signal at 475 °C.' },
  { body: 'Venus', name: 'Venera 8', lat: -10.7, lon: -24.75, kind: 'lander', model: 'venera', year: 1972, by: 'USSR', desc: 'Measured the light reaching the ground and found the clouds let through enough to photograph by.' },
  { body: 'Venus', name: 'Venera 9', lat: 31.01, lon: -68.36, kind: 'lander', model: 'venera', year: 1975, by: 'USSR', desc: 'Sent back the first photograph from the surface of another planet: angular rocks on a slope.' },
  { body: 'Venus', name: 'Venera 10', lat: 15.42, lon: -68.49, kind: 'lander', model: 'venera', year: 1975, by: 'USSR', desc: 'Photographed flat slabs of basalt like pavement under an orange sky.' },
  { body: 'Venus', name: 'Venera 13', lat: -7.5, lon: -57, kind: 'lander', model: 'venera', year: 1982, by: 'USSR', desc: 'Survived 127 minutes and took the first colour pictures of the surface.' },
  { body: 'Venus', name: 'Venera 14', lat: -13.25, lon: -50, kind: 'lander', model: 'venera', year: 1982, by: 'USSR', desc: 'Its soil probe landed on its own ejected lens cap.' },
  { body: 'Venus', name: 'Vega 1', lat: 7.2, lon: 177.8, kind: 'lander', model: 'venera', year: 1985, by: 'USSR', desc: 'Dropped a lander and a balloon that floated in the clouds for two days on its way to Halley’s comet.' },
  { body: 'Venus', name: 'Vega 2', lat: -7.14, lon: 177.67, kind: 'lander', model: 'venera', year: 1985, by: 'USSR', desc: 'The last landing on Venus to date, on the highlands of Aphrodite Terra.' },
  { body: 'Venus', name: 'Pioneer Venus Large Probe', lat: 4.4, lon: -56, kind: 'impact', model: 'probe', year: 1978, by: 'NASA', desc: 'Parachuted through the clouds measuring the air all the way down.' },
  { body: 'Venus', name: 'Pioneer Venus North Probe', lat: 59.3, lon: 4.8, kind: 'impact', model: 'probe', year: 1978, by: 'NASA', desc: 'One of three small probes that fell freely through the atmosphere.' },
  { body: 'Venus', name: 'Pioneer Venus Day Probe', lat: -31.3, lon: -43, kind: 'impact', model: 'probe', year: 1978, by: 'NASA', desc: 'Survived the impact and transmitted from the surface for 67 minutes.' },
  { body: 'Venus', name: 'Pioneer Venus Night Probe', lat: -28.7, lon: 56.7, kind: 'impact', model: 'probe', year: 1978, by: 'NASA', desc: 'Measured the night side’s atmosphere on the way down.' },
  { body: 'Venus', name: 'Maxwell Montes', lat: 65.2, lon: 3.3, kind: 'feature', model: 'none', size: 400, desc: 'The highest mountains on Venus, 11 km above the mean surface, capped with a frost of metal compounds.' },
];

const TITAN: Site[] = [
  { body: 'Titan', name: 'Huygens', lat: -10.573, lon: 167.665, kind: 'probe', model: 'probe', year: 2005, by: 'ESA', desc: 'The most distant landing ever made: it came down on damp sand strewn with water-ice pebbles and sent back 72 minutes of data.' },
  { body: 'Titan', name: 'Kraken Mare', lat: 68, lon: 50, kind: 'feature', model: 'none', size: 400, desc: 'The largest sea on Titan, liquid methane and ethane larger than the Caspian.' },
  { body: 'Titan', name: 'Ligeia Mare', lat: 79, lon: 112, kind: 'feature', model: 'none', size: 200, desc: 'A sea of nearly pure methane, 160 m deep in places, glassy calm.' },
];

const CITIES: [string, number, number, number, string][] = [
  ['Tokyo', 35.6895, 139.6917, 45, 'The largest metropolitan area on Earth, about 37 million people.'],
  ['Delhi', 28.6139, 77.2090, 30, 'India’s capital region, over 30 million people and growing fast.'],
  ['Shanghai', 31.2304, 121.4737, 35, 'China’s largest city and the world’s busiest container port.'],
  ['São Paulo', -23.5505, -46.6333, 30, 'The largest city in the southern hemisphere.'],
  ['Mexico City', 19.4326, -99.1332, 30, 'Built on the drained lake of the Aztec capital Tenochtitlan, 2,240 m up.'],
  ['Cairo', 30.0444, 31.2357, 25, 'On the Nile, across from the pyramids of Giza.'],
  ['Mumbai', 19.0760, 72.8777, 20, 'India’s financial capital, on a peninsula of seven joined islands.'],
  ['Beijing', 39.9042, 116.4074, 30, 'China’s capital for most of the last 800 years.'],
  ['Dhaka', 23.8103, 90.4125, 15, 'One of the most densely populated cities on Earth, on the Ganges delta.'],
  ['Osaka', 34.6937, 135.5023, 30, 'Japan’s second city, merged with Kobe and Kyoto into one urban region.'],
  ['New York', 40.7128, -74.0060, 40, 'The largest city in the United States, on one of the world’s great natural harbours.'],
  ['Karachi', 24.8607, 67.0011, 20, 'Pakistan’s largest city and port, on the Arabian Sea.'],
  ['Buenos Aires', -34.6037, -58.3816, 30, 'On the Río de la Plata, the widest estuary in the world.'],
  ['Istanbul', 41.0082, 28.9784, 25, 'Straddling the Bosphorus between Europe and Asia.'],
  ['Kolkata', 22.5726, 88.3639, 20, 'On the Hooghly, capital of British India until 1911.'],
  ['Lagos', 6.5244, 3.3792, 25, 'Africa’s largest city, on lagoons and islands by the Gulf of Guinea.'],
  ['Manila', 14.5995, 120.9842, 20, 'The capital of the Philippines, among the densest cities anywhere.'],
  ['Rio de Janeiro', -22.9068, -43.1729, 25, 'Between granite peaks and Guanabara Bay.'],
  ['Guangzhou', 23.1291, 113.2644, 35, 'At the head of the Pearl River Delta, the world’s largest urban area.'],
  ['Los Angeles', 34.0522, -118.2437, 40, 'A sprawl of 18 million people across basins and valleys.'],
  ['Moscow', 55.7558, 37.6173, 25, 'Russia’s capital, ringed by orbital roads round the Kremlin.'],
  ['Paris', 48.8566, 2.3522, 20, 'On the Seine; its inner city is one of the densest in Europe.'],
  ['London', 51.5074, -0.1278, 25, 'On the Thames, held inside a green belt since the 1940s.'],
  ['Jakarta', -6.2088, 106.8456, 30, 'Sinking up to 25 cm a year as groundwater is pumped out.'],
  ['Seoul', 37.5665, 126.9780, 25, 'Half of South Korea’s people live in its metropolitan area.'],
  ['Lima', -12.0464, -77.0428, 20, 'A city of 10 million in a desert where it almost never rains.'],
  ['Bangkok', 13.7563, 100.5018, 25, 'On the Chao Phraya delta, criss-crossed by canals.'],
  ['Chicago', 41.8781, -87.6298, 30, 'On Lake Michigan, where the skyscraper was born.'],
  ['Johannesburg', -26.2041, 28.0473, 25, 'Founded on the 1886 Witwatersrand gold rush, 1,750 m up.'],
  ['Sydney', -33.8688, 151.2093, 30, 'Round Port Jackson, one of the largest natural harbours.'],
  ['Toronto', 43.6532, -79.3832, 25, 'Canada’s largest city, on Lake Ontario.'],
  ['Singapore', 1.3521, 103.8198, 15, 'An island city-state a degree north of the equator.'],
  ['Berlin', 52.5200, 13.4050, 18, 'Germany’s capital, divided by a wall from 1961 to 1989.'],
  ['Madrid', 40.4168, -3.7038, 18, 'The highest capital in the European Union, at 650 m.'],
  ['Nairobi', -1.2921, 36.8219, 15, 'Kenya’s capital, with a national park inside the city limits.'],
  ['Riyadh', 24.7136, 46.6753, 25, 'Saudi Arabia’s capital, in the middle of the Arabian plateau.'],
  ['Tehran', 35.6892, 51.3890, 20, 'At the foot of the Alborz mountains.'],
  ['Rome', 41.9028, 12.4964, 15, 'Capital of an empire, and of Italy; the Vatican sits inside it.'],
  ['Cape Town', -33.9249, 18.4241, 18, 'Under Table Mountain, near the southern tip of Africa.'],
  ['Anchorage', 61.2181, -149.9003, 10, 'Alaska’s largest city, between mountains and Cook Inlet.'],
  ['Reykjavík', 64.1466, -21.9426, 8, 'The northernmost capital of a sovereign state, heated by geothermal water.'],
  ['Honolulu', 21.3069, -157.8583, 10, 'On O‘ahu, the most remote large city on Earth.'],
];

const EARTH: Site[] = [
  ...CITIES.map(([name, lat, lon, size, desc]): Site => ({ body: 'Earth', name, lat, lon, kind: 'city', model: 'city', size, desc })),
  { body: 'Earth', name: 'Kennedy Space Center · LC-39A', lat: 28.6082, lon: -80.6041, kind: 'base', model: 'flag', year: 1967, by: 'NASA', desc: 'Every crewed Moon mission left from this pad, and later the Space Shuttle and Falcon Heavy.' },
  { body: 'Earth', name: 'Baikonur · Gagarin’s Start', lat: 45.920, lon: 63.342, kind: 'base', model: 'flag', year: 1957, by: 'USSR / Russia', desc: 'Sputnik and Gagarin flew from here; Soyuz crews still do.' },
  { body: 'Earth', name: 'Guiana Space Centre · Kourou', lat: 5.239, lon: -52.768, kind: 'base', model: 'flag', year: 1968, by: 'ESA / CNES', desc: 'Five degrees from the equator, where the Earth’s spin gives rockets a boost; JWST launched here.' },
  { body: 'Earth', name: 'Jiuquan Satellite Launch Centre', lat: 40.9606, lon: 100.2983, kind: 'base', model: 'flag', year: 1960, by: 'China', desc: 'In the Gobi desert: China’s first satellite and every Shenzhou crew launched from here.' },
  { body: 'Earth', name: 'Satish Dhawan Space Centre · Sriharikota', lat: 13.7199, lon: 80.2304, kind: 'base', model: 'flag', year: 1971, by: 'ISRO', desc: 'India’s spaceport on a barrier island; Chandrayaan and Mangalyaan left from here.' },
  { body: 'Earth', name: 'Tanegashima Space Center', lat: 30.400, lon: 130.970, kind: 'base', model: 'flag', year: 1969, by: 'JAXA', desc: 'On a southern Japanese island, said to be the most beautiful launch site in the world.' },
  { body: 'Earth', name: 'Starbase · Boca Chica', lat: 25.9972, lon: -97.1560, kind: 'base', model: 'flag', year: 2019, by: 'SpaceX', desc: 'Where SpaceX builds and flies Starship, the largest rocket ever launched.' },
  { body: 'Earth', name: 'Amundsen–Scott South Pole Station', lat: -90, lon: 0, kind: 'base', model: 'flag', year: 1956, by: 'USA', desc: 'On 2,800 m of ice at the geographic South Pole, staffed all year round.' },
  { body: 'Earth', name: 'Mount Everest', lat: 27.9881, lon: 86.9250, kind: 'feature', model: 'none', size: 5, desc: 'The highest point above sea level, 8,849 m, still rising a few millimetres a year as India pushes into Asia.' },
  { body: 'Earth', name: 'Challenger Deep · Mariana Trench', lat: 11.3733, lon: 142.5917, kind: 'feature', model: 'none', size: 10, desc: 'The deepest point of the ocean, about 10,935 m down, where the Pacific plate dives under the Philippine plate.' },
  { body: 'Earth', name: 'Grand Canyon', lat: 36.1, lon: -112.1, kind: 'feature', model: 'none', size: 40, desc: 'Cut 1.8 km deep by the Colorado River through two billion years of rock.' },
  { body: 'Earth', name: 'Sahara', lat: 23.0, lon: 13.0, kind: 'feature', model: 'none', size: 1700, desc: 'The largest hot desert, 9 million km²; green savanna as recently as 6,000 years ago.' },
];

const OTHERS: Site[] = [
  { body: 'Mercury', name: 'Caloris Planitia', lat: 30.5, lon: 170.2, kind: 'feature', model: 'none', size: 775, desc: 'An impact basin 1,550 km across; the shock raised jumbled hills on the opposite side of the planet.' },
  { body: 'Mercury', name: 'MESSENGER impact site', lat: 54.4, lon: -149.9, kind: 'impact', model: 'none', year: 2015, by: 'NASA', desc: 'After four years in orbit MESSENGER ran out of fuel and struck at 3.9 km/s, leaving a crater about 16 m wide.' },
  { body: 'Io', name: 'Loki Patera', lat: 13, lon: 51.2, kind: 'feature', model: 'none', size: 100, desc: 'A lava lake 200 km across whose crust founders and overturns every year or so: the most powerful volcano in the solar system.' },
  { body: 'Io', name: 'Pele', lat: -18.7, lon: 104.7, kind: 'feature', model: 'none', size: 15, desc: 'A volcano throwing sulphur 300 km high and ringing itself with a red deposit 1,200 km across.' },
  { body: 'Europa', name: 'Conamara Chaos', lat: 9.7, lon: 86.3, kind: 'feature', model: 'none', size: 40, desc: 'Rafts of ice that broke, drifted and refroze, perhaps where warm water rose close to the surface.' },
  { body: 'Enceladus', name: 'Tiger stripes', lat: -86, lon: 0, kind: 'feature', model: 'none', size: 70, desc: 'Four warm fractures across the south pole venting jets of the ocean below into space.' },
  { body: 'Ceres', name: 'Occator crater · Cerealia Facula', lat: 19.82, lon: -120.67, kind: 'feature', model: 'none', size: 46, desc: 'The brightest spot on Ceres: sodium carbonate left by brine rising from below, perhaps still today.' },
  { body: 'Pluto', name: 'Sputnik Planitia', lat: 20, lon: 180, kind: 'feature', model: 'none', size: 500, desc: 'The left lobe of the heart: a glacier of nitrogen ice 1,000 km across, slowly churning in convection cells.' },
  { body: 'Pluto', name: 'Tombaugh Regio', lat: 10, lon: -175, kind: 'feature', model: 'none', size: 800, desc: 'The bright heart, named for the man who found Pluto in 1930.' },
  { body: 'Pluto', name: 'Wright Mons', lat: -21.6, lon: 173.2, kind: 'feature', model: 'none', size: 75, desc: 'A mountain 4 km high with a deep central pit: probably a cryovolcano.' },
];

export const SITES: Site[] = [...MOON, ...MARS, ...VENUS, ...TITAN, ...EARTH, ...OTHERS];

/** the sites on one real body (its `look.real`) */
export function sitesOn(real: string): Site[] {
  return SITES.filter(s => s.body === real);
}
