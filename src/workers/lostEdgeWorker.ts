// Worker: Lostedge mask generation (coarse downsample + Sierra Lite dither)

import { applySierraLiteLostEdgeMask } from '@/utils/ditherAlgorithms';

type LostEdgeRequest = {
  id: number;
  type: 'lostedge';
  coverage: Uint8Array;
  width: number;
  height: number;
  lostEdge: number;
  tileSize?: number;
};

type LostEdgeResponse = {
  id: number;
  type: 'lostedge-result';
  mask: Uint8Array;
};

type LostEdgeError = {
  id: number;
  type: 'lostedge-error';
  error: string;
};

// Handle incoming messages
self.onmessage = (event: MessageEvent<LostEdgeRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== 'lostedge') return;

  const { id, coverage, width, height, lostEdge, tileSize } = msg;

  try {
    const mask = applySierraLiteLostEdgeMask(coverage, width, height, lostEdge, tileSize ?? 4);
    // Send back transferable buffer to avoid copies
    const resp: LostEdgeResponse = {
      id,
      type: 'lostedge-result',
      mask,
    };
    (self as unknown as Worker).postMessage(resp, [mask.buffer]);
  } catch (error) {
    const resp: LostEdgeError = {
      id,
      type: 'lostedge-error',
      error: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(resp);
  }
};

export {}; // worker module boundary
