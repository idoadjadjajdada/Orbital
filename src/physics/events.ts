import { Body, type Cls } from './body';
import { G, C, KMS, GCC, radiusFromDensity, schwarzschild } from './units';
import { becomeRemnant, msLife, M_TOV, remnantMass, structure, newStar, teffOf } from './stellar';
import { refreshRoche } from './catalog';
import type { World } from './world';

/** A visual cue the renderer can pick up: flashes, shock rings. */
export interface SimEvent {
  kind: 'impact' | 'merge' | 'disrupt' | 'supernova' | 'ia' | 'kilonova' | 'collapse' | 'nebula' | 'swallow' | 'graze';
  x: number; y: number; z: number;
  size: number;     // AU, a sensible radius for the visual
  energy: number;   // 0..1, how big a deal it is
  t: number;        // sim time
  body?: Body;
}

const rnd = Math.random;
function randDir(): [number, number, number] {
  const z = 2 * rnd() - 1, p = 2 * Math.PI * rnd(), s = Math.sqrt(1 - z * z);
  return [s * Math.cos(p), s * Math.sin(p), z];
}

let fragSeq = 0;

export interface FragSpec {
  mass: number;
  n: number;
  cls: Extract<Cls, 'debris' | 'gasp'>;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** spawn within this radius of the centre (shell between inner and outer) */
  rIn: number; rOut: number;
  /** outward speed range */
  vMin: number; vMax: number;
  heat: number;
  color: number;
  beta?: number;
  /** extra rigid-rotation velocity ω × offset, for tidal disruption */
  omega?: [number, number, number];
  /** if set, this body takes the recoil of the ejecta instead of the swarm's drift being removed */
  recoil?: Body;
  /** fragments that pull on everything (and each other), for debris too heavy to ignore */
  source?: boolean;
  /** bias direction for ejecta (unit), and how strongly (0 = isotropic) */
  bias?: [number, number, number]; biasK?: number;
}

/** Scatter `mass` into test particles, conserving the given total momentum exactly. */
export function spawnFragments(w: World, f: FragSpec): Body[] {
  const room = Math.max(0, w.maxParticles - w.particleCount);
  const n = Math.max(0, Math.min(f.n, room));
  if (n === 0 || f.mass <= 0) return [];
  const mEach = f.mass / n;
  const out: Body[] = [];
  const rFrag = f.cls === 'gasp' ? 0 : radiusFromDensity(mEach, 3);
  const placed: [number, number, number][] = [];
  let sx = 0, sy = 0, sz = 0;
  for (let k = 0; k < n; k++) {
    let d = randDir();
    if (f.bias && f.biasK) {
      const b = f.bias, kk = f.biasK;
      d = [d[0] + b[0] * kk, d[1] + b[1] * kk, d[2] + b[2] * kk];
      const l = Math.hypot(d[0], d[1], d[2]); d = [d[0] / l, d[1] / l, d[2] / l];
    }
    let rr = f.rIn + (f.rOut - f.rIn) * Math.cbrt(rnd());
    let ox = d[0] * rr, oy = d[1] * rr, oz = d[2] * rr;
    if (f.source) {
      // self-gravitating pieces must not start inside one another
      for (let tries = 0; tries < 40 && placed.some(q => (q[0] - ox) ** 2 + (q[1] - oy) ** 2 + (q[2] - oz) ** 2 < 4.4 * rFrag * rFrag); tries++) {
        d = randDir();
        rr = f.rIn + (f.rOut - f.rIn) * Math.cbrt(rnd());
        ox = d[0] * rr; oy = d[1] * rr; oz = d[2] * rr;
      }
      placed.push([ox, oy, oz]);
    }
    const sp = f.vMin + (f.vMax - f.vMin) * rnd() ** 1.5;
    let vx = d[0] * sp, vy = d[1] * sp, vz = d[2] * sp;
    if (f.omega) {
      const [wx, wy, wz] = f.omega;
      vx += wy * oz - wz * oy; vy += wz * ox - wx * oz; vz += wx * oy - wy * ox;
    }
    const p = new Body({
      name: 'fragment', kind: f.cls === 'gasp' ? 'gas' : 'fragment', cls: f.cls,
      look: { style: 'rocky', seed: ++fragSeq, c1: f.color, c2: f.color },
      m: mEach, r: rFrag, source: !!f.source, spin: 0,
    });
    if (f.source) p.name = 'debris';
    p.setPos(f.x + ox, f.y + oy, f.z + oz);
    p.setVel(vx, vy, vz);
    p.heat = f.heat * (0.6 + 0.4 * rnd());
    p.beta = f.beta ?? 0;
    sx += vx; sy += vy; sz += vz;
    out.push(p);
  }
  sx /= n; sy /= n; sz /= n;
  if (f.recoil) {
    // the ejecta keep their drift; the body they left takes the opposite push
    const k = f.mass / f.recoil.m;
    f.recoil.vx -= sx * k; f.recoil.vy -= sy * k; f.recoil.vz -= sz * k;
    for (const p of out) { p.vx += f.vx; p.vy += f.vy; p.vz += f.vz; w.add(p); }
  } else {
    // remove the net drift so the swarm carries exactly the momentum it was given
    for (const p of out) { p.vx += f.vx - sx; p.vy += f.vy - sy; p.vz += f.vz - sz; w.add(p); }
  }
  return out;
}

