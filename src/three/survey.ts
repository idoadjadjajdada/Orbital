import type { Body } from '../physics/body';
import { AU_M, MSUN_KG, KM, densityOf, fmtMass, fmtDuration, sig } from '../physics/units';

/**
 * What the lab's survey console and the hangar's landing survey say about a
 * body: its gravity, temperature, air and ground, and whether the lander could
 * set down on it. Real bodies use measured values; anything else is estimated
 * from its mass, size, style and the starlight falling on it.
 */

/** what the lander is built for */
export const LANDER = { maxG: 2.5, maxK: 700, maxBar: 50, minKm: 1 };

interface Fact { k: number; bar: number; air: string; ground: string }
/** mean surface temperature (K), surface pressure (bar), air and ground, as measured */
const FACTS: Record<string, Fact> = {
  Mercury: { k: 440, bar: 0, air: 'none', ground: 'cratered silicate rock over a huge iron core' },
  Venus: { k: 737, bar: 92, air: 'CO₂ 96%, N₂ 3.5%, sulphuric acid clouds', ground: 'basalt plains and volcanoes' },
  Earth: { k: 288, bar: 1.013, air: 'N₂ 78%, O₂ 21%, Ar 0.9% — breathable', ground: 'oceans, continents, ice caps' },
  Moon: { k: 250, bar: 0, air: 'none', ground: 'basalt maria, anorthosite highlands, fine regolith' },
  Mars: { k: 210, bar: 0.006, air: 'CO₂ 95%, N₂ 2.8%, Ar 2%', ground: 'iron-oxide dust over basalt, polar ice' },
  Phobos: { k: 233, bar: 0, air: 'none', ground: 'carbon-rich rubble, grooved' },
  Deimos: { k: 233, bar: 0, air: 'none', ground: 'smooth carbon-rich regolith' },
  Ceres: { k: 168, bar: 0, air: 'none', ground: 'ice-rich clay, bright salt deposits' },
  Vesta: { k: 190, bar: 0, air: 'none', ground: 'basaltic crust, a giant south-pole basin' },
  Jupiter: { k: 165, bar: 0, air: 'H₂ 90%, He 10%', ground: 'none: the gas thickens into liquid metallic hydrogen' },
  Io: { k: 110, bar: 0, air: 'trace SO₂', ground: 'sulphur plains and silicate volcanoes, lava lakes at 1,500 K' },
  Europa: { k: 102, bar: 0, air: 'trace O₂', ground: 'cracked water-ice crust over a salty ocean' },
  Ganymede: { k: 110, bar: 0, air: 'trace O₂', ground: 'grooved ice and dark ancient terrain' },
  Callisto: { k: 134, bar: 0, air: 'trace CO₂', ground: 'dark, heavily cratered ice and rock' },
  Saturn: { k: 134, bar: 0, air: 'H₂ 96%, He 3%', ground: 'none: no solid surface' },
  Titan: { k: 94, bar: 1.5, air: 'N₂ 95%, CH₄ 5%, orange haze', ground: 'methane lakes, hydrocarbon dunes on water-ice bedrock' },
  Enceladus: { k: 75, bar: 0, air: 'trace H₂O from the south-pole geysers', ground: 'the freshest ice in the system' },
  Mimas: { k: 64, bar: 0, air: 'none', ground: 'ice, one enormous crater' },
  Tethys: { k: 86, bar: 0, air: 'none', ground: 'almost pure water ice, a long canyon' },
  Dione: { k: 87, bar: 0, air: 'none', ground: 'ice with bright wispy cliffs' },
  Rhea: { k: 76, bar: 0, air: 'none', ground: 'cratered ice and rock' },
  Iapetus: { k: 110, bar: 0, air: 'none', ground: 'ice, one hemisphere coated dark' },
  Hyperion: { k: 93, bar: 0, air: 'none', ground: 'porous, sponge-like ice' },
  Uranus: { k: 76, bar: 0, air: 'H₂ 83%, He 15%, CH₄ 2%', ground: 'none: no solid surface' },
  Miranda: { k: 60, bar: 0, air: 'none', ground: 'patchwork ice, 20 km cliffs' },
  Ariel: { k: 60, bar: 0, air: 'none', ground: 'bright ice cut by rift valleys' },
  Umbriel: { k: 75, bar: 0, air: 'none', ground: 'dark ancient ice' },
  Titania: { k: 70, bar: 0, air: 'none', ground: 'ice and rock with canyons' },
  Oberon: { k: 75, bar: 0, air: 'none', ground: 'cratered ice and rock' },
  Neptune: { k: 72, bar: 0, air: 'H₂ 80%, He 19%, CH₄ 1.5%', ground: 'none: no solid surface' },
  Triton: { k: 38, bar: 1.4e-5, air: 'thin N₂', ground: 'nitrogen ice, cantaloupe terrain, geysers' },
  Pluto: { k: 44, bar: 1e-5, air: 'thin N₂, CH₄, CO', ground: 'nitrogen-ice plains, water-ice mountains' },
  Charon: { k: 53, bar: 0, air: 'none', ground: 'water ice, a red polar cap' },
  Eris: { k: 42, bar: 0, air: 'frozen onto the ground', ground: 'methane frost, very bright' },
  Makemake: { k: 40, bar: 0, air: 'none', ground: 'methane and ethane ice' },
  Haumea: { k: 50, bar: 0, air: 'none', ground: 'crystalline water ice' },
};

