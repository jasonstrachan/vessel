import type React from 'react';

export type FinalizeDrawingCleanupArgs = {
  endMaskHealingStroke: () => void;
  resetAutoSampleState: () => void;
  clearStrokeSession: () => void;
  strokeBeforeImageRef: React.MutableRefObject<ImageData | null>;
  strokeBeforeColorStateRef: React.MutableRefObject<unknown>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  resumeColorCycleAfterInteraction: () => Promise<void>;
  endFinalizeVisibleTimer: () => void;
  strokeBoundingBoxRef: React.MutableRefObject<unknown>;
  strokeCapturePaddingRef: React.MutableRefObject<number>;
  lastStrokePointRef: React.MutableRefObject<{ x: number; y: number } | null>;
  isBusyRef?: React.MutableRefObject<boolean>;
};

export const finalizeDrawingCleanup = async ({
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
}: FinalizeDrawingCleanupArgs): Promise<void> => {
  endMaskHealingStroke();
  resetAutoSampleState();
  clearStrokeSession();
  strokeBeforeImageRef.current = null;
  strokeBeforeColorStateRef.current = null;
  if (drawingCtxRef.current && drawingCanvasRef.current) {
    drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
  }
  drawingCanvasHasContent.current = false;
  await resumeColorCycleAfterInteraction();
  endFinalizeVisibleTimer();
  strokeBoundingBoxRef.current = null;
  strokeCapturePaddingRef.current = 0;
  lastStrokePointRef.current = null;
  if (isBusyRef) {
    isBusyRef.current = false;
  }
};
