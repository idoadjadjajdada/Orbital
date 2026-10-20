import { buildMap } from './surface';
import { marsReady } from './marsdata';
import { earthReady } from './earthdata';
import { heightsReady } from './heights';
import type { Look } from '../physics/body';

// Paints surface maps off the main thread, so a big one never stalls a frame.
// The Earth, Mars and the measured worlds (heights.ts) wait for their maps, which this thread fetches once.
self.onmessage = async (e: MessageEvent<{ key: string; look: Look; w: number }>) => {
  const { key, look, w } = e.data;
  if (look.real === 'Mars') await marsReady;
  if (look.real === 'Earth') await earthReady;
  // (a detailed map of a measured world waits for its heights; Venus' map is its clouds)
  if (look.real && look.real !== 'Venus' && w >= 512) await heightsReady(look.real);
  const m = buildMap(look, w);
  const bufs = [m.rgb.buffer, m.emit.buffer, m.spec.buffer, m.height.buffer, ...(m.cloud ? [m.cloud.buffer] : [])] as ArrayBuffer[];
  (self as unknown as Worker).postMessage({ key, map: m }, bufs);
};
