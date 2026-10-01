// Deterministic 3D value noise, so a world with the same seed always looks the same.

function hash(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const sm = (t: number) => t * t * (3 - 2 * t);

export function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = sm(x - xi), v = sm(y - yi), w = sm(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u), v),
    l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

export function fbm(x: number, y: number, z: number, oct = 5): number {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x, y, z); n += a;
    x = x * 2.03 + 1.7; y = y * 2.03 + 9.2; z = z * 2.03 + 3.1; a *= 0.5;
  }
  return s / n;
}

export function ridged(x: number, y: number, z: number, oct = 4): number {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * (1 - Math.abs(2 * vnoise(x, y, z) - 1)); n += a;
    x = x * 2.1 + 3.3; y = y * 2.1 + 1.1; z = z * 2.1 + 5.2; a *= 0.5;
  }
  return s / n;
}

/** 4×4 Bayer matrix, 0..1, for ordered dithering */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
export const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];
