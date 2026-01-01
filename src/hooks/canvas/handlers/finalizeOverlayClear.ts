import type { AppState } from '@/stores/useAppStore';

export const clearFinalizeOverlayIfNeeded = ({
  state,
  isColorCycleLayer,
  isColorCycleBrush,
  drawingCanvasRef,
  drawingCtxRef,
  drawingCanvasHasContent,
}: {
  state: AppState;
  isColorCycleLayer: boolean;
  isColorCycleBrush: boolean;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
}): void => {
  const polygonState = state.polygonGradientState;
  const isInAdjustmentMode =
    polygonState.drawingState === 'adjustingSpacing' ||
    polygonState.drawingState === 'adjustingRotation' ||
    polygonState.drawingState === 'adjustingSize';

  if (!isColorCycleLayer || !isColorCycleBrush) {
    if (!isInAdjustmentMode) {
      if (drawingCtxRef.current && drawingCanvasRef.current) {
        drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
      }
      drawingCanvasHasContent.current = false;
    }
  }
};
