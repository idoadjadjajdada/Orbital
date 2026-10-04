import { describe, it, expect } from 'vitest';
import { World } from '../src/physics/world';
import { makeBody, ENTRY } from '../src/physics/catalog';
import { placeExtras } from '../src/physics/extras';
import { Feeding } from '../src/physics/feeding';

/** watch `secs` seconds pass in steps of 1/30 s, `dtSim` years of simulated time each */
function watch(f: Feeding, w: World, secs: number, each: (t: number) => void = () => {}) {
  for (let t = 0; t < secs; t += 1 / 30) { f.update(w, 1e-6, 1 / 30); each(t); }
}

describe('a black hole\'s disc builds up from what it swallows', () => {
  it('has none while it has eaten nothing', () => {
    const w = new World(), f = new Feeding();
    const b = makeBody('bh', 1); w.add(b);
    watch(f, w, 5);
    expect(f.level(b)).toBe(0);
    expect(f.get(b)).toBeNull();
  });

  it('brightens over seconds after a meal, not at once, then fades', () => {
    const w = new World(), f = new Feeding();
    const b = makeBody('bh', 1); w.add(b);
    // a Jupiter's worth falls in, bringing spin about the x axis
    b.swallowed = 1e-3; b.lx = 1;
    f.update(w, 1e-6, 1 / 30);
    expect(f.level(b)).toBeLessThan(0.05);
    let peak = 0, peakT = 0;
    watch(f, w, 120, t => { if (f.level(b) > peak) { peak = f.level(b); peakT = t; } });
    expect(peak).toBeGreaterThan(0.3);
    expect(peakT).toBeGreaterThan(2);
    expect(f.level(b)).toBeLessThan(peak * 0.6);
    // and it lies across the spin that fell in
    expect(f.get(b)!.axis[0]).toBeCloseTo(1, 6);
  });

  it('lights jets only once the disc has been bright a while', () => {
    const w = new World(), f = new Feeding();
    const b = makeBody('bh', 1); w.add(b);
    b.swallowed = 1;
    let jetAt = -1, brightAt = -1;
    watch(f, w, 30, t => {
      const s = f.get(b)!;
      if (brightAt < 0 && s.level > 0.45) brightAt = t;
      if (jetAt < 0 && s.jet > 0.3) jetAt = t;
    });
    expect(brightAt).toBeGreaterThan(0);
    expect(jetAt).toBeGreaterThan(brightAt);
  });

  it('starts established round a hole that comes with its gas, as TON 618 does', () => {
    const w = new World(), f = new Feeding();
    const b = makeBody('ton618', 1); w.add(b);
    placeExtras(w, b, ENTRY.get('ton618')!.extra!, 1);
    f.update(w, 1e-6, 1 / 30);
    expect(f.level(b)).toBeGreaterThan(0.8);
    expect(f.get(b)!.jet).toBeGreaterThan(0.9);
  });
});