const fragCount = (mass: number, perUnit: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.round(mass * perUnit)));

function absorbInto(t: Body, p: Body) {
  const M = t.m + p.m;
  t.vx = (t.vx * t.m + p.vx * p.m) / M; t.vy = (t.vy * t.m + p.vy * p.m) / M; t.vz = (t.vz * t.m + p.vz * p.m) / M;
  t.x = (t.x * t.m + p.x * p.m) / M; t.y = (t.y * t.m + p.y * p.m) / M; t.z = (t.z * t.m + p.z * p.m) / M;
  t.m = M;
}

/** Radius after taking on mass, keeping the heavier body's bulk density. */
function grow(t: Body, density: number) {
  if (t.cls === 'bh') t.r = schwarzschild(t.m);
  else if (t.cls === 'star' && t.star) {
    t.star.m0 = Math.max(t.star.m0, t.m);
    const st = structure(t.star); t.r = st.r;
  } else if (t.cls === 'rock' || t.cls === 'ice' || t.cls === 'gas') t.r = radiusFromDensity(t.m, density);
}

/** A test particle running into a source: its mass and momentum join it. */
export function accrete(w: World, src: Body, p: Body) {
  const v2 = (src.vx - p.vx) ** 2 + (src.vy - p.vy) ** 2 + (src.vz - p.vz) ** 2;
  const rho = src.cls === 'rock' || src.cls === 'ice' || src.cls === 'gas' ? src.density : 0;
  absorbInto(src, p);
  if (rho) grow(src, rho);
  // energy deposited per unit mass of target sets how hot the skin gets
  if (!src.star) src.heat = Math.min(1, src.heat + (p.m / src.m) * v2 / (G * src.m / src.r) * 20);
  w.massChanged(src);
}

/**
 * Two sources meet. Outcomes by regime:
 *  - anything into a star, white dwarf, neutron star or black hole is swallowed;
 *  - two stars merge into a younger-looking star (a blue straggler);
 *  - two compact objects merge, radiating a few percent of the mass;
 *  - two planets: perfect merger below about the mutual escape speed, a
 *    hit-and-run for grazing impacts, otherwise the largest remnant follows
 *    the Leinhardt & Stewart (2012) universal law and the rest is debris.
 */
