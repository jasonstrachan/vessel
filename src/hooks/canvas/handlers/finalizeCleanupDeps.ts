import type { FinalizeDrawingCleanupArgs } from '@/hooks/canvas/handlers/finalizeCleanup';

type FinalizeDrawingCleanupDepsArgs = Omit<FinalizeDrawingCleanupArgs, 'endFinalizeVisibleTimer'> & {
  endFinalizeVisibleTimer: () => void;
};

export const createFinalizeDrawingCleanupDeps = ({
  endMaskHealingStroke,
  resetAutoSampleState,
  clearStrokeSession,
  strokeBeforeImageRef,
  strokeBeforeColorStateRef,
  drawingCtxRef,
  drawingCanvasRef,
  drawingCanvasHasContent,
  resumeColorCycleAfterInteraction,
  endFinalizeVisibleTimer,
  strokeBoundingBoxRef,
  strokeCapturePaddingRef,
  lastStrokePointRef,
  isBusyRef,
}: FinalizeDrawingCleanupDepsArgs): FinalizeDrawingCleanupArgs => ({
  endMaskHealingStroke,
  resetAutoSampleState,
  clearStrokeSession,
  strokeBeforeImageRef,
  strokeBeforeColorStateRef,
  drawingCtxRef,
  drawingCanvasRef,
  drawingCanvasHasContent,
  resumeColorCycleAfterInteraction,
  endFinalizeVisibleTimer,
  strokeBoundingBoxRef,
  strokeCapturePaddingRef,
  lastStrokePointRef,
  isBusyRef,
});
