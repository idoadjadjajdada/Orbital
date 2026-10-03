import { GRID, MAT, OUTLINE_N, type Shape } from '../physics/materials';
import type { V3 } from './sprites';

const hex = (c: number): V3 => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
const PAL = new Map<number, { c: V3; d: V3; glow: number }>();
for (const m of [...MAT.values()]) PAL.set(m.id, { c: hex(m.color), d: hex(m.dark), glow: m.key === 'lava' ? 0.8 : 0 });


/** the outline's radius at angle th, eased from the drawing toward a circle by `round` */
function edgeAt(s: Shape, th: number): [number, number] {
  const f = ((th / (2 * Math.PI)) % 1 + 1) % 1 * OUTLINE_N;
  const i = Math.floor(f), t = f - i;
  const a = s.outline[i % OUTLINE_N], b = s.outline[(i + 1) % OUTLINE_N];
  const drawn = a + (b - a) * t;
  return [drawn, drawn + (1 - drawn) * s.round];
}

/**
 * A hand-drawn body seen from above, turning about the line of sight. Each
 * pixel looks up the cell it came from — stretched toward the middle as the
 * body slumps — and is lit as if the outline were the rim of a dome.
 * `d` is the equivalent diameter in art pixels.
 */
export function bakeShaped(s: Shape, d: number, spin: number, light: V3 | null, lightCol: V3, heat: number): { size: number; data: Uint8ClampedArray<ArrayBuffer> } {
  let ext = 1;
  for (const v of s.outline) ext = Math.max(ext, v);
  const R = Math.max(0.5, d / 2);
  const size = Math.max(1, Math.ceil(2 * R * ext + 2)) | 1;
  const half = size / 2;
  const out = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
  const cs = Math.cos(spin), sn = Math.sin(spin);
  const L = light ? (() => { const n = Math.hypot(light[0], light[1], light[2]) || 1; return [light[0] / n, light[1] / n, light[2] / n] as V3; })() : null;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5 - half) / R, v = -(py + 0.5 - half) / R;
      // into the body's turning frame
      const bu = cs * u + sn * v, bv = -sn * u + cs * v;
      const rho = Math.hypot(bu, bv);
      const th = Math.atan2(bv, bu);
      const [drawn, cur] = edgeAt(s, th);
      if (rho > cur) continue;
      const rn = rho / cur;
      const src = s.packed ? rn : rho * drawn / cur;
      const ci = Math.floor(s.cx + Math.cos(th) * src * s.rc), cj = Math.floor(s.cy - Math.sin(th) * src * s.rc);
      if (ci < 0 || cj < 0 || ci >= GRID || cj >= GRID) continue;
      const k = cj * GRID + ci;
      const id = s.cells[k];
      if (!id) continue;
      const pal = PAL.get(id)!;
      // a dome over the outline: steep at the rim, flat on top
      const z = Math.sqrt(Math.max(0, 1 - rn * rn));
      const nu = rn * Math.cos(th), nv = rn * Math.sin(th);
      // back to the screen frame
      const n: V3 = [cs * nu - sn * nv, sn * nu + cs * nv, z];
      let lit = L ? Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) : 0.55;
      lit = Math.min(1, lit);
      const mark = s.marks[k];
      const shade = (1 - 0.22 * mark) * (rn > 0.9 ? 0.85 : 1);
      let r = (pal.d[0] + (pal.c[0] * lightCol[0] - pal.d[0]) * lit) * shade;
      let g = (pal.d[1] + (pal.c[1] * lightCol[1] - pal.d[1]) * lit) * shade;
      let b = (pal.d[2] + (pal.c[2] * lightCol[2] - pal.d[2]) * lit) * shade;
      const glow = Math.max(pal.glow, heat * 0.9);
      if (glow > 0) { r = Math.max(r, glow); g = Math.max(g, glow * 0.42); b = Math.max(b, glow * 0.1); }
      const o = (py * size + px) * 4;
      out[o] = Math.min(255, r * 255); out[o + 1] = Math.min(255, g * 255); out[o + 2] = Math.min(255, b * 255); out[o + 3] = 255;
    }
  }
  return { size, data: out };
}

/** The drawing itself, flat, at `scale` px per cell: the cross-section shown in the builder and the inspector. */
export function drawCells(ctx: CanvasRenderingContext2D, cells: Uint8Array, scale: number, marks?: Uint8Array) {
  const img = ctx.createImageData(GRID * scale, GRID * scale);
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    const id = cells[j * GRID + i];
    if (!id) continue;
    const pal = PAL.get(id)!;
    const mk = marks ? marks[j * GRID + i] : 0;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      // a one-pixel bevel per cell keeps the grid readable
      const edge = x === scale - 1 || y === scale - 1;
      const t = (edge && scale > 3 ? 0.8 : 1) * (1 - 0.22 * mk);
      const o = ((j * scale + y) * GRID * scale + i * scale + x) * 4;
      img.data[o] = pal.c[0] * 255 * t; img.data[o + 1] = pal.c[1] * 255 * t; img.data[o + 2] = pal.c[2] * 255 * t; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
