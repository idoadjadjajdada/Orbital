import type { Body } from './body';
import type { World } from './world';
import { G, AU_M, YEAR_S, MSUN_KG } from './units';

/**
 * Slow tidal effects, applied between steps.
 *
 * Locking. The bulge a host raises on a body lags behind it while the body
 * spins at a different rate from its orbit, and the torque on that lagging
 * bulge brakes (or spins up) the body until it keeps one face to its host.
 * The rate is constant while it happens (Gladman et al. 1996):
 *   dω/dt = 3 G M² (k₂/Q) R⁵ / (a⁶ · 0.4 m R²).
 *
 * Heating. An eccentric orbit flexes a locked body every orbit; the power
 * dissipated is (21/2)(k₂/Q) G M² R⁵ n e² / a⁶ (Peale et al. 1979). Io's
 * resonances keep its orbit eccentric, and this is what melts it.
 */
const kQ = (b: Body) => (b.cls === 'gas' ? 5e-6 : b.cls === 'ice' ? 1e-3 : 3e-3);

export function tides(w: World, hosts: Map<Body, { host: Body | null; hill: number }>, dt: number) {
  for (const b of w.sources) {
    if (!b.alive || b.cls === 'star' || b.compact || b.held) continue;
    const h = hosts.get(b)?.host;
    if (!h || h.m < 3 * b.m) continue;
    const rx = b.x - h.x, ry = b.y - h.y, rz = b.z - h.z, vx = b.vx - h.vx, vy = b.vy - h.vy, vz = b.vz - h.vz;
    const r2 = rx * rx + ry * ry + rz * rz, r = Math.sqrt(r2);
    const lx = ry * vz - rz * vy, ly = rz * vx - rx * vz, lz = rx * vy - ry * vx;
    const hh = Math.hypot(lx, ly, lz);
    const mu = G * (h.m + b.m);
    const eps = (vx * vx + vy * vy + vz * vz) / 2 - mu / r;
    if (eps >= 0) continue;
    const a = -mu / (2 * eps);
    const n = Math.sqrt(mu / (a * a * a));
    const e = Math.sqrt(Math.max(0, 1 - (hh * hh) / (mu * a)));
    const k = kQ(b);
    // the orbit's sense relative to the body's pole decides which way locked is
    const t = b.tilt, nd = b.node;
    const pole = [Math.sin(t) * Math.sin(nd), -Math.sin(t) * Math.cos(nd), Math.cos(t)];
    const sense = pole[0] * lx + pole[1] * ly + pole[2] * lz >= 0 ? 1 : -1;
    const target = sense * n;
    const rate = (3 * G * h.m * h.m * k * b.r ** 3) / (a ** 6 * 0.4 * b.m);
    const diff = target - b.spin;
    if (diff !== 0) b.spin += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
    // flexing of an eccentric orbit, as a surface flux in W/m²
    if (e > 1e-4 && b.cls !== 'gas') {
      const P = 10.5 * k * G * h.m * h.m * b.r ** 5 * n * e * e / a ** 6; // M☉ AU² yr⁻³
      const W = P * MSUN_KG * AU_M * AU_M / YEAR_S ** 3;
      const flux = W / (4 * Math.PI * (b.r * AU_M) ** 2);
      if (flux > 0.3) b.heat = Math.max(b.heat, Math.min(0.55, flux / 12));
    }
  }
}

/**
 * Hawking radiation. A black hole radiates as a black body at
 * T = ħc³ / 8πGMk, losing mass faster the smaller it is: its lifetime is
 * 5120πG²M³/ħc⁴ ≈ 2.1×10⁶⁷ yr (M/M☉)³. Anything heavier than a mountain lasts
 * far longer than the universe; something of a few hundred thousand tonnes
 * is gone in years, ending in a burst of gamma rays. Returns true when it has
 * gone.
 */
export const HAWKING_T = 2.1e67;
export function hawking(b: Body, dt: number): boolean {
  if (b.cls !== 'bh' || b.m > 1e-14) return false;
  const m3 = b.m ** 3 - dt / HAWKING_T;
  if (m3 <= (1e-28) ** 3) return true;
  b.m = Math.cbrt(m3);
  return false;
}

/** the luminosity of a black hole's Hawking radiation, L☉ */
export const hawkingL = (m: number) => 9.0e-56 / (m * m);