export function collide(w: World, a: Body, b: Body) {
  const T = a.m >= b.m ? a : b, P = T === a ? b : a;
  const dx = P.x - T.x, dy = P.y - T.y, dz = P.z - T.z;
  const dvx = P.vx - T.vx, dvy = P.vy - T.vy, dvz = P.vz - T.vz;
  const vImp = Math.hypot(dvx, dvy, dvz);
  const d = Math.hypot(dx, dy, dz) || T.r;
  const Mtot = T.m + P.m;
  const cx = (T.x * T.m + P.x * P.m) / Mtot, cy = (T.y * T.m + P.y * P.m) / Mtot, cz = (T.z * T.m + P.z * P.m) / Mtot;
  const ev = (kind: Parameters<World['emit']>[0]['kind'], size: number, energy: number) =>
    w.emit({ kind, x: cx, y: cy, z: cz, size, energy, t: w.time });

  const big = (c: Cls) => c === 'star' || c === 'wd' || c === 'ns' || c === 'bh';

  if (T.compact && P.compact) {
    // compact merger
    const ns2 = T.cls === 'ns' && P.cls === 'ns';
    const lost = T.cls === 'bh' && P.cls === 'bh' ? 0.05 * Mtot * 4 * T.m * P.m / Mtot ** 2 : ns2 ? 0.03 : 0;
    absorbInto(T, P);
    w.kill(P);
    if (ns2) {
      T.m -= lost;
      spawnFragments(w, { mass: lost, n: 500, cls: 'gasp', x: T.x, y: T.y, z: T.z, vx: T.vx, vy: T.vy, vz: T.vz,
        rIn: 1e-6, rOut: 3e-6, vMin: 0.05 * C, vMax: 0.3 * C, heat: 1, color: 0xff6040 });
      if (T.m > M_TOV) becomeRemnant(T, 'bh', T.m);
      ev('kilonova', 0.05, 1);
    } else {
      T.m -= lost;
      if (T.cls !== 'bh' && P.cls === 'bh') becomeRemnant(T, 'bh', T.m);
      if (T.cls === 'ns' && T.m > M_TOV) becomeRemnant(T, 'bh', T.m);
      ev('merge', Math.max(T.r * 50, 1e-4), lost > 0 ? 1 : 0.5);
    }
    if (T.cls === 'bh') T.r = schwarzschild(T.m);
    w.massChanged(T);
    return;
  }

  if (big(T.cls)) {
    if (T.cls === 'star' && P.cls === 'star' && T.star && P.star) {
      // stellar merger: fuel mixes, the product sits at the mass-weighted fraction of its new life
      const fa = T.star.age / msLife(T.star.m0), fb = P.star.age / msLife(P.star.m0);
      const f = Math.min(1, (fa * T.m + fb * P.m) / Mtot);
      absorbInto(T, P);
      T.star = newStar(T.m, f);
      const st = structure(T.star);
      T.r = st.r; T.star.L = st.L; T.star.teff = teffOf(st.L, st.r);
      refreshRoche(T);
      w.kill(P);
      ev('merge', T.r * 3, 0.8);
    } else {
      absorbInto(T, P);
      grow(T, T.density);
      refreshRoche(T);
      w.kill(P);
      ev('swallow', Math.max(T.r * 1.5, P.r * 20), Math.min(1, P.m / T.m * 50 + 0.2));
    }
    w.massChanged(T);
    return;
  }

  // Fragments are already the smallest thing resolved: when one meets
  // anything that is not a star it sticks, momentum and mass conserved.
  if (T.cls === 'debris' || P.cls === 'debris') {
    if (dx * dvx + dy * dvy + dz * dvz > 0) return; // touching but already separating
    const rho = T.density;
    absorbInto(T, P);
    w.kill(P);
    if (T.cls === 'debris') T.r = radiusFromDensity(T.m, 3);
    else grow(T, rho);
    w.massChanged(T);
    w.structural();
    if (P.m > 1e-3 * T.m) ev('merge', T.r * 3, 0.3);
    return;
  }

  // ---- planet on planet ----
  const Rt = T.r, Rp = P.r;
  const vesc = Math.sqrt(2 * G * Mtot / (Rt + Rp));
  const bImp = Math.min(1, Math.hypot(dy * dvz - dz * dvy, dz * dvx - dx * dvz, dx * dvy - dy * dvx) / (d * vImp || 1));
  const mu = T.m * P.m / Mtot;
  const QR = 0.5 * mu * vImp * vImp / Mtot;
  const rho1 = GCC;                                   // 1 g/cm³
  const RC1 = Math.cbrt(3 * Mtot / (4 * Math.PI * rho1));
  const gam = P.m / T.m;
  const Qstar = 1.9 * 0.8 * Math.PI * rho1 * G * RC1 * RC1 * (0.25 * (gam + 1) ** 2 / gam) ** (2 / (3 * 0.36) - 1);
  const rhoT = T.density, rhoP = P.density;
  const rhoMix = Mtot / (T.m / rhoT + P.m / rhoP);
  const heat = Math.min(1, 0.35 + QR / Qstar);
  const debrisColor = T.cls === 'gas' ? 0xd8b080 : 0xa08060;

  if (bImp > Rt / (Rt + Rp) && vImp > vesc) {
    // hit and run: both survive, the projectile scraped and both turned aside
    const nx = dx / d, ny = dy / d, nz = dz / d;
    const vn = dvx * nx + dvy * ny + dvz * nz;
    if (vn < 0) {
      // remove the approach along the line of centres, equal and opposite
      const j = -vn * mu;
      T.vx -= j * nx / T.m; T.vy -= j * ny / T.m; T.vz -= j * nz / T.m;
      P.vx += j * nx / P.m; P.vy += j * ny / P.m; P.vz += j * nz / P.m;
    }
    // separate to touching
    const push = (Rt + Rp) * 1.001 - d;
    if (push > 0) {
      P.x += nx * push * T.m / Mtot; P.y += ny * push * T.m / Mtot; P.z += nz * push * T.m / Mtot;
      T.x -= nx * push * P.m / Mtot; T.y -= ny * push * P.m / Mtot; T.z -= nz * push * P.m / Mtot;
    }
    const lost = P.m * Math.min(0.3, 0.06 * (vImp / vesc - 1) + 0.02);
    P.m -= lost;
    grow(P, rhoP);
    refreshRoche(P);
    T.heat = Math.min(1, T.heat + heat * 0.5); P.heat = Math.min(1, P.heat + heat);
    const ex = T.x + nx * Rt, ey = T.y + ny * Rt, ez = T.z + nz * Rt;
    const heavyHR = lost > 0.01 * P.m;
    spawnFragments(w, { mass: lost, n: heavyHR ? 24 : fragCount(lost / P.m, 400, 30, 250), source: heavyHR, cls: 'debris', x: ex, y: ey, z: ez,
      vx: P.vx, vy: P.vy, vz: P.vz, rIn: Rp * 0.3, rOut: Rp, vMin: 0.2 * vesc, vMax: 0.8 * vesc,
      heat: 1, color: debrisColor });
    w.massChanged(T); w.massChanged(P); w.structural();
    w.emit({ kind: 'graze', x: ex, y: ey, z: ez, size: Rt * 2, energy: heat, t: w.time });
    return;
  }

  let Mlr: number;
  if (vImp < 1.1 * vesc) Mlr = Mtot * 0.995;
  else if (QR < 1.8 * Qstar) Mlr = Mtot * (1 - QR / (2 * Qstar));
  else Mlr = Mtot * 0.1 / 1.8 ** -1.5 * (QR / Qstar) ** -1.5;
  Mlr = Math.max(0, Math.min(Mtot * 0.995, Mlr));
  const debris = Mtot - Mlr;
  const vx = (T.vx * T.m + P.vx * P.m) / Mtot, vy = (T.vy * T.m + P.vy * P.m) / Mtot, vz = (T.vz * T.m + P.vz * P.m) / Mtot;

  // the remnant takes over the target: name, look, class
  T.m = Mlr; T.vx = vx; T.vy = vy; T.vz = vz; T.x = cx; T.y = cy; T.z = cz;
  w.kill(P);
  const tooSmall = Mlr < 1e-12;
  if (tooSmall) w.kill(T);
  else {
    if (P.cls === 'gas' && T.cls !== 'gas' && P.m > T.m * 0.3) T.cls = 'gas';
    T.r = radiusFromDensity(Mlr, T.cls === 'gas' ? Math.min(rhoMix, rhoT) : rhoMix);
    T.heat = Math.min(1, T.heat + heat);
    refreshRoche(T);
    w.massChanged(T);
  }
  const R = tooSmall ? Rt : T.r;
  if (debris > 0) {
    // In the Leinhardt–Stewart law the mass outside the largest remnant is by
    // definition unbound, so it leaves faster than the pair's escape speed.
    // A gentle merger's spray is the exception: most of it stays in orbit.
    const merged = vImp < 1.1 * vesc;
    const vEsc = Math.sqrt(2 * G * Mtot / (1.3 * R));
    const imp: [number, number, number] = [dx / d, dy / d, dz / d];
    // Debris worth more than a percent of the remnant is spawned as fewer,
    // self-gravitating pieces: they pull the remnant back, each other together,
    // and can gather into moons. Lighter debris is a swarm of test particles.
    const heavy = debris > 0.01 * Math.max(Mlr, 1e-30);
    const n = heavy ? 32 : fragCount(debris / Mtot, 2000, 40, 600);
    const rIn = R + 1.2 * radiusFromDensity(debris / n, 3);
    spawnFragments(w, { mass: debris, n, source: heavy, cls: 'debris', x: cx, y: cy, z: cz,
      vx, vy, vz, rIn, rOut: rIn + (heavy ? 3 : 0.6) * R, vMin: (merged ? 0.6 : 1.0) * vEsc, vMax: (merged ? 1.1 : 2.0) * vEsc, heat: 1, color: debrisColor,
      bias: imp, biasK: 0.6, recoil: tooSmall ? undefined : T });
  }
  w.structural();
  ev(vImp < 1.1 * vesc ? 'merge' : 'impact', R * 6, heat);
}

