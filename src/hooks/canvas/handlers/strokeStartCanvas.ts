import type React from 'react';

export const initializeStrokeStartCanvasState = ({
  ccStrokeActiveAtStart,
  isColorCycleBrush,
  worldPos,
  stampCounterRef,
  drawingCtxRef,
  drawingCanvasRef,
  drawingCanvasHasContent,
  lastDrawPosRef,
  lastStrokePointRef,
}: {
  ccStrokeActiveAtStart: boolean;
  isColorCycleBrush: boolean;
  worldPos: { x: number; y: number };
  stampCounterRef: React.MutableRefObject<number>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  lastDrawPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  lastStrokePointRef: React.MutableRefObject<{ x: number; y: number } | null>;
}): CanvasRenderingContext2D | null => {
  stampCounterRef.current = 0;
  const drawCtx = drawingCtxRef.current;
  const drawingCanvas = drawingCanvasRef.current;
  if (!drawCtx || !drawingCanvas) {
    return null;
  }

  if (drawingCanvasHasContent.current) {
    // Avoid clearing a large overlay if it's already empty.
    drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  }
  drawingCanvasHasContent.current = !(isColorCycleBrush && ccStrokeActiveAtStart);
  lastDrawPosRef.current = worldPos;
  lastStrokePointRef.current = worldPos;

  return drawCtx;
};
