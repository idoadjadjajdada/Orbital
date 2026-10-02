import { Body } from './body';
import type { World } from './world';

/**
 * A saved state of the world, for undo. Bodies that pull are copied whole.
 * Particles — there can be tens of thousands — are packed into a few numbers
 * each, which is all they are, so a stack of snapshots stays small enough
 * for a tablet's memory.
 */
export interface Snapshot {
  label: string;
  time: number;
  bodies: Body[];
  parts: { cls: Body['cls']; kind: string; name: string; c1: number; source: boolean; f: Float64Array }[];
}

function copy(b: Body): Body {
  const c = Object.assign(Object.create(Object.getPrototypeOf(b)), b) as Body;
  c.look = { ...b.look, rings: b.look.rings ? { ...b.look.rings } : undefined };
  if (b.star) c.star = { ...b.star };
  c.craters = b.craters.slice();
  if (b.shape) c.shape = { ...b.shape, cells: b.shape.cells.slice(), outline: b.shape.outline.slice(), marks: b.shape.marks.slice(), layered: b.shape.layered ? b.shape.layered.slice() : null };
  return c;
}

export function takeSnapshot(w: World, label: string): Snapshot {
  const bodies: Body[] = [], parts: Snapshot['parts'] = [];
  for (const b of w.bodies) {
    if (!b.alive) continue;
    if (b.isParticle && !b.source) {
      parts.push({ cls: b.cls, kind: b.kind, name: b.name, c1: b.look.c1, source: b.source,
        f: Float64Array.of(b.x, b.y, b.z, b.vx, b.vy, b.vz, b.m, b.r, b.heat, b.age, b.beta, b.dens) });
    } else bodies.push(copy(b));
  }
  return { label, time: w.time, bodies, parts };
}

export function restoreSnapshot(w: World, s: Snapshot) {
  w.clear();
  for (const b of s.bodies) w.add(copy(b));
  for (const p of s.parts) {
    const f = p.f;
    const b = new Body({ name: p.name, kind: p.kind, cls: p.cls, look: { style: 'rocky', seed: 0, c1: p.c1, c2: p.c1 }, m: f[6], r: f[7], source: p.source, spin: 0 });
    b.setPos(f[0], f[1], f[2]); b.setVel(f[3], f[4], f[5]);
    b.heat = f[8]; b.age = f[9]; b.beta = f[10]; b.dens = f[11];
    w.add(b);
  }
  w.time = s.time;
  w.structural();
}
