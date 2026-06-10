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
const COLOR_CYCLE_FILL_JOB_TIMEOUT_MS = 10_000;

const getWorker = () => {
  if (!workerPromise) {
    workerPromise = Promise.resolve(new Worker('./colorCycleFill.worker.ts', { type: 'module' })).catch(
      () => new Worker('./colorCycleFill.worker.ts')
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
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const resetWorker = () => {
      workerPromise = null;
      try {
        worker.terminate();
      } catch {}
    };
    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
    };
    const settleResolve = (result: TResult) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };
    const settleReject = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { id: number; ok: boolean; type: ColorCycleFillJob['type']; result?: ColorCycleFillResult; error?: string };
      if (data.id !== id || data.type !== job.type) {
        return;
      }
      if (data.ok && data.result) {
        settleResolve(data.result as TResult);
      } else {
        settleReject(new Error(data.error || 'colorCycle fill worker failed'));
      }
    };
    const handleError = (err: ErrorEvent) => {
      resetWorker();
      settleReject(err.error || new Error(err.message));
    };
    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);
    timeoutId = setTimeout(() => {
      settleReject(new Error(`colorCycle fill worker timed out after ${COLOR_CYCLE_FILL_JOB_TIMEOUT_MS}ms`));
    }, COLOR_CYCLE_FILL_JOB_TIMEOUT_MS);
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
