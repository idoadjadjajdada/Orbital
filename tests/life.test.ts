import { describe, it, expect } from 'vitest';
import { buildPreset } from '../src/physics/presets';
import { makeBody } from '../src/physics/catalog';
import { biosphereOf, speciesAt, biomeOf, type LifeFacts } from '../src/three/life';
import { SITES, sitesOn } from '../src/three/sites';

const solar = buildPreset('solar');
const real = (n: string) => solar.bodies.find(b => b.look.real === n)!;
const REALS = new Set(solar.bodies.map(b => b.look.real).filter((n): n is string => !!n));

const EARTHLIKE: LifeFacts = { surfaceK: 290, surfaceBar: 1, gases: [{ formula: 'N₂', frac: 0.78 }, { formula: 'O₂', frac: 0.21 }], g: 1, starTeff: 5772 };
const COLD: LifeFacts = { surfaceK: 100, surfaceBar: 0, gases: [], g: 0.13, starTeff: 5772 };
const RANK = ['none', 'prebiotic', 'microbial', 'simple', 'complex', 'civilisation'];

describe('life', () => {
  it('knows Earth is inhabited, and by whom', () => {
    const bio = biosphereOf(real('Earth'), { ...EARTHLIKE, surfaceK: 288 });
    expect(bio.level).toBe('civilisation');
    expect(bio.confidence).toBe('confirmed');
    expect(bio.species.length).toBeGreaterThanOrEqual(30);
    expect(new Set(bio.species.map(s => s.id)).size).toBe(bio.species.length);
    expect(bio.species.some(s => s.name === 'Homo sapiens')).toBe(true);
    expect(speciesAt(bio, 'ocean', 0.5)?.kind).not.toBe('microbe');
  });

  it('says what is and is not known in the solar system', () => {
    const mars = biosphereOf(real('Mars'), { surfaceK: 210, surfaceBar: 0.006, gases: [{ formula: 'CO₂', frac: 0.95 }], g: 0.38, starTeff: 5772 });
    expect(mars.confidence).toBe('none');
    expect(mars.habitable).toBe(false);
    expect(mars.species).toEqual([]);
    const europa = biosphereOf(real('Europa'), COLD);
    expect(europa.confidence).toBe('possible');
    expect(europa.where).toBe('subsurface ocean');
    expect(biosphereOf(real('Moon'), COLD).level).toBe('none');
  });

  it('invents the same life from the same seed, and different life from another', () => {
    const names = (seed: number) => biosphereOf(makeBody('terran', seed), EARTHLIKE).species.map(s => s.name);
    expect(names(42)).toEqual(names(42));
    expect(names(42)).not.toEqual(names(43));
  });

  it('gives an oxygen-rich Earth-like world at least simple life', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const bio = biosphereOf(makeBody('terran', seed), EARTHLIKE);
      expect(RANK.indexOf(bio.level)).toBeGreaterThanOrEqual(RANK.indexOf('simple'));
      expect(bio.habitable).toBe(true);
      expect(new Set(bio.species.map(s => s.id)).size).toBe(bio.species.length);
    }
  });

  it('paints plants under a red dwarf in something other than green', () => {
    let flora = 0, green = 0;
    for (let seed = 1; seed <= 10; seed++) {
      for (const s of biosphereOf(makeBody('terran', seed), { ...EARTHLIKE, starTeff: 3200 }).species) {
        if (s.kind !== 'flora' || s.form.shape === 'reef') continue;
        const c = s.form.color, r = c >> 16, g = (c >> 8) & 255, b = c & 255;
        flora++;
        if (g > r && g > b) green++;
      }
    }
    expect(flora).toBeGreaterThan(20);
    expect(green / flora).toBeLessThan(0.2);
  });

  it('finds nothing on an airless rock', () => {
    const rock = makeBody('moon', 7);
    expect(rock.look.style).toBe('barren');
    const bio = biosphereOf(rock, { surfaceK: 250, surfaceBar: 0, gases: [], g: 0.16, starTeff: 5772 });
    expect(bio.level).toBe('none');
    expect(bio.species).toEqual([]);
    expect(speciesAt(bio, 'rock', 0.3)).toBeNull();
  });

  it('reads biomes from the map', () => {
    expect(biomeOf([0.1, 0.2, 0.5], true, 0, -100, 288)).toBe('ocean');
    expect(biomeOf([0.9, 0.9, 0.92], false, 80, 1000, 288)).toBe('ice');
    expect(biomeOf([0.03, 0.08, 0.02], false, 10, 200, 288)).toBe('forest');
    expect(biomeOf([0.6, 0.45, 0.25], false, 20, 300, 288)).toBe('desert');
    expect(biomeOf([0.3, 0.3, 0.3], false, 30, 4500, 288)).toBe('mountain');
  });
});

describe('sites', () => {
  it('places every site on a real body, in range', () => {
    for (const s of SITES) {
      expect(REALS.has(s.body), s.body).toBe(true);
      expect(Math.abs(s.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(s.lon)).toBeLessThanOrEqual(180);
    }
  });

  it('puts Apollo 11 at Tranquility Base', () => {
    const a11 = sitesOn('Moon').find(s => s.name.startsWith('Apollo 11'))!;
    expect(Math.abs(a11.lat - 0.674)).toBeLessThan(0.1);
    expect(Math.abs(a11.lon - 23.473)).toBeLessThan(0.1);
    expect(sitesOn('Earth').filter(s => s.kind === 'city').length).toBeGreaterThanOrEqual(40);
  });
});
