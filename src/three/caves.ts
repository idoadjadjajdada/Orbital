import { fbm, vnoise } from '../pixel/noise';

/**
 * Caves under the ground: a network of passages and chambers in the rock
 * below the land, reached by a ramp cut down into it.
 *
 * Everything here is in the cave's own frame: x to the right, y up, z back
 * toward you (the ramp runs in along −z), metres, from the ground at its
 * mouth. The passages are segments between nodes; each node has the height
 * of its floor, each segment its half width, its height over the floor and
 * where the arch of its roof is centred. The air in a segment is an ellipse
 * across it, cut flat at the floor; the cave's air is all of them together,
 * blended where they meet, and roughened where the rock shows (never at the
 * floor, which stays what you walk on).
 *
 * The rock's surface is where the air ends, as one sheet (a surface net over
 * the air's distance field), so branches open into each other without seams.
 * Only the ramp comes up to the land: there the land is cut away (the
 * ground's shader drops every point of it inside the ramp's air), and the
 * ramp's walls rise a little over it. Everywhere else the passages keep a few
 * metres of rock over their roofs.
 */

export interface CaveNode { x: number; z: number; y: number; /** m along the passages from the mouth */ d: number }
export interface CaveSeg {
  i: number; j: number;
  /** half width, height of the roof's arch over its centre, and of the centre over the floor, m */
  hw: number; up: number; fl: number;
  /** part of the ramp in from the land: its air cuts the land away */
  ramp: boolean;
  /** a chamber, for what hangs from its roof */
  room: boolean;
}
export interface CaveNet { nodes: CaveNode[]; segs: CaveSeg[]; lava: boolean; ice: boolean }

/** the land's height at (x, z) in the cave's frame, m (curvature included) */
export type LandAt = (x: number, z: number) => number;

const mulberry = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** how far the network reaches from its mouth, m */
export function caveReach(lava: boolean) { return lava ? 150 : 75; }

/**
 * Lay out a cave: the ramp down from the land, then a winding main passage
 * with chambers along it and side passages off it (one going down a level),
 * all kept under the land with rock over their roofs, their floors never
 * steeper than you can walk.
 */
