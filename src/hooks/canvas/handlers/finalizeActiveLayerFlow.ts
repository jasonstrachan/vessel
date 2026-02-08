import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import type { CaptureRegion, BoundingBox } from '@/hooks/canvas/utils/captureRegions';
import type { CanvasSnapshot, Layer, Tool } from '@/types';
import {
  prepareFinalizeLayerCaptureContext,
  type PrepareFinalizeLayerCaptureContextDeps,
} from '@/hooks/canvas/handlers/finalizeLayerCaptureContext';
import type { StrokeCoalescePayload } from '@/hooks/canvas/handlers/strokeHistoryCoalesce';
import type { FinalizeEraserStrokeDeps } from '@/hooks/canvas/handlers/eraserFinalize';
import { runFinalizeEraserToolFlow } from '@/hooks/canvas/handlers/finalizeEraserToolFlow';
import { runFinalizeBrushToolFlow } from '@/hooks/canvas/handlers/finalizeBrushToolFlow';
import type { PrepareFinalizeBrushContextDeps } from '@/hooks/canvas/handlers/finalizeBrushContext';
import type { FinalizeColorCycleBrushBaseDeps } from '@/hooks/canvas/handlers/colorCycle/colorCycleFinalizeDeps';
import type { ColorCycleStrokeCommitDeps } from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeCommit';
import type { FinalizeRasterFallbackDeps } from '@/hooks/canvas/handlers/finalizeRasterFallback';
import type { RunFinalizePostCommitDeps } from '@/hooks/canvas/handlers/finalizePostCommit';
import type { FinalizeLostEdgeDispatcher } from '@/hooks/canvas/handlers/finalizeLostEdgeDeps';

export const runFinalizeActiveLayerFlow = async ({
  currentState,
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
  historyActionOverride,
  historyDescriptionOverride,
  isEraserV2,
  eraserRoiRef,
  applyFinalizeLostEdge,
  drawingCanvasRef,
  drawingCtxRef,
  drawingCanvasHasContent,
  releaseBusyLock,
}: {
  currentState: AppState;
  activeLayer: Layer;
  currentTool: Tool | 'eraser';
  drawingCanvas: HTMLCanvasElement | null;
  strokeBeforeImageRef: Parameters<typeof prepareFinalizeLayerCaptureContext>[0]['strokeBeforeImageRef'];
  strokeBeforeColorStateRef: Parameters<typeof prepareFinalizeLayerCaptureContext>[0]['strokeBeforeColorStateRef'];
  activeStrokeSessionRef: Parameters<typeof prepareFinalizeLayerCaptureContext>[0]['activeStrokeSessionRef'];
  endStrokeSession: () => void;
  maxIntervalMs: number;
  project: { width: number; height: number } | null;
  overlayHasContent: boolean;
  strokeBoundingBox: BoundingBox | null;
  strokeCapturePadding: number;
  roiPadding: number;
  engineStrokeBounds: { x: number; y: number; width: number; height: number } | null;
  lastStrokePoint: { x: number; y: number } | null;
  captureRegionOverride: CaptureRegion | null;
  skipSave: boolean;
  historyActionOverride?: CanvasSnapshot['actionType'];
  historyDescriptionOverride?: string;
  isEraserV2: boolean;
  eraserRoiRef: React.MutableRefObject<CaptureRegion | null>;
  applyFinalizeLostEdge: FinalizeLostEdgeDispatcher['applyFinalizeLostEdge'];
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  releaseBusyLock: () => void;
}, deps: {
  finalizeLayerCaptureContextDeps: PrepareFinalizeLayerCaptureContextDeps;
  finalizeEraserStrokeDeps: FinalizeEraserStrokeDeps;
  finalizeBrushContextDeps: PrepareFinalizeBrushContextDeps;
  finalizeColorCycleBrushBaseDeps: FinalizeColorCycleBrushBaseDeps;
  colorCycleCommitDeps: ColorCycleStrokeCommitDeps;
  finalizeRasterFallbackDeps: FinalizeRasterFallbackDeps;
  finalizePostCommitDeps: RunFinalizePostCommitDeps;
}): Promise<void> => {
  const {
    activeLayerIdString,
    layerBeforeImage,
    layerBeforeColorState,
    coalescePayload,
    captureRoi,
  } = await prepareFinalizeLayerCaptureContext({
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
  }, deps.finalizeLayerCaptureContextDeps);

  if (currentTool === 'eraser') {
    await runFinalizeEraserToolFlow({
      activeLayer,
      activeLayerId: activeLayerIdString,
      drawingCanvas,
      layerBeforeImage,
      layerBeforeColorState: layerBeforeColorState as ColorCycleSerializedState | null,
      historyActionOverride,
      historyDescriptionOverride,
      captureRoi,
      eraserRoiRef,
      coalescePayload,
      isEraserV2,
      skipSave,
    }, deps.finalizeEraserStrokeDeps);
    return;
  }

  await runFinalizeBrushToolFlow({
    currentState,
    activeLayer,
    historyActionOverride,
    historyDescriptionOverride,
    drawingCanvas,
    drawingCtx: drawingCtxRef.current,
    project,
    strokeBoundingBox,
    strokeCapturePadding,
    roiPadding,
    enableCaptureRoi: true,
    applyFinalizeLostEdge,
    skipSave,
    layerBeforeImage,
    currentTool,
    coalescePayload: coalescePayload as StrokeCoalescePayload | undefined,
    captureRoi,
    layerBeforeColorState: layerBeforeColorState as ColorCycleSerializedState | null,
    drawingCanvasRef,
    drawingCtxRef,
    drawingCanvasHasContent,
    releaseBusyLock,
  }, {
    finalizeBrushContextDeps: deps.finalizeBrushContextDeps,
    finalizeColorCycleBrushBaseDeps: deps.finalizeColorCycleBrushBaseDeps,
    colorCycleCommitDeps: deps.colorCycleCommitDeps,
    finalizeRasterFallbackDeps: deps.finalizeRasterFallbackDeps,
    finalizePostCommitDeps: deps.finalizePostCommitDeps,
  });
};
