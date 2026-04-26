import type { SequentialStrokeEvent } from '@/types';
import type { FrameTileSet } from '@/lib/sequential/types';
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
const completed = new Map<string, FrameTileSet>();
let worker: Worker | null = null;
let nextRequestId = 1;
let workerUnavailable = false;

const requestKeysById = new Map<number, string>();

const getWorker = (): Worker | null => {
  if (worker || workerUnavailable || typeof Worker === 'undefined') {
    return worker;
  }
  try {
    worker = new Worker(new URL('./SequentialMaterializer.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const key = requestKeysById.get(event.data.id);
      if (!key) {
        return;
      }
      requestKeysById.delete(event.data.id);
      pending.delete(key);
      completed.set(key, event.data.tileSet);
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
  const tileSet = completed.get(key);
  if (!tileSet) {
    return null;
  }
  completed.delete(key);
  return tileSet;
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
}): void => {
  if (pending.has(key) || completed.has(key)) {
    return;
  }
  const targetWorker = getWorker();
  if (!targetWorker) {
    return;
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
};

export const clearSequentialWorkerMaterializerBridge = (): void => {
  pending.clear();
  completed.clear();
  requestKeysById.clear();
};

export const disposeSequentialWorkerMaterializerBridge = (): void => {
  clearSequentialWorkerMaterializerBridge();
  worker?.terminate();
  worker = null;
  workerUnavailable = false;
};