export function caveNet(seed: number, lava: boolean, ice: boolean, land: LandAt): CaveNet {
  const r = mulberry(seed), nodes: CaveNode[] = [], segs: CaveSeg[] = [];
  const reach = caveReach(lava);
  const tun = () => lava ? { hw: 7 + 2 * r(), up: 6, fl: 3 } : { hw: 1.7 + 0.6 * r(), up: 2.4 + 0.4 * r(), fl: 1.1 };
  const room = () => lava ? { hw: 11 + 3 * r(), up: 8, fl: 4 } : { hw: 6 + 3 * r(), up: 5 + 2 * r(), fl: 2.5 };
  const add = (x: number, z: number, y: number) => { nodes.push({ x, z, y, d: 0 }); return nodes.length - 1; };
  /** where each node was grown from */
  const parent = new Map<number, number>();
  // ---- the ramp: in from the land, down at a walkable slope, until it is well under it
  // (into a lava tube, down the rubble where its roof fell in: narrower than the tube)
  const T0 = lava ? { hw: 3.5 + r(), up: 3.6, fl: 1.4 } : tun(), step = lava ? 4 : 3, drop = step * 0.4;
  // the land's lowest round a point, and how much rock a passage keeps over its roof
  const lowest = (x: number, z: number, R: number) => { let lo = land(x, z); for (let q = 0; q < 4; q++) lo = Math.min(lo, land(x + Math.cos(q * Math.PI / 2) * R, z + Math.sin(q * Math.PI / 2) * R)); return lo; };
  const cover = (t: { fl: number; up: number }) => t.fl + t.up + (lava ? 4 : 3);
  // (down until it is as deep as the passages after it need, the land ahead rising or falling: into the hill
  // if there is one, so whichever way gets under the land soonest)
  const deepEnough = (x: number, z: number, y: number) => lowest(x, z, (lava ? 9 : 2.3) + 8) - y > (lava ? 13 : 6.9) + 1;
  const stepsTo = (a: number) => {
    let x = 0, z = 4, y = land(x, z) - 0.3;
    for (let k = 1; k <= 20; k++) { x += Math.sin(a) * step; z -= Math.cos(a) * step; y = Math.min(land(x, z) - 0.3, y - drop); if (deepEnough(x, z, y)) return k; }
    return 99;
  };
  const a0 = [0, Math.PI / 2, -Math.PI / 2, Math.PI].map(a => ({ a, k: stepsTo(a) })).reduce((b, c) => (c.k < b.k ? c : b)).a;
  let x = 0, z = 4, ang = a0;
  let prev = add(x, z, land(x, z) - 0.3);
  for (let k = 0; k < 20; k++) {
    ang = a0 + (ang - a0) * 0.6 + (r() - 0.5) * 0.3;
    x += Math.sin(ang) * step; z -= Math.cos(ang) * step;
    const y = Math.min(land(x, z) - 0.3, nodes[prev].y - drop);
    const n = add(x, z, y);
    parent.set(n, prev);
    segs.push({ i: prev, j: n, ...T0, ramp: true, room: false });
    prev = n;
    if (deepEnough(x, z, y)) break;
  }
  const rampNodes = new Set(nodes.map((_, k) => k));
  // ---- the passages
  // (clear of every passage but the one it goes on from, back as far as the gap it keeps)
  const far = (px: number, pz: number, from: number, gap: number) => {
    const near = new Set([from]);
    for (let k = from, run = 0; parent.has(k) && run < gap * 2;) { const u = parent.get(k)!; run += Math.hypot(nodes[k].x - nodes[u].x, nodes[k].z - nodes[u].z); near.add(u); k = u; }
    return segs.every(s => {
    if (near.has(s.i) && near.has(s.j)) return true;
    const a = nodes[s.i], b = nodes[s.j], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((px - a.x) * ex + (pz - a.z) * ez) / l2));
    return Math.hypot(a.x + ex * t - px, a.z + ez * t - pz) > s.hw + gap;
  });
  };
  const grow = (from: number, heading: number, n: number, dy: number, rooms: number, branches: number) => {
    let at = from, h = heading;
    for (let k = 0; k < n; k++) {
      // (a chamber at the end, and now and then on the way: not right at the start, where it would pull the way in down)
      const big = k === n - 1 ? rooms > 0 : k >= 2 && r() < 0.18 * rooms;
      const T = big ? room() : tun(), len = big ? T.hw * 1.3 : (lava ? 12 : 6) + r() * (lava ? 8 : 4);
      let placed = -1;
      for (let tries = 0; tries < 5 && placed < 0; tries++) {
        const hh = h + (r() - 0.5) * (tries ? 1.6 : 0.7);
        const px = nodes[at].x + Math.sin(hh) * len, pz = nodes[at].z - Math.cos(hh) * len;
        if (Math.hypot(px, pz) > reach || Math.hypot(px, pz - 4) < 12) continue;
        if (!far(px, pz, at, T.hw + 4)) continue;
        placed = add(px, pz, nodes[at].y + dy * len + (r() - 0.5) * 0.5);
        parent.set(placed, at);
        h = hh;
      }
      if (placed < 0) return;
      segs.push({ i: at, j: placed, ...T, ramp: false, room: big });
      if (branches > 0 && !big && r() < 0.35) {
        branches--;
        const side = r() < 0.5 ? -1 : 1;
        grow(placed, h + side * (0.9 + 0.7 * r()), 3 + Math.floor(r() * 4), branches === 0 ? -0.22 : (r() - 0.5) * 0.12, r() < 0.6 ? 1 : 0, 0);
      }
      at = placed;
    }
  };
  grow(prev, ang, lava ? 9 + Math.floor(r() * 5) : 9 + Math.floor(r() * 6), (r() - 0.6) * 0.1, lava ? 1 : 2, lava ? 1 : 3);
  // ---- rock over every roof but the ramp's: no floor higher than the land round it allows
  for (const s of segs) {
    if (s.ramp) continue;
    const a = nodes[s.i], b = nodes[s.j], head = cover(s);
    for (const t of [0, 0.5, 1]) {
      const lo = lowest(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, s.hw + 1.5);
      if (t < 1 && !rampNodes.has(s.i)) a.y = Math.min(a.y, lo - head);
      if (t > 0) b.y = Math.min(b.y, lo - head);
    }
  }
  // ---- floors no steeper than a walk: pulled down, never up, so the rock over them stays (the ramp too, if the
  // passages ask it to go deeper; only its mouth stays at the land)
  const slope = 0.42;
  for (let pass = 0; pass < 200; pass++) {
    let moved = false;
    for (const s of segs) {
      const a = nodes[s.i], b = nodes[s.j], L = Math.hypot(b.x - a.x, b.z - a.z) * slope;
      if (b.y > a.y + L + 1e-6 && s.j !== 0) { b.y = a.y + L; moved = true; }
      if (a.y > b.y + L + 1e-6 && s.i !== 0) { a.y = b.y + L; moved = true; }
    }
    if (!moved) break;
  }
  // ---- how far each node is from the mouth, along the passages
  const out = new Map<number, number[]>();
  for (const s of segs) { (out.get(s.i) ?? out.set(s.i, []).get(s.i)!).push(s.j); (out.get(s.j) ?? out.set(s.j, []).get(s.j)!).push(s.i); }
  const seen = new Set([0]), q = [0];
  while (q.length) {
    const k = q.shift()!;
    for (const m of out.get(k) ?? []) if (!seen.has(m)) { seen.add(m); nodes[m].d = nodes[k].d + Math.hypot(nodes[m].x - nodes[k].x, nodes[m].y - nodes[k].y, nodes[m].z - nodes[k].z); q.push(m); }
  }
  return { nodes, segs, lava, ice };
}

