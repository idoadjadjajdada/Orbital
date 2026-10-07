import { AU_M, G, YEAR_S } from '../physics/units';
import type { Body } from '../physics/body';
import type { V3 } from '../pixel/sprites';

/** AU/yr² in m/s² */
const ACC = AU_M / (YEAR_S * YEAR_S);

/** the pull of every body on a point (AU/yr²); inside a body, only what lies deeper than the point */
function accel(p: V3, bodies: readonly Body[], skip: Body | null, out: V3) {
  out[0] = out[1] = out[2] = 0;
  for (const b of bodies) {
    if (b === skip || !b.alive || !b.source || !(b.m > 0)) continue;
    const dx = b.x - p[0], dy = b.y - p[1], dz = b.z - p[2], d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= 0) continue;
    const d = Math.sqrt(d2), r = Math.max(b.r, 1e-12);
    const k = d >= r ? (G * b.m) / (d2 * d) : (G * b.m) / (r * r * r);
    out[0] += dx * k; out[1] += dy * k; out[2] += dz * k;
  }
  return out;
}

/**
 * the gravity on something at p (sandbox AU) that moves in the frame of
 * `anchor` (its position and velocity kept relative to that body), in m/s²:
 * the pull of every body on it, less the pull on the anchor itself, which the
 * frame already carries. Near a world that is the world's own gravity, falling
 * off with height; between them, the tide of the rest.
 */
export function pull(p: V3, anchor: Body | null, bodies: readonly Body[]): V3 {
  const a = accel(p, bodies, null, [0, 0, 0]);
  if (anchor) {
    const f = accel([anchor.x, anchor.y, anchor.z], bodies, anchor, [0, 0, 0]);
    a[0] -= f[0]; a[1] -= f[1]; a[2] -= f[2];
  }
  return [a[0] * ACC, a[1] * ACC, a[2] * ACC];
}
