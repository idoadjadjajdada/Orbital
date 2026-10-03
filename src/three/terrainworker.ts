import { buildPatch, type PatchJob } from './terrain';
import { marsReady } from '../pixel/marsdata';

// Builds terrain patches off the main thread: a few hundred milliseconds each, never a stalled frame.
// Mars waits for its measured maps, which this thread fetches once.
self.onmessage = async (e: MessageEvent<PatchJob>) => {
  if (e.data.spec.look.real === 'Mars') await marsReady;
  const p = buildPatch(e.data);
  (self as unknown as Worker).postMessage(p, [p.pos.buffer, p.nrm.buffer, p.col.buffer, p.sea.buffer, p.index.buffer, p.rocks.buffer] as ArrayBuffer[]);
};
