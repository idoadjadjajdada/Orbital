import { describe, it, expect } from 'vitest';
import { Body } from '../src/physics/body';
import { World } from '../src/physics/world';
import { energy } from '../src/physics/integrator';
import { G, C, M_EARTH, M_JUP, R_EARTH, KMS, schwarzschild, R_SUN } from '../src/physics/units';
import { stateFromElements, osculating, elementsDeg, relative, norm } from '../src/physics/orbit';
import { lagrangePoints, assignHosts } from '../src/physics/analysis';
import { makeBody } from '../src/physics/catalog';
import { msLife, zamsL } from '../src/physics/stellar';
import { buildPreset } from '../src/physics/presets';
import { MOONS } from '../src/physics/data/moons';

const FOREVER = Number.POSITIVE_INFINITY;

function point(name: string, m: number, r = 1e-5, source = true) {
  return new Body({ name, kind: 'test', cls: 'rock', look: { style: 'rocky', seed: 1, c1: 0, c2: 0 }, m, r, source });
}

function orbiting(host: Body, b: Body, a: number, e: number, i = 0, M = 0) {
  const mu = G * (host.m + b.m);
  const { r, v } = stateFromElements(mu, { a, e, i, node: 0, peri: 0, M });
  b.setPos(host.x + r[0], host.y + r[1], host.z + r[2]);
  b.setVel(host.vx + v[0], host.vy + v[1], host.vz + v[2]);
  return b;
}

function centreOfMass(w: World) {
  let px = 0, py = 0, pz = 0, m = 0;
  for (const b of w.bodies) if (b.alive) { px += b.m * b.vx; py += b.m * b.vy; pz += b.m * b.vz; m += b.m; }
  return { px, py, pz, m };
}

function run(w: World, T: number, chunk = T) {
  let t = 0;
  while (t < T - 1e-15) t += w.step(Math.min(chunk, T - t), FOREVER);
}

describe('integrator', () => {
  it('keeps a circular Earth orbit to Kepler’s period and conserves energy', () => {
    const w = new World();
    w.integ.gr = false;
    const sun = point('sun', 1, 0.00465);
    const earth = orbiting(sun, point('earth', M_EARTH, R_EARTH), 1, 0);
    w.add(sun); w.add(earth);
    const E0 = energy(w.bodies, false);
    const P = 2 * Math.PI * Math.sqrt(1 / (G * (1 + M_EARTH)));
    run(w, 100 * P, P / 7);
    const { r } = relative(earth, sun);
    const E1 = energy(w.bodies, false);
    expect(Math.abs((E1 - E0) / E0)).toBeLessThan(1e-7);
    // back where it started after exactly 100 periods
    expect(Math.hypot(r[0] - 1, r[1], r[2])).toBeLessThan(1e-5);
  });

  it('holds energy through a 0.95-eccentricity orbit', () => {
    const w = new World();
    w.integ.gr = false;
    const sun = point('sun', 1, 0.00465);
    const comet = orbiting(sun, point('comet', 1e-12, 1e-8), 3, 0.95);
    w.add(sun); w.add(comet);
    const E0 = energy(w.bodies, false);
    const P = 2 * Math.PI * Math.sqrt(27 / G);
    run(w, 30 * P, 0.37);
    const o = osculating(G * sun.m, ...([relative(comet, sun).r, relative(comet, sun).v] as const));
    expect(Math.abs((energy(w.bodies, false) - E0) / E0)).toBeLessThan(3e-6);
    expect(Math.abs(o.a - 3)).toBeLessThan(1e-5);
    expect(Math.abs(o.e - 0.95)).toBeLessThan(1e-6);
  });

  it('runs the inner solar system, moons and all, for a year without drift', () => {
    const w = buildPreset('inner');
    const E0 = energy(w.bodies);
    run(w, 1, 1 / 50);
    expect(Math.abs((energy(w.bodies) - E0) / E0)).toBeLessThan(1e-8);
    const earth = w.bodies.find(b => b.name === 'Earth')!;
    const moon = w.bodies.find(b => b.name === 'Moon')!;
    const d = norm(relative(moon, earth).r);
    expect(d).toBeGreaterThan(0.0023);
    expect(d).toBeLessThan(0.0029);
  });
});

