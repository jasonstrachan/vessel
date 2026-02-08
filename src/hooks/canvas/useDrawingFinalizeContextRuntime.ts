import { useFinalizeContextDeps } from '@/hooks/canvas/useFinalizeContextDeps';
import { CC_DEBUG } from '@/debug/ccDebug';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type UseFinalizeContextArgs = Parameters<typeof useFinalizeContextDeps>[0];

type UseDrawingFinalizeContextRuntimeArgs = {
  refs: DrawingHandlerRefs;
  storeRef: UseFinalizeContextArgs['finalizeBrushContextDepsArgs']['storeRef'];
  captureCanvasToActiveLayer: UseFinalizeContextArgs['finalizeEraserStrokeDepsArgs']['captureCanvasToActiveLayer'];
  scheduleHistoryCommit: UseFinalizeContextArgs['finalizeEraserStrokeDepsArgs']['scheduleHistoryCommit'];
  withTiming: UseFinalizeContextArgs['finalizeEraserStrokeDepsArgs']['withTiming'];
  logError: UseFinalizeContextArgs['finalizeLayerCaptureContextDepsArgs']['logError'];
  endMaskHealingStroke: UseFinalizeContextArgs['finalizeDrawingCleanupDepsArgs']['endMaskHealingStroke'];
  resetAutoSampleState: UseFinalizeContextArgs['finalizeDrawingCleanupDepsArgs']['resetAutoSampleState'];
  clearStrokeSession: UseFinalizeContextArgs['finalizeDrawingCleanupDepsArgs']['clearStrokeSession'];
  resumeColorCycleAfterInteraction: UseFinalizeContextArgs['finalizeDrawingCleanupDepsArgs']['resumeColorCycleAfterInteraction'];
  isBusyRef: UseFinalizeContextArgs['finalizeDrawingCleanupDepsArgs']['isBusyRef'];
  boundingBoxToCaptureRegion: UseFinalizeContextArgs['finalizeLayerCaptureContextDepsArgs']['boundingBoxToCaptureRegion'];
  rectToCaptureRegion: UseFinalizeContextArgs['finalizeLayerCaptureContextDepsArgs']['rectToCaptureRegion'];
  unionCaptureRegions: UseFinalizeContextArgs['finalizeLayerCaptureContextDepsArgs']['unionCaptureRegions'];
  captureLayerRegionImageData: UseFinalizeContextArgs['finalizeLayerCaptureContextDepsArgs']['captureLayerRegionImageData'];
  ensureLayerSnapshotWithRetry: UseFinalizeContextArgs['finalizeLayerCaptureContextDepsArgs']['ensureLayerSnapshotWithRetry'];
  debugTime: (label: string) => void;
  debugTimeEnd: (label: string) => void;
  perfMark: (label: string) => void;
  perfMeasure: (name: string, startLabel: string, endLabel: string) => void;
};

export const useDrawingFinalizeContextRuntime = ({
  refs,
  storeRef,
  captureCanvasToActiveLayer,
  scheduleHistoryCommit,
  withTiming,
  logError,
  endMaskHealingStroke,
  resetAutoSampleState,
  clearStrokeSession,
  resumeColorCycleAfterInteraction,
  isBusyRef,
  boundingBoxToCaptureRegion,
  rectToCaptureRegion,
  unionCaptureRegions,
  captureLayerRegionImageData,
  ensureLayerSnapshotWithRetry,
  debugTime,
  debugTimeEnd,
  perfMark,
  perfMeasure,
}: UseDrawingFinalizeContextRuntimeArgs) =>
  useFinalizeContextDeps({
    finalizeLayerCaptureContextDepsArgs: {
      boundingBoxToCaptureRegion,
      rectToCaptureRegion,
      unionCaptureRegions,
      captureLayerRegionImageData,
      ensureLayerSnapshotWithRetry,
      logError,
    },
    finalizeLostEdgeDispatcherArgs: {
      drawingCtxRef: refs.drawingCtxRef,
      drawingCanvasRef: refs.drawingCanvasRef,
      storeRef,
      shapePointsRef: refs.shapePointsRef,
    },
    finalizeBrushContextDepsArgs: { storeRef },
    finalizeEraserStrokeDepsArgs: {
      captureCanvasToActiveLayer,
      scheduleHistoryCommit,
      withTiming,
      logError,
    },
    finalizeVisibleTimerArgs: {
      debugEnabled: () => CC_DEBUG.on,
      debugTime,
      debugTimeEnd,
      perfMark,
      perfMeasure: (name, startLabel, endLabel = startLabel) =>
        perfMeasure(name, startLabel, endLabel),
    },
    finalizeDrawingCleanupDepsArgs: {
      endMaskHealingStroke,
      resetAutoSampleState,
      clearStrokeSession,
      strokeBeforeImageRef: refs.strokeBeforeImageRef,
      strokeBeforeColorStateRef: refs.strokeBeforeColorStateRef,
      drawingCtxRef: refs.drawingCtxRef,
      drawingCanvasRef: refs.drawingCanvasRef,
      drawingCanvasHasContent: refs.drawingCanvasHasContent,
      resumeColorCycleAfterInteraction,
      strokeBoundingBoxRef: refs.strokeBoundingBoxRef,
      strokeCapturePaddingRef: refs.strokeCapturePaddingRef,
      lastStrokePointRef: refs.lastStrokePointRef,
      isBusyRef,
    },
  });
