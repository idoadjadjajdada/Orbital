#!/usr/bin/env node
// Bake the measured ground of the worlds whose heights are known, for the painters (src/pixel/heights.ts).
// Each is written to src/pixel/data/, equirectangular from 180° W with north at the top, each texel the
// mean of the source pixels it covers, its height in two channels (a canvas only reads 8 bits of each), in
// steps of 4 m (finer would only be noise at these texel sizes, and would not compress):
//   km = (R * 256 + G) * 0.004 - 12
//
//   node tools/bake-heights.mjs moon|venus|mercury|mars   (the source is fetched into tools/data/<world>/ first)
//
// The sources, all public domain:
//   moon     LOLA, NASA SVS CGI Moon Kit (https://svs.gsfc.nasa.gov/4720): ldem_16_uint.tif, 5760 x 2880, unsigned
//            16-bit half-metres over a 1737.4 km sphere, offset by +20000
//   venus    Magellan GTDR v2, USGS Astrogeology: Venus_Magellan_Topography_Global_4641m_v02.tif, 8192 x 4096,
//            signed 16-bit metres (gaps where Magellan saw nothing, filled from round them)
//   mercury  MESSENGER DEM v2, USGS Astrogeology: Mercury_Messenger_USGS_DEM_Global_665m_v2.tif, 23040 x 11520,
//            signed 16-bit metres over 2439.4 km, from 0° E. 531 MB, so only 3 rows of every 11 are fetched (range requests)
//   mars     MOLA MEGDR, PDS Geosciences: megt90n000eb.img, 5760 x 2880, big-endian signed 16-bit metres over the
//            areoid, from 0° E (turned to start at 180° W)
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, readSync, closeSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LO = -12, STEP = 0.004, SPAN = 65535 * STEP;
const USGS = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/';

const WORLDS = {
  moon: {
    url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16_uint.tif', out: 'moon-height.png', W: 2048, H: 1024,
    km: v => (v - 20000) / 2000,
    // the far side's highest ground, the deepest of South Pole–Aitken, Tycho's floor, Mare Imbrium
    checks: [['Engel’gardt high', 5.4, -158.6, 9, 11.5], ['SPA floor (Antoniadi)', -70.3, -172, -8.5, -5], ['Tycho floor', -43.3, -11.2, -4, -2], ['Mare Imbrium', 33, -16, -3.5, -1.5]],
  },
  venus: {
    url: USGS + 'Venus_Magellan_Topography_Global_4641m_v02.tif', out: 'venus-height.png', W: 2048, H: 1024,
    km: v => v / 1000,
    checks: [['Maxwell Montes', 65.2, 3.3, 7, 12], ['Lakshmi Planum', 68, -21, 2.5, 5], ['Atalanta Planitia', 46, 165, -2.5, 0], ['Maat Mons', 0.5, -165.3, 3.5, 9.5]],
  },
  mercury: {
    url: USGS + 'Mercury_Messenger_USGS_DEM_Global_665m_v2.tif', out: 'mercury-height.png', W: 2048, H: 1024, partial: 3, east0: true,
    km: v => v / 1000,
    checks: [['Caloris floor', 31.5, 162.7, -3, 1.5], ['Rachmaninoff floor (the lowest ground)', 27.6, 57.6, -11, -4], ['northern plains', 70, 0, -4, 0]],
  },
  mars: {
    url: 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img', out: 'mars-mola.png', W: 2880, H: 1440,
    raw: { w: 5760, h: 2880, be: true }, east0: true,
    km: v => v / 1000,
    checks: [['Olympus Mons', 18.65, -133.8, 19, 22.5], ['Hellas floor', -42.4, 70.5, -8.5, -6], ['Arsia Mons', -8.26, -120.1, 15, 18.5], ['Elysium Mons', 24.8, 146.9, 11, 14.5]],
  },
};

const name = process.argv[2], world = WORLDS[name];
if (!world) throw new Error(`which world? ${Object.keys(WORLDS).join(', ')}`);
const dir = join(HERE, 'data', name);
mkdirSync(dir, { recursive: true });
const src = join(dir, world.url.split('/').pop());
const { W, H } = world;

