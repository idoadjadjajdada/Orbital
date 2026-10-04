import { describe, it, expect, afterAll } from 'vitest';
import { buildPreset } from '../src/physics/presets';
import { AU_M } from '../src/physics/units';
import { atmosphere, gravity } from '../src/three/science';
import { groundSpec, groundAt, type GroundSample } from '../src/three/terrain';
import { setMars } from '../src/pixel/marsdata';
import { buildMap } from '../src/pixel/surface';
import { readGrey } from './png';

const solar = buildPreset('solar');
const stars = solar.sources.filter(b => b.cls === 'star');
const mars = solar.sources.find(b => b.name === 'Mars')!;
const D = Math.PI / 180;
const dir = (la: number, lo: number): [number, number, number] => [Math.cos(la * D) * Math.cos(lo * D), Math.cos(la * D) * Math.sin(lo * D), Math.sin(la * D)];
const smp: GroundSample = { h: 0, r: 0, g: 0, b: 0, sea: false, rock: 0 };

describe('Mars from MOLA', () => {
  const g = readGrey('src/pixel/data/mars-height.png');
  setMars({ w: g.w, h: g.h, height: g.data, rgb: null });
  afterAll(() => setMars(null));
  const s = groundSpec(mars.look, mars.r * AU_M, gravity(mars), atmosphere(mars, stars).bar);
  const at = (la: number, lo: number) => groundAt(s, dir(la, lo), 30000, smp);

  it('is equirectangular from 180° W, twice as wide as tall', () => {
    expect(g.w).toBe(2 * g.h);
  });
  it('puts the measured summits and basins where they are, at their heights', () => {
    expect(at(18.65, -133.8)).toBeGreaterThan(17000);           // Olympus Mons, 21.9 km
    expect(at(-8.3, -120.1)).toBeGreaterThan(13000);            // Arsia Mons
    expect(at(-42.4, 70.5)).toBeLessThan(-5500);                // Hellas, the floor near −7 km
    expect(at(18.44, 77.45)).toBeLessThan(-1500);               // Jezero, about −2.6 km
    expect(at(-4.59, 137.44)).toBeLessThan(-2000);              // Gale crater, −4.5 km
    expect(at(-8, -100)).toBeGreaterThan(3000);                 // the Tharsis plateau
  });
  it('lowers the north below the southern highlands', () => {
    let n = 0, so = 0;
    for (let lo = -180; lo < 180; lo += 10) { n += at(50, lo); so += at(-30, lo); }
    expect(so - n).toBeGreaterThan(4000 * 36);
  });
  it('meets itself across the 180° meridian', () => {
    expect(Math.abs(at(0, 179.95) - at(0, -179.95))).toBeLessThan(400);
  });
  it('paints the map from the data', () => {
    const m = buildMap(mars.look, 128);
    // the painter's heights are 0.5 + km / 40: Olympus' texel well above Hellas'
    const tex = (la: number, lo: number) => m.height[Math.floor((la / 180 + 0.5) * m.h) * m.w + Math.floor((((lo + 360) % 360) / 360) * m.w)];
    expect(tex(18.65, -133.8) - tex(-42.4, 70.5)).toBeGreaterThan(0.5);
  });
});