describe('relativity', () => {
  function precessionPerOrbit(gr: boolean, M: number, a: number, e: number, orbits: number) {
    const w = new World();
    w.integ.gr = gr; w.integ.gw = false;
    const host = point('hole', M, 1e-9);
    const b = orbiting(host, point('star', 1e-9, 1e-9), a, e);
    w.add(host); w.add(b);
    const P = 2 * Math.PI * Math.sqrt(a ** 3 / (G * M));
    run(w, orbits * P, P / 5);
    const { r, v, mu } = relative(b, host);
    const o = osculating(mu, r, v);
    return Math.atan2(o.evec[1], o.evec[0]) / orbits;
  }

  it('advances periapsis by 6πGM/(c²a(1−e²)) per orbit', () => {
    // far enough out that the osculating elements' own wobble is small next
    // to what accumulates over forty orbits
    const M = 1e6, a = 1000, e = 0.5;
    const want = (6 * Math.PI * G * M) / (C * C * a * (1 - e * e));
    const got = precessionPerOrbit(true, M, a, e, 40) - precessionPerOrbit(false, M, a, e, 40);
    expect(Math.abs(got / want - 1)).toBeLessThan(0.02);
  });

  it('inspirals two black holes on the Peters timescale', () => {
    const w = new World();
    w.integ.gr = false;
    const m = 10, a0 = 2e-5;
    const A = makeBody('bh'), B = makeBody('bh');
    const v = Math.sqrt(G * 2 * m / a0) / 2;
    A.setPos(-a0 / 2, 0, 0); A.setVel(0, -v, 0);
    B.setPos(a0 / 2, 0, 0); B.setVel(0, v, 0);
    w.add(A); w.add(B);
    const peters = (5 / 256) * C ** 5 * a0 ** 4 / (G ** 3 * m * m * 2 * m);
    let t = 0;
    while (w.sources.length !== 1 && t < 2 * peters) t += w.step(peters / 200, FOREVER);
    expect(w.sources.length).toBe(1);
    expect(Math.abs(t / peters - 1)).toBeLessThan(0.05);
    // a few percent of the mass leaves as gravitational waves
    expect(w.sources[0].m).toBeCloseTo(19, 1);
    expect(w.sources[0].r).toBeCloseTo(schwarzschild(w.sources[0].m), 12);
  });
});

describe('lagrange points', () => {
  it('keeps a Trojan at L4 of Jupiter for a thousand years', () => {
    const w = new World();
    w.integ.gr = false;
    const sun = point('sun', 1, R_SUN);
    const jup = orbiting(sun, point('jupiter', M_JUP, 4.8e-4), 5.2, 0);
    w.add(sun); w.add(jup);
    const L4 = lagrangePoints(jup, sun)[3];
    const tro = point('trojan', 1e-14, 1e-9, false);
    tro.setPos(L4[0], L4[1], L4[2]);
    // co-rotate with the pair
    const om = Math.sqrt(G * (1 + M_JUP) / 5.2 ** 3);
    tro.setVel(-om * L4[1], om * L4[0], 0);
    w.add(tro);
    for (let k = 0; k < 100; k++) {
      run(w, 10, 1);
      const now = lagrangePoints(jup, sun)[3];
      expect(Math.hypot(tro.x - now[0], tro.y - now[1])).toBeLessThan(1.0);
    }
  });

  it('puts L1 at the Hill radius for a small mass', () => {
    const sun = point('sun', 1);
    const earth = orbiting(sun, point('earth', M_EARTH), 1, 0);
    const [L1] = lagrangePoints(earth, sun);
    const d = Math.hypot(L1[0] - earth.x, L1[1] - earth.y);
    expect(d / Math.cbrt(M_EARTH / 3)).toBeCloseTo(1, 1);
  });
});

