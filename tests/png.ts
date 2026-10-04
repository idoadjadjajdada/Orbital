import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** an 8-bit grey PNG, as the bake tools write them */
export function readGrey(path: string) {
  const f = readFileSync(path);
  let p = 8, w = 0, h = 0;
  const idat: Buffer[] = [];
  while (p < f.length) {
    const len = f.readUInt32BE(p), type = f.toString('ascii', p + 4, p + 8);
    if (type === 'IHDR') { w = f.readUInt32BE(p + 8); h = f.readUInt32BE(p + 12); if (f[p + 16] !== 8 || f[p + 17] !== 0) throw new Error(`${path}: not 8-bit grey`); }
    if (type === 'IDAT') idat.push(f.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (w + 1)], src = raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1));
    for (let x = 0; x < w; x++) {
      const a = x ? out[y * w + x - 1] : 0, b = y ? out[(y - 1) * w + x] : 0, c = x && y ? out[(y - 1) * w + x - 1] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = ft === 0 ? 0 : ft === 1 ? a : ft === 2 ? b : ft === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[y * w + x] = (src[x] + pred) & 255;
    }
  }
  return { w, h, data: out };
}
