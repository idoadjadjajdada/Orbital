import { describe, it, expect } from 'vitest';
import { buildPreset } from '../src/physics/presets';
import { AU_M } from '../src/physics/units';
import { atmosphere, gravity } from '../src/three/science';
import { groundSpec, groundAt, type GroundSample } from '../src/three/terrain';
import { Ruins, type Ruin } from '../src/three/ruins';

const solar = buildPreset('solar'), stars = solar.sources.filter(b => b.cls === 'star');
const D = Math.PI / 180;
const dir = (la: number, lo: number): [number, number, number] => [Math.cos(la * D) * Math.cos(lo * D), Math.cos(la * D) * Math.sin(lo * D), Math.sin(la * D)];

function scan(name: string, rate: number, la0: number, lo0: number, span: number) {
  const b = solar.sources.find(x => x.name === name)!, R = b.r * AU_M;
  const spec = groundSpec(b.look, R, gravity(b), atmosphere(b, stars).bar);
  const smp: GroundSample = { h: 0, r: 0, g: 0, b: 0, sea: false, rock: 0 };
  const ru = new Ruins(), found = new Map<string, [number, number]>(), all = new Map<string, Ruin>();
  const ctx = { R, seed: Math.floor(b.look.seed % 9973) + 17, rate, people: null, built: () => false, sampleAt: (m: [number, number, number]) => { const h = groundAt(spec, m, 1, smp); return { h: smp.sea ? 0 : h, sea: smp.sea, r: smp.r, g: smp.g, b: smp.b }; } };
  const step = 8000 / R / D;
  for (let la = la0; la < la0 + span; la += step) for (let lo = lo0; lo < lo0 + span; lo += step / Math.cos(la * D)) {
    ru.frame(ctx, dir(la, lo));
    for (const { r } of ru.near) { found.set(r.key, [Math.asin(r.n[2]) / D, Math.atan2(r.n[1], r.n[0]) / D]); all.set(r.key, r); }
  }
  return { found, all, ru, area: (span * D * R / 1000) ** 2 * Math.cos((la0 + span / 2) * D) };
}

describe('ruins', () => {
  it('are rare, and always in the same places', () => {
    const a = scan('Moon', 0.006, 10, 20, 7), b = scan('Moon', 0.006, 10, 20, 7);
    const perMkm2 = (a.found.size / a.area) * 1e6;
    // a site every fifty kilometres or so: some, but far apart
    expect(a.found.size).toBeGreaterThan(0);
    expect(perMkm2).toBeLessThan(800);
    expect([...b.found.keys()].sort()).toEqual([...a.found.keys()].sort());
    console.log('moon ruins', a.found.size, 'in', Math.round(a.area), 'km2:', [...a.found.values()].slice(0, 3).map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(' '));
  });
  it('each site has something left in its main ruin, and the scan reads who built it', () => {
    const { all, ru } = scan('Moon', 0.006, 10, 20, 7);
    const main = [...all.values()].filter(r => r.key.endsWith('/0'));
    expect(main.length).toBeGreaterThan(0);
    for (const r of main) {
      expect(r.art?.name).toMatch(/^an? /);
      expect(r.art!.about.length).toBeGreaterThan(30);
      expect(r.age).toBeGreaterThan(100);
      const lines = ru.read(r, null);
      expect(lines.some(l => /doorways stand \d/.test(l) && /tall/.test(l))).toBe(true);
      expect(lines.some(l => /Something lies in it/.test(l))).toBe(true);
    }
    // the others in a site are just ruins
    expect([...all.values()].filter(r => !r.key.endsWith('/0')).every(r => !r.art)).toBe(true);
  });
});