// ---------------------------------------------------------------- a TIFF's one image: uncompressed 16-bit grey, in strips
function tiffLayout(buf) {
  if (buf.toString('latin1', 0, 4) !== 'II*\0') throw new Error('not a little-endian TIFF');
  const ifd = buf.readUInt32LE(4), n = buf.readUInt16LE(ifd), tags = new Map();
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12, tag = buf.readUInt16LE(e), type = buf.readUInt16LE(e + 2), count = buf.readUInt32LE(e + 4);
    const size = { 3: 2, 4: 4 }[type] ?? 0;
    const at = size * count <= 4 ? e + 8 : buf.readUInt32LE(e + 8);
    const vals = [];
    for (let i = 0; i < count && size && at + i * size < buf.length; i++) vals.push(size === 2 ? buf.readUInt16LE(at + i * 2) : buf.readUInt32LE(at + i * 4));
    tags.set(tag, vals);
  }
  const w = tags.get(256)?.[0], h = tags.get(257)?.[0], signed = tags.get(339)?.[0] === 2;
  if (tags.get(258)?.[0] !== 16 || (tags.get(259)?.[0] ?? 1) !== 1) throw new Error(`unexpected image: ${tags.get(258)} bits, compression ${tags.get(259)}`);
  const offs = tags.get(273);
  // (one row a strip, one after another, as all four sources are: row r starts at offs[0] + r * w * 2)
  if (tags.get(278)?.[0] !== 1 || offs[1] - offs[0] !== w * 2) throw new Error('rows are not stored one a strip, end to end');
  return { w, h, signed, start: offs[0] };
}

// ---------------------------------------------------------------- the source, as rows of km (NaN where nothing was measured)
let sw, sh, rowsOf; // rowsOf(j) → the source rows that output row j covers, each a Float32Array of km
if (world.partial) {
  // fetch only `partial` rows round the middle of each output row's band, cached in tools/data/<world>/
  const head = join(dir, 'header.bin');
  if (!existsSync(head)) writeFileSync(head, await range(0, 199999));
  const L = tiffLayout(readFileSync(head));
  sw = L.w; sh = L.h;
  const cache = join(dir, `rows-${H}x${world.partial}.bin`), rowB = sw * 2, k = world.partial;
  if (!existsSync(cache)) {
    const all = Buffer.alloc(H * k * rowB);
    let next = 0, done = 0;
    const worker = async () => {
      for (let j; (j = next++) < H;) {
        const c = Math.floor(((j + 0.5) * sh) / H) - (k >> 1);
        all.set(await range(L.start + c * rowB, L.start + (c + k) * rowB - 1), j * k * rowB);
        if (++done % 64 === 0) process.stdout.write(`  ${done} / ${H} rows\r`);
      }
    };
    await Promise.all(Array.from({ length: 12 }, worker));
    writeFileSync(cache, all);
  }
  const all = readFileSync(cache);
  rowsOf = j => Array.from({ length: k }, (_, r) => decode(all, (j * k + r) * rowB, sw, L.signed, false));
} else {
  if (!existsSync(src)) {
    const r = await fetch(world.url);
    if (!r.ok) throw new Error(`fetching ${world.url}: ${r.status}`);
    writeFileSync(src, Buffer.from(await r.arrayBuffer()));
  }
  const buf = readFileSync(src);
  const L = world.raw ? { ...world.raw, signed: true, start: 0 } : tiffLayout(buf);
  sw = L.w; sh = L.h;
  if (buf.length < L.start + sw * sh * 2) throw new Error(`the image data is short: ${buf.length} bytes`);
  rowsOf = j => {
    const out = [];
    for (let y = Math.floor((j * sh) / H); y < Math.floor(((j + 1) * sh) / H); y++) {
      out.push(decode(buf, L.start + y * sw * 2, sw, L.signed, L.be));
    }
    return out;
  };
}

function decode(buf, at, w, signed, be) {
  const row = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const o = at + x * 2, v = signed ? (be ? buf.readInt16BE(o) : buf.readInt16LE(o)) : be ? buf.readUInt16BE(o) : buf.readUInt16LE(o);
    row[x] = signed && v === -32768 ? NaN : world.km(v);
  }
  return row;
}

