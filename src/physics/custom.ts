import { Body } from './body';
import { makeBody, refreshRoche } from './catalog';
import { newStar, structure, teffOf } from './stellar';
import { HOUR, M_JUP } from './units';
import { lookFromShape, makeShape, shapeStats } from './materials';

/** What the builder has made: a drawn world, or a star of a chosen mass and age. */
export interface CustomSpec {
  mode: 'world' | 'star';
  cells: Uint8Array;
  /** log10 of the drawing frame's width, km */
  sizeLog: number;
  name: string;
  /** rotation period, hours */
  dayH: number;
  starMass: number;
  /** where in its life, as in the catalogue: 0..1 main sequence, >1 giant */
  starAge: number;
  seed: number;
}

export function buildCustom(c: CustomSpec): Body | null {
  if (c.mode === 'star') {
    const b = makeBody('sun', c.seed, c.name || 'Custom star');
    b.kind = 'custom';
    b.star = newStar(c.starMass, c.starAge);
    const st = structure(b.star);
    b.m = st.m; b.r = st.r; b.star.L = st.L; b.star.phase = st.phase; b.star.teff = teffOf(st.L, st.r);
    refreshRoche(b);
    return b;
  }
  const st = shapeStats(c.cells, 10 ** c.sizeLog);
  if (!st.filled) return null;
  const shape = makeShape(c.cells, st);
  const look = lookFromShape(shape, c.seed);
  const cls = st.gasFrac > 0.5 ? 'gas' : st.iceFrac > 0.5 ? 'ice' : 'rock';
  const b = new Body({
    name: c.name || 'Custom world', kind: 'custom', cls, m: st.mass, r: st.rEq,
    look: { ...look, seed: c.seed }, spin: (2 * Math.PI) / (c.dayH * HOUR), tilt: 0.1,
  });
  // a ball of gas past thirteen Jupiters would burn deuterium; past eighty, hydrogen — keep it a world
  if (cls === 'gas' && b.m > 13 * M_JUP) b.look = { ...b.look, style: 'browndwarf' };
  b.shape = shape;
  // already as round as it can be: skip straight to being a sphere
  if (st.asph < 0.03 && shape.roundGoal > 0) { shape.round = 0.96; shape.roundGoal = 1; }
  if (st.liquidFrac > 0.5 && look.style === 'lava') b.heat = 0.8;
  refreshRoche(b);
  return b;
}
