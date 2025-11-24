import {
  detectColorCycleWorkerSupport,
  markColorCycleWorkerUnsupported,
} from '@/utils/colorCycleWorkerSupport';
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

const createWorker = (preferModule = true) => {
  const url = resolveWorkerUrl();
  // Prefer module workers; fall back to classic workers when the environment
  // refuses module type (some embedded webviews) so we fail gracefully instead
  // of emitting opaque "worker error undefined" logs.
  if (!url) {
    return new Worker('./colorCycleCompositor.worker.ts');
  }
  if (!preferModule) {
    return new Worker(url);
  }
  try {
    return new Worker(url, { type: 'module' });
  } catch (error) {
    // Classic fallback keeps us functional on older browsers; the worker code
    // is simple enough to run in either mode.
    return new Worker(url);
  }
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
    const rawDetails =
      event.message || (event.error instanceof Error ? event.error.message : undefined) ||
      `${event.filename || 'worker'}:${event.lineno ?? '?'}:${event.colno ?? '?'}`;
    const details = rawDetails && rawDetails !== 'worker:?:?' ? rawDetails : 'worker runtime error';
    // Suppress noisy worker-runtime warnings; fallback paths will handle rendering.
    hasLoggedWorkerRuntimeFailure = true;
    const fallbackError = new Error(`ColorCycle compositor worker error (${details})`);
    const error = event.error instanceof Error ? event.error : fallbackError;
    this.pending.forEach(({ reject }) => reject(error));
    this.pending.clear();
    cachedClientPromise = null;
    markColorCycleWorkerUnsupported('worker-runtime-error');
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
let hasLoggedWorkerRuntimeFailure = false;

export const getColorCycleCompositorClient = (): Promise<ColorCycleCompositorClient> => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('ColorCycle compositor worker unavailable on server'));
  }
  if (!cachedClientPromise) {
    const attemptClient = (preferModule: boolean) => {
      const worker = createWorker(preferModule);
      const client = new ColorCycleCompositorClient(worker);
      return client.ping().then(
        () => client,
        (error) => {
          client.dispose();
          throw error;
        }
      );
    };

    cachedClientPromise = new Promise<ColorCycleCompositorClient>((resolve, reject) => {
      const support = detectColorCycleWorkerSupport();
      if (!support.supported) {
        reject(new Error(`ColorCycle compositor worker unsupported (${support.reason})`));
        return;
      }

      const attempts: Array<() => Promise<ColorCycleCompositorClient>> = [
        () => attemptClient(true),
        () => attemptClient(false),
      ];

      const runNext = (index: number, lastError?: unknown) => {
        if (index >= attempts.length) {
          const errorToThrow = lastError instanceof Error ? lastError : new Error(String(lastError));
          reject(errorToThrow);
          return;
        }

        attempts[index]()
          .then(resolve)
          .catch((error) => {
            runNext(index + 1, error);
          });
      };

      runNext(0);
    }).catch((error) => {
      // Allow future retries instead of permanently caching a rejected promise
      cachedClientPromise = null;
      markColorCycleWorkerUnsupported(
        error instanceof Error ? `worker-load-failed: ${error.message}` : 'worker-load-failed'
      );
      throw error;
    });
  }
  return cachedClientPromise as Promise<ColorCycleCompositorClient>;
};
