import type {
  AutoConvertRegionsJob,
  AutoConvertRegionsResult,
  ColorCycleFillJob,
  ColorCycleFillResult,
  ConcentricFillJob,
  ConcentricFillResult,
  PerceptualDitherJob,
  PerceptualDitherResult,
  ShapeGradientSampleJob,
  ShapeGradientSampleResult,
} from './colorCycleFillTypes';
import { createColorCycleFillWorker } from './colorCycleFillWorkerFactory';

let workerPromise: Promise<Worker> | null = null;
let jobCounter = 0;
const COLOR_CYCLE_FILL_JOB_TIMEOUT_MS = 10_000;
let compositeSampleCanvas: HTMLCanvasElement | null = null;
let referenceSampleCanvas: HTMLCanvasElement | null = null;

type ShapeGradientCanvasSource = HTMLCanvasElement | OffscreenCanvas;

type ShapeGradientCanvasSamplingOptions = {
  compositeCanvas: ShapeGradientCanvasSource;
  referenceCanvas?: ShapeGradientCanvasSource | null;
  shapePoints: Array<{ x: number; y: number }>;
  direction?: { x: number; y: number } | null;
  maxColors: number;
  mode: 'linear' | 'concentric';
  sampleScale?: number;
};

const getCanvas2dContext = (
  canvas: ShapeGradientCanvasSource,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null => canvas.getContext(
  '2d',
  { willReadFrequently: true } as CanvasRenderingContext2DSettings,
) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

const captureScaledCanvasRegion = ({
  source,
  originX,
  originY,
  width,
  height,
  scale,
  kind,
}: {
  source: ShapeGradientCanvasSource;
  originX: number;
  originY: number;
  width: number;
  height: number;
  scale: number;
  kind: 'composite' | 'reference';
}): ImageData => {
  const sourceContext = getCanvas2dContext(source);
  if (sourceContext && scale === 1) {
    return sourceContext.getImageData(originX, originY, width, height);
  }
  if (typeof document === 'undefined') {
    throw new Error(`${kind} shape sampling canvas unavailable`);
  }
  const scaledWidth = Math.max(1, Math.ceil(width / scale));
  const scaledHeight = Math.max(1, Math.ceil(height / scale));
  let target = kind === 'composite' ? compositeSampleCanvas : referenceSampleCanvas;
  if (!target) {
    target = document.createElement('canvas');
    if (kind === 'composite') {
      compositeSampleCanvas = target;
    } else {
      referenceSampleCanvas = target;
    }
  }
  if (target.width !== scaledWidth || target.height !== scaledHeight) {
    target.width = scaledWidth;
    target.height = scaledHeight;
  }
  const targetContext = target.getContext('2d', { willReadFrequently: true });
  if (!targetContext) {
    throw new Error(`Unable to create scaled ${kind} sampling canvas`);
  }
  targetContext.clearRect(0, 0, scaledWidth, scaledHeight);
  targetContext.imageSmoothingEnabled = true;
  targetContext.drawImage(
    source,
    originX,
    originY,
    width,
    height,
    0,
    0,
    scaledWidth,
    scaledHeight,
  );
  return targetContext.getImageData(0, 0, scaledWidth, scaledHeight);
};

const getWorker = () => {
  if (!workerPromise) {
    workerPromise = Promise.resolve().then(createColorCycleFillWorker);
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
    if ('compositePixels' in job && job.compositePixels) {
      transfer.push(job.compositePixels);
    }
    if ('referencePixels' in job && job.referencePixels) {
      transfer.push(job.referencePixels);
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

export const runShapeGradientSampleJob = async (
  job: ShapeGradientSampleJob
): Promise<ShapeGradientSampleResult> => runWorkerJob<ShapeGradientSampleJob, ShapeGradientSampleResult>(job);

export const runAutoConvertRegionsJob = async (
  job: AutoConvertRegionsJob,
): Promise<AutoConvertRegionsResult> =>
  runWorkerJob<AutoConvertRegionsJob, AutoConvertRegionsResult>(job);

export const sampleShapeGradientFromCanvases = async ({
  compositeCanvas,
  referenceCanvas,
  shapePoints,
  direction,
  maxColors,
  mode,
  sampleScale = 1,
}: ShapeGradientCanvasSamplingOptions): Promise<ShapeGradientSampleResult | null> => {
  if (shapePoints.length < 3 || compositeCanvas.width <= 0 || compositeCanvas.height <= 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of shapePoints) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const originX = Math.max(0, Math.min(compositeCanvas.width - 1, Math.floor(minX)));
  const originY = Math.max(0, Math.min(compositeCanvas.height - 1, Math.floor(minY)));
  const endX = Math.max(originX + 1, Math.min(compositeCanvas.width, Math.ceil(maxX)));
  const endY = Math.max(originY + 1, Math.min(compositeCanvas.height, Math.ceil(maxY)));
  const width = endX - originX;
  const height = endY - originY;
  const scale = Math.max(1, Math.round(sampleScale));
  const compositeImage = captureScaledCanvasRegion({
    source: compositeCanvas,
    originX,
    originY,
    width,
    height,
    scale,
    kind: 'composite',
  });
  const referenceImage = referenceCanvas
    ? captureScaledCanvasRegion({
        source: referenceCanvas,
        originX,
        originY,
        width,
        height,
        scale,
        kind: 'reference',
      })
    : null;
  const vertices = new Float32Array(shapePoints.length * 2);
  for (let index = 0; index < shapePoints.length; index += 1) {
    vertices[index * 2] = shapePoints[index].x;
    vertices[index * 2 + 1] = shapePoints[index].y;
  }

  return runShapeGradientSampleJob({
    type: 'shape-gradient-sample',
    width: compositeImage.width,
    height: compositeImage.height,
    originX,
    originY,
    sampleScaleX: width / compositeImage.width,
    sampleScaleY: height / compositeImage.height,
    vertices,
    compositePixels: compositeImage.data.buffer as ArrayBuffer,
    referencePixels: referenceImage?.data.buffer as ArrayBuffer | undefined,
    maxColors: Math.max(1, Math.min(16, Math.round(maxColors))),
    mode,
    directionX: direction?.x,
    directionY: direction?.y,
  });
};
