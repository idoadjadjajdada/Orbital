import { Body, type Cls } from './body';
import { G, C, KM, KMS, GCC, AU_M, YEAR_S, MSUN_KG, radiusFromDensity, schwarzschild, fmtMass } from './units';
import { becomeRemnant, msLife, M_TOV, remnantMass, structure, newStar, teffOf } from './stellar';
import { refreshRoche, rocheFactor } from './catalog';
import type { World } from './world';

/** A visual cue the renderer can pick up: flashes, shock rings. */
export interface SimEvent {
  kind: 'impact' | 'merge' | 'disrupt' | 'supernova' | 'ia' | 'kilonova' | 'collapse' | 'nebula' | 'swallow' | 'graze' | 'crater' | 'strip' | 'evaporate' | 'airburst' | 'gw' | 'flare' | 'wormhole';
  x: number; y: number; z: number;
  size: number;     // AU, a sensible radius for the visual
  energy: number;   // 0..1, how big a deal it is
  t: number;        // sim time
  body?: Body;
  /** the name of whatever it happened to, as it was called at the time */
  name?: string;
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
  /** bulk density of the material, g/cm³ (sets its Roche limit later) */
  rho?: number;
  /** if set, this body takes the recoil of the ejecta instead of the swarm's drift being removed */
  recoil?: Body;
  /** fragments that pull on everything (and each other), for debris too heavy to ignore */
  source?: boolean;
  /** bias direction for ejecta (unit), and how strongly (0 = isotropic) */
  bias?: [number, number, number]; biasK?: number;
  /** place the pieces in two caps, along +axis and −axis (tidal stripping) */
  bipolar?: [number, number, number];
}

