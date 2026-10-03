import type { Body } from './body';
import { G, C } from './units';

/**
 * Fourth-order Hermite predictor-corrector with individual block time steps
 * (Makino & Aarseth 1992) — the standard integrator for collisional N-body work.
 *
 * Every body carries its own step, a power-of-two fraction of the span being
 * advanced, chosen from its own acceleration and its derivatives (Aarseth's
 * criterion). Io steps a few thousand times a year while Neptune steps a few
 * times, and a belt of asteroids never pays for the moons. All bodies land
 * together at the end of each `advance` call, so what is drawn is exact.
 *
 * Forces: Newtonian gravity with no softening, plus
 *  - the leading relativistic correction as a 1/r^3 potential term, which
 *    reproduces the 1PN periapsis advance 6πGM/(c²a(1-e²)) exactly (Nobili &
 *    Roxburgh 1986) while staying conservative;
 *  - gravitational-wave radiation reaction between compact objects, as a drag
 *    on the relative motion sized to the Peters (1964) power;
 *  - radiation pressure from luminous sources on test particles with β > 0.
 */

const K_TICKS = 52;               // local time is counted in 2^-52 of the span
const SPAN = 2 ** K_TICKS;
const K_MAX = 44;                 // finest level allowed: span / 2^44
const C2 = C * C;
const C5 = C2 * C2 * C;
const GW_K = (32 / 5) * G ** 4;
const DISC = 2e-5; // AU, ~3000 km

export interface Hit { a: Body; b: Body; kind: 'collide' | 'roche'; }

export class Hermite {
  /** accuracy parameter of the step criterion; smaller is more accurate */
  eta = 0.005;
  /** start-up criterion, used when there are no higher derivatives yet */
  etaStart = 0.004;
  /** never cross more than this fraction of the distance to any source in one step */
  etaCross = 0.2;

  /** corrector passes per step; 2 makes the scheme nearly time-symmetric */
  iterations = 2;
  /** Test particles pull on nothing, so their errors never feed back into the
   *  system: they take one corrector pass and a looser step criterion. */
  etaParticle = 0.02;

  gr = true;
  gw = true;
  rad = true;

  /** collisions and disruptions involving sources — these stop the step */
  hits: Hit[] = [];
  /** test particles that ran into a source; they are dead already, the
   *  caller hands their mass and momentum over once everything is in step */
  absorbed: { p: Body; into: Body }[] = [];
  /** force evaluations performed, for the performance readout */
  evals = 0;

  private levels: Set<Body>[] = Array.from({ length: K_MAX + 1 }, () => new Set());
  private level = new Map<Body, number>();
  private srcs: Body[] = [];
  private span = 0;
  private tick = 0;

  // scratch outputs of evalForce
  private fa = [0, 0, 0];
  private fj = [0, 0, 0];
  private cross = Infinity;
  private hStep = 0;

  /** Fresh accelerations and step sizes for every body at the current state. */
  init(bodies: Body[], sources: Body[]) {
    this.srcs = sources;
    for (const b of bodies) { b.px = b.x; b.py = b.y; b.pz = b.z; b.pvx = b.vx; b.pvy = b.vy; b.pvz = b.vz; b.t = 0; }
    for (const b of bodies) {
      this.evalForce(b, false);
      b.ax = this.fa[0]; b.ay = this.fa[1]; b.az = this.fa[2];
      b.jx = this.fj[0]; b.jy = this.fj[1]; b.jz = this.fj[2];
      const a = Math.hypot(b.ax, b.ay, b.az), j = Math.hypot(b.jx, b.jy, b.jz);
      let dt = j > 0 ? this.etaStart * a / j : Infinity;
      dt = Math.min(dt, this.etaCross * Math.sqrt(this.cross));
      // a body that already has a step keeps it, unless the start-up estimate
      // says the neighbourhood has changed a lot
      b.dtWant = b.dtWant > 0 ? Math.min(b.dtWant, 8 * dt) : dt;
    }
    this.hits.length = 0;
  }

