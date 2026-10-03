import { describe, it, expect } from 'vitest';
import { buildPreset } from '../src/physics/presets';
import { buildMap } from '../src/pixel/surface';
import { terrainSrc, heightAt, buildPatch, dirOf, offsetDir } from '../src/three/terrain';

describe('terrain', () => {
  const w = buildPreset('solar');
  const get = (n: string) => w.sources.find(b => b.name === n)!;
  const earth = terrainSrc(get('Earth'), buildMap(get('Earth').look, 512));
  const moon = terrainSrc(get('Moon'), buildMap(get('Moon').look, 512));
  const mars = terrainSrc(get('Mars'), buildMap(get('Mars').look, 512));
  it('puts the seas at sea level and the Himalaya kilometres up', () => {
    expect(heightAt(earth, dirOf(0, -30))).toBe(0);              // mid-Atlantic
    expect(heightAt(earth, dirOf(30, 85))).toBeGreaterThan(2500); // Tibet
    expect(heightAt(earth, dirOf(51.5, -0.1))).toBeLessThan(800); // London
  });
  it('raises Olympus Mons far above the Martian plains', () => {
    expect(heightAt(mars, dirOf(18.65, -133.8)) - heightAt(mars, dirOf(40, 10))).toBeGreaterThan(8000);
  });
  it('is continuous: a step of a metre changes the height by much less than a metre on the plains', () => {
    const c = dirOf(0.674, 23.473);
    let worst = 0;
    for (let k = 0; k < 50; k++) {
      const a = offsetDir(c, k * 37, k * 11, moon.R), b = offsetDir(c, k * 37 + 1, k * 11, moon.R);
      worst = Math.max(worst, Math.abs(heightAt(moon, a, 0.5) - heightAt(moon, b, 0.5)));
    }
    expect(worst).toBeLessThan(1.5);
  });
  it('builds a patch quickly enough for a worker, with no NaN', () => {
    const t0 = performance.now();
    const p = buildPatch(moon, dirOf(0.674, 23.473), 20000, 129, 1);
    const ms = performance.now() - t0;
    expect(p.pos.every(Number.isFinite) && p.nor.every(Number.isFinite) && p.col.every(Number.isFinite)).toBe(true);
    expect(ms).toBeLessThan(3000);

  });
});
