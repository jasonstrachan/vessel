import type { PerceptualDitherJob, PerceptualDitherResult } from './colorCycleFillTypes';

let workerPromise: Promise<Worker> | null = null;
let jobCounter = 0;

const getWorker = () => {
  if (!workerPromise) {
    workerPromise = Promise.resolve(
      new Worker(new URL('./colorCycleFill.worker.ts', import.meta.url), { type: 'module' })
    );
  }
  return workerPromise;
};

export const runPerceptualDitherJob = async (
  job: PerceptualDitherJob
): Promise<PerceptualDitherResult> => {
  if (typeof window === 'undefined') {
    throw new Error('colorCycle fill worker unavailable on server');
  }
  const worker = await getWorker();
  const id = ++jobCounter;
  return new Promise((resolve, reject) => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { id: number; ok: boolean; result?: PerceptualDitherResult; error?: string };
      if (data.id !== id) {
        return;
      }
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      if (data.ok && data.result) {
        resolve(data.result);
      } else {
        reject(new Error(data.error || 'colorCycle fill worker failed'));
      }
    };
    const handleError = (err: ErrorEvent) => {
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      reject(err.error || new Error(err.message));
    };
    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);
    const transfer: ArrayBuffer[] = [];
    if (job.pixels) {
      transfer.push(job.pixels);
    }
    worker.postMessage({ id, job }, transfer);
  });
};