  /**
   * Advance every body by up to `T`. Stops early — with every body brought to
   * the same instant — at the first collision or tidal disruption, or when the
   * wall-clock `deadline` passes. Returns the time actually advanced.
   */
  advance(bodies: Body[], sources: Body[], T: number, deadline: number): number {
    this.srcs = sources;
    this.hits.length = 0;
    this.absorbed.length = 0;
    if (T <= 0 || bodies.length === 0) return T;
    this.span = T;
    this.tick = T / SPAN;

    for (const s of this.levels) s.clear();
    this.level.clear();
    for (const b of bodies) {
      b.t = 0;
      const k = this.levelFor(b.dtWant, 0, 0);
      this.levels[k].add(b);
      this.level.set(b, k);
    }

    let tau = 0;
    let blocks = 0;
    const active: Body[] = [];
    while (tau < SPAN) {
      let kf = K_MAX;
      while (kf > 0 && this.levels[kf].size === 0) kf--;
      const tn = tau + 2 ** (K_TICKS - kf);

      active.length = 0;
      for (let k = 0; k <= kf; k++) {
        if (this.levels[k].size && tn % 2 ** (K_TICKS - k) === 0) for (const b of this.levels[k]) active.push(b);
      }

      for (const s of sources) this.predict(s, tn);
      this.stepGroup(active, tn, true);

      for (const b of active) {
        const k = this.level.get(b)!;
        // a particle swallowed this step leaves the schedule, or its tiny
        // last step would keep the block clock ticking with nothing to do
        if (!b.alive) { this.levels[k].delete(b); this.level.delete(b); continue; }
        const kn = this.levelFor(b.dtWant, k, tn);
        if (kn !== k) { this.levels[k].delete(b); this.levels[kn].add(b); this.level.set(b, kn); }
      }
      tau = tn;

      if (this.hits.length) { this.syncTo(bodies, tau); return tau * this.tick; }
      if ((++blocks & 63) === 0 && performance.now() > deadline && tau < SPAN) {
        this.syncTo(bodies, tau);
        return tau * this.tick;
      }
    }
    for (const b of bodies) b.t = 0;
    return T;
  }

  /** Bring every body to local tick `tau` with a partial step, then zero the clocks. */
  private syncTo(bodies: Body[], tau: number) {
    for (const s of this.srcs) this.predict(s, tau);
    const lag: Body[] = [];
    for (const b of bodies) if (b.t < tau && b.alive) lag.push(b);
    this.stepGroup(lag, tau, false);
    for (const b of bodies) b.t = 0;
  }

  /** Pick the block level for a wanted step: as coarse as allowed, but at most
   *  one level coarser than now, and only at a time the coarser level divides. */
  private levelFor(dtWant: number, kOld: number, tn: number): number {
    let k = dtWant >= this.span ? 0 : Math.ceil(Math.log2(this.span / dtWant));
    if (!(k >= 0)) k = 0;
    if (k > K_MAX) k = K_MAX;
    if (tn > 0 && k < kOld) {
      k = kOld - 1;
      if (tn % 2 ** (K_TICKS - k) !== 0) k = kOld;
    }
    return k;
  }

  private predict(b: Body, tn: number) {
    const h = (tn - b.t) * this.tick;
    if (h === 0) { b.px = b.x; b.py = b.y; b.pz = b.z; b.pvx = b.vx; b.pvy = b.vy; b.pvz = b.vz; return; }
    const h2 = h * h / 2, h3 = h * h * h / 6;
    b.px = b.x + b.vx * h + b.ax * h2 + b.jx * h3;
    b.py = b.y + b.vy * h + b.ay * h2 + b.jy * h3;
    b.pz = b.z + b.vz * h + b.az * h2 + b.jz * h3;
    b.pvx = b.vx + b.ax * h + b.jx * h2;
    b.pvy = b.vy + b.ay * h + b.jy * h2;
    b.pvz = b.vz + b.az * h + b.jz * h2;
  }

  /**
   * Take every body in `group` from its own time to `tn`. Sources outside the
   * group must already be predicted to `tn`. The corrector is the
   * time-symmetric Hermite form, iterated (P(EC)^n, Kokubo, Yoshinaga & Makino
   * 1998): the second pass evaluates forces at the corrected state, which
   * removes most of the secular energy drift of the one-pass scheme.
   */
  private stepGroup(group: Body[], tn: number, live: boolean) {
    for (const b of group) if (!b.source || !live) this.predict(b, tn);
    for (let it = 0; it < this.iterations; it++) {
      const last = it === this.iterations - 1;
      for (const b of group) {
        if (!b.alive || (it > 0 && !b.source)) continue;
        this.hStep = (tn - b.t) * this.tick;
        this.evalForce(b, live && (last || !b.source));
        b.nax = this.fa[0]; b.nay = this.fa[1]; b.naz = this.fa[2];
        b.njx = this.fj[0]; b.njy = this.fj[1]; b.njz = this.fj[2];
        b.ncross = this.cross;
      }
      for (const b of group) if (b.alive && (it === 0 || b.source)) this.correct(b, (tn - b.t) * this.tick);
    }
    for (const b of group) this.commit(b, tn, live);
  }

