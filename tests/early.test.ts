import { describe, it, expect } from 'vitest';
import { World } from '../src/physics/world';
import { buildPreset } from '../src/physics/presets';
import { Early, ERAS, scoreSystem } from '../src/physics/early';
import { HOUR } from '../src/physics/units';

const host = () => { const said: string[] = []; return { said, toast: (m: string) => { said.push(m); }, setWarp: () => {} }; };

describe('the early solar system', () => {
  it('scores the real solar system near full marks', () => {
    const w = buildPreset('solar', new World());
    const s = scoreSystem(w);
    // (the real one has no fifth giant to have thrown out, and its planets are its planets)
    expect(s.total).toBeGreaterThan(90);
  });

  it('builds every era', () => {
    for (let k = 0; k < ERAS.length; k++) {
      const w = new World(), e = new Early(host());
      e.build(w, k);
      expect(w.sources.some(b => b.name === 'Sun')).toBe(true);
      expect(w.sources.some(b => b.name === 'Jupiter')).toBe(true);
      expect(e.age).toBe(ERAS[k].at);
      // the fifth giant until the instability has thrown it out
      expect(w.sources.some(b => b.name === 'Planet Five')).toBe(k <= ERAS.findIndex(x => x.key === 'nice'));
    }
  });

  it('runs from one era into the next', () => {
    const w = new World(), h = host(), e = new Early(h);
    e.build(w, 0);
    w.drive = dt => e.drive(w, dt);
    for (let k = 0; k < 400 && e.era === 0; k++) { const got = w.step(2, Infinity); e.tick(w, got); }
    expect(e.era).toBe(1);
    expect(h.said.some(m => /Grand Tack/.test(m))).toBe(true);
  });

  it('Theia strikes the proto-Earth, and it melts', () => {
    const w = new World(), h = host(), e = new Early(h);
    e.build(w, ERAS.findIndex(x => x.key === 'theia'));
    w.drive = dt => e.drive(w, dt);
    e.age = 62.0001;
    e.tick(w, 0);
    const theia = w.sources.find(b => b.name === 'Theia')!;
    expect(h.said.some(m => /Theia strikes/.test(m))).toBe(true);
    for (let k = 0; k < 200 && theia.alive; k++) { const got = w.step(0.05 * HOUR, Infinity); e.tick(w, got); }
    expect(theia.alive).toBe(false);
    const earth = w.sources.find(b => b.name === 'Proto-Earth' || b.name === 'Earth')!;
    expect(earth.heat).toBeGreaterThan(0.5);
  }, 120000);
});
