/**
 * The Earth's land as it is measured: elevation from NASA's SRTM-based
 * topography, baked by tools/bake-earth-height.py into a 2048 × 1024 grey
 * picture, equirectangular from 180° W with north at the top (about 20 km a
 * texel). Fetched once in each thread that paints, like Mars' maps
 * (marsdata.ts); until it is in, and in tests, the Earth painter makes its
 * mountains from the map of where the ranges are.
 *
 * Alongside the heights, how rugged the land is round each texel (the spread
 * of heights in the texels about it): the Himalaya and the Andes rugged,
 * Tibet's plateau and the Great Plains smooth however high they stand.
 */
export interface EarthData {
  w: number; h: number;
  /** elevation, value × 25.1 m; rows north to south */
  height: Uint8Array;
  /** local relief, m: the spread of the heights round each texel */
  rough: Float32Array;
}

/** metres a grey level */
export const EARTH_M = 25.1;

export let EARTH_DEM: EarthData | null = null;

/** use these data (tests set them from the file directly) */
export function setEarth(w: number, h: number, height: Uint8Array | null) {
  EARTH_DEM = height ? { w, h, height, rough: roughness(w, h, height) } : null;
}

/** the standard deviation of height in the 5 × 5 texels round each */
function roughness(w: number, h: number, a: Uint8Array) {
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let s = 0, s2 = 0, n = 0;
    for (let b = -2; b <= 2; b++) {
      const jj = Math.max(0, Math.min(h - 1, j + b)) * w;
      for (let c = -2; c <= 2; c++) { const v = a[jj + ((i + c + w) % w)]; s += v; s2 += v * v; n++; }
    }
    const m = s / n;
    out[j * w + i] = Math.sqrt(Math.max(0, s2 / n - m * m)) * EARTH_M;
  }
  return out;
}

async function load(): Promise<boolean> {
  if (typeof fetch === 'undefined' || typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') return false;
  try {
    const blob = await (await fetch(new URL('./data/earth-height.png', import.meta.url).href)).blob();
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data, height = new Uint8Array(bmp.width * bmp.height);
    for (let i = 0; i < height.length; i++) height[i] = d[i * 4];
    setEarth(bmp.width, bmp.height, height);
    return true;
  } catch {
    return false;
  }
}

/** resolves once the data are in (true) or cannot be had (false) */
export const earthReady: Promise<boolean> = load();
