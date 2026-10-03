import { describe, it, expect } from 'vitest';
import { buildPreset } from '../src/physics/presets';
import { makeBody } from '../src/physics/catalog';
import { atmosphereOf, airAt, compositionOf } from '../src/three/science';

describe('the atmosphere reader and the interiors', () => {
  const w = buildPreset('solar');
  const stars = w.sources.filter(b => b.cls === 'star');
  const get = (n: string) => w.sources.find(b => b.name === n)!;
  it('reads the real worlds as measured', () => {
    const e = atmosphereOf(get('Earth'), stars);
    expect(e.gases.find(g => g.formula === 'N₂')!.frac).toBeCloseTo(0.78, 1);
    expect(atmosphereOf(get('Mars'), stars).surfaceBar).toBeCloseTo(0.006, 3);
    const v = atmosphereOf(get('Venus'), stars);
    expect(v.surfaceBar).toBeGreaterThan(85);
    expect(v.surfaceK).toBeGreaterThan(700);
    expect(atmosphereOf(get('Jupiter'), stars).kind).toBe('envelope');
    expect(atmosphereOf(get('Moon'), stars).exists).toBe(false);
  });
  it('has fractions that add up and no NaN, for every body in the solar system', () => {
    for (const b of w.sources) {
      if (!b.alive || b.cls === 'debris') continue;
      const a = atmosphereOf(b, stars);
      if (a.exists) expect(Math.abs(a.gases.reduce((k, g) => k + g.frac, 0) - 1), b.name).toBeLessThan(0.02);
      for (const h of [-2e5, -1e4, 0, 1e4, 1e5, 1e6]) {
        const s = airAt(a, b, h);
        expect(Number.isFinite(s.bar) && s.bar >= 0 && Number.isFinite(s.K) && Number.isFinite(s.rho), `${b.name} at ${h}`).toBe(true);
      }
      const c = compositionOf(b);
      expect(c.layers[0].r0).toBe(0);
      expect(c.layers[c.layers.length - 1].r1).toBeCloseTo(1, 5);
      for (let k = 1; k < c.layers.length; k++) expect(c.layers[k].r0).toBeCloseTo(c.layers[k - 1].r1, 5);
    }
  });
  it('gets denser and hotter going down into Jupiter', () => {
    const b = get('Jupiter'), a = atmosphereOf(b, stars);
    let last = airAt(a, b, 5e4);
    for (const h of [0, -5e4, -1e5]) { const s = airAt(a, b, h); expect(s.bar).toBeGreaterThan(last.bar); expect(s.K).toBeGreaterThanOrEqual(last.K); last = s; }
  });
  it('gives an Earth-like world round a Sun-like star nitrogen, oxygen and a mild climate', () => {
    const t = makeBody('terran', 7);
    t.x = 1; t.y = 0; t.z = 0;
    const a = atmosphereOf(t, stars);
    expect(a.gases.some(g => g.formula === 'N₂')).toBe(true);
    expect(a.gases.some(g => g.formula === 'O₂')).toBe(true);
    expect(a.surfaceK).toBeGreaterThan(240);
    expect(a.surfaceK).toBeLessThan(340);
  });
});
