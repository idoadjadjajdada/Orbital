import { buildTile, type TileJob } from './terrain';
import { marsReady } from '../pixel/marsdata';
import { earthReady } from '../pixel/earthdata';

// Builds terrain tiles off the main thread: tens of milliseconds each, never a stalled frame.
// Mars waits for its measured maps, which this thread fetches once.
self.onmessage = async (e: MessageEvent<TileJob>) => {
  if (e.data.spec.look.real === 'Mars') await marsReady;
  if (e.data.spec.look.real === 'Earth') await earthReady;
  const t = buildTile(e.data);
  (self as unknown as Worker).postMessage(t, [t.pos.buffer, t.nrm.buffer, t.col.buffer, t.sea.buffer, t.rock.buffer, t.index.buffer, t.rocks.buffer] as ArrayBuffer[]);
};
