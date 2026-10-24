import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';

export type CaptureBrushFromCanvas = (
  canvas: HTMLCanvasElement,
  rect: { x: number; y: number; width: number; height: number },
  options?: { generateThumbnail: boolean }
) => { imageData: ImageData; width: number; height: number } | null;

type ResamplerSampleArgs = {
  samplePos: { x: number; y: number };
  brushSize: number;
  compositeCanvas: HTMLCanvasElement | null;
  resamplerBrushDataRef: React.MutableRefObject<CustomBrushStrokeData | undefined>;
  cacheKeyPrefix: string;
  clampToCanvas: boolean;
};

let resamplerCaptureRevision = 0;

const captureResamplerSample = (
  args: ResamplerSampleArgs,
  deps: { captureBrushFromCanvas: CaptureBrushFromCanvas }
): CustomBrushStrokeData | undefined => {
  const { compositeCanvas } = args;
  if (!compositeCanvas) {
    return args.resamplerBrushDataRef.current;
  }

  const halfSize = args.brushSize / 2;
  let sampleX = Math.floor(args.samplePos.x - halfSize);
  let sampleY = Math.floor(args.samplePos.y - halfSize);
  let width = Math.floor(halfSize * 2);
  let height = Math.floor(halfSize * 2);

  if (args.clampToCanvas) {
    const minX = Math.max(0, sampleX);
    const minY = Math.max(0, sampleY);
    const maxX = Math.min(compositeCanvas.width, sampleX + width);
    const maxY = Math.min(compositeCanvas.height, sampleY + height);
    sampleX = minX;
    sampleY = minY;
    width = maxX - minX;
    height = maxY - minY;
  }

  if (width <= 0 || height <= 0) {
    return args.resamplerBrushDataRef.current;
  }

  const captureResult = deps.captureBrushFromCanvas(
    compositeCanvas,
    { x: sampleX, y: sampleY, width, height },
    { generateThumbnail: false }
  );

  if (captureResult) {
    const cacheKey = `${args.cacheKeyPrefix}:${++resamplerCaptureRevision}`;
    (captureResult.imageData as ImageData & { __vesselCacheKey?: string }).__vesselCacheKey =
      cacheKey;
    args.resamplerBrushDataRef.current = {
      imageData: captureResult.imageData,
      width: captureResult.width,
      height: captureResult.height,
      isColorizable: false,
      isResampler: true,
      cacheKey,
    };
  }

  return args.resamplerBrushDataRef.current;
};

export const captureResamplerSingleSample = (
  args: {
    samplePos: { x: number; y: number };
    brushSize: number;
    compositeCanvas: HTMLCanvasElement | null;
    resamplerBrushDataRef: React.MutableRefObject<CustomBrushStrokeData | undefined>;
  },
  deps: { captureBrushFromCanvas: CaptureBrushFromCanvas }
): CustomBrushStrokeData | undefined =>
  captureResamplerSample(
    {
      ...args,
      cacheKeyPrefix: 'resampler:single',
      clampToCanvas: false,
    },
    deps
  );

export const updateContinuousResamplerSample = (
  args: {
    samplePos: { x: number; y: number };
    brushSize: number;
    compositeCanvas: HTMLCanvasElement | null;
    resamplerBrushDataRef: React.MutableRefObject<CustomBrushStrokeData | undefined>;
    stampCounterRef: React.MutableRefObject<number>;
    resampleInterval: number;
  },
  deps: { captureBrushFromCanvas: CaptureBrushFromCanvas }
): CustomBrushStrokeData | undefined => {
  args.stampCounterRef.current++;
  if (
    args.stampCounterRef.current >= args.resampleInterval ||
    !args.resamplerBrushDataRef.current
  ) {
    args.stampCounterRef.current = 0;
    return captureResamplerSample(
      {
        samplePos: args.samplePos,
        brushSize: args.brushSize,
        compositeCanvas: args.compositeCanvas,
        resamplerBrushDataRef: args.resamplerBrushDataRef,
        cacheKeyPrefix: 'resampler:continuous',
        clampToCanvas: true,
      },
      deps
    );
  }

  return args.resamplerBrushDataRef.current;
};
