import { FF } from '@/config/ccFeatureFlags';
import {
  BRUSH_HISTORY_COALESCE_WINDOW_MS,
  ROI_PADDING_PX,
} from '@/hooks/canvas/drawingHandlersConfig';
import type {
  FinalizeFlowArgs,
  UseDrawingFinalizeRuntimeArgs,
} from '@/hooks/canvas/useDrawingFinalizeRuntime.types';

interface BuildDrawingFinalizeAfterQueueDispatcherArgsOptions {
  refs: UseDrawingFinalizeRuntimeArgs['refs'];
  brushEngine: UseDrawingFinalizeRuntimeArgs['brushEngine'];
  userBrushEngine: UseDrawingFinalizeRuntimeArgs['userBrushEngine'];
  cancelAnimationFrameSafe: FinalizeFlowArgs['finalizeAfterQueueDispatcherArgs']['cancelAnimationFrameSafe'];
  endStrokeSession: UseDrawingFinalizeRuntimeArgs['endStrokeSession'];
  applyFinalizeLostEdge: UseDrawingFinalizeRuntimeArgs['applyFinalizeLostEdge'];
}

export const buildDrawingFinalizeAfterQueueDispatcherArgs = ({
  refs,
  brushEngine,
  userBrushEngine,
  cancelAnimationFrameSafe,
  endStrokeSession,
  applyFinalizeLostEdge,
}: BuildDrawingFinalizeAfterQueueDispatcherArgsOptions): FinalizeFlowArgs['finalizeAfterQueueDispatcherArgs'] => ({
  isEraserV2: FF.ERASER_V2,
  strokeBatchTimerRef: refs.strokeBatchTimerRef,
  lastDrawPosRef: refs.lastDrawPosRef,
  resamplerBrushDataRef: refs.resamplerBrushDataRef,
  stampCounterRef: refs.stampCounterRef,
  drawingCtxRef: refs.drawingCtxRef,
  brushEngine: brushEngine as FinalizeFlowArgs['finalizeAfterQueueDispatcherArgs']['brushEngine'],
  userBrushEngine,
  cancelAnimationFrameSafe,
  strokeBeforeImageRef: refs.strokeBeforeImageRef,
  strokeBeforeColorStateRef: refs.strokeBeforeColorStateRef,
  activeStrokeSessionRef: refs.activeStrokeSessionRef,
  endStrokeSession,
  maxIntervalMs: BRUSH_HISTORY_COALESCE_WINDOW_MS,
  strokeBoundingBoxRef: refs.strokeBoundingBoxRef,
  strokeCapturePaddingRef: refs.strokeCapturePaddingRef,
  roiPadding: ROI_PADDING_PX,
  lastStrokePointRef: refs.lastStrokePointRef,
  eraserRoiRef: refs.eraserRoiRef,
  applyFinalizeLostEdge,
  drawingCanvasRef: refs.drawingCanvasRef,
  drawingCanvasHasContent: refs.drawingCanvasHasContent,
});
