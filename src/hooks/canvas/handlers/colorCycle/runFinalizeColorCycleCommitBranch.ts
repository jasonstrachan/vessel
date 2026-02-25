import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import {
  commitColorCycleStrokeIfNeeded,
  type ColorCycleStrokeCommitDeps,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeCommit';
import type { ManagedColorCycleBrush } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import {
  handleFinalizeRasterFallback,
  type FinalizeRasterFallbackDeps,
} from '@/hooks/canvas/handlers/finalizeRasterFallback';
import type { BoundingBox, CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { BrushSettings, CanvasSnapshot, Layer, Tool } from '@/types';

export const runFinalizeColorCycleCommitBranch = async ({
  isColorCycleLayer,
  isAnyColorCycleBrush,
  activeLayer,
  activeSettings,
  project,
  drawingCanvas,
  strokeBoundingBox,
  strokeCapturePadding,
  roiPadding,
  enableCaptureRoi,
  applyFinalizePolygonLostEdge,
  skipSave,
  layerBeforeImage,
  currentTool,
  resolvedHistoryAction,
  resolvedHistoryDescription,
  coalescePayload,
  captureRoi,
  layerBeforeColorState,
  colorCycleCommitDeps,
  finalizeRasterFallbackDeps,
}: {
  isColorCycleLayer: boolean;
  isAnyColorCycleBrush: boolean;
  activeLayer: Layer;
  activeSettings: BrushSettings;
  project: { width: number; height: number } | null;
  drawingCanvas: HTMLCanvasElement | null;
  strokeBoundingBox: BoundingBox | null;
  strokeCapturePadding: number;
  roiPadding: number;
  enableCaptureRoi: boolean;
  applyFinalizePolygonLostEdge: () => void;
  skipSave: boolean;
  layerBeforeImage: ImageData | null;
  currentTool: Tool | 'eraser';
  resolvedHistoryAction: CanvasSnapshot['actionType'];
  resolvedHistoryDescription: string;
  coalescePayload: unknown;
  captureRoi: CaptureRegion | undefined;
  layerBeforeColorState: ColorCycleSerializedState | null;
  colorCycleCommitDeps: ColorCycleStrokeCommitDeps;
  finalizeRasterFallbackDeps: FinalizeRasterFallbackDeps;
}): Promise<{
  historyHandled: boolean;
  strokeCaptureRoi?: CaptureRegion;
  deferredLayerCanvas: HTMLCanvasElement | null;
  brushForCleanup?: ManagedColorCycleBrush;
}> => {
  applyFinalizePolygonLostEdge();

  const colorCycleCommitResult = await commitColorCycleStrokeIfNeeded({
    isColorCycleLayer,
    isColorCycleBrush: isAnyColorCycleBrush,
    activeLayer,
    brushSettings: activeSettings,
    project,
    drawingCanvas,
    strokeBoundingBox,
    strokeCapturePadding,
    roiPadding,
    enableCaptureRoi,
  }, colorCycleCommitDeps);

  if (colorCycleCommitResult.handled) {
    return {
      historyHandled: false,
      strokeCaptureRoi: colorCycleCommitResult.strokeCaptureRoi,
      deferredLayerCanvas: colorCycleCommitResult.deferredLayerCanvas ?? null,
      brushForCleanup: colorCycleCommitResult.brushForCleanup,
    };
  }

  if (colorCycleCommitResult.skipped) {
    return {
      historyHandled: false,
      deferredLayerCanvas: null,
    };
  }

  const historyHandled = await handleFinalizeRasterFallback({
    commitSkipped: colorCycleCommitResult.skipped,
    skipSave,
    layerBeforeImage,
    isColorCycleLayer,
    activeSettings,
    activeLayer,
    currentTool,
    resolvedHistoryAction,
    resolvedHistoryDescription,
    coalescePayload,
    captureRoi,
    layerBeforeColorState,
  }, finalizeRasterFallbackDeps);

  return {
    historyHandled,
    deferredLayerCanvas: null,
  };
};
