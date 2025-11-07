import type {
  ColorCycleFillJob,
  ColorCycleFillResult,
  ConcentricFillJob,
  ConcentricFillResult,
  PerceptualDitherJob,
  PerceptualDitherResult,
} from './colorCycleFillTypes';

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

const runWorkerJob = async <TJob extends ColorCycleFillJob, TResult extends ColorCycleFillResult>(
  job: TJob
): Promise<TResult> => {
  if (typeof window === 'undefined') {
    throw new Error('colorCycle fill worker unavailable on server');
  }
  const worker = await getWorker();
  const id = ++jobCounter;
  return new Promise((resolve, reject) => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { id: number; ok: boolean; type: ColorCycleFillJob['type']; result?: ColorCycleFillResult; error?: string };
      if (data.id !== id || data.type !== job.type) {
        return;
      }
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      if (data.ok && data.result) {
        resolve(data.result as TResult);
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
    if ('pixels' in job && job.pixels) {
      transfer.push(job.pixels as ArrayBuffer);
    }
    if ('vertices' in job && job.vertices) {
      transfer.push(job.vertices.buffer as ArrayBuffer);
    }
    worker.postMessage({ id, job }, transfer);
  });
};

export const runPerceptualDitherJob = async (
  job: PerceptualDitherJob
): Promise<PerceptualDitherResult> => runWorkerJob<PerceptualDitherJob, PerceptualDitherResult>(job);

export const runConcentricFillJob = async (
  job: ConcentricFillJob
): Promise<ConcentricFillResult> => runWorkerJob<ConcentricFillJob, ConcentricFillResult>(job);
