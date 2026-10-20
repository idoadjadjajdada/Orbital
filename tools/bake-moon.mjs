#!/usr/bin/env node
// Bake the Moon's ground for the painters from LOLA's measured elevations (NASA SVS CGI Moon Kit,
// https://svs.gsfc.nasa.gov/4720, public domain): ldem_16_uint.tif, 5760 x 2880, 16 pixels a degree,
// equirectangular from 180° W with north at the top, uncompressed unsigned 16-bit, half-metres
// relative to a sphere of 1737.4 km offset by +20000.
//
// Written to src/pixel/data/moon-height.png: 2048 x 1024 (about 5 km a texel), each texel the mean of
// the source pixels it covers, its height in two channels (a canvas only reads 8 bits of each), in steps of
// 4 m (a texel spans 5 km: finer would only be noise, and would not compress):
//   km = (R * 256 + G) * 0.004 - 10
//
//   node tools/bake-moon.mjs [ldem_16_uint.tif]   (no argument: fetched into tools/data/moon/ first)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const URL_SRC = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16_uint.tif';
const OUT = join(HERE, '..', 'src', 'pixel', 'data', 'moon-height.png');
const W = 2048, H = 1024, LO = -10, STEP = 0.004, SPAN = 65535 * STEP;

let src = process.argv[2];
if (!src) {
  src = join(HERE, 'data', 'moon', 'ldem_16_uint.tif');
  if (!existsSync(src)) {
    mkdirSync(dirname(src), { recursive: true });
    const r = await fetch(URL_SRC);
    if (!r.ok) throw new Error(`fetching ${URL_SRC}: ${r.status}`);
    writeFileSync(src, Buffer.from(await r.arrayBuffer()));
  }
}

// ---------------------------------------------------------------- the TIFF: one image, uncompressed, 16-bit grey
const buf = readFileSync(src);
if (buf.toString('latin1', 0, 4) !== 'II*\0') throw new Error('not a little-endian TIFF');
const ifd = buf.readUInt32LE(4), n = buf.readUInt16LE(ifd), tags = new Map();
for (let k = 0; k < n; k++) {
  const e = ifd + 2 + k * 12, tag = buf.readUInt16LE(e), type = buf.readUInt16LE(e + 2), count = buf.readUInt32LE(e + 4);
  const size = { 3: 2, 4: 4 }[type] ?? 0;
  const at = size * count <= 4 ? e + 8 : buf.readUInt32LE(e + 8);
  const vals = [];
  for (let i = 0; i < count && size; i++) vals.push(size === 2 ? buf.readUInt16LE(at + i * 2) : buf.readUInt32LE(at + i * 4));
  tags.set(tag, vals);
}
const SW = tags.get(256)?.[0], SH = tags.get(257)?.[0];
if (SW !== 5760 || SH !== 2880 || tags.get(258)?.[0] !== 16 || (tags.get(259)?.[0] ?? 1) !== 1) throw new Error(`unexpected image: ${SW} x ${SH}, ${tags.get(258)} bits, compression ${tags.get(259)}`);
const offs = tags.get(273), counts = tags.get(279);
const raw = Buffer.concat(offs.map((o, i) => buf.subarray(o, o + counts[i])));
if (raw.length !== SW * SH * 2) throw new Error(`image data is ${raw.length} bytes, not ${SW * SH * 2}`);
const km = (i) => (raw.readUInt16LE(i * 2) - 20000) / 2000;

// ---------------------------------------------------------------- down to 2048 x 1024, each texel the mean of what it covers
const out = new Float64Array(W * H);
let lo = Infinity, hi = -Infinity;
for (let j = 0; j < H; j++) {
  const y0 = Math.floor((j * SH) / H), y1 = Math.floor(((j + 1) * SH) / H);
  for (let i = 0; i < W; i++) {
    const x0 = Math.floor((i * SW) / W), x1 = Math.floor(((i + 1) * SW) / W);
    let s = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += km(y * SW + x);
    const v = s / ((y1 - y0) * (x1 - x0));
    out[j * W + i] = v;
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
}
if (lo < LO || hi > LO + SPAN) throw new Error(`heights ${lo}..${hi} km fall outside the encoding's range`);

// ---------------------------------------------------------------- a PNG: 8-bit RGB, the height's two bytes in R and G
const B = W * 3, img = Buffer.alloc(B * H);
for (let k = 0; k < W * H; k++) {
  const q = Math.round((out[k] - LO) / STEP);
  img[k * 3] = q >> 8; img[k * 3 + 1] = q & 255; img[k * 3 + 2] = 0;
}
// each row through whichever of PNG's five filters leaves the smallest residuals (the usual choice), so the
// smooth ground compresses: the low byte alone looks like noise
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
const rows = Buffer.alloc((B + 1) * H), cand = Array.from({ length: 5 }, () => Buffer.alloc(B));
for (let j = 0; j < H; j++) {
  const row = img.subarray(j * B, (j + 1) * B), up = j ? img.subarray((j - 1) * B, j * B) : Buffer.alloc(B);
  let best = 0, bestSum = Infinity;
  for (let f = 0; f < 5; f++) {
    const c = cand[f];
    let sum = 0;
    for (let x = 0; x < B; x++) {
      const a = x >= 3 ? row[x - 3] : 0, b = up[x], cc = x >= 3 ? up[x - 3] : 0;
      const v = (row[x] - [0, a, b, (a + b) >> 1, paeth(a, b, cc)][f]) & 255;
      c[x] = v; sum += v < 128 ? v : 256 - v;
    }
    if (sum < bestSum) { bestSum = sum; best = f; }
  }
  rows[j * (B + 1)] = best;
  cand[best].copy(rows, j * (B + 1) + 1);
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
writeFileSync(OUT, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));

console.log(`moon-height.png ${W} x ${H}: ${lo.toFixed(2)} .. ${hi.toFixed(2)} km`);
// (checks against LOLA: the far side's highest ground, Engel'gardt, and the deepest of South Pole–Aitken, and Tycho's floor)
for (const [name, la, lo2] of [['Engel’gardt high', 5.4, -158.6], ['SPA floor (Antoniadi)', -70.3, -172], ['Tycho floor', -43.3, -11.2], ['Mare Imbrium', 33, -16]]) {
  const i = Math.floor(((lo2 + 180) / 360) * W) % W, j = Math.floor(((90 - la) / 180) * H);
  console.log(`  ${name.padEnd(22)} ${out[j * W + i].toFixed(2)} km`);
}
