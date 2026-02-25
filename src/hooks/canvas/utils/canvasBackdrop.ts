import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';

type CanvasLike = HTMLCanvasElement | OffscreenCanvas;

const createTempCanvas = (width: number, height: number): CanvasLike | null => {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
};

export const applyBackdropFromSnapshot = (
  targetCtx: CanvasRenderingContext2D | null,
  snapshot: ImageData | null,
  region?: CaptureRegion
): void => {
  if (!targetCtx || !snapshot) {
    return;
  }

  const roi = region ?? { x: 0, y: 0, width: snapshot.width, height: snapshot.height };
  if (roi.width <= 0 || roi.height <= 0) {
    return;
  }

  const tempCanvas = createTempCanvas(roi.width, roi.height);
  if (!tempCanvas) {
    return;
  }
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!tempCtx || !('putImageData' in tempCtx)) {
    return;
  }

  // Offset so only the ROI portion lands inside the temporary canvas
  tempCtx.putImageData(snapshot, -roi.x, -roi.y);

  targetCtx.save();
  targetCtx.globalCompositeOperation = 'destination-over';
  targetCtx.drawImage(
    tempCanvas as CanvasImageSource,
    0,
    0,
    roi.width,
    roi.height,
    roi.x,
    roi.y,
    roi.width,
    roi.height
  );
  targetCtx.restore();
};
