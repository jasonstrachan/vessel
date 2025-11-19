import { applySierraLiteLostEdgeMask } from '@/utils/ditherAlgorithms';

type LostEdgeRequestPayload = {
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

type Pending = {
  resolve: (mask: Uint8Array) => void;
  reject: (err: Error) => void;
};

export class LostEdgeWorkerManager {
  private worker: Worker | null = null;
  private supported: boolean;
  private requestId = 0;
  private pending = new Map<number, Pending>();

  constructor() {
    this.supported = typeof Worker !== 'undefined';
    if (!this.supported) return;

    try {
      this.worker = new Worker(new URL('../../workers/lostEdgeWorker.ts', import.meta.url), {
        type: 'module'
      });
      this.worker.onmessage = this.onMessage;
      this.worker.onerror = this.onError;
    } catch (error) {
      console.error('[LostEdgeWorker] init failed, falling back to main thread', error);
      this.supported = false;
      this.worker = null;
    }
  }

  private onMessage = (event: MessageEvent<LostEdgeResponse | LostEdgeError>) => {
    const msg = event.data;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.type === 'lostedge-error') {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg.mask);
    }
  };

  private onError = (err: ErrorEvent) => {
    console.error('[LostEdgeWorker] worker error', err);
    for (const [, pending] of this.pending) {
      pending.reject(new Error(err.message));
    }
    this.pending.clear();
  };

  async compute(payload: LostEdgeRequestPayload): Promise<Uint8Array> {
    if (!this.supported || !this.worker) {
      return applySierraLiteLostEdgeMask(
        payload.coverage,
        payload.width,
        payload.height,
        payload.lostEdge,
        payload.tileSize ?? 4
      );
    }

    const id = ++this.requestId;
    return new Promise<Uint8Array>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker?.postMessage({ ...payload, id, type: 'lostedge' }, [payload.coverage.buffer]);
    });
  }
}

export const sharedLostEdgeWorker = new LostEdgeWorkerManager();