describe('collisions', () => {
  function impact(vRel: number, offset: number) {
    const w = new World();
    const a = makeBody('terran'), b = makeBody('terran');
    a.setPos(0, 0, 0); b.setPos(-4 * R_EARTH, offset * R_EARTH, 0);
    a.setVel(0, 0, 0); b.setVel(vRel, 0, 0);
    w.add(a); w.add(b);
    const p0 = centreOfMass(w);
    run(w, 3e-4, 1e-5);
    return { w, p0, p1: centreOfMass(w) };
  }

  it('conserves mass and momentum through a catastrophic impact', () => {
    const { w, p0, p1 } = impact(40 * KMS, 0.2);
    expect(w.sources.length).toBeGreaterThan(5);
    const biggest = Math.max(...w.sources.map(b => b.m));
    expect(biggest).toBeLessThan(1.9 * M_EARTH);
    expect(p1.m / p0.m).toBeCloseTo(1, 12);
    expect(Math.hypot(p1.px - p0.px, p1.py - p0.py, p1.pz - p0.pz) / Math.hypot(p0.px, p0.py)).toBeLessThan(1e-9);
  });

  it('merges a slow head-on impact into one body', () => {
    const { w } = impact(2 * KMS, 0);
    // one planet; the half-percent spray may already be gathering into a moonlet
    const planets = w.sources.filter(b => b.cls !== 'debris');
    expect(planets.length).toBe(1);
    expect(planets[0].m).toBeGreaterThan(1.98 * M_EARTH);
  });

  it('lets a grazing impact go on as two bodies', () => {
    const { w } = impact(20 * KMS, 1.8);
    expect(w.sources.filter(b => b.cls !== 'debris').length).toBe(2);
  });
});

describe('tides', () => {
  it('tears a comet apart inside Jupiter’s Roche limit', () => {
    const w = new World();
    const jup = makeBody('jupiter');
    const comet = makeBody('comet');
    jup.setPos(0, 0, 0);
    // a parabolic pass with periapsis at 1.3 Jupiter radii
    const q = 1.3 * jup.r;
    comet.setPos(q, 0, 0); comet.setVel(0, Math.sqrt(2 * G * jup.m / q), 0);
    const m0 = comet.m + jup.m;
    w.add(jup); w.add(comet);
    run(w, 1e-4, 1e-6);
    expect(comet.alive).toBe(false);
    expect(w.particleCount).toBeGreaterThan(50);
    const total = w.bodies.reduce((s, b) => s + b.m, 0);
    expect(total / m0).toBeCloseTo(1, 12);
  });
});

describe('stars', () => {
  it('follows the mass–luminosity and lifetime relations', () => {
    expect(zamsL(1)).toBe(1);
    expect(msLife(1)).toBe(1e10);
    // twice the mass: about eleven times as bright, about a fifth of the life
    expect(zamsL(2) / zamsL(1)).toBeGreaterThan(10);
    expect(msLife(2) / msLife(1)).toBeLessThan(0.2);
  });

  it('a dying giant leaves a white dwarf and a nebula', () => {
    const w = new World();
    const g = makeBody('redgiant');
    w.add(g);
    let t = 0;
    while (g.cls !== 'wd' && t < 1e5) t += w.step(50, Infinity);
    w.step(50, Infinity);
    expect(g.cls).toBe('wd');
    expect(g.m).toBeCloseTo(0.109 * 1.2 + 0.394, 2);
    expect(w.particleCount).toBeGreaterThan(50);
  });

  it('a red supergiant goes supernova and leaves a neutron star', () => {
    const w = new World();
    const g = makeBody('supergiant');
    w.add(g);
    const m0 = g.m;
    run(w, 600, 5);
    expect(g.cls).toBe('ns');
    expect(g.m).toBeCloseTo(1.4, 6);
    const total = w.bodies.reduce((s, b) => s + b.m, 0);
    expect(total).toBeLessThan(m0); // the wind and the fastest ejecta have already left
    expect(w.events.some(e => e.kind === 'supernova')).toBe(true);
  });
});