async function range(a, b) {
  for (let tries = 0; ; tries++) {
    try {
      const r = await fetch(world.url, { headers: { Range: `bytes=${a}-${b}` } });
      if (r.status !== 206) throw new Error(`range ${a}-${b}: ${r.status}`);
      const out = Buffer.from(await r.arrayBuffer());
      if (out.length !== b - a + 1) throw new Error(`range ${a}-${b}: ${out.length} bytes`);
      return out;
    } catch (e) {
      if (tries >= 4) throw e;
      await new Promise(r => setTimeout(r, 1000 * (tries + 1)));
    }
  }
}

// ---------------------------------------------------------------- down to W x H, each texel the mean of what it covers
const out = new Float64Array(W * H);
for (let j = 0; j < H; j++) {
  const rows = rowsOf(j);
  // (a source from 0° E is read half a turn round, so it starts at 180° W like the rest)
  const turn = world.east0 ? sw / 2 : 0;
  for (let i = 0; i < W; i++) {
    const x0 = Math.floor((i * sw) / W) + turn, x1 = Math.floor(((i + 1) * sw) / W) + turn;
    let s = 0, c = 0;
    for (const row of rows) for (let x = x0; x < x1; x++) { const v = row[x % sw]; if (v === v) { s += v; c++; } }
    out[j * W + i] = c ? s / c : NaN;
  }
}
// gaps (nothing measured under a whole texel) filled from round them, a ring at a time
let gaps = 0;
for (let k = 0; k < W * H; k++) if (out[k] !== out[k]) gaps++;
for (let left = gaps, pass = 0; left && pass < 500; pass++) {
  const fill = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (out[j * W + i] === out[j * W + i]) continue;
    let s = 0, c = 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const jj = j + dj;
      if (jj < 0 || jj >= H) continue;
      const v = out[jj * W + ((i + di + W) % W)];
      if (v === v) { s += v; c++; }
    }
    if (c) fill.push([j * W + i, s / c]);
  }
  for (const [k, v] of fill) out[k] = v;
  left -= fill.length;
}
let lo = Infinity, hi = -Infinity;
for (const v of out) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
if (!(lo >= LO && hi <= LO + SPAN)) throw new Error(`heights ${lo}..${hi} km fall outside the encoding's range`);

// ---------------------------------------------------------------- a PNG: 8-bit RGB, the height's two bytes in R and G
const B = W * 3, img = Buffer.alloc(B * H);
for (let k = 0; k < W * H; k++) {
  const q = Math.round((out[k] - LO) / STEP);
  img[k * 3] = q >> 8; img[k * 3 + 1] = q & 255;
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
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(join(HERE, '..', 'src', 'pixel', 'data', world.out), png);

console.log(`${world.out} ${W} x ${H}, ${(png.length / 1e6).toFixed(2)} MB: ${lo.toFixed(2)} .. ${hi.toFixed(2)} km${gaps ? `, ${gaps} empty texels filled` : ''}`);
// --preview <file.png>: the heights as a grey picture, half size, low black to high white, to look at
const pv = process.argv.indexOf('--preview');
if (pv > 0) {
  const w = W >> 1, h = H >> 1, g = Buffer.alloc((w + 1) * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) g[j * (w + 1) + 1 + i] = Math.round((255 * (out[2 * j * W + 2 * i] - lo)) / (hi - lo));
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 0;
  writeFileSync(process.argv[pv + 1], Buffer.concat([png.subarray(0, 8), chunk('IHDR', ih), chunk('IDAT', deflateSync(g)), chunk('IEND', Buffer.alloc(0))]));
}
// (checks against the known heights of a few landmarks: a map turned or flipped would miss them)
let bad = 0;
for (const [label, la, lo2, min, max] of world.checks) {
  const i = Math.floor(((lo2 + 180) / 360) * W) % W, j = Math.floor(((90 - la) / 180) * H), v = out[j * W + i];
  const ok = v >= min && v <= max;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(38)} ${v.toFixed(2)} km (expected ${min} .. ${max})`);
}
if (bad) process.exit(1);
