import { buildPreset, PRESETS } from '../src/physics/presets';
import { energy } from '../src/physics/integrator';

// Physics benchmark, per preset at its default warp (run with `node bench/run.mjs`; PRESETS=a,b picks presets):
//  - cost: wall time for 60 frames' worth of simulated time with no deadline, so the same work old and new;
//  - frames: 120 frames with app.ts's 11 ms budget, how much of the asked-for time they cover and the slowest frame.
const KEYS = (process.env.PRESETS ?? 'solar,inner,kirkwood,saturn,quasar,xrb,tde,sgra').split(',');
for (const key of KEYS) {
  const warp = PRESETS.find(p => p.key === key)!.warp;
  let w = buildPreset(key);
  w.step(warp / 60, Infinity); // warm-up
  const E0 = energy(w.bodies);
  let t0 = performance.now();
  for (let f = 0; f < 60; f++) w.step(warp / 60, Infinity);
  const cost = (performance.now() - t0) / 60;
  const dE = (energy(w.bodies) - E0) / Math.abs(E0);

  w = buildPreset(key);
  w.step(warp / 60, performance.now() + 11);
  let sim = 0, worst = 0;
  for (let f = 0; f < 120; f++) {
    const s = performance.now();
    sim += w.step(warp / 60, s + 11);
    worst = Math.max(worst, performance.now() - s);
  }
  console.log(`${key.padEnd(9)} n=${String(w.bodies.length).padStart(5)}  cost ${cost.toFixed(1).padStart(6)} ms/frame  covered ${(100 * sim / (2 * warp)).toFixed(0).padStart(3)}%  worst ${worst.toFixed(0).padStart(3)} ms  dE/E ${dE.toExponential(1)}`);
}
