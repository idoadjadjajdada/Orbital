import { describe, it, expect } from 'vitest';
import { buildPreset } from '../src/physics/presets';
import { AU_M } from '../src/physics/units';
import { atmosphere, gravity } from '../src/three/science';
import { groundSpec, groundAt, type GroundSample } from '../src/three/terrain';
import { formsNear, formGeometry } from '../src/three/landforms';
import { caveNet, caveFloorAt, caveSurface, inRamp } from '../src/three/caves';

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
  it('a cave is under the land: a ramp down from it, passages with rock over their roofs, floors you can walk', () => {
    // a hillside, rising away from the mouth
    const land = (x: number, z: number) => -z * 0.15 + Math.sin(x * 0.05) * 2;
    for (const [seed, lava] of [[1234, false], [77, false], [9, true]] as const) {
      const net = caveNet(seed, lava, false, land);
      const ramp = net.segs.filter(s => s.ramp), deep = net.segs.filter(s => !s.ramp);
      expect(ramp.length).toBeGreaterThan(1);
      expect(deep.length).toBeGreaterThan(3);
      // the mouth is at the land; every other roof is under it, with rock over it
      const m = net.nodes[0];
      expect(Math.abs(m.y - (land(m.x, m.z) - 0.3))).toBeLessThan(1e-6);
      const rampNodes = new Set(ramp.flatMap(s => [s.i, s.j]));
      for (const s of deep) for (const k of [s.i, s.j]) {
        if (rampNodes.has(k)) continue;
        const p = net.nodes[k];
        expect(p.y + s.fl + s.up, `seed ${seed}`).toBeLessThan(land(p.x, p.z) - 2.5);
      }
      // no floor steeper than a walk
      for (const s of net.segs) {
        const a = net.nodes[s.i], b = net.nodes[s.j];
        expect(Math.abs(b.y - a.y) / Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.45);
      }
      // in at the mouth, then deep inside: a floor, and a roof well over it
      const at = (k: number) => caveFloorAt(net, net.nodes[k].x, net.nodes[k].y + 0.6, net.nodes[k].z);
      expect(at(0)).not.toBeNull();
      const far = net.nodes.reduce((b, n, k) => (n.d > net.nodes[b].d ? k : b), 0);
      expect(at(far)!.roof - at(far)!.floor).toBeGreaterThan(2.5);
      expect(net.nodes[far].y).toBeLessThan(land(net.nodes[far].x, net.nodes[far].z) - 5);
      // walking the land over a deep passage, you stay on the land
      const p = net.nodes[far];
      expect(caveFloorAt(net, p.x, land(p.x, p.z) + 0.6, p.z)).toBeNull();
      // the land is cut away over the ramp's mouth, and nowhere over the deep passages
      const r = net.nodes[ramp[1].i];
      expect(inRamp(net, r.x, land(r.x, r.z) - 0.05, r.z)).toBe(true);
      expect(inRamp(net, p.x, land(p.x, p.z), p.z)).toBe(false);
      // the rock: one surface, all its numbers whole
      const g = caveSurface(net, land, 5);
      expect(g.pos.length / 3).toBeGreaterThan(2000);
      expect(g.pos.every(Number.isFinite)).toBe(true);
      expect(g.idx.length % 3).toBe(0);
      expect(Math.max(...g.idx)).toBeLessThan(g.pos.length / 3);
      // dark deep in, light at the mouth
      expect(Math.max(...g.sky)).toBeGreaterThan(0.6);
      expect(Math.min(...g.sky)).toBeLessThan(0.05);
    }
  });
  it('every cave, on any land: walkable floors, rock over its passages', () => {
    const lands = [() => 0, (x: number, z: number) => z * 0.12 + Math.sin(x * 0.2) * 3, (x: number, z: number) => 8 * Math.sin(x * 0.04) * Math.cos(z * 0.05)];
    for (const land of lands) for (let k = 0; k < 24; k++) {
      const net = caveNet(k * 97 + 1, k % 4 === 0, false, land);
      const rampNodes = new Set(net.segs.filter(s => s.ramp).flatMap(s => [s.i, s.j]));
      for (const s of net.segs) {
        const a = net.nodes[s.i], b = net.nodes[s.j];
        expect(Math.abs(b.y - a.y) / Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.43);
        if (!s.ramp) for (const q of [s.i, s.j]) if (!rampNodes.has(q)) expect(net.nodes[q].y + s.fl + s.up).toBeLessThan(land(net.nodes[q].x, net.nodes[q].z) - 2.5);
      }
    }
  });
  it('builds every kind in every rock without a hole in its numbers', () => {
    for (const kind of ['arch', 'hoodoo', 'spire', 'shelter', 'cave'] as const) for (const rock of ['sandstone', 'ice', 'basalt'] as const) {
      const g = formGeometry({ key: 'k', kind, rock, n: [1, 0, 0], h0: 0, head: 1, size: 20, seed: 77, name: '', about: '' });
      expect((g.getAttribute('position').array as Float32Array).every(Number.isFinite), `${kind} ${rock}`).toBe(true);
      expect((g.getAttribute('normal').array as Float32Array).every(Number.isFinite), `${kind} ${rock}`).toBe(true);
    }
  });
});
