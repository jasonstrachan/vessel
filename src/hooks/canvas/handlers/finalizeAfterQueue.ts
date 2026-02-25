import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { Tool } from '@/types';
import {
  finalizeStrokePrep,
  type FinalizeStrokePrepArgs,
  type FinalizeStrokePrepDeps,
} from '@/hooks/canvas/handlers/strokeFinalizePrep';
import {
  runFinalizeActiveLayerFlow,
} from '@/hooks/canvas/handlers/finalizeActiveLayerFlow';
import type { PrepareFinalizeLayerCaptureContextDeps } from '@/hooks/canvas/handlers/finalizeLayerCaptureContext';
import type { FinalizeEraserStrokeDeps } from '@/hooks/canvas/handlers/eraserFinalize';
import type { PrepareFinalizeBrushContextDeps } from '@/hooks/canvas/handlers/finalizeBrushContext';
import type { FinalizeColorCycleBrushBaseDeps } from '@/hooks/canvas/handlers/colorCycle/colorCycleFinalizeDeps';
import type { ColorCycleStrokeCommitDeps } from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeCommit';
import type { FinalizeRasterFallbackDeps } from '@/hooks/canvas/handlers/finalizeRasterFallback';
import type { RunFinalizePostCommitDeps } from '@/hooks/canvas/handlers/finalizePostCommit';
import type { FinalizeLostEdgeDispatcher } from '@/hooks/canvas/handlers/finalizeLostEdgeDeps';