/** where a point falls along a segment: t (0–1), the floor there, how far out from its line (m) */
function along(net: CaveNet, s: CaveSeg, x: number, z: number) {
  const a = net.nodes[s.i], b = net.nodes[s.j], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
  return { t, floor: a.y + (b.y - a.y) * t, dh: Math.hypot(a.x + ex * t - x, a.z + ez * t - z) };
}

/** a segment's air: negative inside (about the distance to its wall), positive in the rock */
function segField(net: CaveNet, s: CaveSeg, x: number, y: number, z: number) {
  const { floor, dh } = along(net, s, x, z), dy = y - floor - s.fl;
  const e = (Math.sqrt((dh / s.hw) ** 2 + (dy / s.up) ** 2) - 1) * Math.min(s.hw, s.up);
  return { f: Math.max(e, floor - y), floor };
}

/** is a point in the ramp's air (where the land is cut away)? */
export function inRamp(net: CaveNet, x: number, y: number, z: number) {
  return net.segs.some(s => s.ramp && segField(net, s, x, y, z).f < 0);
}

/**
 * Inside the cave at (x, z) with feet (plus a step) at y: the floor you stand
 * on, the roof over you and how far in you are; null if no floor of it is
 * under you within a short drop.
 */
export function caveFloorAt(net: CaveNet, x: number, y: number, z: number): { floor: number; roof: number; d: number } | null {
  let best: { floor: number; roof: number; d: number } | null = null;
  for (const s of net.segs) {
    const { t, floor, dh } = along(net, s, x, z);
    // the width of its floor, less a margin for your shoulders
    if (dh > s.hw * Math.sqrt(1 - (s.fl / s.up) ** 2) - 0.35) continue;
    if (floor > y + 0.05 || floor < y - 2.6) continue;
    if (best && floor <= best.floor) continue;
    const a = net.nodes[s.i], b = net.nodes[s.j];
    best = { floor, roof: floor + s.fl + s.up * Math.sqrt(Math.max(0, 1 - (dh / s.hw) ** 2)), d: a.d + (b.d - a.d) * t };
  }
  return best;
}

/** how much of the daylight reaches m along the passages from the mouth */
export function caveSky(net: CaveNet, d: number) { return Math.exp(-d / (net.ice ? 18 : net.lava ? 14 : 8)); }

/**
 * The cave's rock: one surface where its air meets the rock, as positions,
 * the triangles, and how much daylight reaches each point. `land` is the
 * land's height near the ramp, where its walls stop (a little over it).
 */
