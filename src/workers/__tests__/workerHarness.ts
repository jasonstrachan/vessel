import { parentPort, workerData } from 'worker_threads';

type WorkerHarnessData = {
  entry: string;
  tsConfigPath: string;
};

const data = workerData as WorkerHarnessData;

if (!parentPort) {
  throw new Error('worker harness requires parentPort');
}

const globalScope = globalThis as typeof globalThis & {
  onmessage?: ((event: MessageEvent<unknown>) => void) | null;
  postMessage?: (message: unknown, transfer?: ArrayBuffer[]) => void;
};

globalScope.postMessage = (message: unknown, transfer?: ArrayBuffer[]) => {
  parentPort.postMessage(message, transfer as never);
};

parentPort.on('message', (dataMessage) => {
  const handler = globalScope.onmessage;
  if (handler) {
    handler({ data: dataMessage } as MessageEvent<unknown>);
  }
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
require(data.entry);
