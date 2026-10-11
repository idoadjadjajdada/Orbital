import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildPreset } from '../src/physics/presets';
import { Fleet } from '../src/three/fleet';

const earthFleet = () => {
  const solar = buildPreset('solar');
  const stars = solar.sources.filter(b => b.cls === 'star');
  const f = new Fleet(new THREE.Scene(), () => stars);
  f.fixtures(solar.sources);
  const find = (p: (c: Fleet['crafts'][number]) => boolean) => f.crafts.find(p)!;
  return {
    f,
    iss: find(c => c.kind === 'station'),
    pad: find(c => c.kind === 'pad' && /Canaveral/.test(c.name)),
    wayfarer: find(c => c.rocket?.kind === 'wayfarer'),
    mammoth: find(c => c.rocket?.kind === 'mammoth'),
  };
};

describe('retiring a craft', () => {
  it('will not strand a rocket on the pad it stands on, nor one flying to or from a site', () => {
    const { f, iss, pad, wayfarer } = earthFleet();
    expect(f.retire(pad)).toMatch(/Wayfarer 1 is on Canaveral Launch Pad/);
    expect(f.crafts).toContain(pad);
    expect(f.fly(wayfarer, iss)).toBe('');
    expect(f.retire(iss)).toMatch(/flying to ISS/);
    expect(f.retire(pad)).toMatch(/flying from Canaveral Launch Pad/);
    for (let k = 0; k < 100 && wayfarer.rocket!.trip; k++) f.step(50);
    expect(wayfarer.status).toBe('docked at ISS');
    expect(f.retire(iss)).toMatch(/docked at ISS/);
    // the pad it left is free now; it can still fly back somewhere
    expect(f.retire(pad)).toBe('');
    expect(f.crafts).not.toContain(pad);
    expect(f.fly(wayfarer, f.crafts.find(c => c.kind === 'base')!)).toBe('');
  });
});

describe('a rover on a rocket', () => {
  it('stays aboard at a station, and rolls out where the rocket next lands', () => {
    const { f, iss, mammoth } = earthFleet();
    const rovers = () => f.crafts.filter(c => c.kind === 'rover').length;
    const home = f.byId(mammoth.rocket!.at!)!;
    mammoth.rocket!.load.rover = true;
    expect(f.fly(mammoth, iss)).toBe('');
    for (let k = 0; k < 100 && mammoth.rocket!.trip; k++) f.step(50);
    expect(mammoth.status).toBe('docked at ISS');
    expect(rovers()).toBe(0);
    expect(mammoth.rocket!.load.rover).toBe(true);
    expect(mammoth.log.at(-1)!.msg).toMatch(/rover stays aboard/);
    expect(f.fly(mammoth, home)).toBe('');
    for (let k = 0; k < 100 && mammoth.rocket!.trip; k++) f.step(50);
    expect(mammoth.state).toBe('surface');
    expect(rovers()).toBe(1);
    expect(mammoth.rocket!.load.rover).toBe(false);
  });
});
