import { buildPatch, type PatchJob } from './terrain';

// Builds terrain patches off the main thread: a few hundred milliseconds each, never a stalled frame.
self.onmessage = (e: MessageEvent<PatchJob>) => {
  const p = buildPatch(e.data);
  (self as unknown as Worker).postMessage(p, [p.pos.buffer, p.nrm.buffer, p.col.buffer, p.sea.buffer, p.index.buffer, p.rocks.buffer] as ArrayBuffer[]);
};
