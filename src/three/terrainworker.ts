import { buildPatch, type TerrainSrc, type V3 } from './terrain';

// Builds patches of ground off the main thread. A world's recipe is sent once; then jobs.
let src: TerrainSrc | null = null;
self.onmessage = (e: MessageEvent<{ src?: TerrainSrc; job?: { id: number; c: V3; E: number; N: number; fine: number } }>) => {
  if (e.data.src) { src = e.data.src; return; }
  const j = e.data.job;
  if (!j || !src) return;
  const p = buildPatch(src, j.c, j.E, j.N, j.fine);
  (self as unknown as Worker).postMessage({ id: j.id, key: src.key, patch: p }, [p.pos.buffer, p.col.buffer, p.nor.buffer, p.idx.buffer, p.hgt.buffer] as ArrayBuffer[]);
};