/** Scatter `mass` into test particles, conserving the given total momentum exactly. */
export function spawnFragments(w: World, f: FragSpec): Body[] {
  const room = Math.max(0, w.maxParticles - w.particleCount);
  const n = Math.max(0, Math.min(f.n, room));
  if (n === 0 || f.mass <= 0) return [];
  const mEach = f.mass / n;
  const out: Body[] = [];
  const rFrag = f.cls === 'gasp' ? 0 : radiusFromDensity(mEach, f.rho ?? 3);
  const placed: [number, number, number][] = [];
  let sx = 0, sy = 0, sz = 0;
  for (let k = 0; k < n; k++) {
    let d = randDir();
    if (f.bias && f.biasK) {
      const b = f.bias, kk = f.biasK;
      d = [d[0] + b[0] * kk, d[1] + b[1] * kk, d[2] + b[2] * kk];
      const l = Math.hypot(d[0], d[1], d[2]); d = [d[0] / l, d[1] / l, d[2] / l];
    }
    if (f.bipolar) {
      const s = k % 2 ? -1 : 1, a = f.bipolar, j = 0.45;
      d = [s * a[0] + d[0] * j, s * a[1] + d[1] * j, s * a[2] + d[2] * j];
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
    if (f.source) { p.name = 'debris'; p.dens = f.rho ?? 3; refreshRoche(p); }
    p.setPos(f.x + ox, f.y + oy, f.z + oz);
    p.setVel(vx, vy, vz);
    p.heat = f.heat * (0.6 + 0.4 * rnd());
    p.dens = f.rho ?? 3;
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

const CLEAR = 3e-5; // AU, just outside where test particles are caught by a compact object

/**
 * Through a wormhole: out of the other mouth, on the far side, still moving the
 * same way at the same speed relative to the mouth. Returns false if the other
 * mouth is gone.
 */
export function traverse(w: World, mouth: Body, b: Body): boolean {
  const o = w.sources.find(s => s.id === mouth.partnerId && s.alive);
  if (!o) return false;
  const vx = b.vx - mouth.vx, vy = b.vy - mouth.vy, vz = b.vz - mouth.vz;
  const v = Math.hypot(vx, vy, vz) || 1;
  // out on the side it was heading for, clear of the throat
  // (test particles are caught 3,000 km out from anything compact, so beyond that)
  const k = Math.max(1.5 * Math.max(o.r, b.r * 2), CLEAR);
  b.setPos(o.x + (vx / v) * k, o.y + (vy / v) * k, o.z + (vz / v) * k);
  b.setVel(o.vx + vx, o.vy + vy, o.vz + vz);
  b.alive = true;
  b.dtWant = 0;
  w.moved(b);
  if (b.source || b.m > 1e-12) w.emit({ kind: 'wormhole', x: o.x, y: o.y, z: o.z, size: o.r * 6, energy: 0.4, t: w.time, body: b, name: `${b.name} came through the wormhole` });
  return true;
}

/** Nothing can fall into a white hole: whatever reaches its horizon is turned back out. */
export function repel(w: World, wh: Body, b: Body) {
  let nx = b.x - wh.x, ny = b.y - wh.y, nz = b.z - wh.z;
  const n = Math.hypot(nx, ny, nz) || 1; nx /= n; ny /= n; nz /= n;
  const vx = b.vx - wh.vx, vy = b.vy - wh.vy, vz = b.vz - wh.vz;
  const vn = vx * nx + vy * ny + vz * nz;
  const k = Math.max(1.3 * (wh.r + b.r), CLEAR);
  b.setPos(wh.x + nx * k, wh.y + ny * k, wh.z + nz * k);
  // the inward motion reversed; momentum goes to the hole
  if (vn < 0) {
    b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; b.vz -= 2 * vn * nz;
    const f = (2 * vn * b.m) / wh.m;
    wh.vx += f * nx; wh.vy += f * ny; wh.vz += f * nz;
  }
  b.alive = true;
  b.dtWant = 0;
  w.moved(b);
}

/** A test particle running into a source. */
export function accrete(w: World, src: Body, p: Body) {
  if (src.look.wormhole) { if (traverse(w, src, p)) return; }
  if (src.look.white) { repel(w, src, p); return; }
  if ((src.cls === 'rock' || src.cls === 'ice' || src.cls === 'gas' || src.cls === 'debris') && p.cls === 'debris') {
    // Cratering is for small impactors. A piece more than a few percent of
    // what it hits is a collision between near-equals at the speeds of a
    // settling disc: the two simply stick.
    if (src.cls === 'debris' && p.m > 0.03 * src.m) {
      const rho = src.dens;
      absorbInto(src, p);
      src.r = radiusFromDensity(src.m, rho);
      refreshRoche(src);
      w.massChanged(src);
      return;
    }
    crater(w, src, p);
    return;
  }
  if (src.compact) swallow(src, p);
  const rho = src.cls === 'rock' || src.cls === 'ice' || src.cls === 'gas' ? src.density : 0;
  absorbInto(src, p);
  if (rho) grow(src, rho);
  w.massChanged(src);
}

/** What a compact object takes in is tallied for its jets, along with the spin it brings. */
function swallow(c: Body, p: Body) {
  c.swallowed += p.m;
  const rx = p.x - c.x, ry = p.y - c.y, rz = p.z - c.z, vx = p.vx - c.vx, vy = p.vy - c.vy, vz = p.vz - c.vz;
  c.lx += p.m * (ry * vz - rz * vy); c.ly += p.m * (rz * vx - rx * vz); c.lz += p.m * (rx * vy - ry * vx);
}

const KG_M3 = 1000; // one g/cm³ in kg/m³

/**
 * A small body hits a much larger one. It does not simply add itself: it digs
 * a crater sized by the Schmidt–Housen π-scaling law for the gravity regime,
 *   D = 1.161 (ρi/ρt)^⅓ L^0.78 v^0.44 g^−0.22   (SI),
 * and throws out ejecta, the part of it faster than escape speed leaving for
 * good. On a big planet that is a sliver of the impactor's mass; on a small
 * moon or asteroid, where escape speed is tiny, it can be more than the
 * impactor brought — small bodies are worn down by impacts, not built up.
 * A gas giant has no surface to dig: the impactor leaves a dark scar in the
 * clouds, as Shoemaker–Levy 9 did on Jupiter, which the winds smear away.
 */
export function crater(w: World, T: Body, p: Body) {
  // A thick atmosphere stops small stony bodies before they reach the ground:
  // on Earth anything under about fifty metres breaks up and burns overhead,
  // as the Chelyabinsk meteor did, and never digs a crater.
  const shield = T.look.style === 'terran' || T.look.style === 'ocean' ? 50 : T.name === 'Venus' ? 1500 : T.name === 'Titan' ? 200 : 0;
  if (shield > 0 && 2 * p.r * AU_M < shield && T.cls !== 'gas') {
    absorbInto(T, p);
    w.massChanged(T);
    w.emit({ kind: 'airburst', x: p.x, y: p.y, z: p.z, size: T.r * 0.03, energy: 0.1, t: w.time, body: T });
    return;
  }
  const dvx = p.vx - T.vx, dvy = p.vy - T.vy, dvz = p.vz - T.vz;
  const v = Math.hypot(dvx, dvy, dvz);
  let nx = p.x - T.x, ny = p.y - T.y, nz = p.z - T.z;
  let nn = Math.hypot(nx, ny, nz);
  if (nn < 0.5 * T.r) { nx = -dvx; ny = -dvy; nz = -dvz; nn = v || 1; } // swept through: it came in along its velocity
  nx /= nn; ny /= nn; nz /= nn;
  const vesc = Math.sqrt(2 * G * T.m / T.r);
  const gSI = (G * T.m) / (T.r * T.r) * AU_M / (YEAR_S * YEAR_S);
  const vSI = v * AU_M / YEAR_S;
  const rhoT = Math.max(0.3, T.density) * KG_M3;
  const rhoI = (p.r > 0 ? Math.min(8, Math.max(0.5, p.density)) : 2.5) * KG_M3;
  const Li = 2 * (p.r > 0 ? p.r : radiusFromDensity(p.m, rhoI / KG_M3)) * AU_M;
  const D = 1.161 * Math.cbrt(rhoI / rhoT) * Li ** 0.78 * vSI ** 0.44 * gSI ** -0.22;
  const ang = Math.min(1.2, D / 2 / (T.r * AU_M));
  const gas = T.cls === 'gas';
  // excavated mass ~ a bowl a fifth as deep as it is wide
  const mCrater = gas ? 0 : rhoT * 0.1 * D ** 3 / MSUN_KG;
  const mEsc = gas ? 0 : Math.min(0.5 * mCrater, 0.08 * p.m * Math.max(0, (v / vesc) ** 2 - 1), 0.2 * T.m);
  const heatBefore = T.heat;
  const rho = T.density;
  absorbInto(T, p);
  grow(T, rho);
  T.heat = Math.min(1, heatBefore + (p.m / T.m) * (v / vesc) ** 2 * 30);
  T.craters.push({ x: nx, y: ny, z: nz, a: ang, t: w.time });
  if (T.craters.length > 64) {
    // the smallest go first; the old ones are eroded or buried
    let worst = 0;
    for (let i = 1; i < T.craters.length; i++) if (T.craters[i].a < T.craters[worst].a) worst = i;
    T.craters.splice(worst, 1);
  }
  // escaping ejecta are spawned in proportion to their mass, never more pieces than the impactor was
  const nEj = mEsc > 0 ? Math.max(1, Math.min(12, Math.round((4 * mEsc) / p.m))) : 0;
  if (nEj > 0 && w.particleCount < w.maxParticles) {
    const ex = T.x + nx * T.r * 1.02, ey = T.y + ny * T.r * 1.02, ez = T.z + nz * T.r * 1.02;
    // the ejecta's mass comes out of the target only as it is actually thrown
    T.m -= mEsc;
    const made = spawnFragments(w, { mass: mEsc, n: nEj, cls: 'debris', x: ex, y: ey, z: ez,
      vx: T.vx, vy: T.vy, vz: T.vz, rIn: 0, rOut: Math.min(T.r * 0.2, D / AU_M), vMin: 1.02 * vesc, vMax: 1.5 * vesc,
      heat: 1, color: T.look.c2, bias: [nx, ny, nz], biasK: 1.6, recoil: T, rho: Math.max(0.5, T.density) });
    if (!made.length) T.m += mEsc;
  }
  w.massChanged(T);
  if (ang > 0.004 || p.m > 1e-6 * T.m)
    w.emit({ kind: 'crater', x: T.x + nx * T.r, y: T.y + ny * T.r, z: T.z + nz * T.r, size: Math.max(D / AU_M, T.r * 0.05), energy: Math.min(1, ang * 4), t: w.time, body: T });
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
  if (a.look.wormhole || b.look.wormhole) {
    const mouth = a.look.wormhole ? a : b, other = mouth === a ? b : a;
    if (other.look.wormhole) return;
    if (traverse(w, mouth, other)) return;
  }
  if (a.look.white || b.look.white) {
    const wh = a.look.white ? a : b;
    repel(w, wh, wh === a ? b : a);
    return;
  }
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
      ev('gw', Math.max(T.r * 50, 1e-4), 0.8);
    } else {
      T.m -= lost;
      if (T.cls !== 'bh' && P.cls === 'bh') becomeRemnant(T, 'bh', T.m);
      if (T.cls === 'ns' && T.m > M_TOV) becomeRemnant(T, 'bh', T.m);
      w.emit({ kind: 'gw', x: cx, y: cy, z: cz, size: Math.max(T.r * 50, 1e-4), energy: lost > 0 ? 1 : 0.6, t: w.time,
        name: lost > 0 ? `Black holes merged — ${fmtMass(lost)} left as gravitational waves` : 'Compact objects merged' });
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
      if (T.compact) swallow(T, P);
      absorbInto(T, P);
      grow(T, T.density);
      refreshRoche(T);
      w.kill(P);
      ev('swallow', Math.max(T.r * 1.5, P.r * 20), Math.min(1, P.m / T.m * 50 + 0.2));
    }
    w.massChanged(T);
    return;
  }

  // something tiny against a world digs a crater rather than merging as an equal
  if (P.m < 1e-4 * T.m && T.cls !== 'debris') {
    crater(w, T, P);
    w.kill(P);
    w.structural();
    return;
  }

  // Fragments are already the smallest thing resolved: when one meets
  // anything that is not a star it sticks, momentum and mass conserved.
  if (T.cls === 'debris' || P.cls === 'debris') {
    // only just touching and already separating: let them go. Anything deeper is
    // a hit, even if found late — a body left inside another would be flung out
    // by the unphysical pull of a point mass at close range
    if (dx * dvx + dy * dvy + dz * dvz > 0 && d > 0.9 * (T.r + P.r)) return;
    const rho = T.cls === 'debris' ? (T.m * T.dens + P.m * (P.cls === 'debris' ? P.dens : P.density)) / (T.m + P.m) : T.density;
    absorbInto(T, P);
    w.kill(P);
    // keep the material's own density: a merged clump must not swell, or its
    // Roche limit would creep out past the orbit it already has
    if (T.cls === 'debris') { T.dens = rho; T.r = radiusFromDensity(T.m, rho); refreshRoche(T); }
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

  if (bImp > Rt / (Rt + Rp) && vImp <= 1.15 * vesc) {
    grazeAndMerge(w, T, P, { vImp, vesc, bImp, bcrit: Rt / (Rt + Rp), rhoMix, heat, color: debrisColor });
    return;
  }
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

  // the angular momentum of the impact, about the pair's centre, ends up as spin
  const spinL = spinVector(T).map((v, i) => v + spinVector(P)[i]);
  const Lo = [mu * (dy * dvz - dz * dvy), mu * (dz * dvx - dx * dvz), mu * (dx * dvy - dy * dvx)];
  // the remnant takes over the target: name, look, class
  T.m = Mlr; T.vx = vx; T.vy = vy; T.vz = vz; T.x = cx; T.y = cy; T.z = cz;
  w.kill(P);
  const tooSmall = Mlr < 1e-12;
  if (tooSmall) w.kill(T);
  else {
    if (P.cls === 'gas' && T.cls !== 'gas' && P.m > T.m * 0.3) T.cls = 'gas';
    T.r = radiusFromDensity(Mlr, T.cls === 'gas' ? Math.min(rhoMix, rhoT) : rhoMix);
    T.heat = Math.min(1, T.heat + heat);
    const keep = Mlr / Mtot;
    setSpin(T, [(spinL[0] + Lo[0]) * keep, (spinL[1] + Lo[1]) * keep, (spinL[2] + Lo[2]) * keep]);
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

/**
 * A grazing impact near escape speed: the projectile shears past, is slowed,
 * comes back and merges, and the spiral arm it trails is left in orbit. This
 * is the regime of the canonical Moon-forming impact (Canup 2004): a few
 * percent of the mass ends up in a disc round the merged body, spinning the
 * way the impact did. Inside the Roche limit that disc can only be a ring;
 * outside it the pieces can gather into a moon.
 */
function grazeAndMerge(w: World, T: Body, P: Body, o: { vImp: number; vesc: number; bImp: number; bcrit: number; rhoMix: number; heat: number; color: number }) {
  const Mtot = T.m + P.m;
  // Canup (2004): a 45° graze at about escape speed puts ~2% of the mass in orbit;
  // more oblique impacts more, faster ones lose some of it to escape
  const x = Math.min(1, (o.bImp - o.bcrit) / (1 - o.bcrit));
  const fDisk = (0.016 + 0.06 * x) * Math.max(0.4, 1 - 0.8 * Math.max(0, o.vImp / o.vesc - 1));
  const disk = fDisk * Mtot;
  const cx = (T.x * T.m + P.x * P.m) / Mtot, cy = (T.y * T.m + P.y * P.m) / Mtot, cz = (T.z * T.m + P.z * P.m) / Mtot;
  const vx = (T.vx * T.m + P.vx * P.m) / Mtot, vy = (T.vy * T.m + P.vy * P.m) / Mtot, vz = (T.vz * T.m + P.vz * P.m) / Mtot;
  const dx = P.x - T.x, dy = P.y - T.y, dz = P.z - T.z, ux = P.vx - T.vx, uy = P.vy - T.vy, uz = P.vz - T.vz;
  // orbital angular momentum of the pair about their centre of mass
  const mu = T.m * P.m / Mtot;
  let lx = dy * uz - dz * uy, ly = dz * ux - dx * uz, lz = dx * uy - dy * ux;
  const Limp = mu * Math.hypot(lx, ly, lz);
  const ln = Math.hypot(lx, ly, lz) || 1; lx /= ln; ly /= ln; lz /= ln;
  // a basis in the impact plane
  let ax = dx, ay = dy, az = dz;
  const an = Math.hypot(ax, ay, az) || 1; ax /= an; ay /= an; az /= an;
  const bx = ly * az - lz * ay, by = lz * ax - lx * az, bz = lx * ay - ly * ax;

  const spinL = spinVector(T, 1).map((v, i) => v + spinVector(P, 1)[i]);
  T.m = Mtot - disk;
  T.x = cx; T.y = cy; T.z = cz; T.vx = vx; T.vy = vy; T.vz = vz;
  if (P.cls === 'gas' && P.m > 0.3 * T.m) T.cls = 'gas';
  T.r = radiusFromDensity(T.m, o.rhoMix);
  T.heat = 1;
  refreshRoche(T);
  w.kill(P);

  // The disc is vapour and melt of the mantles, about 3.3 g/cm³. Its Roche
  // limit splits it: inside, only a ring of small pieces can exist (test
  // particles that collide and settle); outside, self-gravitating clumps that
  // can gather into a moon. Surface density falls as r^−1.5 out to twice that
  // limit, about half the mass outside it, which gives the disc the specific
  // angular momentum the impact simulations find.
  const rhoDisc = Math.min(3.3, o.rhoMix);
  const aR = 2.44 * T.r * Math.cbrt(T.density / rhoDisc);
  const rMin = 1.15 * T.r, rMax = Math.max(2 * aR, 3 * T.r);
  const sq0 = Math.sqrt(rMin), sq1 = Math.sqrt(rMax);
  const uR = Math.min(1, Math.max(0, (Math.sqrt(aR) - sq0) / (sq1 - sq0))); // mass fraction inside aR
  const fIn = uR;
  // 500 small pieces inside. Outside, the impact simulations find the material
  // not as a fine swarm but as a few intact clumps of Theia's mantle, the largest
  // holding about half of it (Canup & Asphaug 2001; Canup 2004)
  const nIn = fIn > 0 ? 500 : 0;
  const CLUMPS = [0.5, 0.25, 0.15, 0.1];
  const mIn = disk * fIn, mOut = disk - mIn;
  const placed: [number, number, number][] = [];
  const made: Body[] = [];
  let sx = 0, sy = 0, sz = 0, qx = 0, qy = 0, qz = 0, mDisk = 0, Ldisk = 0;
  const one = (outer: boolean, mEach: number, at?: [number, number]) => {
    const rFrag = radiusFromDensity(mEach, rhoDisc);
    let px = 0, py = 0, pz = 0, rr = 0, th = 0;
    for (let tries = 0; tries < 40; tries++) {
      const lo = outer ? uR : 0, hi = outer ? 1 : uR;
      rr = at ? at[0] : (sq0 + (sq1 - sq0) * (lo + (hi - lo) * rnd())) ** 2;
      th = at ? at[1] : 2 * Math.PI * rnd();
      const h = (rnd() - 0.5) * 0.04 * rr;
      px = (ax * Math.cos(th) + bx * Math.sin(th)) * rr + lx * h;
      py = (ay * Math.cos(th) + by * Math.sin(th)) * rr + ly * h;
      pz = (az * Math.cos(th) + bz * Math.sin(th)) * rr + lz * h;
      if (!outer || !placed.some(q => (q[0] - px) ** 2 + (q[1] - py) ** 2 + (q[2] - pz) ** 2 < 4.4 * rFrag * rFrag)) break;
    }
    if (outer) placed.push([px, py, pz]);
    const vc = Math.sqrt(G * T.m / rr) * (0.98 + 0.04 * rnd());
    const vr = (rnd() - 0.5) * 0.04 * vc;
    const tx = -ax * Math.sin(th) + bx * Math.cos(th), ty = -ay * Math.sin(th) + by * Math.cos(th), tz = -az * Math.sin(th) + bz * Math.cos(th);
    const rx = px / rr, ry = py / rr, rz = pz / rr;
    const pvx = tx * vc + rx * vr, pvy = ty * vc + ry * vr, pvz = tz * vc + rz * vr;
    const f = new Body({ name: outer ? 'debris' : 'fragment', kind: 'fragment', cls: 'debris', m: mEach, r: rFrag, source: outer, spin: 0,
      look: { style: 'barren', seed: ++fragSeq, c1: o.color, c2: o.color } });
    f.setPos(cx + px, cy + py, cz + pz);
    f.setVel(pvx, pvy, pvz);
    f.heat = 1;
    f.dens = rhoDisc;
    sx += mEach * pvx; sy += mEach * pvy; sz += mEach * pvz;
    qx += mEach * px; qy += mEach * py; qz += mEach * pz; mDisk += mEach;
    Ldisk += mEach * rr * vc;
    made.push(f);
  };
  for (let k = 0; k < nIn; k++) one(false, mIn / nIn);
  if (mOut > 0) {
    // spread round the orbit, each with its periapsis safely beyond the Roche limit
    const th0 = 2 * Math.PI * rnd();
    CLUMPS.forEach((f, k) => one(true, f * mOut, [aR * (1.15 + 0.5 * rnd()), th0 + (k * 2 * Math.PI) / CLUMPS.length + 0.3 * (rnd() - 0.5)]));
  }
  // Each piece is on its orbit about the merged body. A few big clumps are not
  // spread evenly round it, so their centre of mass and momentum are off-centre:
  // the merged body takes the recoil, keeping the pair's totals exactly, rather
  // than every piece being given a common drift that would make all their orbits eccentric.
  const Mt = T.m + mDisk;
  const ex = cx - qx / Mt, ey = cy - qy / Mt, ez = cz - qz / Mt;
  T.x = ex; T.y = ey; T.z = ez;
  T.vx = vx - sx / Mt; T.vy = vy - sy / Mt; T.vz = vz - sz / Mt;
  for (const f of made) {
    f.x += ex - cx; f.y += ey - cy; f.z += ez - cz;
    f.vx += T.vx; f.vy += T.vy; f.vz += T.vz;
    if (f.source) refreshRoche(f);
    w.add(f);
  }
  // what the disc did not take spins the merged body up — the five-hour day the young Earth was left with
  const Lrest = Math.max(0, Limp - Ldisk);
  setSpin(T, [spinL[0] + Lrest * lx, spinL[1] + Lrest * ly, spinL[2] + Lrest * lz]);
  // A third or so of the disc starts as rock vapour (Canup 2004); it drags on
  // the moonlets until it condenses, about a year, turning in the impact's plane.
  w.addVapour(T, 0.3 * disk, T.r, Math.max(rMax, 10 * T.r), [lx, ly, lz], 1);
  w.massChanged(T);
  w.structural();
  w.emit({ kind: 'merge', x: cx, y: cy, z: cz, size: T.r * 6, energy: 1, t: w.time,
    name: `Graze and merge — ${fmtMass(disk)} thrown into orbit` });
}

/** moment-of-inertia factor I / (m r²): centrally condensed worlds and stars sit below a uniform ball's 0.4 */
function inertiaK(b: Body) { return b.cls === 'star' ? 0.08 : b.cls === 'gas' ? 0.25 : 0.33; }

/** spin angular momentum as a vector along the body's pole, times `k` */
export function spinVector(b: Body, k = 1): [number, number, number] {
  const L = k * inertiaK(b) * b.m * b.r * b.r * b.spin;
  const t = b.tilt, n = b.node;
  return [L * Math.sin(t) * Math.sin(n), -L * Math.sin(t) * Math.cos(n), L * Math.cos(t)];
}

/** Give a body this spin angular momentum, no faster than it can turn without flying apart. */
export function setSpin(b: Body, L: [number, number, number]) {
  const n = Math.hypot(L[0], L[1], L[2]);
  if (!(n > 0)) return;
  const wMax = Math.sqrt(G * b.m / b.r ** 3);
  b.spin = Math.min(wMax, n / (inertiaK(b) * b.m * b.r * b.r));
  b.tilt = Math.acos(Math.max(-1, Math.min(1, L[2] / n)));
  b.node = Math.atan2(L[0] / n, -L[1] / n);
}

/**
 * Tides. Inside its Roche distance a body is pulled apart harder than its own
 * gravity holds it, but how much it loses depends on how deep the pass goes,
 * measured by the penetration factor β = r_t / r_p, where r_t = R (M/m)^⅓ is the
 * tidal radius and r_p the closest approach. Fluid bodies (stars, giants, any
 * world big enough to be round) start losing their outer layers at β ≈ 0.5
 * and are destroyed outright past β ≈ 0.9 (Guillochon & Ramirez-Ruiz 2013);
 * rubble piles hold on a little deeper.
 *
 * A pass is handled in two stages. Crossing the Roche distance only works out
 * where this pass will do its damage. The body is torn at that point: the
 * tidal radius for a full disruption, the periapsis for a partial one. That
 * matters, because the spread in orbital energy across the body, which sets
 * how long the debris stream is and how fast it falls back, is set where it
 * comes apart: ΔE ≈ G M R / r².
 */
export function disrupt(w: World, b: Body, by: Body) {
  const rx = b.x - by.x, ry = b.y - by.y, rz = b.z - by.z;
  const vx = b.vx - by.vx, vy = b.vy - by.vy, vz = b.vz - by.vz;
  const r2 = rx * rx + ry * ry + rz * rz, r = Math.sqrt(r2);
  const mu = G * (by.m + b.m);
  const hx = ry * vz - rz * vy, hy = rz * vx - rx * vz, hz = rx * vy - ry * vx;
  const h2 = hx * hx + hy * hy + hz * hz;
  const eps = (vx * vx + vy * vy + vz * vz) / 2 - mu / r;
  const e = Math.sqrt(Math.max(0, 1 + (2 * eps * h2) / (mu * mu)));
  const rp = Math.min(r, h2 / (mu * (1 + e)));
  const fac = rocheFactor(b) || 2.44;
  const rRoche = b.rocheK * Math.cbrt(by.m);
  const rt = rRoche / fac;
  const fluid = fac > 2;
  const q = rp / rRoche;
  const qFull = fluid ? 0.455 : 0.6, qOnset = fluid ? 0.85 : 0.95;
  const x = Math.max(0, Math.min(1, (qOnset - q) / (qOnset - qFull)));
  // A body that stays inside — a nearly circular orbit, apoapsis within the
  // limit — has no way out: it overflows its Roche lobe every orbit and comes
  // apart. One only passing through loses what lies beyond its Lagrange points.
  const ra = eps < 0 ? h2 / (mu * Math.max(1e-9, 1 - e)) : Infinity;
  const trapped = ra < rRoche;
  const frac = q <= qFull || trapped ? 1 : 0.98 * x * x;
  const full = frac > 0.7;

  if (b.tidalHost !== by.id || b.tidalR <= 0) {
    if (b.tidalHost === by.id) return; // this pass has already done its work
    b.tidalHost = by.id;
    b.tidalT = w.time;
    if (frac < 0.01) { b.tidalR = 0; return; } // too shallow to lose anything
    const rBreak = full ? (trapped ? r : Math.max(rt, rp * 1.02)) : rp * 1.05;
    b.tidalR = rBreak;
    if (r > rBreak) return;
  }
  b.tidalR = 0;
  b.tidalT = w.time;

  // spin-locked: the pieces keep the angular rate the body had about its host
  const omega: [number, number, number] = [hx / r2, hy / r2, hz / r2];
  const gas = b.cls === 'star' || b.cls === 'gas';
  const color = b.cls === 'star' ? 0xffc080 : b.cls === 'gas' ? 0xd8b890 : b.cls === 'ice' ? 0xc8d8e8 : 0x9a8070;
  const rho = b.cls === 'debris' ? b.dens : b.density;
  const big = by.cls === 'bh' && by.m > 1e3;

  if (full) {
    spawnFragments(w, { mass: b.m, n: b.cls === 'star' ? (big ? 1500 : 900) : b.cls === 'gas' ? 800 : b.cls === 'debris' && !b.source ? 60 : b.r > 200 * KM ? 1200 : 400, cls: gas ? 'gasp' : 'debris',
      x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, rIn: 0, rOut: b.r, vMin: 0, vMax: 0,
      heat: gas ? 0.9 : 0.5, color, omega, rho });
    w.kill(b);
    w.structural();
    const beta = rt / rp;
    w.emit({ kind: 'disrupt', x: b.x, y: b.y, z: b.z, size: b.r * 4, energy: 0.6, t: w.time, body: by,
      name: `${b.name} was torn apart by ${by.name}${beta > 1.5 ? ` (β = ${beta.toFixed(1)})` : ''}` });
    return;
  }

  // Partial: the layers beyond its inner and outer Lagrange points are pulled
  // off on both sides, the near side into a tail that leads, more tightly bound
  // than the body, and the far side into one that trails, less bound.
  const dm = frac * b.m;
  const ux = rx / r, uy = ry / r, uz = rz / r;
  // what is left must not be touching what it lost, or it would sweep it straight back up
  const solid = b.cls === 'rock' || b.cls === 'ice' || b.cls === 'debris';
  const rNew = solid ? radiusFromDensity(b.m - dm, rho) : b.r;
  const rL = Math.max(1.08 * rNew, r * Math.cbrt(b.m / (3 * by.m)));
  const made = spawnFragments(w, { mass: dm, n: Math.max(40, Math.min(600, Math.round(frac * 1500))), cls: gas ? 'gasp' : 'debris',
    x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, rIn: rL, rOut: rL * 1.25, vMin: 0, vMax: 0,
    heat: gas ? 0.8 : 0.5, color, omega, rho, recoil: b, bipolar: [ux, uy, uz] });
  const lost = made.reduce((t, p) => t + p.m, 0);
  if (lost <= 0) return;
  b.m -= lost;
  // a rocky world keeps its density; a giant or a star swells a little as it is
  // unloaded, so it is drawn no smaller
  if (solid) b.r = radiusFromDensity(b.m, rho);
  b.heat = Math.min(1, b.heat + frac * 2);
  refreshRoche(b);
  w.massChanged(b);
  w.emit({ kind: 'strip', x: b.x, y: b.y, z: b.z, size: b.r * 3, energy: Math.min(1, frac * 3), t: w.time, body: b,
    name: `${by.name}'s tides stripped ${Math.round(frac * 100)}% of ${b.name}` });
}

/** A tidal pass is over once the body is well clear, or has gone once round inside. */
export function tidalReset(w: World, b: Body) {
  const by = w.sources.find(s => s.id === b.tidalHost);
  if (!by || !by.alive) { b.tidalHost = 0; b.tidalR = 0; return; }
  const r = Math.hypot(b.x - by.x, b.y - by.y, b.z - by.z);
  const rRoche = b.rocheK * Math.cbrt(by.m);
  const period = 2 * Math.PI * Math.sqrt(r ** 3 / (G * (by.m + b.m)));
  if (r > 1.15 * rRoche || (b.tidalR === 0 && w.time - b.tidalT > period)) { b.tidalHost = 0; b.tidalR = 0; }
}

const VSN = 5000 * KMS, VIA = 10000 * KMS;

/** End of a star's life. */
export function starDeath(w: World, b: Body, ev: 'wd' | 'sn' | 'collapse' | 'ia' | 'ns-collapse') {
  const s = b.star!;
  const name = b.name;
  const at = (kind: Parameters<World['emit']>[0]['kind'], size: number, energy: number) =>
    w.emit({ kind, x: b.x, y: b.y, z: b.z, size, energy, t: w.time, body: b, name });
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
  // fine enough that a few hundred parcels are in flight at once, so the outflow reads as a cloud
  const parcel = Math.max(1e-7, (s.m0 - s.coreM) / 30000);
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

/**
 * Shatter a body outright: a catastrophic disruption, its pieces leaving at a
 * little over its escape speed. Heavy enough pieces keep their own gravity,
 * so what is left can gather again into a rubble pile.
 */
export function shatterBody(w: World, b: Body) {
  const vesc = Math.sqrt(2 * G * b.m / Math.max(b.r, 1e-12));
  const gas = b.cls === 'gas';
  const heavy = !gas && b.m > 1e-12;
  const color = gas ? 0xd8b890 : b.cls === 'ice' ? 0xc8d8e8 : b.look.c2;
  spawnFragments(w, { mass: b.m, n: heavy ? 40 : 500, source: heavy, cls: gas ? 'gasp' : 'debris', x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz,
    rIn: b.r * 0.4, rOut: b.r * 1.6, vMin: 0.7 * vesc, vMax: 1.6 * vesc, heat: 1, color, rho: b.cls === 'debris' ? b.dens : b.density });
  w.kill(b);
  w.structural();
  w.emit({ kind: 'impact', x: b.x, y: b.y, z: b.z, size: b.r * 6, energy: 1, t: w.time, body: b, name: `${b.name} was shattered` });
}
