import type { Body } from './body';
import { Hermite } from './integrator';
import { accrete, collide, disrupt, starDeath, wind, cometActivity, type SimEvent } from './events';
import { evolve } from './stellar';
import { refreshRoche } from './catalog';
import { G } from './units';

/**
 * The simulation: a set of bodies, the integrator that moves them, and
 * everything that happens to them between steps — collisions, tidal
 * disruption, stars ageing and dying.
 */
export class World {
  bodies: Body[] = [];
  sources: Body[] = [];
  time = 0;
  integ = new Hermite();
  maxParticles = 25000;
  /** events since the renderer last looked */
  events: SimEvent[] = [];
  /** called when bodies are removed, so views can drop what they hold for them */
  onRemove: ((b: Body) => void) | null = null;

  private dirtyStructure = true;
  private dirtyForces = true;
  private massRef = new Map<Body, number>();

  get particleCount() { return this.bodies.length - this.sources.length; }

  add(b: Body) {
    b.alive = true;
    b.dtWant = 0;
    this.bodies.push(b);
    if (b.source) this.sources.push(b);
    this.dirtyForces = true;
  }

  kill(b: Body) {
    if (!b.alive) return;
    b.alive = false;
    this.dirtyStructure = true;
    this.dirtyForces = true;
  }

  clear() {
    for (const b of this.bodies) this.onRemove?.(b);
    this.bodies = [];
    this.sources = [];
    this.events = [];
    this.time = 0;
    this.dirtyStructure = this.dirtyForces = true;
  }

  emit(e: SimEvent) { this.events.push(e); if (this.events.length > 200) this.events.shift(); }
  structural() { this.dirtyStructure = true; this.dirtyForces = true; }
  massChanged(b: Body) { if (b.source) this.dirtyForces = true; b.dtWant = 0; }
  /** a body was moved by hand: its own step size must be found again */
  moved(b: Body) { b.dtWant = 0; this.dirtyForces = true; }

  private rebuild() {
    if (this.dirtyStructure) {
      const dead = this.bodies.filter(b => !b.alive);
      if (dead.length) {
        this.bodies = this.bodies.filter(b => b.alive);
        for (const b of dead) this.onRemove?.(b);
      }
      this.sources = this.bodies.filter(b => b.source);
      this.dirtyStructure = false;
    }
    if (this.dirtyForces) {
      this.integ.init(this.bodies, this.sources);
      this.massRef.clear();
      for (const s of this.sources) this.massRef.set(s, s.m);
      this.dirtyForces = false;
    }
  }

  /**
   * Advance by `T` years or until `deadline` (performance.now() ms).
   * Returns the time actually covered.
   */
  step(T: number, deadline: number): number {
    this.rebuild();
    this.backReaction(T / 2);
    let done = 0;
    let guard = 0;
    while (done < T && guard++ < 400) {
      const got = this.integ.advance(this.bodies, this.sources, T - done, deadline);
      done += got;
      this.time += got;
      for (const { p, into } of this.integ.absorbed) {
        if (into.alive) accrete(this, into, p);
        this.dirtyStructure = true;
      }
      const hits = this.integ.hits.slice();
      const seen = new Set<string>();
      for (const h of hits) {
        if (!h.a.alive || !h.b.alive) continue;
        const key = h.a.id < h.b.id ? `${h.a.id}:${h.b.id}` : `${h.b.id}:${h.a.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (h.kind === 'collide') collide(this, h.a, h.b);
        else disrupt(this, h.a, h.b);
      }
      if (this.dirtyStructure || this.dirtyForces || hits.length) {
        this.dirtyForces = true;
        this.rebuild();
      }
      if (performance.now() > deadline) break;
    }
    this.backReaction(done - T / 2);
    if (done > 0) this.after(done);
    return done;
  }

  /**
   * Test particles carry mass but the integrator does not let sources feel
   * it. Hand that pull back as a kick to each source, half before the step
   * and half after (Strang splitting), so debris, winds and ejecta still
   * tug on what they left — and momentum is kept to second order.
   */
  private backReaction(dt: number) {
    if (dt === 0 || this.sources.length === this.bodies.length) return;
    for (const s of this.sources) {
      if (s.held) continue;
      let ax = 0, ay = 0, az = 0;
      const soft = s.r * s.r;
      for (const p of this.bodies) {
        if (p.source || !p.alive || p.m === 0) continue;
        const dx = p.x - s.x, dy = p.y - s.y, dz = p.z - s.z;
        const r2 = dx * dx + dy * dy + dz * dz + soft;
        const f = G * p.m / (r2 * Math.sqrt(r2));
        ax += f * dx; ay += f * dy; az += f * dz;
      }
      s.vx += ax * dt; s.vy += ay * dt; s.vz += az * dt;
    }
  }

  /** Everything slower than an orbit: stars age, winds blow, debris cools, far strays are dropped. */
  private after(dt: number) {
    const stars = this.sources.filter(b => b.luminous && b.cls === 'star');
    for (const b of [...this.sources]) {
      if (!b.alive) continue;
      b.spinAngle = (b.spinAngle + b.spin * dt) % (2 * Math.PI);
      if (b.heat > 0 && !b.star && b.kind !== 'lava') b.heat *= Math.exp(-dt / 3000);
      if (b.star) {
        const { shed, ev } = evolve(b, dt);
        if (shed > 0) wind(this, b, shed);
        if (ev !== 'none') starDeath(this, b, ev);
        refreshRoche(b);
      }
      if (b.kind === 'comet' && stars.length) cometActivity(this, b, stars, dt);
    }

    // drop particles that have left the system, and comet gas that has thinned out
    let far = 0;
    for (const s of this.sources) far = Math.max(far, Math.hypot(s.x, s.y, s.z) + s.r);
    const cull2 = Math.max(400, 6 * far) ** 2;
    for (const b of this.bodies) {
      if (b.source || !b.alive) continue;
      b.age += dt;
      if (b.heat > 0) b.heat *= Math.exp(-dt / (b.cls === 'gasp' ? 30 : 2));
      const gone = b.x * b.x + b.y * b.y + b.z * b.z > cull2 || (b.beta > 0.5 && b.age > 0.15);
      if (gone) this.kill(b);
    }

    // a source whose mass moved noticeably needs its pull recomputed
    for (const s of this.sources) {
      const m0 = this.massRef.get(s);
      if (m0 === undefined || Math.abs(s.m - m0) > 1e-7 * m0) { this.dirtyForces = true; break; }
    }
  }
}
