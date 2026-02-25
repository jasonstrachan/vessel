import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { Layer } from '@/types';

export type PrepareStrokeCaptureArgs = {
  activeLayer: Layer | null;
  project: { width: number; height: number } | null;
  drawingCanvas: HTMLCanvasElement | null;
  overlayHasContent: boolean;
  strokeBoundingBox: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null;
  strokeCapturePadding: number;
  roiPadding: number;
  engineStrokeBounds: { x: number; y: number; width: number; height: number } | null;
  lastStrokePoint?: { x: number; y: number } | null;
  captureRegionOverride?: CaptureRegion | null;
  layerBeforeImage: ImageData | null;
  skipSave: boolean;
};

export type PrepareStrokeCaptureDeps = {
  boundingBoxToCaptureRegion: (
    boundingBox: PrepareStrokeCaptureArgs['strokeBoundingBox'],
    padding: number,
    project: { width: number; height: number }
  ) => CaptureRegion | undefined;
  rectToCaptureRegion: (
    rect: PrepareStrokeCaptureArgs['engineStrokeBounds'],
    padding: number,
    project: { width: number; height: number }
  ) => CaptureRegion | undefined;
  unionCaptureRegions: (
    a?: CaptureRegion | null,
    b?: CaptureRegion | null
  ) => CaptureRegion | null | undefined;
  captureLayerRegionImageData: (layer: Layer, roi: CaptureRegion) => ImageData | null;
  ensureLayerSnapshotWithRetry: (
    layer: Layer | null | undefined,
    existing: ImageData | null,
    retries: number
  ) => Promise<ImageData | null>;
  logError: (message: string) => void;
};

export const prepareStrokeCapture = async (
  args: PrepareStrokeCaptureArgs,
  deps: PrepareStrokeCaptureDeps
): Promise<{ captureRoi?: CaptureRegion; layerBeforeImage: ImageData | null }> => {
  const {
    activeLayer,
    project,
    drawingCanvas,
    overlayHasContent,
    strokeBoundingBox,
    strokeCapturePadding,
    roiPadding,
  engineStrokeBounds,
  lastStrokePoint,
  captureRegionOverride,
  layerBeforeImage,
  skipSave,
  } = args;

  if (!activeLayer || !project) {
    return { captureRoi: undefined, layerBeforeImage };
  }

  const pointerRoi = deps.boundingBoxToCaptureRegion(
    strokeBoundingBox,
    roiPadding + strokeCapturePadding,
    project
  );
  const engineRoi = deps.rectToCaptureRegion(
    engineStrokeBounds,
    roiPadding,
    project
  );

  let captureRoi: CaptureRegion | undefined;
  if (captureRegionOverride) {
    captureRoi = captureRegionOverride;
  } else {
    captureRoi = deps.unionCaptureRegions(pointerRoi, engineRoi) ?? pointerRoi ?? engineRoi;
  }
  if (!captureRoi && drawingCanvas && overlayHasContent) {
    if (lastStrokePoint && project) {
      const pad = Math.max(1, Math.ceil(roiPadding + strokeCapturePadding));
      const x = Math.max(0, Math.floor(lastStrokePoint.x) - pad);
      const y = Math.max(0, Math.floor(lastStrokePoint.y) - pad);
      const right = Math.min(project.width, Math.ceil(lastStrokePoint.x) + pad);
      const bottom = Math.min(project.height, Math.ceil(lastStrokePoint.y) + pad);
      if (right > x && bottom > y) {
        captureRoi = {
          x,
          y,
          width: Math.max(1, right - x),
          height: Math.max(1, bottom - y),
        };
      }
    }

    if (!captureRoi) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[history] Falling back to full-canvas capture', {
          overlayHasContent,
          project,
          engineStrokeBounds,
          strokeBoundingBox,
          lastStrokePoint,
        });
      }
      captureRoi = {
        x: 0,
        y: 0,
        width: drawingCanvas.width,
        height: drawingCanvas.height,
      };
    }
  }

  let nextBeforeImage = layerBeforeImage;
  if (!nextBeforeImage && captureRoi && activeLayer.layerType !== 'color-cycle') {
    nextBeforeImage = deps.captureLayerRegionImageData(activeLayer, captureRoi);
  }

  if (!skipSave && activeLayer.layerType !== 'color-cycle' && !nextBeforeImage) {
    nextBeforeImage = await deps.ensureLayerSnapshotWithRetry(activeLayer, null, 3);
    if (!nextBeforeImage) {
      deps.logError('[finalize] brush beforeImage missing after retry; undo history skipped.');
    }
  }

  return { captureRoi, layerBeforeImage: nextBeforeImage };
};
