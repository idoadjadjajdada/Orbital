import { pixels } from './marsdata';

/**
 * The worlds whose ground is measured: the Moon (LOLA), Venus (Magellan), Mercury (MESSENGER), and Mars (MOLA)
 * finer than the small map it starts with. Baked by tools/bake-heights.mjs into pictures 5 to 19 km a texel,
 * equirectangular from 180° W with north at the top, each height in two channels: km = (R · 256 + G) · 0.004 − 12.
 *
 * Unlike the Earth's and Mars' small maps they are not fetched at the start: the first time a detailed map of
 * the world or its ground is wanted, in whichever thread wants it. Until then — and in tests — the painters
 * work from their lists of features.
 */
export interface HeightMap { w: number; h: number; /** heights as stored, rows north to south: `kmOf` reads them */ q: Uint16Array }

/** a stored height (or a blend of them) in km */
export const kmOf = (q: number) => q * 0.004 - 12;

const URLS: Record<string, () => string> = {
  Moon: () => new URL('./data/moon-height.png', import.meta.url).href,
  Venus: () => new URL('./data/venus-height.png', import.meta.url).href,
  Mercury: () => new URL('./data/mercury-height.png', import.meta.url).href,
  Mars: () => new URL('./data/mars-mola.png', import.meta.url).href,
};

/** whether a world has a measured map to fetch */
export const measured = (real?: string) => !!real && real in URLS;

export const HEIGHTS: Record<string, HeightMap | undefined> = {};

/** use these data (tests set them directly) */
export function setHeights(real: string, d: HeightMap | null) { HEIGHTS[real] = d ?? undefined; }

const asked = new Map<string, Promise<boolean>>(), settled = new Set<string>();
/** whether a world's map has been fetched, or failed to be: what is painted from now on stays as it is */
export const heightsSettled = (real: string) => settled.has(real);

/** fetch a world's map, once: resolves once it is in (true) or cannot be had (false) */
export function heightsReady(real: string): Promise<boolean> {
  let p = asked.get(real);
  if (!p) {
    p = (async () => {
      if (!measured(real) || typeof fetch === 'undefined' || typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') return false;
      try {
        const px = await pixels(URLS[real]());
        const q = new Uint16Array(px.w * px.h);
        for (let i = 0; i < q.length; i++) q[i] = px.data[i * 4] * 256 + px.data[i * 4 + 1];
        HEIGHTS[real] = { w: px.w, h: px.h, q };
        return true;
      } catch {
        return false;
      }
    })().finally(() => { settled.add(real); });
    asked.set(real, p);
  }
  return p;
}
