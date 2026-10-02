import type { App } from './app';
import type { Body } from './physics/body';
import { G } from './physics/units';
import { spawnFragments, shatterBody } from './physics/events';
import { PIX } from './pixel/renderer';

type P3 = { x: number; y: number; z: number };

/**
 * The hands-on tools that act on the world while held: a gravity well that
 * pulls things in (or pushes them away), a laser that boils rock off whatever
 * it hits, a blast, and copies of bodies. They act in the time you see — a
 * pull or a blast moves things across the screen in about a second, whatever
 * the speed of time is set to.
 */

/** reach of the attract and repel well, CSS px */
export const FIELD_PX = 170;
/** reach of a blast, CSS px */
export const BLAST_PX = 120;

/** pull towards (sign 1) or push away from (sign −1) a point, everything within reach */
export function fieldStep(app: App, at: P3, sign: number, dtReal: number) {
  const w = app.world, R = FIELD_PX * app.view.perCss;
  // AU/yr of speed change per real second at the centre: enough to cross the reach in about a second on screen
  const a = (2.5 * R) / Math.max(app.warp, 1e-12);
  for (const b of w.bodies) {
    if (!b.alive || b.held || isFixed(b)) continue;
    const dx = at.x - b.x, dy = at.y - b.y, dz = at.z - b.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > R || d === 0) continue;
    const f = 1 - d / R;
    let dv = sign * a * f * dtReal;
    // a pull stops at the centre rather than overshooting it
    if (sign > 0) dv = Math.min(dv, d / Math.max(app.warp, 1e-12));
    // and a little drag in the well, so what it catches gathers instead of swinging through
    const k = sign > 0 ? Math.min(1, 1.5 * f * dtReal) : 0;
    const hv = app.hostOf(b);
    const rvx = b.vx - (hv?.vx ?? 0), rvy = b.vy - (hv?.vy ?? 0), rvz = b.vz - (hv?.vz ?? 0);
    b.setVel(b.vx + (dx / d) * dv - rvx * k, b.vy + (dy / d) * dv - rvy * k, b.vz + (dz / d) * dv - rvz * k);
    w.moved(b);
  }
}

/** stars and holes are too big to throw around with a tool */
function isFixed(b: Body) { return b.cls === 'star' || b.cls === 'bh' || b.cls === 'ns' || b.cls === 'wd'; }

/**
 * A laser: fired at a body it holds on it from a fixed offset; aimed by hand,
 * its ends are screen points (CSS px), so it stays put on screen while the
 * view follows something
 */
export interface Laser {
  target: Body | null; off: P3;
  css: { fx: number; fy: number; tx: number; ty: number };
  from: P3; to: P3; hit: Body | null; end: P3; m0: WeakMap<Body, number>;
}

/** the laser's two ends in the world, now */
function laserEnds(app: App, l: Laser) {
  const t = l.target;
  if (t && t.alive) {
    l.from = { x: t.x + l.off.x, y: t.y + l.off.y, z: 0 };
    l.to = { x: t.x, y: t.y, z: 0 };
  } else {
    l.from = app.view.unproject(l.css.fx, l.css.fy);
    l.to = app.view.unproject(l.css.tx, l.css.ty);
  }
}

/** where the beam from `from` towards `to` stops: the first body in its path, or the edge of the screen */
export function laserTrace(app: App, l: Laser) {
  const v = app.view;
  laserEnds(app, l);
  const ux0 = l.to.x - l.from.x, uy0 = l.to.y - l.from.y, ul = Math.hypot(ux0, uy0);
  l.hit = null;
  if (ul === 0) { l.end = { ...l.from }; return; }
  const ux = ux0 / ul, uy = uy0 / ul;
  const far = (Math.hypot(v.W, v.H) / v.scale) * 1.2;
  let best = far;
  const minR = 3 * v.perCss;
  for (const b of app.visual) {
    const rx = b.x - l.from.x, ry = b.y - l.from.y;
    const t = rx * ux + ry * uy;
    if (t <= 0 || t > best) continue;
    const perp = Math.abs(rx * uy - ry * ux), R = Math.max(b.r, minR);
    if (perp > R) continue;
    const tIn = t - Math.sqrt(R * R - perp * perp);
    if (tIn < best) { best = Math.max(0, tIn); l.hit = b; }
  }
  l.end = { x: l.from.x + ux * best, y: l.from.y + uy * best, z: 0 };
}

/**
 * The laser on what it hits: rock and ice boil off the lit face as a hot
 * plume, and the body is pushed away by it — a rocket made of itself. Small
 * things go at once; a moon goes in a few seconds, a world in tens, a giant
 * slowly. Once most of it is gone, what is left flies apart. Stars and holes
 * shrug it off.
 */