const KIND: Record<string, string> = {
  terran: 'Earth-like world', ocean: 'Ocean world', rocky: 'Rocky world', barren: 'Airless rock', ice: 'Icy world', lava: 'Lava world',
  iron: 'Iron world', carbon: 'Carbon world', desert: 'Desert world', gas: 'Gas giant', icegiant: 'Ice giant', hotjupiter: 'Hot Jupiter',
  browndwarf: 'Brown dwarf', star: 'Star', wd: 'White dwarf', ns: 'Neutron star', bh: 'Black hole',
};
const AIR: Record<string, [string, number]> = {
  terran: ['N₂, O₂ (presumed)', 1], ocean: ['N₂, H₂O vapour (presumed)', 2], desert: ['thin CO₂ (presumed)', 0.05], lava: ['rock vapour, SO₂', 0.1],
  gas: ['H₂, He', 0], icegiant: ['H₂, He, CH₄', 0], hotjupiter: ['H₂, He, metal vapours', 0], browndwarf: ['H₂, He', 0],
};
const GROUND: Record<string, string> = {
  terran: 'oceans and continents', ocean: 'a global ocean', rocky: 'silicate rock', barren: 'cratered rock and dust', ice: 'water and volatile ices',
  lava: 'molten rock', iron: 'iron and nickel', carbon: 'graphite and carbides', desert: 'sand and bare rock',
};

export interface Survey {
  name: string;
  kind: string;
  rows: [string, string][];
  land: { ok: boolean; why: string };
  /** surface gravity, g */
  g: number;
}

const G_SI = 6.674e-11;