/** Inside the Roche limit of something much heavier: the body comes apart and its pieces follow their own orbits. */
export function disrupt(w: World, b: Body, by: Body) {
  const rx = b.x - by.x, ry = b.y - by.y, rz = b.z - by.z;
  const vx = b.vx - by.vx, vy = b.vy - by.vy, vz = b.vz - by.vz;
  const r2 = rx * rx + ry * ry + rz * rz;
  // spin-locked: the pieces keep the angular rate the body had about its host
  const omega: [number, number, number] = [(ry * vz - rz * vy) / r2, (rz * vx - rx * vz) / r2, (rx * vy - ry * vx) / r2];
  const gas = b.cls === 'star' || b.cls === 'gas';
  const color = b.cls === 'star' ? 0xffc080 : b.cls === 'gas' ? 0xd8b890 : b.cls === 'ice' ? 0xc8d8e8 : 0x9a8070;
  spawnFragments(w, { mass: b.m, n: b.cls === 'star' ? 900 : b.cls === 'gas' ? 600 : 400, cls: gas ? 'gasp' : 'debris',
    x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, rIn: 0, rOut: b.r, vMin: 0, vMax: 0,
    heat: gas ? 0.9 : 0.3, color, omega });
  w.kill(b);
  w.structural();
  w.emit({ kind: 'disrupt', x: b.x, y: b.y, z: b.z, size: b.r * 4, energy: 0.6, t: w.time, body: by });
}