describe('analysis', () => {
  it('gives the Moon to the Earth and the Earth to the Sun', () => {
    const w = buildPreset('solar');
    const hosts = assignHosts(w.sources);
    const by = (n: string) => w.sources.find(b => b.name === n)!;
    expect(hosts.get(by('Moon'))!.host).toBe(by('Earth'));
    expect(hosts.get(by('Earth'))!.host).toBe(by('Sun'));
    expect(hosts.get(by('Io'))!.host).toBe(by('Jupiter'));
    expect(hosts.get(by('Sun'))!.host).toBe(null);
  });

  it('round-trips orbital elements', () => {
    const el = elementsDeg(2.5, 0.3, 12, 40, 70, 200);
    const { r, v } = stateFromElements(G, el);
    const o = osculating(G, r, v);
    expect(o.a).toBeCloseTo(2.5, 10);
    expect(o.e).toBeCloseTo(0.3, 10);
    expect(o.i).toBeCloseTo((12 * Math.PI) / 180, 10);
  });
});

describe('rings and discs', () => {
  function cloud(aMin: number, aMax: number, n: number, total: number, seed = 1) {
    const w = new World();
    const p = makeBody('saturn');
    p.look = { ...p.look, rings: undefined };
    p.setPos(0, 0, 0); p.setVel(0, 0, 0);
    w.add(p);
    let s = seed;
    const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let k = 0; k < n; k++) {
      const q = new Body({ name: 'bit', kind: 'fragment', cls: 'debris', look: { style: 'rocky', seed: k, c1: 0, c2: 0 }, m: total / n, r: 1e-9, source: false });
      q.dens = 0.9;
      orbiting(p, q, p.r * (aMin + (aMax - aMin) * r()), 0.15 * r(), 0.15 * r(), 2 * Math.PI * r());
      // spread the nodes and phases
      const ang = 2 * Math.PI * r(), c = Math.cos(ang), sn = Math.sin(ang);
      [q.x, q.y] = [c * q.x - sn * q.y, sn * q.x + c * q.y];
      [q.vx, q.vy] = [c * q.vx - sn * q.vy, sn * q.vx + c * q.vy];
      w.add(q);
    }
    return { w, p };
  }
  const stats = (w: World, p: Body) => {
    let e = 0, inc = 0, n = 0, L = 0;
    for (const b of w.bodies) {
      if (b === p || !b.alive) continue;
      const { r, v, mu } = relative(b, p);
      const o = osculating(mu, r, v);
      e += o.e; inc += Math.abs(Math.sin(o.i)); n++;
      L += b.m * (r[0] * v[1] - r[1] * v[0]);
    }
    return { e: e / n, inc: inc / n, L, n };
  };

  it('flattens and circularises a debris cloud inside the Roche limit into a ring', () => {
    // a moon's worth of ice spread between 1.3 and 2 planet radii
    const { w, p } = cloud(1.3, 2.0, 1500, 4e20 / 1.98847e30);
    const s0 = stats(w, p);
    const P = 2 * Math.PI * Math.sqrt((1.6 * p.r) ** 3 / (G * p.m));
    run(w, 60 * P, P / 4);
    const s1 = stats(w, p);
    expect(s1.inc).toBeLessThan(s0.inc / 4);
    expect(s1.e).toBeLessThan(s0.e / 3);
    expect(Math.abs(s1.L / s0.L - 1)).toBeLessThan(0.02);
    // nothing gathered: it stays a ring of particles
    expect(w.sources.length).toBe(1);
  });

  it('lets debris outside the Roche limit gather into moonlets', () => {
    const { w, p } = cloud(4, 4.4, 1500, 4e21 / 1.98847e30, 7);
    const P = 2 * Math.PI * Math.sqrt((4.2 * p.r) ** 3 / (G * p.m));
    run(w, 40 * P, P / 4);
    expect(w.bodies.some(b => b.name === 'moonlet')).toBe(true);
  });
});

