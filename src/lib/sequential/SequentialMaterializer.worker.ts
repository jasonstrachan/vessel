import { SequentialCpuMaterializer } from '@/lib/sequential/materializer/SequentialCpuMaterializer';
import type { FrameTileSet, SequentialMaterializeFrameInput } from '@/lib/sequential/types';

type WorkerRequest = {
  id: number;
  input: SequentialMaterializeFrameInput;
};

type WorkerResponse = {
  id: number;
  tileSet: FrameTileSet;
};

type SequentialMaterializerWorkerScope = {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<WorkerRequest>) => void
  ) => void;
  postMessage: (message: WorkerResponse, transfer: Transferable[]) => void;
};

const materializer = new SequentialCpuMaterializer({ tileSize: 128 });
const workerScope = self as unknown as SequentialMaterializerWorkerScope;

workerScope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const { id, input } = event.data;
  const tileSet = materializer.materializeFrame(input);
  const transferables: Transferable[] = [];
  tileSet.tiles.forEach((tile) => {
    transferables.push(tile.data.buffer);
  });
  workerScope.postMessage({ id, tileSet } satisfies WorkerResponse, transferables);
});

export {};