export function caveSurface(net: CaveNet, land: LandAt, seed: number) {
  const st = net.lava ? 1.4 : 0.85;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of net.segs) for (const k of [s.i, s.j]) {
    const p = net.nodes[k], pad = s.hw + 2;
    x0 = Math.min(x0, p.x - pad); x1 = Math.max(x1, p.x + pad); z0 = Math.min(z0, p.z - pad); z1 = Math.max(z1, p.z + pad);
    y0 = Math.min(y0, p.y - 1.5); y1 = Math.max(y1, p.y + s.fl + s.up + 1.5);
  }
  // the land's top near the ramp: over it, the air is the sky's
  const rampSegs = net.segs.filter(s => s.ramp);
  for (const s of rampSegs) for (const k of [s.i, s.j]) y1 = Math.max(y1, land(net.nodes[k].x, net.nodes[k].z) + 2);
  const nx = Math.ceil((x1 - x0) / st) + 1, ny = Math.ceil((y1 - y0) / st) + 1, nz = Math.ceil((z1 - z0) / st) + 1;
  const N = nx * ny * nz, D = new Float32Array(N).fill(1e3), floorOf = new Float32Array(N), terr = new Uint8Array(N);
  const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  // each segment's air into the grid, within its own box: the ramp joined sharply (its shape is the hole in the land), the rest blended
  const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  for (const s of net.segs) {
    const a = net.nodes[s.i], b = net.nodes[s.j], pad = s.hw + 1.5;
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - pad - x0) / st)), i1 = Math.min(nx - 1, Math.ceil((Math.max(a.x, b.x) + pad - x0) / st));
    const k0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - pad - z0) / st)), k1 = Math.min(nz - 1, Math.ceil((Math.max(a.z, b.z) + pad - z0) / st));
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - 1.5 - y0) / st)), j1 = Math.min(ny - 1, Math.ceil((Math.max(a.y, b.y) + s.fl + s.up + 1.5 - y0) / st));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const n = idx(i, j, k), sf = segField(net, s, x0 + i * st, y0 + j * st, z0 + k * st);
      const was = D[n], now = s.ramp ? Math.min(was, sf.f) : smin(was, sf.f, net.lava ? 3 : 1.4);
      if (sf.f < was) floorOf[n] = sf.floor;
      D[n] = now;
    }
  }
  // the land over the ramp, and the rock roughened (not near the land, not at the floor)
  const landTop = new Float32Array(nx * nz).fill(Infinity);
  for (const s of rampSegs) {
    const a = net.nodes[s.i], b = net.nodes[s.j], pad = s.hw + 3;
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - pad - x0) / st)), i1 = Math.min(nx - 1, Math.ceil((Math.max(a.x, b.x) + pad - x0) / st));
    const k0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - pad - z0) / st)), k1 = Math.min(nz - 1, Math.ceil((Math.max(a.z, b.z) + pad - z0) / st));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) if (landTop[i + nx * k] === Infinity) landTop[i + nx * k] = land(x0 + i * st, z0 + k * st) + 0.6;
  }
  // (and everywhere else, more coarsely: far from the ramp it only has to be over the rock, so the grid's
  // top is the sky's and not a wall of rock)
  const C = 6, cx = Math.ceil((nx - 1) / C) + 1, cz = Math.ceil((nz - 1) / C) + 1, coarse = new Float32Array(cx * cz);
  for (let k = 0; k < cz; k++) for (let i = 0; i < cx; i++) coarse[i + cx * k] = land(x0 + i * C * st, z0 + k * C * st) + 0.6;
  const exact = landTop.map(v => (v === Infinity ? 0 : 1));
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    if (exact[i + nx * k]) continue;
    const fi = i / C, fk = k / C, i0 = Math.floor(fi), k0 = Math.floor(fk), u = fi - i0, w = fk - k0, i1 = Math.min(cx - 1, i0 + 1), k1 = Math.min(cz - 1, k0 + 1);
    landTop[i + nx * k] = (coarse[i0 + cx * k0] * (1 - u) + coarse[i1 + cx * k0] * u) * (1 - w) + (coarse[i0 + cx * k1] * (1 - u) + coarse[i1 + cx * k1] * u) * w;
  }
  const amp = net.lava ? 0.3 : 0.55, sc = net.lava ? 0.18 : 0.45;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const top = landTop[i + nx * k];
    for (let j = 0; j < ny; j++) {
      const n = idx(i, j, k), y = y0 + j * st;
      let v = D[n];
      if (Math.abs(v) < amp * 2.5) {
        const a = amp * smooth(0.2, 1.4, y - floorOf[n]) * smooth(2, 6, top - y);
        if (a > 0) {
          const x = x0 + i * st, z = z0 + k * st;
          v += ((fbm(x * sc + seed, y * sc, z * sc, 3) - 0.5) * 2 + (vnoise(x * sc * 3.1, y * sc * 3.1 + seed, z * sc * 3.1) - 0.5) * 0.5) * a;
        }
      }
      // the land: rock under it, sky over it (its surface is the land's own, not the cave's)
      const t = top - y;
      if (t < v) { v = t; terr[n] = 1; }
      D[n] = v;
    }
  }
  // ---- the surface net: a point in each cell the surface crosses, joined into a quad across each crossed edge
  const cell = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos: number[] = [];
  const E: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { v[c] = D[idx(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]; if (v[c] < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, m = 0;
    for (const [p, q] of E) {
      if ((v[p] < 0) === (v[q] < 0)) continue;
      const t = v[p] / (v[p] - v[q]);
      sx += (p & 1) + ((q & 1) - (p & 1)) * t; sy += ((p >> 1) & 1) + (((q >> 1) & 1) - ((p >> 1) & 1)) * t; sz += ((p >> 2) & 1) + (((q >> 2) & 1) - ((p >> 2) & 1)) * t;
      m++;
    }
    cell[cidx(i, j, k)] = pos.length / 3;
    pos.push(x0 + (i + sx / m) * st, y0 + (j + sy / m) * st, z0 + (k + sz / m) * st);
  }
  const tri: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) tri.push(a, c, b, a, d, c); else tri.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const n = idx(i, j, k), here = D[n] < 0;
    // the edges to +x, +y, +z
    for (let ax = 0; ax < 3; ax++) {
      const m = ax === 0 ? idx(i + 1, j, k) : ax === 1 ? idx(i, j + 1, k) : idx(i, j, k + 1);
      if ((D[m] < 0) === here) continue;
      // (where the land's top is the surface, the land draws itself)
      if (terr[here ? m : n]) continue;
      if (ax === 0) quad(cell[cidx(i, j - 1, k - 1)], cell[cidx(i, j, k - 1)], cell[cidx(i, j, k)], cell[cidx(i, j - 1, k)], here);
      else if (ax === 1) quad(cell[cidx(i - 1, j, k - 1)], cell[cidx(i - 1, j, k)], cell[cidx(i, j, k)], cell[cidx(i, j, k - 1)], here);
      else quad(cell[cidx(i - 1, j - 1, k)], cell[cidx(i, j - 1, k)], cell[cidx(i, j, k)], cell[cidx(i - 1, j, k)], here);
    }
  }
  // the daylight at each point: from how far it is along the passages, by the segment nearest it
  const nv = pos.length / 3, sky = new Float32Array(nv);
  for (let p = 0; p < nv; p++) {
    const x = pos[p * 3], y = pos[p * 3 + 1], z = pos[p * 3 + 2];
    let bf = Infinity, bd = 0;
    for (const s of net.segs) {
      const f = segField(net, s, x, y, z).f;
      if (f < bf) { bf = f; const t = along(net, s, x, z).t, a = net.nodes[s.i], b = net.nodes[s.j]; bd = a.d + (b.d - a.d) * t; }
    }
    sky[p] = caveSky(net, bd);
    // under the open sky, where the ramp is still a cut in the land
    const top = landTop[Math.min(nx - 1, Math.max(0, Math.round((x - x0) / st))) + nx * Math.min(nz - 1, Math.max(0, Math.round((z - z0) / st)))];
    if (exact[Math.min(nx - 1, Math.max(0, Math.round((x - x0) / st))) + nx * Math.min(nz - 1, Math.max(0, Math.round((z - z0) / st)))]) {
      let open = 0;
      for (const s of rampSegs) {
        const { t, floor, dh } = along(net, s, x, z);
        if (dh < s.hw + 1 && floor + s.fl + s.up > top - 0.6) open = Math.max(open, 1 - smooth(0, 6, top - 0.6 - y) * 0.5);
        void t;
      }
      sky[p] = Math.max(sky[p], open);
    }
  }
  return { pos: new Float32Array(pos), idx: tri, sky };
}

