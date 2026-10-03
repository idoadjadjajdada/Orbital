/**
 * Mars as it is measured: MOLA's elevations and a true-colour mosaic, baked by
 * tools/bake-mars.py into two small pictures, equirectangular from 180° W with
 * north at the top. They are fetched once, in each thread that paints (the
 * main thread and the map and terrain workers, which share the browser's
 * cache), and the Mars painter reads them from then on. Until they arrive —
 * and in tests, with no browser to decode them — it paints from its list of
 * features instead.
 */
export interface MarsData {
  w: number; h: number;
  /** elevation above the areoid: value × 0.12 − 8.5 km, rows north to south */
  height: Uint8Array;
  /** colour, RGB, rows north to south; null paints from the features */
  rgb: Uint8Array | null;
}

export let MARS: MarsData | null = null;

/** use these data (tests set them from the files directly) */
export function setMars(d: MarsData | null) { MARS = d; }

async function pixels(url: string) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  g.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, data: g.getImageData(0, 0, bmp.width, bmp.height).data };
}

async function load(): Promise<boolean> {
  if (typeof fetch === 'undefined' || typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') return false;
  try {
    const [h, c] = await Promise.all([
      pixels(new URL('./data/mars-height.png', import.meta.url).href),
      pixels(new URL('./data/mars-colour.jpg', import.meta.url).href),
    ]);
    const height = new Uint8Array(h.w * h.h), rgb = new Uint8Array(c.w * c.h * 3);
    for (let i = 0; i < h.w * h.h; i++) height[i] = h.data[i * 4];
    for (let i = 0; i < c.w * c.h; i++) { rgb[i * 3] = c.data[i * 4]; rgb[i * 3 + 1] = c.data[i * 4 + 1]; rgb[i * 3 + 2] = c.data[i * 4 + 2]; }
    if (c.w !== h.w || c.h !== h.h) return false;
    MARS = { w: h.w, h: h.h, height, rgb };
    return true;
  } catch {
    return false;
  }
}

/** resolves once the data are in (true) or cannot be had (false) */
export const marsReady: Promise<boolean> = load();
