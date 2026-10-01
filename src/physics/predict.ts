import { Body } from './body';
import { Hermite } from './integrator';
import { G } from './units';
import { osculating, relative } from './orbit';

/** Shallow copy with fresh integrator state, so prediction never touches the live sim. */
function clone(b: Body): Body {
  const c = Object.assign(Object.create(Body.prototype), b) as Body;
  c.dtWant = 0;
  c.held = false;
  return c;
}

export interface Prediction {
  /** world positions along the path, relative to the host's position at each moment, re-anchored to where the host is now */
  points: [number, number, number][];
  impact: [number, number, number] | null;
  hitName: string | null;
}

/**
 * Integrate the system forward with the would-be body in it, using the same
 * integrator as the live simulation — so the line is the real future path,
 * perturbations, slingshots and all, not a Keplerian guess.
 */
export function predict(sources: Body[], probe: Body, host: Body | null, budgetMs = 7): Prediction {
  const keep = host ? sources.filter(s => s === host || s.m > 1e-6 * host.m) : sources;
  const srcs = keep.map(clone);
  const hostC = host ? srcs[keep.indexOf(host)] : null;
  const p = clone(probe);
  p.source = false;
  const all = [...srcs, p];
  const integ = new Hermite();
  integ.eta = 0.02;
  integ.iterations = 1;
  integ.init(all, srcs);

  // horizon: about one orbit if it is bound, otherwise long enough to leave
  let horizon = 1;
  if (hostC) {
    const { r, v, mu } = relative(p, hostC);
    const o = osculating(mu, r, v);
    const d = Math.hypot(...r);
    horizon = o.a > 0 && o.e < 1 ? Math.min(o.period * 1.02, 1e6) : (6 * d) / Math.max(Math.hypot(...v), Math.sqrt((G * hostC.m) / d));
  }
  const N = 600;
  const dt = horizon / N;
  const deadline = performance.now() + budgetMs;
  const pts: [number, number, number][] = [];
  const hx0 = host ? host.x : 0, hy0 = host ? host.y : 0, hz0 = host ? host.z : 0;
  const rel = () => {
    const hx = hostC ? hostC.x : 0, hy = hostC ? hostC.y : 0, hz = hostC ? hostC.z : 0;
    pts.push([p.x - hx + hx0, p.y - hy + hy0, p.z - hz + hz0]);
  };
  rel();
  for (let k = 0; k < N && performance.now() < deadline; k++) {
    let done = 0;
    while (done < dt * 0.999999) {
      done += integ.advance(all, srcs, dt - done, deadline);
      if (!p.alive || integ.hits.length) {
        const hit = integ.absorbed[0]?.into ?? integ.hits.find(h => h.a === p || h.b === p)?.b ?? null;
        rel();
        const hi = hit ? keep[srcs.indexOf(hit)] : null;
        return { points: pts, impact: pts[pts.length - 1], hitName: hi?.name ?? null };
      }
      if (performance.now() > deadline) break;
    }
    rel();
  }
  return { points: pts, impact: null, hitName: null };
}