/** a body's survey; `stars` light it, `host` is what it goes round */
export function survey(b: Body, stars: Body[], host: Body | null): Survey {
  const style = b.look.style, real = b.look.real;
  const M = b.m * MSUN_KG, R = b.r * AU_M;
  const g = R > 0 ? G_SI * M / (R * R) / 9.81 : 0;
  const vesc = R > 0 ? Math.sqrt(2 * G_SI * M / R) / 1000 : 0;
  // measured facts only for the real thing, not a world someone named after it
  const fact = real && Object.hasOwn(FACTS, real) ? FACTS[real] : undefined;
  const giant = b.cls === 'gas' || ['gas', 'icegiant', 'hotjupiter', 'browndwarf'].includes(style);
  const compact = ['star', 'wd', 'ns', 'bh'].includes(b.cls);
  // the starlight here: the temperature a dark ball would settle at
  let flux = 0;
  for (const s of stars) {
    if (s === b) continue;
    const d2 = (s.x - b.x) ** 2 + (s.y - b.y) ** 2 + (s.z - b.z) ** 2;
    flux += (s.star?.L ?? 0) / Math.max(d2, 1e-12);
  }
  const teq = 278.6 * Math.pow(flux, 0.25);
  const temp = compact ? (b.star?.teff ?? 0) : fact ? fact.k : b.heat > 0.55 ? Math.max(teq, 1200) : teq * (style === 'terran' || style === 'ocean' ? 1.034 : 1);
  const [air, bar] = fact ? [fact.air, fact.bar] : AIR[style] ?? ['none', 0];
  const ground = fact ? fact.ground : b.heat > 0.55 ? 'molten after an impact' : GROUND[style] ?? '—';
  const kind = b.look.craft ? 'Spacecraft' : b.cls === 'debris' ? 'Fragment' : b.r < 300 * KM && !compact && !giant ? (b.cls === 'ice' ? 'Icy body' : 'Asteroid') : KIND[style] ?? b.cls;

  const rows: [string, string][] = [['Mass', fmtMass(b.m)], ['Radius', `${sig(b.r / KM)} km`]];
  if (!compact || b.cls === 'star') {
    rows.push(['Surface gravity', `${sig(g, 3)} g`], ['Escape velocity', `${sig(vesc, 3)} km/s`], ['Density', `${sig(densityOf(b.m, b.r), 3)} g/cm³`]);
  }
  if (b.spin) rows.push(['Day', fmtDuration((2 * Math.PI) / Math.abs(b.spin))]);
  rows.push([compact ? 'Surface temperature' : fact ? 'Mean temperature' : 'Temperature (est.)', temp ? `${Math.round(temp).toLocaleString('en-US')} K · ${Math.round(temp - 273.15).toLocaleString('en-US')} °C` : '—']);
  if (!compact) {
    rows.push(['Atmosphere', bar > 0 && !giant ? `${air} · ${sig(bar, 2)} bar` : air]);
    rows.push(['Surface', giant ? 'none: no solid surface' : ground]);
  }
  if (host) {
    const d = Math.hypot(b.x - host.x, b.y - host.y, b.z - host.z);
    rows.push(['Orbits', `${host.name} at ${d >= 0.01 ? `${sig(d)} AU` : `${sig(d / KM)} km`}`]);
  }

  let land: Survey['land'];
  if (b.look.craft) land = { ok: false, why: 'A spacecraft: match its speed and dock, don’t land' };
  else if (b.cls === 'bh') land = { ok: false, why: 'A black hole: nothing to land on, and no coming back' };
  else if (compact) land = { ok: false, why: `${KIND[b.cls] ?? 'A star'}: far too hot, and no surface` };
  else if (giant) land = { ok: false, why: 'No solid surface: the lander would sink until it was crushed' };
  else if (b.r / KM < LANDER.minKm) land = { ok: false, why: 'Too small to land on: hold station and step across' };
  else if (temp > LANDER.maxK) land = { ok: false, why: `Too hot: ${Math.round(temp)} K, and the lander is rated to ${LANDER.maxK} K` };
  else if (bar > LANDER.maxBar) land = { ok: false, why: `The air is too thick: ${sig(bar, 2)} bar would crush the lander` };
  else if (g > LANDER.maxG) land = { ok: false, why: `Gravity too strong: ${sig(g, 2)} g, and the lander can lift off from ${LANDER.maxG} g` };
  else {
    const notes = [bar >= 0.5 && /breathable/.test(air) ? 'breathable air' : bar >= 0.05 ? 'an atmosphere to brake in, suits on' : bar >= 1e-3 ? 'thin air: suits on, it barely slows the fall' : 'airless: suits on, powered descent all the way'];
    if (g < 0.02) notes.push('barely any gravity: touch down gently');
    if (temp < 100) notes.push('bitterly cold');
    land = { ok: true, why: `Landable: ${notes.join('; ')}` };
  }
  return { name: b.name, kind, rows, land, g };
}
