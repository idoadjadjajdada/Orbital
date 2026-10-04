import type { Body } from './body';
import type { World } from './world';

/**
 * How a compact object's accretion disc builds up and dies away, from what
 * it actually swallows.
 *
 * Matter that reaches a black hole (or a neutron star) does not light a disc
 * at once. It first has to settle into orbit round it — the stream from a
 * torn star wraps round and collides with itself, a swallowed planet's
 * debris spreads into a ring — and only then does it spiral in through the
 * disc, heating as it goes. So what the physics hands over (`swallowed`, and
 * the spin it brought in `lx ly lz`) goes first into a ring that is still
 * settling, then drains from there into the disc, and from the disc into the
 * hole. The disc's brightness follows what is in it: nothing round a hole
 * that has eaten nothing, a slow brightening after a meal, a bright disc
 * while it is fed, a fading one after. Jets need a disc that has been bright
 * for a while. A hole that comes with its gas already in place (a quasar,
 * TON 618, a microquasar's companion overflowing onto it) starts with its
 * disc and jets established.
 *
 * The time scales are in seconds of watching (the real ones run from hours
 * round a stellar hole to millennia round a quasar), so the build-up can be
 * seen at any speed of time; it holds still while time is paused.
 */

/** seconds for swallowed matter to settle into the disc, and for the disc to drain */
const SETTLE = 4, DRAIN = 10;
/** seconds for the jets to come up once the disc is bright, and to die away */
const JET_UP = 5, JET_DOWN = 8;

export interface DiscState {
  /** mass still settling, and in the disc (M☉) */
  settling: number; disc: number;
  /** how bright the disc is, 0 (none) to 1 (as bright as a quasar's) */
  level: number;
  /** how strong the jets are, 0–1 */
  jet: number;
  /** the disc's axis (unit): the spin of what fell in */
  axis: [number, number, number];
  /** mass falling in, M☉ per year of simulated time, smoothed */
  rate: number;
}

export class Feeding {
  private state = new Map<Body, DiscState>();

  /** the disc of a body, if it has had one (or comes with one) */
  get(b: Body): DiscState | null { return this.state.get(b) ?? null; }

  /** brightness 0–1 of a body's disc (0 for one that has none) */
  level(b: Body) { return this.state.get(b)?.level ?? 0; }

  /** each frame: `dtSim` years of simulated time stepped, `dtReal` seconds of watching */
  update(w: World, dtSim: number, dtReal: number) {
    for (const [b] of this.state) if (!b.alive) this.state.delete(b);
    for (const b of w.sources) {
      if (!b.compact || b.look.white || b.look.wormhole) continue;
      let s = this.state.get(b);
      const fed = b.feed > 0 && b.feedLeft > 0;
      if (!s) {
        if (!fed && b.swallowed <= 0) continue;
        s = { settling: 0, disc: 0, level: fed ? 0.85 : 0, jet: fed ? 1 : 0, axis: [0, 0, 1], rate: 0 };
        this.state.set(b, s);
      }
      // the spin of what has fallen in sets the disc's plane
      const L = Math.hypot(b.lx, b.ly, b.lz);
      if (L > 0) s.axis = [b.lx / L, b.ly / L, b.lz / L];
      if (dtSim <= 0 || dtReal <= 0) { b.swallowed = 0; continue; }
      const inst = b.swallowed / dtSim;
      s.rate += (inst - s.rate) * Math.min(1, dtReal * 1.5);
      // a fed nucleus's own inner disc is already there and stays topped up; what else it eats adds to it
      if (!fed) s.settling += b.swallowed;
      b.swallowed = 0;
      const toDisc = s.settling * (1 - Math.exp(-dtReal / SETTLE));
      s.settling -= toDisc;
      s.disc += toDisc;
      s.disc -= s.disc * (1 - Math.exp(-dtReal / DRAIN));
      // brightness from the disc's mass against the hole's, over six decades: a stray asteroid barely
      // shows, a planet round a stellar hole glows, a star torn apart by a million-sun hole blazes
      const want = Math.max(fed ? 0.85 : 0, s.disc > 0 ? Math.max(0, Math.min(1, (Math.log10(s.disc / b.m) + 12) / 6)) : 0);
      s.level += (want - s.level) * (1 - Math.exp(-dtReal / (want > s.level ? 1.5 : 4)));
      // jets once the disc has been bright a while
      const jw = fed ? 1 : smooth(0.45, 0.8, s.level);
      s.jet += (jw - s.jet) * (1 - Math.exp(-dtReal / (jw > s.jet ? JET_UP : JET_DOWN)));
      if (!fed && s.level < 0.002 && s.settling + s.disc < 1e-15 * b.m) this.state.delete(b);
    }
  }
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