  /** Corrected state into px/pv, from the start-of-step state still held in x/v/a/j. */
  private correct(b: Body, h: number) {
    if (h === 0 || b.held) return;
    const h2 = h / 2, h12 = h * h / 12;
    const vx = b.vx + h2 * (b.ax + b.nax) + h12 * (b.jx - b.njx);
    const vy = b.vy + h2 * (b.ay + b.nay) + h12 * (b.jy - b.njy);
    const vz = b.vz + h2 * (b.az + b.naz) + h12 * (b.jz - b.njz);
    b.px = b.x + h2 * (b.vx + vx) + h12 * (b.ax - b.nax);
    b.py = b.y + h2 * (b.vy + vy) + h12 * (b.ay - b.nay);
    b.pz = b.z + h2 * (b.vz + vz) + h12 * (b.az - b.naz);
    b.pvx = vx; b.pvy = vy; b.pvz = vz;
  }

  private commit(b: Body, tn: number, live: boolean) {
    const h = (tn - b.t) * this.tick;
    b.t = tn;
    if (h === 0) return;
    b.x = b.px; b.y = b.py; b.z = b.pz;
    b.vx = b.pvx; b.vy = b.pvy; b.vz = b.pvz;
    if (b.held) { b.ax = b.ay = b.az = b.jx = b.jy = b.jz = 0; return; }
    const ih = 1 / h, ih2 = ih * ih, ih3 = ih2 * ih;
    const da = [b.ax - b.nax, b.ay - b.nay, b.az - b.naz];
    const j0 = [b.jx, b.jy, b.jz], j1 = [b.njx, b.njy, b.njz];
    let S = 0, R = 0;
    for (let k = 0; k < 3; k++) {
      const s2 = (-6 * da[k] - h * (4 * j0[k] + 2 * j1[k])) * ih2;
      const s3 = (12 * da[k] + 6 * h * (j0[k] + j1[k])) * ih3;
      const c2 = s2 + h * s3;
      S += c2 * c2; R += s3 * s3;
    }
    S = Math.sqrt(S); R = Math.sqrt(R);
    b.ax = b.nax; b.ay = b.nay; b.az = b.naz;
    b.jx = b.njx; b.jy = b.njy; b.jz = b.njz;

    // Aarseth's criterion at the end of the step; skip it for sliver steps
    // taken only to synchronise, whose difference quotients are noise.
    if (!live && h < 0.25 * b.dtWant) return;
    const A = Math.hypot(b.ax, b.ay, b.az), J = Math.hypot(b.jx, b.jy, b.jz);
    const den = J * R + S * S;
    let dt = den > 0 ? Math.sqrt((b.source ? this.eta : this.etaParticle) * (A * S + J * J) / den) : Infinity;
    if (!(dt > 0)) dt = Infinity;
    b.dtWant = Math.min(dt, this.etaCross * Math.sqrt(b.ncross));
  }

  /** Returns true when `b` is gone and the force loop should stop. */
  private contact(b: Body, s: Body): boolean {
    if (!b.source) { b.alive = false; this.absorbed.push({ p: b, into: s }); return true; }
    this.hits.push({ a: b, b: s, kind: 'collide' });
    return false;
  }

