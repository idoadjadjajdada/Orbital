import { Body } from './body';
import type { World } from './world';
import { makeBody, refreshRoche, type Extra } from './catalog';
import { G, KM, KMS, schwarzschild } from './units';
import { addTorus } from './disks';
import { newStar, structure, teffOf } from './stellar';
import { spawnFragments } from './events';

/** the Eddington accretion rate, M☉/yr per M☉ of hole, at 10% efficiency */
export const EDD = 2.2e-8;

/**
 * Some objects only do what they are known for in the right surroundings: a
 * quasar needs gas to eat, an X-ray binary a companion overflowing onto it, a
 * kilonova a second neutron star. These place that surroundings with the body,
 * already set going, so it arrives doing what it does. `span` is a distance in
 * AU the caller can see, for things (a wormhole's other mouth) that need room.
 */
export function placeExtras(w: World, b: Body, x: Extra, span: number): Body[] {
  const before = new Set(w.bodies);
  switch (x.kind) {
    case 'agn': {
      const rs = schwarzschild(b.m);
      // the ring's axis, tilted from the line of sight (the view looks down z)
      const t = (x.tilt * Math.PI) / 180, ph = Math.random() * 2 * Math.PI;
      const n: [number, number, number] = [Math.sin(t) * Math.cos(ph), Math.sin(t) * Math.sin(ph), Math.cos(t)];
      addTorus(w, b, 40 * rs, 400 * rs, 1e-4 * b.m, 1200, n, 0.6);
      feedFrom(b, x.edd, n);
      break;
    }
    case 'feed':
      feedFrom(b, x.edd, [0, 0, 1]);
      break;
    case 'donor': {
      const d = makeBody(x.star, Math.floor(Math.random() * 1e9), 'Donor star');
      d.star = newStar(x.m0, x.age);
      const st = structure(d.star);
      d.m = st.m; d.r = st.r; d.star.L = st.L; d.star.phase = st.phase; d.star.teff = teffOf(st.L, st.r);
      refreshRoche(d);
      // just past filling its Roche lobe (Eggleton 1983), so the stream starts at once
      const q = d.m / b.m, q3 = Math.cbrt(q), q23 = q3 * q3;
      const rL = 0.49 * q23 / (0.6 * q23 + Math.log(1 + q3));
      const a = d.r / (rL * 1.015);
      binary(w, b, d, a);
      // the disc the stream has already built round the compact object, out to
      // where the gas circularizes, and the inner part of it already feeding
      addTorus(w, b, 0.02 * a, 0.3 * a, 1e-6 * d.m, 300, [0, 0, 1], 0.8);
      feedFrom(b, x.edd, [0, 0, 1]);
      break;
    }
    case 'twin': {
      const c = makeBody(b.kind, Math.floor(Math.random() * 1e9));
      c.name = `${b.name} B`;
      b.name = `${b.name} A`;
      c.m = b.m; c.r = b.r;
      binary(w, b, c, x.sepKm * KM);
      break;
    }
    case 'shell': {
      // thrown off earlier: a thin shell coasting outward, thinning as it goes
      spawnFragments(w, { mass: x.m, n: 700, cls: 'gasp', x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz,
        rIn: 0.85 * x.r, rOut: x.r, vMin: 0.8 * x.v * KMS, vMax: 1.1 * x.v * KMS, heat: 0.5, color: x.color });
      break;
    }
    case 'dust': {
      // Σ ∝ 1/r, on near-circular orbits with a little random motion: it settles
      // and, where tides allow, gathers into planetesimals by itself
      const n = 1500, made: Body[] = [];
      for (let k = 0; k < n; k++) {
        const r = x.rIn * Math.pow(x.rOut / x.rIn, Math.random());
        const ph = 2 * Math.PI * Math.random();
        const vc = Math.sqrt((G * b.m) / r) * (1 + (Math.random() - 0.5) * 0.02);
        const p = new Body({ name: 'fragment', kind: 'fragment', cls: 'debris', m: x.m / n, r: 0, source: false, spin: 0,
          look: { style: 'rocky', seed: k, c1: 0xa08868, c2: 0xa08868 } });
        p.setPos(b.x + r * Math.cos(ph), b.y + r * Math.sin(ph), b.z + (Math.random() - 0.5) * 0.02 * r);
        p.setVel(b.vx - vc * Math.sin(ph), b.vy + vc * Math.cos(ph), b.vz);
        p.dens = 1.5;
        made.push(p);
      }
      for (const p of made) w.add(p);
      break;
    }
    case 'wormhole': {
      const o = makeBody('wormhole', Math.floor(Math.random() * 1e9), 'Wormhole B');
      b.name = 'Wormhole A';
      const ph = Math.random() * 2 * Math.PI;
      o.setPos(b.x + span * Math.cos(ph), b.y + span * Math.sin(ph), b.z);
      o.setVel(b.vx, b.vy, b.vz);
      b.partnerId = o.id; o.partnerId = b.id;
      w.add(o);
      break;
    }
  }
  w.structural();
  return w.bodies.filter(q => !before.has(q));
}

/** an unresolved inner disc already falling in, at this Eddington fraction, with its spin along n */
function feedFrom(b: Body, edd: number, n: [number, number, number]) {
  b.feed = edd * EDD * b.m;
  // enough for a long while: ten thousand years at this rate, or a millionth of the hole
  b.feedLeft = Math.max(b.feed * 1e4, 1e-6 * b.m);
  b.lx = n[0]; b.ly = n[1]; b.lz = n[2];
}

/** put `c` on a circular orbit with `b`, keeping where `b` was and how it moved as their centre of mass */
function binary(w: World, b: Body, c: Body, a: number) {
  const M = b.m + c.m, v = Math.sqrt((G * M) / a);
  const ph = Math.random() * 2 * Math.PI, ux = Math.cos(ph), uy = Math.sin(ph);
  const cx = b.x, cy = b.y, cz = b.z, vx = b.vx, vy = b.vy, vz = b.vz;
  b.setPos(cx - ux * a * c.m / M, cy - uy * a * c.m / M, cz);
  c.setPos(cx + ux * a * b.m / M, cy + uy * a * b.m / M, cz);
  b.setVel(vx + uy * v * c.m / M, vy - ux * v * c.m / M, vz);
  c.setVel(vx - uy * v * b.m / M, vy + ux * v * b.m / M, vz);
  w.moved(b);
  w.add(c);
}
