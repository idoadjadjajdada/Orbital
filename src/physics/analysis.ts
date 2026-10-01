import type { Body } from './body';
import { G } from './units';
import { cross, norm, osculating, relative, unit, type V3 } from './orbit';

/**
 * Who goes round whom. A body belongs to the smallest heavier body whose Hill
 * sphere it is inside and to which it is bound; failing that, to the heaviest
 * body it is bound to. That gives the Moon to the Earth even though the Sun
 * pulls on it twice as hard — the Earth's tide on it is what wins.
 */
export function assignHosts(sources: Body[]): Map<Body, { host: Body | null; hill: number }> {
  const sorted = [...sources].sort((a, b) => b.m - a.m);
  const out = new Map<Body, { host: Body | null; hill: number }>();
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    let best: Body | null = null, bestHill = Infinity, fallback: Body | null = null;
    for (let j = 0; j < i; j++) {
      const h = sorted[j];
      if (h.m <= b.m) continue;
      const { r, v, mu } = relative(b, h);
      const d = norm(r);
      const bound = (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) / 2 - mu / d < 0;
      if (!bound) continue;
      if (!fallback) fallback = h;
      const hill = out.get(h)!.hill;
      if (d < hill && hill < bestHill) { best = h; bestHill = hill; }
    }
    const host = best ?? fallback;
    let hill = Infinity;
    if (host) {
      const { r, v, mu } = relative(b, host);
      const o = osculating(mu, r, v);
      const dist = o.a > 0 ? o.a * (1 - o.e) : norm(r);
      hill = dist * Math.cbrt(b.m / (3 * host.m));
    }
    out.set(b, { host, hill });
    b.hostId = host ? host.id : 0;
  }
  return out;
}

/** The host a test particle or a point in space belongs to, given the source hierarchy. */
export function hostOfPoint(p: V3, vrel: V3 | null, sources: Body[], hosts: Map<Body, { host: Body | null; hill: number }>): Body | null {
  let best: Body | null = null, bestHill = Infinity, heaviest: Body | null = null;
  for (const s of sources) {
    if (!heaviest || s.m > heaviest.m) heaviest = s;
    const d = Math.hypot(p[0] - s.x, p[1] - s.y, p[2] - s.z);
    const hill = hosts.get(s)?.hill ?? Infinity;
    if (d < hill && hill < bestHill && d > s.r) {
      if (vrel) {
        const v2 = (vrel[0] - s.vx) ** 2 + (vrel[1] - s.vy) ** 2 + (vrel[2] - s.vz) ** 2;
        if (v2 / 2 - G * s.m / d >= 0) continue;
      }
      best = s; bestHill = hill;
    }
  }
  return best ?? heaviest;
}

/**
 * The five Lagrange points of a body and its host, in the plane of its orbit.
 * L1–L3 from the collinear equilibrium condition solved numerically; L4/L5 at
 * the apexes of the equilateral triangles.
 */
export function lagrangePoints(b: Body, host: Body): V3[] {
  const M = host.m + b.m, q = b.m / M;
  const { r, v } = relative(b, host);
  const d = norm(r);
  const ex = unit(r);
  const hz = unit(cross(r, v));
  const ey = cross(hz, ex);
  const f = (x: number) => x - (1 - q) * (x + q) / Math.abs(x + q) ** 3 - q * (x - 1 + q) / Math.abs(x - 1 + q) ** 3;
  const bisect = (lo: number, hi: number) => {
    let flo = f(lo);
    for (let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2, fm = f(mid);
      if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const eps = 1e-12;
  const xs = [bisect(-q + eps, 1 - q - eps), bisect(1 - q + eps, 2), bisect(-2, -q - eps)];
  const bc: V3 = [host.x + r[0] * q, host.y + r[1] * q, host.z + r[2] * q];
  const at = (x: number, y: number): V3 => [
    bc[0] + d * (x * ex[0] + y * ey[0]), bc[1] + d * (x * ex[1] + y * ey[1]), bc[2] + d * (x * ex[2] + y * ey[2]),
  ];
  const s3 = Math.sqrt(3) / 2;
  return [at(xs[0], 0), at(xs[1], 0), at(xs[2], 0), at(0.5 - q, s3), at(0.5 - q, -s3)];
}

/** Conservative habitable zone (Kopparapu et al. 2013 flux limits), AU. */
export function habitableZone(L: number): [number, number] {
  return [Math.sqrt(L / 1.107), Math.sqrt(L / 0.356)];
}

export function barycentre(a: Body, b: Body): V3 {
  const M = a.m + b.m;
  return [(a.x * a.m + b.x * b.m) / M, (a.y * a.m + b.y * b.m) / M, (a.z * a.m + b.z * b.m) / M];
}