const VSN = 5000 * KMS, VIA = 10000 * KMS;

/** End of a star's life. */
export function starDeath(w: World, b: Body, ev: 'wd' | 'sn' | 'collapse' | 'ia' | 'ns-collapse') {
  const s = b.star!;
  const at = (kind: Parameters<World['emit']>[0]['kind'], size: number, energy: number) =>
    w.emit({ kind, x: b.x, y: b.y, z: b.z, size, energy, t: w.time, body: b });
  if (ev === 'wd') {
    const core = s.coreM;
    const env = b.m - core;
    const R = b.r;
    becomeRemnant(b, 'wd', core);
    if (env > 0) {
      // the hot core's fast wind sweeps the last of the envelope out: it
      // leaves above escape speed and coasts at a few tens of km/s
      const ve = Math.sqrt(2 * G * core / (0.5 * R));
      spawnFragments(w, { mass: env, n: 400, cls: 'gasp', x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz,
        rIn: R * 0.5, rOut: R, vMin: 1.05 * ve, vMax: 1.3 * ve, heat: 0.6, color: 0x60c0d0 });
    }
    at('nebula', R * 3, 0.4);
  } else if (ev === 'sn') {
    const rem = remnantMass(s.m0);
    const cls = s.m0 < 25 ? 'ns' : 'bh';
    const ej = b.m - rem;
    const R = b.r;
    // natal kick: neutron stars are born moving a few hundred km/s
    const kick = (cls === 'ns' ? 265 : 60) * KMS * (0.3 + 1.2 * rnd());
    const [kx, ky, kz] = randDir();
    const pvx = b.vx, pvy = b.vy, pvz = b.vz, M = b.m;
    becomeRemnant(b, cls, rem);
    b.vx += kx * kick; b.vy += ky * kick; b.vz += kz * kick;
    // the ejecta carry whatever momentum the remnant did not
    const evx = (pvx * M - b.vx * rem) / ej, evy = (pvy * M - b.vy * rem) / ej, evz = (pvz * M - b.vz * rem) / ej;
    spawnFragments(w, { mass: ej, n: 1500, cls: 'gasp', x: b.x, y: b.y, z: b.z, vx: evx, vy: evy, vz: evz,
      rIn: R * 0.2, rOut: R * 0.8, vMin: 0.5 * VSN, vMax: 1.3 * VSN, heat: 1, color: 0xa0c8ff });
    at('supernova', R * 6, 1);
  } else if (ev === 'collapse' || ev === 'ns-collapse') {
    const rem = ev === 'collapse' ? remnantMass(s.m0) : b.m;
    const ej = b.m - rem;
    const R = b.r;
    becomeRemnant(b, 'bh', rem);
    if (ej > 0) spawnFragments(w, { mass: ej, n: 500, cls: 'gasp', x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz,
      rIn: R * 0.5, rOut: R, vMin: 100 * KMS, vMax: 300 * KMS, heat: 0.7, color: 0xc08060 });
    at('collapse', Math.max(R * 2, 0.01), 0.6);
  } else if (ev === 'ia') {
    spawnFragments(w, { mass: b.m, n: 1500, cls: 'gasp', x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz,
      rIn: 0, rOut: b.r, vMin: 0.6 * VIA, vMax: 1.2 * VIA, heat: 1, color: 0xfff0c0 });
    at('ia', 0.05, 1);
    w.kill(b);
  }
  refreshRoche(b);
  w.massChanged(b);
  w.structural();
}

