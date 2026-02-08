import { useCallback, type MutableRefObject } from 'react';
import { viewPerformanceTracker } from '@/utils/viewPerformanceTracker';

interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface UseDrawingCanvasDrawCallbackOptions {
  drawBase: (
    ctx: CanvasRenderingContext2D,
    transform: ViewTransform,
    skipDrawingCanvas: boolean,
    drawingCanvas: HTMLCanvasElement | null,
    isDrawing: boolean,
    drawingCanvasHasContent: boolean,
    isSelecting: boolean,
    selectionStart: { x: number; y: number } | null,
    dpr: number
  ) => void;
  drawingHandlers: {
    drawingCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
    drawingCanvasHasContent: MutableRefObject<boolean>;
  };
  interaction: {
    state: { isDrawing: boolean; isSelecting: boolean };
    refs: { selectionStart: MutableRefObject<{ x: number; y: number } | null> };
  };
  pan: {
    getState: () => { isPanning: boolean };
  };
  isZoomingRef: MutableRefObject<boolean>;
  devicePixelRatioRef: MutableRefObject<number>;
}

export const useDrawingCanvasDrawCallback = ({
  drawBase,
  drawingHandlers,
  interaction,
  pan,
  isZoomingRef,
  devicePixelRatioRef,
}: UseDrawingCanvasDrawCallbackOptions) => {
  return useCallback(
    (
      ctx: CanvasRenderingContext2D,
      transform: ViewTransform,
      skipDrawingCanvas = false
    ) => {
      const shouldMeasure = process.env.NODE_ENV !== 'production';
      const frameStart = shouldMeasure ? performance.now() : 0;
      const dpr = devicePixelRatioRef.current || 1;

      ctx.save();
      drawBase(
        ctx,
        transform,
        skipDrawingCanvas,
        drawingHandlers.drawingCanvasRef.current,
        interaction.state.isDrawing,
        drawingHandlers.drawingCanvasHasContent.current,
        interaction.state.isSelecting,
        interaction.refs.selectionStart.current,
        dpr
      );
      ctx.restore();

      if (shouldMeasure) {
        const duration = performance.now() - frameStart;
        const isPanActive = pan.getState().isPanning;
        if (isPanActive) {
          viewPerformanceTracker.record('pan', duration);
        } else if (isZoomingRef.current) {
          viewPerformanceTracker.record('zoom', duration);
        } else {
          viewPerformanceTracker.record('draw', duration);
        }
      }
    },
    [devicePixelRatioRef, drawBase, drawingHandlers, interaction, isZoomingRef, pan]
  );
};
