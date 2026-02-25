import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { BrushSettings, CanvasSnapshot, Layer, Tool } from '@/types';
import {
  prepareFinalizeBrushContext,
  type PrepareFinalizeBrushContextDeps,
} from '@/hooks/canvas/handlers/finalizeBrushContext';
import { runFinalizeColorCycleBrush } from '@/hooks/canvas/handlers/colorCycle/runFinalizeColorCycleBrush';
import type { FinalizeColorCycleBrushBaseDeps } from '@/hooks/canvas/handlers/colorCycle/colorCycleFinalizeDeps';
import {
  runFinalizeColorCycleCommitBranch,
} from '@/hooks/canvas/handlers/colorCycle/runFinalizeColorCycleCommitBranch';
import type { ColorCycleStrokeCommitDeps } from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeCommit';
import type { FinalizeRasterFallbackDeps } from '@/hooks/canvas/handlers/finalizeRasterFallback';
import {
  runFinalizePostCommitForBrushFlow,
  type RunFinalizePostCommitDeps,
} from '@/hooks/canvas/handlers/finalizePostCommit';
import type { BoundingBox } from '@/hooks/canvas/utils/captureRegions';
import type { StrokeCoalescePayload } from '@/hooks/canvas/handlers/strokeHistoryCoalesce';

export const runFinalizeBrushToolFlow = async ({
  currentState,
  activeLayer,
  historyActionOverride,
  historyDescriptionOverride,
  drawingCanvas,
  drawingCtx,
  project,
  strokeBoundingBox,
  strokeCapturePadding,
  roiPadding,
  enableCaptureRoi,
  applyFinalizeLostEdge,
  skipSave,
  layerBeforeImage,
  currentTool,
  coalescePayload,
  captureRoi,
  layerBeforeColorState,
  drawingCanvasRef,
  drawingCtxRef,
  drawingCanvasHasContent,
  releaseBusyLock,
}: {
  currentState: AppState;
  activeLayer: Layer;
  historyActionOverride?: CanvasSnapshot['actionType'];
  historyDescriptionOverride?: string;
  drawingCanvas: HTMLCanvasElement | null;
  drawingCtx: CanvasRenderingContext2D | null;
  project: { width: number; height: number } | null;
  strokeBoundingBox: BoundingBox | null;
  strokeCapturePadding: number;
  roiPadding: number;
  enableCaptureRoi: boolean;
  applyFinalizeLostEdge: (args: {
    isColorCycleLayer: boolean;
    activeSettings: BrushSettings;
    logDevStats?: boolean;
  }) => void;
  skipSave: boolean;
  layerBeforeImage: ImageData | null;
  currentTool: Tool | 'eraser';
  coalescePayload: StrokeCoalescePayload | undefined;
  captureRoi: CaptureRegion | undefined;
  layerBeforeColorState: ColorCycleSerializedState | null;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  releaseBusyLock: () => void;
}, deps: {
  finalizeBrushContextDeps: PrepareFinalizeBrushContextDeps;
  finalizeColorCycleBrushBaseDeps: FinalizeColorCycleBrushBaseDeps;
  colorCycleCommitDeps: ColorCycleStrokeCommitDeps;
  finalizeRasterFallbackDeps: FinalizeRasterFallbackDeps;
  finalizePostCommitDeps: RunFinalizePostCommitDeps;
}): Promise<{ shouldReturn: boolean }> => {
  const brushContext = prepareFinalizeBrushContext({
    currentState,
    activeLayer,
    historyActionOverride,
    historyDescriptionOverride,
  }, deps.finalizeBrushContextDeps);
  if (!brushContext) {
    return { shouldReturn: true };
  }

  const {
    currentState: nextState,
    activeLayer: nextLayer,
    activeLayerIdString,
    activeSettings,
    isColorCycleLayer,
    isColorCycleBrush,
    isAnyColorCycleBrush,
    shouldDisableCoalescing,
    resolvedHistoryAction,
    resolvedHistoryDescription,
  } = brushContext;

  const finalizeResult = await runFinalizeColorCycleBrush({
    activeSettings,
    currentState: nextState,
    drawingCanvas,
    drawingCtx,
    baseDeps: deps.finalizeColorCycleBrushBaseDeps,
  });
  if (finalizeResult.shouldReturn) {
    return { shouldReturn: true };
  }

  const nextCoalescePayload = shouldDisableCoalescing ? undefined : coalescePayload;
  const {
    historyHandled,
    strokeCaptureRoi,
    deferredLayerCanvas,
    brushForCleanup,
  } = await runFinalizeColorCycleCommitBranch({
    isColorCycleLayer,
    isAnyColorCycleBrush,
    activeLayer: nextLayer,
    activeSettings,
    project,
    drawingCanvas,
    strokeBoundingBox,
    strokeCapturePadding,
    roiPadding,
    enableCaptureRoi,
    applyFinalizePolygonLostEdge: () =>
      applyFinalizeLostEdge({
        isColorCycleLayer,
        activeSettings,
      }),
    skipSave,
    layerBeforeImage,
    currentTool,
    resolvedHistoryAction,
    resolvedHistoryDescription,
    coalescePayload: nextCoalescePayload,
    captureRoi,
    layerBeforeColorState,
    colorCycleCommitDeps: deps.colorCycleCommitDeps,
    finalizeRasterFallbackDeps: deps.finalizeRasterFallbackDeps,
  });

  await runFinalizePostCommitForBrushFlow({
    state: nextState,
    isColorCycleLayer,
    isColorCycleBrush,
    isAnyColorCycleBrush,
    drawingCanvasRef,
    drawingCtxRef,
    drawingCanvasHasContent,
    releaseBusyLock,
    historyHandled,
    skipSave,
    activeLayerId: activeLayerIdString,
    layerBeforeImage,
    layerBeforeColorState,
    resolvedHistoryAction,
    resolvedHistoryDescription,
    currentTool,
    coalescePayload: nextCoalescePayload,
    captureRoi,
    shouldDisableCoalescing,
    deferredLayerCanvas,
    strokeCaptureRoi,
    brushForCleanup,
  }, deps.finalizePostCommitDeps);

  return { shouldReturn: false };
};