/** Mass a star sheds between frames leaves as a dust-driven wind. */
export function wind(w: World, b: Body, shed: number) {
  const s = b.star!;
  const parcel = Math.max(1e-6, (s.m0 - s.coreM) / 1200);
  const acc = (windAcc.get(b) ?? 0) + shed;
  const n = Math.floor(acc / parcel);
  windAcc.set(b, acc - n * parcel);
  if (n <= 0) return;
  const vesc = Math.sqrt(2 * G * b.m / b.r);
  spawnFragments(w, { mass: n * parcel, n, cls: 'gasp', x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz,
    rIn: b.r * 1.02, rOut: b.r * 1.1, vMin: 0.35 * vesc, vMax: 0.6 * vesc, heat: 0.35,
    color: s.phase === 'agb' ? 0x50b0c8 : 0xd08850,
    // radiation pressure on the dust is what drives a giant's wind
    beta: 1.4 * b.m / Math.max(s.L, 1e-9) });
}
const windAcc = new WeakMap<Body, number>();

/**
 * A comet near a star boils. The gas and dust it loses are pushed back by the
 * starlight harder than gravity pulls them, so the tail points away from the
 * star whatever way the comet is going.
 */
export function cometActivity(w: World, c: Body, stars: Body[], dt: number) {
  let flux = 0, sx = 0, sy = 0, sz = 0;
  for (const s of stars) {
    const dx = c.x - s.x, dy = c.y - s.y, dz = c.z - s.z;
    const r2 = dx * dx + dy * dy + dz * dz;
    const f = s.star!.L / r2;
    if (f > flux) { flux = f; const r = Math.sqrt(r2); sx = dx / r; sy = dy / r; sz = dz / r; }
  }
  if (flux < 1 / 9) return; // water ice sublimates inside ~3 AU of the Sun
  // a Halley-class nucleus loses ~10^4 kg/s near perihelion — 0.2% of its mass an orbit
  const rate = 1.5e-11 * c.m * flux * 365.25;
  const lose = Math.min(c.m * 0.5, rate * dt);
  const acc = (windAcc.get(c) ?? 0) + Math.min(400, flux * 60) * dt * 365.25 / 10;
  const n = Math.floor(acc);
  windAcc.set(c, acc - n);
  c.m -= lose;
  if (n <= 0) return;
  const ve = 0.5 * KMS;
  spawnFragments(w, { mass: lose, n: Math.min(n, 40), cls: 'gasp', x: c.x, y: c.y, z: c.z, vx: c.vx, vy: c.vy, vz: c.vz,
    rIn: c.r, rOut: c.r * 2, vMin: 0.3 * ve, vMax: ve, heat: 0.2, color: 0x90c8ff, beta: 0.9 + 0.8 * rnd(),
    bias: [-sx, -sy, -sz], biasK: 1.2 });
}
