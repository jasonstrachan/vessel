import { captureCanvasImageData, type CanvasLike } from '@/utils/canvas/canvasImage';

type CaptureROI = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const normalizeCaptureROI = (
  roi: CaptureROI | undefined,
  width: number,
  height: number
): CaptureROI | undefined => {
  if (!roi) {
    return undefined;
  }
  if (
    !Number.isFinite(roi.x) ||
    !Number.isFinite(roi.y) ||
    !Number.isFinite(roi.width) ||
    !Number.isFinite(roi.height)
  ) {
    return undefined;
  }

  const x = Math.max(0, Math.floor(roi.x));
  const y = Math.max(0, Math.floor(roi.y));
  const right = Math.min(width, Math.ceil(roi.x + roi.width));
  const bottom = Math.min(height, Math.ceil(roi.y + roi.height));
  if (right <= x || bottom <= y) {
    return undefined;
  }

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
};

const getCanvasContext = (
  canvas: CanvasLike
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null =>
  canvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

export const captureColorCycleCanvasSnapshot = ({
  canvas,
  existingImageData,
  roi,
}: {
  canvas?: CanvasLike | null;
  existingImageData?: ImageData | null;
  roi?: CaptureROI;
}): ImageData | undefined => {
  if (!canvas) {
    return existingImageData ?? undefined;
  }

  const width = Math.max(1, Math.floor(canvas.width));
  const height = Math.max(1, Math.floor(canvas.height));
  const normalizedRoi = normalizeCaptureROI(roi, width, height);

  if (!normalizedRoi) {
    return captureCanvasImageData(canvas) ?? existingImageData ?? undefined;
  }

  const matchesExistingDimensions =
    existingImageData?.width === width && existingImageData?.height === height;
  if (!matchesExistingDimensions) {
    return captureCanvasImageData(canvas) ?? existingImageData ?? undefined;
  }

  const context = getCanvasContext(canvas);
  if (!context) {
    return existingImageData ?? undefined;
  }

  try {
    const region = context.getImageData(
      normalizedRoi.x,
      normalizedRoi.y,
      normalizedRoi.width,
      normalizedRoi.height
    );
    const target = existingImageData.data;
    const source = region.data;
    const sourceStride = normalizedRoi.width * 4;

    for (let row = 0; row < normalizedRoi.height; row += 1) {
      const sourceStart = row * sourceStride;
      const targetStart =
        ((normalizedRoi.y + row) * width + normalizedRoi.x) * 4;
      target.set(source.subarray(sourceStart, sourceStart + sourceStride), targetStart);
    }

    return existingImageData;
  } catch {
    return captureCanvasImageData(canvas) ?? existingImageData ?? undefined;
  }
};