describe('impacts', () => {
  function hit(target: Body, v: number, m: number) {
    const w = new World();
    target.setPos(0, 0, 0); target.setVel(0, 0, 0);
    const q = new Body({ name: 'rock', kind: 'fragment', cls: 'debris', look: { style: 'rocky', seed: 1, c1: 0, c2: 0 }, m, r: 0, source: false });
    q.r = Math.cbrt(3 * m / (4 * Math.PI * 2.5 * 1000 * (1.495978707e11) ** 3 / 1.98847e30));
    q.setPos(-3 * target.r, 0.3 * target.r, 0); q.setVel(v, 0, 0);
    w.add(target); w.add(q);
    const m0 = target.m;
    run(w, 6 * target.r / v, target.r / v / 20);
    return { w, m0 };
  }

  it('leaves a crater, and a big planet keeps most of the impactor', () => {
    const e = makeBody('terran');
    const imp = 1e15 / 1.98847e30;
    const { w, m0 } = hit(e, 20 * KMS, imp);
    expect(e.craters.length).toBe(1);
    const gained = e.m - m0;
    expect(gained).toBeGreaterThan(0.5 * imp);
    expect(gained).toBeLessThan(imp);
    expect(w.events.some(ev => ev.kind === 'crater')).toBe(true);
  });

  it('wears a small body down: it loses more than the impactor brings', () => {
    const v = makeBody('asteroid');
    const imp = 1e12 / 1.98847e30;
    const { m0 } = hit(v, 5 * KMS, imp);
    expect(v.craters.length).toBe(1);
    expect(v.m).toBeLessThan(m0);
  });
});

describe('events', () => {
  it('Theia grazes, merges, and leaves a disc in orbit', () => {
    const w = buildPreset('theia');
    const m0 = w.bodies.reduce((s, b) => s + b.m, 0);
    run(w, 0.003, 1e-4);
    const E = w.sources.find(b => b.name === 'Proto-Earth')!;
    expect(w.sources.find(b => b.name === 'Theia')).toBeUndefined();
    const orbiting = w.bodies.filter(b => b !== E && b.name !== 'Sun' && b.alive);
    expect(orbiting.length).toBeGreaterThan(10);
    const m1 = w.bodies.reduce((s, b) => s + b.m, 0);
    expect(Math.abs(m1 / m0 - 1)).toBeLessThan(1e-9);
  });

  it('a star overflowing its Roche lobe feeds gas toward its black hole', () => {
    const w = buildPreset('xrb');
    const donor = w.sources.find(b => b.name === 'Donor star')!;
    const m0 = donor.m;
    run(w, 0.01, 2e-4);
    expect(donor.m).toBeLessThan(m0);
    expect(w.particleCount).toBeGreaterThan(20);
  });
});

describe('moon data', () => {
  it('has every moon in the JPL table and places them round their planets', () => {
    expect(MOONS.length).toBeGreaterThan(400);
    const w = buildPreset('saturn');
    const sat = w.sources.find(b => b.name === 'Saturn')!;
    const titan = w.bodies.find(b => b.name === 'Titan')!;
    const d = norm(relative(titan, sat).r) / KM_;
    expect(d).toBeGreaterThan(1.15e6);
    expect(d).toBeLessThan(1.3e6);
    // Saturn's moons orbit near its equator, which is tilted 26.7° to its orbit
    const o = osculating(G * sat.m, relative(titan, sat).r, relative(titan, sat).v);
    const ax = [Math.sin(sat.tilt) * Math.sin(sat.node), -Math.sin(sat.tilt) * Math.cos(sat.node), Math.cos(sat.tilt)];
    const hn = norm(o.h);
    const cosang = (o.h[0] * ax[0] + o.h[1] * ax[1] + o.h[2] * ax[2]) / hn;
    expect(cosang).toBeGreaterThan(0.99);
  });
});
const KM_ = 1 / 1.495978707e8;
