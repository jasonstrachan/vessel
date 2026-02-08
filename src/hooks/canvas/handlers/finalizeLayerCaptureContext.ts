import type React from 'react';
import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { Layer, Tool } from '@/types';
import type { StrokeCoalescePayload } from '@/hooks/canvas/handlers/strokeHistoryCoalesce';
import type { BrushStrokeSession } from '@/hooks/canvas/handlers/strokeSession';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';

export const prepareFinalizeLayerCaptureContext = async ({
  activeLayer,
  currentTool,
  drawingCanvas,
  strokeBeforeImageRef,
  strokeBeforeColorStateRef,
  activeStrokeSessionRef,
  endStrokeSession,
  maxIntervalMs,
  project,
  overlayHasContent,
  strokeBoundingBox,
  strokeCapturePadding,
  roiPadding,
  engineStrokeBounds,
  lastStrokePoint,
  captureRegionOverride,
  skipSave,
}: {
  activeLayer: Layer;
  currentTool: Tool | 'eraser';
  drawingCanvas: HTMLCanvasElement | null;
  strokeBeforeImageRef: React.MutableRefObject<ImageData | null>;
  strokeBeforeColorStateRef: React.MutableRefObject<ColorCycleSerializedState | null>;
  activeStrokeSessionRef: React.MutableRefObject<BrushStrokeSession | null>;
  endStrokeSession: () => void;
  maxIntervalMs: number;
  project: { width: number; height: number } | null;
  overlayHasContent: boolean;
  strokeBoundingBox: { minX: number; minY: number; maxX: number; maxY: number } | null;
  strokeCapturePadding: number;
  roiPadding: number;
  engineStrokeBounds: { x: number; y: number; width: number; height: number } | null;
  lastStrokePoint: { x: number; y: number } | null;
  captureRegionOverride: CaptureRegion | null;
  skipSave: boolean;
}, deps: PrepareFinalizeLayerCaptureContextDeps): Promise<{
  activeLayerIdString: string;
  layerBeforeImage: ImageData | null;
  layerBeforeColorState: ColorCycleSerializedState | null;
  coalescePayload: StrokeCoalescePayload | undefined;
  captureRoi: CaptureRegion | undefined;
}> => {
  const activeLayerIdString = activeLayer.id;
  let layerBeforeImage = strokeBeforeImageRef.current;
  const layerBeforeColorState = strokeBeforeColorStateRef.current;
  const coalescePayload = deps.buildStrokeCoalescePayload({
    activeStrokeSessionRef,
    endStrokeSession,
    activeLayerId: activeLayerIdString,
    currentTool,
    maxIntervalMs,
  });

  const capturePrep = await deps.prepareStrokeCapture({
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
  });

  layerBeforeImage = capturePrep.layerBeforeImage;

  return {
    activeLayerIdString,
    layerBeforeImage,
    layerBeforeColorState,
    coalescePayload,
    captureRoi: capturePrep.captureRoi,
  };
};

export type PrepareFinalizeLayerCaptureContextDeps = {
  buildStrokeCoalescePayload: (args: {
    activeStrokeSessionRef: React.MutableRefObject<BrushStrokeSession | null>;
    endStrokeSession: () => void;
    activeLayerId: string;
    currentTool: Tool | 'eraser';
    maxIntervalMs: number;
  }) => StrokeCoalescePayload | undefined;
  prepareStrokeCapture: (args: {
    activeLayer: Layer | null;
    project: { width: number; height: number } | null;
    drawingCanvas: HTMLCanvasElement | null;
    overlayHasContent: boolean;
    strokeBoundingBox: { minX: number; minY: number; maxX: number; maxY: number } | null;
    strokeCapturePadding: number;
    roiPadding: number;
    engineStrokeBounds: { x: number; y: number; width: number; height: number } | null;
    lastStrokePoint?: { x: number; y: number } | null;
    captureRegionOverride?: CaptureRegion | null;
    layerBeforeImage: ImageData | null;
    skipSave: boolean;
  }) => Promise<{ captureRoi?: CaptureRegion; layerBeforeImage: ImageData | null }>;
};
