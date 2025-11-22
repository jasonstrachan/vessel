import { detectColorCycleWorkerSupport } from '@/utils/colorCycleWorkerSupport';
import type {
  ColorCycleCompositorLayerFrame,
  ColorCycleCompositorMessage,
  ColorCycleCompositorResponse,
} from './colorCycleCompositorTypes';

const resolveWorkerUrl = () => {
  try {
    // Avoid import.meta syntax errors under CommonJS (Jest)
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'return (typeof import !== "undefined" && import.meta && import.meta.url) ? new URL("./colorCycleCompositor.worker.ts", import.meta.url) : null;'
    );
    return fn();
  } catch {
    return null;
  }
};

const createWorker = () => {
  const url = resolveWorkerUrl();
  // Fallback: rely on runtime worker resolution (tests or legacy bundlers)
  return url
    ? new Worker(url, { type: 'module' })
    : new Worker('./colorCycleCompositor.worker.ts');
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type FrameListener = (layers: ColorCycleCompositorLayerFrame[]) => void;

export class ColorCycleCompositorClient {
  private worker: Worker;
  private requestCounter = 0;
  private pending = new Map<number, PendingRequest>();
  private frameListeners = new Set<FrameListener>();

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.addEventListener('message', this.handleMessage as EventListener);
    this.worker.addEventListener('error', this.handleWorkerError);
  }

  private handleMessage = (event: MessageEvent<ColorCycleCompositorResponse>) => {
    const data = event.data;
    switch (data.type) {
      case 'pong':
      case 'ack': {
        this.resolvePending(data.requestId, data);
        break;
      }
      case 'error': {
        this.rejectPending(
          data.requestId,
          new Error(data.message || 'ColorCycle compositor worker error')
        );
        break;
      }
      case 'frame': {
        this.frameListeners.forEach((listener) => {
          try {
            listener(data.layers);
          } catch (error) {
            if (process.env.NODE_ENV !== 'production') {
              console.warn('[ColorCycleWorker] frame listener failed', error);
            }
          }
        });
        break;
      }
      default:
        break;
    }
  };

  private handleWorkerError = (event: ErrorEvent) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[ColorCycleWorker] worker error', event.message);
    }
    this.pending.forEach(({ reject }) => reject(event.error || new Error(event.message)));
    this.pending.clear();
  };

  private resolvePending(requestId: number | undefined, value: unknown) {
    if (typeof requestId !== 'number') {
      return;
    }
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    pending.resolve(value);
    this.pending.delete(requestId);
  }

  private rejectPending(requestId: number | undefined, error: Error) {
    if (typeof requestId !== 'number') {
      return;
    }
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    pending.reject(error);
    this.pending.delete(requestId);
  }

  private nextRequestId(): number {
    this.requestCounter += 1;
    return this.requestCounter;
  }

  private send<T = unknown>(message: ColorCycleCompositorMessage & { requestId?: number }): Promise<T> {
    if (typeof window === 'undefined') {
      return Promise.reject(new Error('ColorCycle compositor client unavailable on server'));
    }
    const requestId = this.nextRequestId();
    const payload = { ...message, requestId } as ColorCycleCompositorMessage & { requestId: number };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (value: unknown) => {
          resolve(value as T);
        },
        reject,
      });
      this.worker.postMessage(payload);
    });
  }

  ping(): Promise<void> {
    return this.send({ type: 'ping' }).then(() => undefined);
  }

  requestFrame(): Promise<void> {
    return this.send({ type: 'frame-request' }).then(() => undefined);
  }

  ensureLayer(layerId: string, width: number, height: number): Promise<void> {
    return this.send({ type: 'ensure-layer', layerId, width, height }).then(() => undefined);
  }

  disposeLayer(layerId: string): Promise<void> {
    return this.send({ type: 'dispose-layer', layerId }).then(() => undefined);
  }

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  dispose(): void {
    this.worker.removeEventListener('message', this.handleMessage as EventListener);
    this.worker.removeEventListener('error', this.handleWorkerError);
    this.worker.terminate();
    this.pending.forEach(({ reject }, id) => {
      reject(new Error('ColorCycle compositor client disposed'));
      this.pending.delete(id);
    });
    this.frameListeners.clear();
  }
}

let cachedClientPromise: Promise<ColorCycleCompositorClient> | null = null;

export const getColorCycleCompositorClient = (): Promise<ColorCycleCompositorClient> => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('ColorCycle compositor worker unavailable on server'));
  }
  if (!cachedClientPromise) {
    cachedClientPromise = new Promise((resolve, reject) => {
      const support = detectColorCycleWorkerSupport();
      if (!support.supported) {
        reject(new Error(`ColorCycle compositor worker unsupported (${support.reason})`));
        return;
      }
      try {
        const worker = createWorker();
        const client = new ColorCycleCompositorClient(worker);
        client
          .ping()
          .then(() => resolve(client))
          .catch((error) => {
            client.dispose();
            reject(error);
          });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  return cachedClientPromise;
};