function smooth(a: number, b: number, x: number) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/** what hangs from the chambers' roofs and stands on their floors */
export function caveDressing(net: CaveNet, seed: number): { x: number; y: number; z: number; len: number; down: boolean }[] {
  const r = mulberry(seed + 7), out: { x: number; y: number; z: number; len: number; down: boolean }[] = [];
  for (const s of net.segs) {
    if (s.ramp) continue;
    const n = Math.floor(r() * (s.room ? 14 : 3));
    const a = net.nodes[s.i], b = net.nodes[s.j];
    for (let m = 0; m < n; m++) {
      const t = r(), side = (r() - 0.5) * 1.6 * s.hw * 0.8, down = r() < 0.6;
      const ex = b.x - a.x, ez = b.z - a.z, l = Math.hypot(ex, ez) || 1;
      const x = a.x + ex * t - ez / l * side, z = a.z + ez * t + ex / l * side, floor = a.y + (b.y - a.y) * t;
      const dh = Math.abs(side);
      if (!down && dh > s.hw * 0.6) continue;
      const y = down ? floor + s.fl + s.up * Math.sqrt(Math.max(0, 1 - (dh / s.hw) ** 2)) + 0.4 : floor - 0.1;
      out.push({ x, y, z, len: 0.3 + r() * (s.room ? 2.2 : 0.7), down });
    }
  }
  return out;
}