export const runFinalizeAfterQueue = async ({
  snapshot,
  finalizeTool,
  isEraserV2,
  strokeBatchTimerRef,
  lastDrawPosRef,
  resamplerBrushDataRef,
  stampCounterRef,
  drawingCtxRef,
  brushEngine,
  userBrushEngine,
  cancelAnimationFrameSafe,
  strokeBeforeImageRef,
  strokeBeforeColorStateRef,
  activeStrokeSessionRef,
  endStrokeSession,
  maxIntervalMs,
  project,
  overlayHasContent,
  strokeBoundingBoxRef,
  strokeCapturePaddingRef,
  roiPadding,
  lastStrokePointRef,
  captureRegionOverride,
  skipSave,
  historyActionOverride,
  historyDescriptionOverride,
  eraserRoiRef,
  applyFinalizeLostEdge,
  drawingCanvasRef,
  drawingCanvasHasContent,
  releaseBusyLock,
}: {
  snapshot: AppState;
  finalizeTool: Tool | 'eraser';
  isEraserV2: boolean;
  strokeBatchTimerRef: FinalizeStrokePrepArgs['strokeBatchTimerRef'];
  lastDrawPosRef: FinalizeStrokePrepArgs['lastDrawPosRef'];
  resamplerBrushDataRef: FinalizeStrokePrepArgs['resamplerBrushDataRef'];
  stampCounterRef: FinalizeStrokePrepArgs['stampCounterRef'];
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  brushEngine: FinalizeStrokePrepDeps['brushEngine'];
  userBrushEngine: FinalizeStrokePrepDeps['userBrushEngine'];
  cancelAnimationFrameSafe: (handle: number) => void;
  strokeBeforeImageRef: Parameters<typeof runFinalizeActiveLayerFlow>[0]['strokeBeforeImageRef'];
  strokeBeforeColorStateRef: Parameters<typeof runFinalizeActiveLayerFlow>[0]['strokeBeforeColorStateRef'];
  activeStrokeSessionRef: Parameters<typeof runFinalizeActiveLayerFlow>[0]['activeStrokeSessionRef'];
  endStrokeSession: () => void;
  maxIntervalMs: number;
  project: { width: number; height: number } | null;
  overlayHasContent: boolean;
  strokeBoundingBoxRef: React.MutableRefObject<Parameters<typeof runFinalizeActiveLayerFlow>[0]['strokeBoundingBox']>;
  strokeCapturePaddingRef: React.MutableRefObject<number>;
  roiPadding: number;
  lastStrokePointRef: React.MutableRefObject<{ x: number; y: number } | null>;
  captureRegionOverride: CaptureRegion | null;
  skipSave: boolean;
  historyActionOverride?: Parameters<typeof runFinalizeActiveLayerFlow>[0]['historyActionOverride'];
  historyDescriptionOverride?: Parameters<typeof runFinalizeActiveLayerFlow>[0]['historyDescriptionOverride'];
  eraserRoiRef: React.MutableRefObject<CaptureRegion | null>;
  applyFinalizeLostEdge: FinalizeLostEdgeDispatcher['applyFinalizeLostEdge'];
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
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
  const currentState = snapshot;
  const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
  const currentTool: Tool | 'eraser' = currentState.tools.currentTool as Tool | 'eraser';
  const currentBrushId = currentState.currentBrushPreset?.id;

  const engineStrokeBounds = finalizeStrokePrep({
    finalizeTool,
    isEraserV2,
    strokeBatchTimerRef,
    lastDrawPosRef,
    resamplerBrushDataRef,
    stampCounterRef,
    drawingCtx: drawingCtxRef.current,
    currentBrushId,
  }, {
    brushEngine,
    userBrushEngine,
    cancelAnimationFrame: cancelAnimationFrameSafe,
  });

  if (!activeLayer) {
    return;
  }

  await runFinalizeActiveLayerFlow({
    currentState,
    activeLayer,
    currentTool,
    drawingCanvas: drawingCanvasRef.current,
    strokeBeforeImageRef,
    strokeBeforeColorStateRef,
    activeStrokeSessionRef,
    endStrokeSession,
    maxIntervalMs,
    project,
    overlayHasContent,
    strokeBoundingBox: strokeBoundingBoxRef.current,
    strokeCapturePadding: strokeCapturePaddingRef.current,
    roiPadding,
    engineStrokeBounds,
    lastStrokePoint: lastStrokePointRef.current,
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
  }, deps);
};

export type RunFinalizeAfterQueueArgs = Parameters<typeof runFinalizeAfterQueue>[0];
export type RunFinalizeAfterQueueDeps = Parameters<typeof runFinalizeAfterQueue>[1];

export type FinalizeAfterQueueDispatchArgs = {
  snapshot: AppState;
  finalizeTool: Tool | 'eraser';
  project: { width: number; height: number } | null;
  overlayHasContent: boolean;
  captureRegionOverride: CaptureRegion | null;
  skipSave: boolean;
  historyActionOverride?: Parameters<typeof runFinalizeActiveLayerFlow>[0]['historyActionOverride'];
  historyDescriptionOverride?: Parameters<typeof runFinalizeActiveLayerFlow>[0]['historyDescriptionOverride'];
  releaseBusyLock: () => void;
};

export type FinalizeAfterQueueDispatcher = (
  args: FinalizeAfterQueueDispatchArgs,
  deps: RunFinalizeAfterQueueDeps
) => Promise<void>;

export const createFinalizeAfterQueueDispatcher = ({
  isEraserV2,
  strokeBatchTimerRef,
  lastDrawPosRef,
  resamplerBrushDataRef,
  stampCounterRef,
  drawingCtxRef,
  brushEngine,
  userBrushEngine,
  cancelAnimationFrameSafe,
  strokeBeforeImageRef,
  strokeBeforeColorStateRef,
  activeStrokeSessionRef,
  endStrokeSession,
  maxIntervalMs,
  strokeBoundingBoxRef,
  strokeCapturePaddingRef,
  roiPadding,
  lastStrokePointRef,
  eraserRoiRef,
  applyFinalizeLostEdge,
  drawingCanvasRef,
  drawingCanvasHasContent,
}: {
  isEraserV2: boolean;
  strokeBatchTimerRef: FinalizeStrokePrepArgs['strokeBatchTimerRef'];
  lastDrawPosRef: FinalizeStrokePrepArgs['lastDrawPosRef'];
  resamplerBrushDataRef: FinalizeStrokePrepArgs['resamplerBrushDataRef'];
  stampCounterRef: FinalizeStrokePrepArgs['stampCounterRef'];
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  brushEngine: FinalizeStrokePrepDeps['brushEngine'];
  userBrushEngine: FinalizeStrokePrepDeps['userBrushEngine'];
  cancelAnimationFrameSafe: (handle: number) => void;
  strokeBeforeImageRef: Parameters<typeof runFinalizeActiveLayerFlow>[0]['strokeBeforeImageRef'];
  strokeBeforeColorStateRef: Parameters<typeof runFinalizeActiveLayerFlow>[0]['strokeBeforeColorStateRef'];
  activeStrokeSessionRef: Parameters<typeof runFinalizeActiveLayerFlow>[0]['activeStrokeSessionRef'];
  endStrokeSession: () => void;
  maxIntervalMs: number;
  strokeBoundingBoxRef: React.MutableRefObject<Parameters<typeof runFinalizeActiveLayerFlow>[0]['strokeBoundingBox']>;
  strokeCapturePaddingRef: React.MutableRefObject<number>;
  roiPadding: number;
  lastStrokePointRef: React.MutableRefObject<{ x: number; y: number } | null>;
  eraserRoiRef: React.MutableRefObject<CaptureRegion | null>;
  applyFinalizeLostEdge: FinalizeLostEdgeDispatcher['applyFinalizeLostEdge'];
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
}): FinalizeAfterQueueDispatcher => (
  {
    snapshot,
    finalizeTool,
    project,
    overlayHasContent,
    captureRegionOverride,
    skipSave,
    historyActionOverride,
    historyDescriptionOverride,
    releaseBusyLock,
  },
  deps
) =>
  runFinalizeAfterQueue({
    snapshot,
    finalizeTool,
    isEraserV2,
    strokeBatchTimerRef,
    lastDrawPosRef,
    resamplerBrushDataRef,
    stampCounterRef,
    drawingCtxRef,
    brushEngine,
    userBrushEngine,
    cancelAnimationFrameSafe,
    strokeBeforeImageRef,
    strokeBeforeColorStateRef,
    activeStrokeSessionRef,
    endStrokeSession,
    maxIntervalMs,
    project,
    overlayHasContent,
    strokeBoundingBoxRef,
    strokeCapturePaddingRef,
    roiPadding,
    lastStrokePointRef,
    captureRegionOverride,
    skipSave,
    historyActionOverride,
    historyDescriptionOverride,
    eraserRoiRef,
    applyFinalizeLostEdge,
    drawingCanvasRef,
    drawingCanvasHasContent,
    releaseBusyLock,
  }, deps);
