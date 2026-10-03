import { buildMap } from './surface';
import type { Look } from '../physics/body';

// Paints surface maps off the main thread, so a big one never stalls a frame.
self.onmessage = (e: MessageEvent<{ key: string; look: Look; w: number }>) => {
  const { key, look, w } = e.data;
  const m = buildMap(look, w);
  const bufs = [m.rgb.buffer, m.emit.buffer, m.spec.buffer, m.height.buffer, ...(m.cloud ? [m.cloud.buffer] : [])] as ArrayBuffer[];
  (self as unknown as Worker).postMessage({ key, map: m }, bufs);
};
