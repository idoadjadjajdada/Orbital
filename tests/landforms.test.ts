import { describe, it, expect } from 'vitest';
import { buildPreset } from '../src/physics/presets';
import { AU_M } from '../src/physics/units';
import { atmosphere, gravity } from '../src/three/science';
import { groundSpec, groundAt, type GroundSample } from '../src/three/terrain';
import { formsNear, cavePath, caveFloor, formSolid, formGeometry, type Form } from '../src/three/landforms';

const solar = buildPreset('solar');
const stars = solar.sources.filter(b => b.cls === 'star');
const D = Math.PI / 180;
const dir = (la: number, lo: number): [number, number, number] => [Math.cos(la * D) * Math.cos(lo * D), Math.cos(la * D) * Math.sin(lo * D), Math.sin(la * D)];
const world = (name: string) => {
  const b = solar.sources.find(x => x.name === name)!;
  const s = groundSpec(b.look, b.r * AU_M, gravity(b), atmosphere(b, stars).bar);
  const smp: GroundSample = { h: 0, r: 0, g: 0, b: 0, sea: false, rock: 0 };
  return { s, sample: (n: [number, number, number], f: number) => { groundAt(s, n, f, smp); return smp; } };
};

describe('arches, spires, overhangs and caves', () => {
  it('stand in the same places every time, whichever way you come', () => {
    const { s, sample } = world('Mars');
    const a = formsNear(s, dir(18.4, 77.4), 2500, sample).map(f => f.key).sort();
    const b = formsNear(s, dir(18.41, 77.41), 2500, sample).map(f => f.key);
    expect(a.length).toBeGreaterThan(3);
    // the cells both searches cover hold the same forms
    expect(a.filter(k => b.includes(k)).length).toBeGreaterThan(a.length / 2);
    expect(formsNear(s, dir(18.4, 77.4), 2500, sample).map(f => f.key).sort()).toEqual(a);
  });
  it('come from the setting: sandstone on Mars, lava tubes in the Moon’s maria, ice on Europa, none at sea', () => {
    const mars = world('Mars'), moon = world('Moon'), europa = world('Europa'), earth = world('Earth');
    expect(formsNear(mars.s, dir(18.4, 77.4), 2500, mars.sample).every(f => f.rock === 'sandstone')).toBe(true);
    expect(formsNear(mars.s, dir(18.4, 77.4), 3000, mars.sample).some(f => f.kind === 'arch' || f.kind === 'hoodoo')).toBe(true);
    const tubes = formsNear(moon.s, dir(0.674, 23.47), 3000, moon.sample);
    expect(tubes.some(f => f.kind === 'cave' && f.name === 'A lava tube')).toBe(true);
    expect(formsNear(europa.s, dir(10, 10), 3000, europa.sample).every(f => f.rock === 'ice')).toBe(true);
    expect(formsNear(earth.s, dir(30, -40), 3000, earth.sample).length).toBe(0);
  });
  it('a cave has a floor to walk on inside, walls round it, and a hill over it', () => {
    const f: Form = { key: 'k', kind: 'cave', rock: 'limestone', n: [0, 0, 1], h0: 0, head: 0, size: 32, seed: 1234, name: 'A cave', about: '' };
    const P = cavePath(f);
    // just inside the mouth, and in the chamber at the end
    const mouth = P.pts[2], deep = P.pts[P.pts.length - 4];
    expect(caveFloor(P, mouth.x, mouth.z)).not.toBeNull();
    expect(caveFloor(P, deep.x, deep.z)!.roof).toBeGreaterThan(2.5);
    expect(formSolid(f, mouth.x, 0.5, mouth.z, P)).toBe(false);
    // beside the tunnel, in the hill: rock
    expect(formSolid(f, mouth.x + 8, 0.5, mouth.z - 6, P)).toBe(true);
    const g = formGeometry(f);
    expect(g.getAttribute('position').count).toBeGreaterThan(500);
    expect((g.getAttribute('position').array as Float32Array).every(Number.isFinite)).toBe(true);
  });
  it('builds every kind in every rock without a hole in its numbers', () => {
    for (const kind of ['arch', 'hoodoo', 'spire', 'shelter', 'cave'] as const) for (const rock of ['sandstone', 'ice', 'basalt'] as const) {
      const g = formGeometry({ key: 'k', kind, rock, n: [1, 0, 0], h0: 0, head: 1, size: 20, seed: 77, name: '', about: '' });
      expect((g.getAttribute('position').array as Float32Array).every(Number.isFinite), `${kind} ${rock}`).toBe(true);
      expect((g.getAttribute('normal').array as Float32Array).every(Number.isFinite), `${kind} ${rock}`).toBe(true);
    }
  });
});