  /**
   * Acceleration and jerk on `b` at its predicted state, from every source at
   * its predicted state. Also notes contacts and Roche-limit incursions.
   */
  private evalForce(b: Body, detect: boolean) {
    this.evals++;
    let ax = 0, ay = 0, az = 0, jx = 0, jy = 0, jz = 0;
    let cross = Infinity;
    const xi = b.px, yi = b.py, zi = b.pz, vxi = b.pvx, vyi = b.pvy, vzi = b.pvz;
    const mi = b.m;
    const bcr = b.captureRadius;
    const rocheK = b.rocheK;
    const gwB = this.gw && b.compact;
    const beta = this.rad ? b.beta : 0;
    if (b.held) { this.fa[0] = this.fa[1] = this.fa[2] = 0; this.fj[0] = this.fj[1] = this.fj[2] = 0; this.cross = Infinity; return; }

    for (const s of this.srcs) {
      if (s === b) continue;
      const dx = s.px - xi, dy = s.py - yi, dz = s.pz - zi;
      const dvx = s.pvx - vxi, dvy = s.pvy - vyi, dvz = s.pvz - vzi;
      const r2 = dx * dx + dy * dy + dz * dz;
      // two bodies on exactly the same spot would turn everything to NaN: the collision code deals with them
      if (!(r2 > 0)) continue;
      const rv = dx * dvx + dy * dvy + dz * dvz;
      const v2 = dvx * dvx + dvy * dvy + dvz * dvz;
      const inv2 = 1 / r2, inv = Math.sqrt(inv2), inv3 = inv * inv2;
      const ms = s.m;

      const fN = G * ms * inv3;
      let f = fN;
      let g = -3 * rv * inv2 * fN;
      if (this.gr) {
        // potential -3 G² M m_i m_s / (c² r²): force 6 G² M m_s / c² · r / r⁴ on b
        const fG = 6 * G * G * (mi + ms) * ms / C2 * inv2 * inv2;
        f += fG;
        g += -4 * rv * inv2 * fG;
      }
      let prx = 0, pry = 0, prz = 0;
      if (beta > 0 && s.star && s.star.L > 0) {
        const fR = beta * G * s.star.L * inv3;
        f -= fR;
        g -= -3 * rv * inv2 * fR;
        // Poynting–Robertson drag: the light is aberrated by the grain's own
        // motion, a drag of order v/c that makes dust spiral into its star
        // (βGL / r²c)(−ṙ r̂ − v): with d = star − grain and dv = v_star − v_grain,
        // ṙ = d·dv / r and this is (βGL / r³c)(ṙ d + r dv)
        const k = fR / C, rdot = rv * inv, r = 1 / inv;
        prx = k * (rdot * dx + r * dvx);
        pry = k * (rdot * dy + r * dvy);
        prz = k * (rdot * dz + r * dvz);
      }
      ax += f * dx + prx; ay += f * dy + pry; az += f * dz + prz;
      jx += f * dvx + g * dx; jy += f * dvy + g * dy; jz += f * dvz + g * dz;

      if (gwB && s.compact && v2 > 0) {
        // Radiation reaction on the relative orbit, sized so the power drawn
        // matches Peters' dE/dt = -(32/5) G⁴ m1² m2² M / (c⁵ r⁵).
        const M = mi + ms;
        const K = GW_K * mi * ms * M * M / C5 * inv2 * inv2 * inv / v2;
        const w = K * ms / M;
        // d/dt of w·dv, with the relative acceleration taken as Newtonian
        const arelF = -G * M * inv3;
        const av = arelF * rv; // dv · a_rel
        const wdot = w * (-5 * rv * inv2 - 2 * av / v2);
        ax += w * dvx; ay += w * dvy; az += w * dvz;
        jx += wdot * dvx + w * arelF * dx;
        jy += wdot * dvy + w * arelF * dy;
        jz += wdot * dvz + w * arelF * dz;
      }

      const c = r2 / (v2 + 1e-300);
      if (c < cross) cross = c;
      const ff = r2 * r2 / (G * (mi + ms) * r2 * inv);
      if (ff < cross) cross = ff;

      if (detect) {
        // A test particle that reaches a compact object joins its accretion
        // disc, which is not resolved here, rather than being followed down
        // to a 12 km surface on microsecond steps.
        const rc = !b.source && s.compact ? Math.max(bcr + s.captureRadius, DISC) : bcr + s.captureRadius;
        if (r2 < rc * rc) { if (this.contact(b, s)) break; }
        else {
          // swept test over the step just taken: did the pair pass through
          // contact between the previous block and this one?
          const h = this.hStep;
          const reach = rc + Math.sqrt(v2) * h;
          if (r2 < reach * reach && rv > 0) {
            const tc = Math.max(-h, -rv / v2);
            const d2 = r2 + 2 * rv * tc + v2 * tc * tc;
            if (d2 < rc * rc && this.contact(b, s)) break;
          }
          if (rocheK > 0 && ms > 10 * mi) {
            // first the Roche distance, where tides start to win; once a pass is
            // under way, the distance at which this pass actually tears it
            const rr = b.tidalHost === s.id ? b.tidalR : rocheK * Math.cbrt(ms);
            if (r2 < rr * rr) this.hits.push({ a: b, b: s, kind: 'roche' });
          }
        }
      }
    }
    this.fa[0] = ax; this.fa[1] = ay; this.fa[2] = az;
    this.fj[0] = jx; this.fj[1] = jy; this.fj[2] = jz;
    this.cross = cross;
  }
}

/**
 * Total energy, Msun AU² / yr²: every body's kinetic energy, the potential
 * between sources, and between each test particle and the sources (particles
 * do not interact with one another).
 */
export function energy(bodies: Body[], gr = true): number {
  let E = 0;
  const live = bodies.filter(b => b.alive);
  const src = live.filter(b => b.source);
  for (const b of live) E += 0.5 * b.m * (b.vx ** 2 + b.vy ** 2 + b.vz ** 2);
  for (let i = 0; i < src.length; i++) {
    for (let j = i + 1; j < src.length; j++) {
      const a = src[i], b = src[j];
      const r = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      E -= G * a.m * b.m / r;
      if (gr) E -= 3 * G * G * (a.m + b.m) * a.m * b.m / (C2 * r * r);
    }
  }
  for (const p of live) {
    if (p.source || p.m === 0) continue;
    for (const s of src) E -= G * p.m * s.m / Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z);
  }
  return E;
}
