import { describe, it, expect } from 'vitest';
import { buildPreset } from '../src/physics/presets';
import { grow, soilOfSample, REFERENCE, PLANTS, GrowLab, DAYS_PER_YEAR, type Amend } from '../src/three/growlab';
import { grassiness } from '../src/three/grass';

const solar = buildPreset('solar');
const body = (n: string) => solar.sources.find(b => b.name === n)!;
const plant = (id: string) => PLANTS.find(p => p.id === id)!;
const am = (...a: Amend[]) => new Set<Amend>(a);

describe('the growth lab', () => {
  it('grows well in potting soil and a nutrient solution', () => {
    for (const p of PLANTS) {
      expect(grow(REFERENCE[0], p, am()).rate).toBeGreaterThan(0.75);
      expect(grow(REFERENCE[1], p, am()).rate).toBeGreaterThan(0.75);
    }
  });
  it('Mars ground kills a plant until its perchlorate is washed out; then, given compost, crops grow', () => {
    const mars = soilOfSample(body('Mars'), 'Mars', 'basaltic sand', '0°N 0°E', 1);
    const raw = grow(mars, plant('radish'), am());
    expect(raw.dies).toBe(true);
    expect(raw.limits.join()).toMatch(/perchlorate/);
    const fixed = grow(mars, plant('radish'), am('rinse', 'compost'));
    expect(fixed.dies).toBe(false);
    expect(fixed.rate).toBeGreaterThan(0.5);
  });
  it('the Moon\'s regolith, given nutrients, grows cress slowly and stressed, as the Apollo soil did', () => {
    const moon = soilOfSample(body('Moon'), 'Moon', 'mare basalt', '0°N 23°E', 1);
    expect(grow(moon, plant('cress'), am()).rate).toBeLessThan(0.15);
    const fed = grow(moon, plant('cress'), am('npk'));
    expect(fed.dies).toBe(false);
    expect(fed.rate).toBeGreaterThan(0.25);
    expect(fed.rate).toBeLessThan(0.7);
    expect(fed.stress).toBe('purple');
  });
  it('a legume with rhizobia makes its own nitrogen', () => {
    const washed = REFERENCE.find(s => s.id === 'mgs')!;
    expect(grow(washed, plant('pea'), am('rhizo')).rate).toBeGreaterThan(grow(washed, plant('pea'), am()).rate * 3);
    expect(grow(washed, plant('wheat'), am('rhizo')).rate).toBeCloseTo(grow(washed, plant('wheat'), am()).rate, 6);
  });
  it('runs at a day a minute, and grows to its time', () => {
    const gl = new GrowLab();
    gl.draft = { base: 1, k: 0, soil: 0, plant: PLANTS.findIndex(p => p.id === 'radish'), amends: am() };
    gl.sow(0);
    const ch = gl.chambers(1)[0]!;
    expect(gl.state(ch, 14 / DAYS_PER_YEAR).frac).toBeCloseTo(0.5, 5);
    const done = gl.state(ch, 28 / DAYS_PER_YEAR);
    expect(done.done).toBe(true);
    expect(done.yield).toBe(100);
  });
  it('a harvest is food for the crew, as much as the crop was good; an unripe or dead one is none', () => {
    const gl = new GrowLab();
    gl.draft = { base: 1, k: 0, soil: 0, plant: PLANTS.findIndex(p => p.id === 'potato'), amends: am() };
    gl.sow(0);
    expect(gl.harvest(1, 0, 10 / DAYS_PER_YEAR)).toBeNull();
    expect(gl.chambers(1)[0]).toBeNull();
    gl.draft = { base: 1, k: 1, soil: 0, plant: PLANTS.findIndex(p => p.id === 'potato'), amends: am() };
    gl.sow(0);
    const h = gl.harvest(1, 1, 90 / DAYS_PER_YEAR)!;
    expect(h.yield).toBe(100);
    expect(h.days).toBe(plant('potato').food);
    expect(gl.chambers(1)[1]).toBeNull();
  });
  it('analysed samples go on the shelf', () => {
    const gl = new GrowLab();
    gl.addSample(body('Mars'), 'Mars', 'basaltic sand', '18°N 77°E');
    expect(gl.soils().length).toBe(REFERENCE.length + 1);
    expect(gl.soils().at(-1)!.rows!.length).toBeGreaterThan(0);
  });
});

describe('grass', () => {
  it('grows where the Earth\'s ground is green, not on sand, rock or a lifeless world', () => {
    expect(grassiness(0.3, 0.37, 0.19, 0.3, null, 1)).toBeGreaterThan(0.9);
    expect(grassiness(0.6, 0.5, 0.35, 0.2, null, 1)).toBe(0);
    expect(grassiness(0.3, 0.37, 0.19, 0.95, null, 1)).toBe(0);
    expect(grassiness(0.3, 0.37, 0.19, 0.3, null, 0)).toBe(0);
  });
});