export function laserStep(app: App, l: Laser, dtReal: number) {
  laserTrace(app, l);
  const b = l.hit, w = app.world;
  if (!b || app.paused) return;
  if (isFixed(b) || b.look.wormhole || b.look.white) return;
  // dust and gravel flash off at once
  if (!b.source) { w.kill(b); w.structural(); return; }
  if (!l.m0.has(b)) l.m0.set(b, b.m);
  const m0 = l.m0.get(b)!;
  // fraction of the mass boiled off per real second
  const f = Math.min(0.6, 0.05 * Math.cbrt(3e-6 / b.m));
  const dm = b.m * f * dtReal;
  const ux = l.end.x - l.from.x, uy = l.end.y - l.from.y, ul = Math.hypot(ux, uy) || 1;
  const n: [number, number, number] = [-ux / ul, -uy / ul, 0];
  const vesc = Math.sqrt((2 * G * b.m) / Math.max(b.r, 1e-12));
  const gas = b.cls === 'gas';
  spawnFragments(w, {
    mass: dm, n: 4, cls: 'gasp',
    x: b.x + n[0] * b.r, y: b.y + n[1] * b.r, z: b.z,
    vx: b.vx, vy: b.vy, vz: b.vz,
    rIn: 0, rOut: b.r * 0.15, vMin: 1.0 * vesc, vMax: 2.2 * vesc,
    heat: 1, color: gas ? 0xffc890 : 0xffb070, bias: n, biasK: 0.85, recoil: b,
  });
  b.m -= dm;
  b.r *= Math.cbrt(Math.max(0, b.m) / (b.m + dm));
  b.heat = Math.min(1, b.heat + 2 * dtReal);
  w.massChanged(b);
  w.moved(b);
  if (b.m < 0.35 * m0) { l.m0.delete(b); shatterBody(w, b); }
}

/** a blast at a point: everything nearby thrown outward, worlds near the middle shattered */
export function blast(app: App, at: P3) {
  const w = app.world, R = BLAST_PX * app.view.perCss;
  const vmax = (1.6 * R) / Math.max(app.warp, 1e-12);
  const shatter: Body[] = [];
  for (const b of w.bodies) {
    if (!b.alive || b.held || isFixed(b)) continue;
    const dx = b.x - at.x, dy = b.y - at.y, dz = b.z - at.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > R) continue;
    if (b.source && d < 0.3 * R && !b.look.wormhole && !b.look.white && !b.look.craft) { shatter.push(b); continue; }
    const f = 1 - d / R, dv = vmax * f;
    const ux = d > 0 ? dx / d : Math.random() - 0.5, uy = d > 0 ? dy / d : Math.random() - 0.5, uz = d > 0 ? dz / d : 0;
    b.setVel(b.vx + ux * dv, b.vy + uy * dv, b.vz + uz * dv);
    b.heat = Math.min(1, b.heat + f);
    w.moved(b);
  }
  for (const b of shatter) shatterBody(w, b);
  w.emit({ kind: 'airburst', x: at.x, y: at.y, z: at.z, size: R * 0.6, energy: 1, t: w.time });
}

/** draw the laser beam and the attract/repel well */
export function drawTools(app: App, ctx: CanvasRenderingContext2D, field: { at: P3; sign: number } | null, laser: Laser | null) {
  const v = app.view;
  const t = performance.now() / 1000;
  if (field) {
    const x = v.sx(field.at.x), y = v.sy(field.at.y), R = FIELD_PX / PIX;
    ctx.strokeStyle = field.sign > 0 ? 'rgba(140,200,255,0.7)' : 'rgba(255,150,120,0.7)';
    for (let k = 0; k < 3; k++) {
      // rings that run inward for a pull, outward for a push
      let ph = ((t * 0.8 + k / 3) % 1);
      if (field.sign > 0) ph = 1 - ph;
      ctx.globalAlpha = 0.25 + 0.6 * (1 - ph);
      ctx.beginPath(); ctx.arc(x, y, Math.max(1, R * ph), 0, 2 * Math.PI); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = field.sign > 0 ? '#bfe0ff' : '#ffc0a8';
    ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
  }
  if (laser) {
    const x0 = v.sx(laser.from.x), y0 = v.sy(laser.from.y), x1 = v.sx(laser.end.x), y1 = v.sy(laser.end.y);
    const flick = 0.75 + 0.25 * Math.sin(t * 60);
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(255,60,60,${0.35 * flick})`; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = `rgba(255,220,210,${flick})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.lineWidth = 1; ctx.lineCap = 'butt';
    ctx.fillStyle = '#ff6a5a';
    ctx.fillRect(Math.round(x0) - 1, Math.round(y0) - 1, 3, 3);
    if (laser.hit) {
      ctx.fillStyle = `rgba(255,240,200,${flick})`;
      ctx.beginPath(); ctx.arc(x1, y1, 2 + 2 * flick, 0, 2 * Math.PI); ctx.fill();
    }
  }
}
