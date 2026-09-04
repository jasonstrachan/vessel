import type { SequentialStrokeEvent } from '@/types';
import type { FrameTileSet } from '@/lib/sequential/types';
import { SequentialWorkerResultCache } from '@/lib/sequential/SequentialWorkerResultCache';
export {
  buildSequentialWorkerEventsSignature,
  buildSequentialWorkerMaterializeKey,
} from '@/lib/sequential/SequentialWorkerMaterializerKeys';

type WorkerRequest = {
  id: number;
  input: {
    width: number;
    height: number;
    frameIndex: number;
    events: ReadonlyArray<SequentialStrokeEvent>;
    eventsAreFrameScoped: boolean;
  };
};

type WorkerResponse = {
  id: number;
  tileSet: FrameTileSet;
};

const pending = new Set<string>();
const completed = new SequentialWorkerResultCache();
const syncOnlyKeys = new Set<string>();
let worker: Worker | null = null;
let nextRequestId = 1;
let workerUnavailable = false;
let workerFactoryOverride: (() => Worker) | null = null;

const requestKeysById = new Map<number, string>();

const dispatchWorkerFrameReady = (frameIndex: number): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent('vessel:sequentialFrameUpdate', {
    detail: { frameIndex, advancedFrames: 0 },
  }));
};

const getWorker = (): Worker | null => {
  if (worker || workerUnavailable || (typeof Worker === 'undefined' && !workerFactoryOverride)) {
    return worker;
  }
  try {
    worker = workerFactoryOverride
      ? workerFactoryOverride()
      : new Worker(new URL('./SequentialMaterializer.worker.ts', import.meta.url), {
          type: 'module',
        });
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const key = requestKeysById.get(event.data.id);
      if (!key) {
        return;
      }
      requestKeysById.delete(event.data.id);
      pending.delete(key);
      if (!completed.set(key, event.data.tileSet)) {
        syncOnlyKeys.add(key);
      }
      dispatchWorkerFrameReady(event.data.tileSet.frameIndex);
    });
    worker.addEventListener('error', () => {
      workerUnavailable = true;
      pending.clear();
      requestKeysById.clear();
      worker?.terminate();
      worker = null;
    });
  } catch {
    workerUnavailable = true;
    worker = null;
  }
  return worker;
};

export const consumeSequentialWorkerMaterializedFrame = (key: string): FrameTileSet | null => {
  return completed.take(key);
};

export const requestSequentialWorkerMaterializedFrame = ({
  key,
  width,
  height,
  frameIndex,
  events,
}: {
  key: string;
  width: number;
  height: number;
  frameIndex: number;
  events: ReadonlyArray<SequentialStrokeEvent>;
}): boolean => {
  if (syncOnlyKeys.delete(key)) {
    return false;
  }
  if (pending.has(key) || completed.has(key)) {
    return true;
  }
  const targetWorker = getWorker();
  if (!targetWorker) {
    return false;
  }
  const id = nextRequestId;
  nextRequestId += 1;
  pending.add(key);
  requestKeysById.set(id, key);
  targetWorker.postMessage({
    id,
    input: {
      width,
      height,
      frameIndex,
      events,
      eventsAreFrameScoped: true,
    },
  } satisfies WorkerRequest);
  return true;
};

export const clearSequentialWorkerMaterializerBridge = (): void => {
  pending.clear();
  completed.clear();
  syncOnlyKeys.clear();
  requestKeysById.clear();
};

export const disposeSequentialWorkerMaterializerBridge = (): void => {
  clearSequentialWorkerMaterializerBridge();
  worker?.terminate();
  worker = null;
  workerUnavailable = false;
};

export const __setSequentialWorkerFactoryForTests = (
  factory: (() => Worker) | null,
): void => {
  disposeSequentialWorkerMaterializerBridge();
  workerFactoryOverride = factory;
};
