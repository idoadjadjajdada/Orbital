import { describe, it, expect, afterAll } from 'vitest';
import { buildPreset } from '../src/physics/presets';
import { AU_M } from '../src/physics/units';
import { atmosphere, gravity } from '../src/three/science';
import { groundSpec, groundAt, type GroundSample } from '../src/three/terrain';
import { setEarth } from '../src/pixel/earthdata';
import { setMars } from '../src/pixel/marsdata';
import { PEAKS } from '../src/three/peaks';
import { sitesOn } from '../src/three/sites';
import { readGrey } from './png';

const solar = buildPreset('solar');
const stars = solar.sources.filter(b => b.cls === 'star');
const body = (name: string) => solar.sources.find(b => b.name === name)!;
const D = Math.PI / 180;
const dir = (la: number, lo: number): [number, number, number] => [Math.cos(la * D) * Math.cos(lo * D), Math.cos(la * D) * Math.sin(lo * D), Math.sin(la * D)];
const smp: GroundSample = { h: 0, r: 0, g: 0, b: 0, sea: false, rock: 0 };
const spec = (name: string) => { const b = body(name); return groundSpec(b.look, b.r * AU_M, gravity(b), atmosphere(b, stars).bar); };

describe('the Earth’s land, measured', () => {
  const g = readGrey('src/pixel/data/earth-height.png');
  setEarth(g.w, g.h, g.data);
  afterAll(() => setEarth(0, 0, null));
  const s = spec('Earth');
  const at = (la: number, lo: number, fine = 200) => groundAt(s, dir(la, lo), fine, smp);

  it('stands the plateaus and plains at their heights', () => {
    expect(at(33, 88)).toBeGreaterThan(4000);                   // Tibet
    expect(at(-17, -68)).toBeGreaterThan(3000);                 // the Altiplano
    expect(at(38.5, -98)).toBeLessThan(1000);                   // Kansas
    expect(at(30, -40)).toBe(0);                                // the Atlantic
    expect(smp.sea).toBe(true);
  });
  it('raises the named mountains to their measured summits', () => {
    for (const p of PEAKS.filter(k => k.body === 'Earth' && k.shape !== 'cone' && k.shape !== 'shield')) {
      expect(Math.abs(at(p.lat, p.lon, 1) - p.h!), p.name).toBeLessThan(120);
    }
    // a volcano's summit is its crater rim
    const fuji = PEAKS.find(k => k.name === 'Mount Fuji')!;
    expect(at(fuji.lat, fuji.lon, 1)).toBeLessThan(fuji.h!);
    expect(at(fuji.lat, fuji.lon, 1)).toBeGreaterThan(fuji.h! - 400);
    // Everest is the highest point for 30 km round
    let hi = 0;
    for (let k = 0; k < 200; k++) hi = Math.max(hi, at(27.9881 + Math.sin(k * 12.9898) * 0.25, 86.925 + Math.sin(k * 78.233) * 0.25, 50));
    expect(hi).toBeLessThan(8849 + 50);
  });
  it('is rugged where the land is and gentle where it is not', () => {
    const spread = (la: number, lo: number) => { const hs = Array.from({ length: 40 }, (_, k) => at(la + (k % 8) * 0.01, lo + Math.floor(k / 8) * 0.01, 50)); return Math.max(...hs) - Math.min(...hs); };
    expect(spread(28.2, 85.5)).toBeGreaterThan(4 * spread(38.5, -98));   // the Himalaya against Kansas
  });
  it('lists the mountains as places to fly to', () => {
    expect(sitesOn('Earth').some(x => x.name === 'Mount Everest' && x.kind === 'peak')).toBe(true);
    expect(sitesOn('Mars').some(x => x.name === 'Olympus Mons')).toBe(true);
  });
});

describe('Olympus Mons, whole', () => {
  const g = readGrey('src/pixel/data/mars-height.png');
  setMars({ w: g.w, h: g.h, height: g.data, rgb: null });
  afterAll(() => setMars(null));
  const s = spec('Mars');
  // along a line due east of the middle (18.65° N, 133.8° W)
  const east = (km: number) => groundAt(s, dir(18.65, -133.8 + km / (3389.5 * Math.cos(18.65 * D)) / D), 200, smp);
  it('has a caldera sunk into its summit, and its rim near 22 km', () => {
    expect(east(35)).toBeGreaterThan(20500);
    expect(east(0)).toBeLessThan(east(35) - 1500);
  });
  it('falls away down its cliffs at the foot, kilometres high', () => {
    expect(east(260) - east(310)).toBeGreaterThan(5000);
  });
});
