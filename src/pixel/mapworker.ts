import { buildMap } from './surface';
import { marsReady } from './marsdata';
import type { Look } from '../physics/body';

// Paints surface maps off the main thread, so a big one never stalls a frame.
// Mars waits for its measured maps, which this thread fetches once.
self.onmessage = async (e: MessageEvent<{ key: string; look: Look; w: number }>) => {
  const { key, look, w } = e.data;
  if (look.real === 'Mars') await marsReady;
  const m = buildMap(look, w);
  const bufs = [m.rgb.buffer, m.emit.buffer, m.spec.buffer, m.height.buffer, ...(m.cloud ? [m.cloud.buffer] : [])] as ArrayBuffer[];
  (self as unknown as Worker).postMessage({ key, map: m }, bufs);
};
