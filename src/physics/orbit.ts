import type { Body } from './body';
import { G } from './units';

export type V3 = [number, number, number];

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => { const n = norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };

export const pos = (b: Body): V3 => [b.x, b.y, b.z];
export const vel = (b: Body): V3 => [b.vx, b.vy, b.vz];

const D2R = Math.PI / 180;

export interface Elements {
  a: number;      // semi-major axis, AU (negative when unbound)
  e: number;
  i: number;      // radians
  node: number;   // longitude of ascending node, radians
  peri: number;   // argument of periapsis, radians
  M: number;      // mean anomaly, radians
}

export function solveKepler(M: number, e: number): number {
  M = ((M % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
  for (let k = 0; k < 50; k++) {
    const f = E - e * Math.sin(E) - M;
    const d = f / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-15) break;
  }
  return E;
}

function rotate(x: number, y: number, el: Elements): V3 {
  const cO = Math.cos(el.node), sO = Math.sin(el.node);
  const cw = Math.cos(el.peri), sw = Math.sin(el.peri);
  const ci = Math.cos(el.i), si = Math.sin(el.i);
  const X = (cO * cw - sO * sw * ci) * x + (-cO * sw - sO * cw * ci) * y;
  const Y = (sO * cw + cO * sw * ci) * x + (-sO * sw + cO * cw * ci) * y;
  const Z = (sw * si) * x + (cw * si) * y;
  return [X, Y, Z];
}

/** Position and velocity relative to the host for a bound orbit, μ = G(M + m). */
export function stateFromElements(mu: number, el: Elements): { r: V3; v: V3 } {
  const { a, e } = el;
  const E = solveKepler(el.M, e);
  const cE = Math.cos(E), sE = Math.sin(E);
  const q = Math.sqrt(1 - e * e);
  const rr = a * (1 - e * cE);
  const x = a * (cE - e), y = a * q * sE;
  const k = Math.sqrt(mu * a) / rr;
  return { r: rotate(x, y, el), v: rotate(-k * sE, k * q * cE, el) };
}

/** Elements in degrees, as tables give them. */
export function elementsDeg(a: number, e: number, iDeg: number, nodeDeg: number, periDeg: number, MDeg: number): Elements {
  return { a, e, i: iDeg * D2R, node: nodeDeg * D2R, peri: periDeg * D2R, M: MDeg * D2R };
}

export interface Osculating {
  a: number; e: number; i: number; period: number;
  rp: number; ra: number;
  h: V3; evec: V3; energy: number;
}

export function osculating(mu: number, r: V3, v: V3): Osculating {
  const rn = norm(r);
  const h = cross(r, v);
  const vxh = cross(v, h);
  const evec = sub(scale(vxh, 1 / mu), scale(r, 1 / rn));
  const e = norm(evec);
  const energy = dot(v, v) / 2 - mu / rn;
  const a = -mu / (2 * energy);
  const hn = norm(h);
  const i = hn > 0 ? Math.acos(Math.max(-1, Math.min(1, h[2] / hn))) : 0;
  const period = a > 0 ? 2 * Math.PI * Math.sqrt(a ** 3 / mu) : Infinity;
  return { a, e, i, period, rp: a * (1 - e), ra: a > 0 ? a * (1 + e) : Infinity, h, evec, energy };
}

export function relative(b: Body, host: Body) {
  return {
    r: [b.x - host.x, b.y - host.y, b.z - host.z] as V3,
    v: [b.vx - host.vx, b.vy - host.vy, b.vz - host.vz] as V3,
    mu: G * (b.m + host.m),
  };
}

/** Points round the osculating ellipse, relative to the host. */
export function ellipsePoints(o: Osculating, r: V3, n: number): V3[] {
  const P = o.e > 1e-9 ? unit(o.evec) : unit(r);
  const Q = unit(cross(unit(o.h), P));
  const p = o.a * (1 - o.e * o.e);
  const out: V3[] = [];
  for (let k = 0; k <= n; k++) {
    const nu = (k / n) * 2 * Math.PI;
    const rr = p / (1 + o.e * Math.cos(nu));
    const c = Math.cos(nu) * rr, s = Math.sin(nu) * rr;
    out.push([P[0] * c + Q[0] * s, P[1] * c + Q[1] * s, P[2] * c + Q[2] * s]);
  }
  return out;
}

export const circularSpeed = (mu: number, r: number) => Math.sqrt(mu / r);
