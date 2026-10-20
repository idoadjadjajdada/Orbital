import { pixels } from './marsdata';

/**
 * The Moon as LOLA measured it: elevations relative to a sphere of 1737.4 km, baked by
 * tools/bake-moon.mjs into a 2048 × 1024 picture (about 5 km a texel), equirectangular from 180° W
 * with north at the top, each height in two channels: km = (R · 256 + G) · 0.004 − 10.
 *
 * Unlike the Earth's and Mars' small maps it is not fetched at the start: the first time a detailed
 * map of the Moon or its ground is wanted, in whichever thread wants it. Until then — and in tests —
 * the Moon painter works from its list of maria and craters.
 */
export interface MoonData { w: number; h: number; /** km, rows north to south */ km: Float32Array }

export let MOON: MoonData | null = null;

/** use these data (tests set them directly) */
export function setMoon(d: MoonData | null) { MOON = d; }

let asked: Promise<boolean> | null = null, settled = false;
/** whether the measured map has been fetched, or failed to be: what is painted from now on stays as it is */
export const moonSettled = () => settled;

/** fetch the map, once: resolves once it is in (true) or cannot be had (false) */
export function moonReady(): Promise<boolean> {
  return (asked ??= (async () => {
    if (typeof fetch === 'undefined' || typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') return false;
    try {
      const p = await pixels(new URL('./data/moon-height.png', import.meta.url).href);
      const km = new Float32Array(p.w * p.h);
      for (let i = 0; i < km.length; i++) km[i] = (p.data[i * 4] * 256 + p.data[i * 4 + 1]) * 0.004 - 10;
      MOON = { w: p.w, h: p.h, km };
      return true;
    } catch {
      return false;
    }
  })().finally(() => { settled = true; }));
}
