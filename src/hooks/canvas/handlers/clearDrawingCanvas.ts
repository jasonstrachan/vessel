import type React from 'react';
import { setOverlaySeededFromLayer } from '@/hooks/canvas/utils/overlaySeedState';

interface ClearDrawingCanvasOptions {
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  lastDrawPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  eraserV2Enabled: boolean;
  eraserToolRef: React.MutableRefObject<{ cancel: () => void } | null>;
  eraserRoiRef: React.MutableRefObject<{ x: number; y: number; width: number; height: number } | null>;
  endMaskHealingStroke: () => void;
  resetShapeDragRefs: () => void;
}

export const clearDrawingCanvas = ({
  drawingCtxRef,
  drawingCanvasRef,
  drawingCanvasHasContent,
  lastDrawPosRef,
  eraserV2Enabled,
  eraserToolRef,
  eraserRoiRef,
  endMaskHealingStroke,
  resetShapeDragRefs,
}: ClearDrawingCanvasOptions): void => {
  if (drawingCtxRef.current && drawingCanvasRef.current) {
    drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
    setOverlaySeededFromLayer(drawingCanvasRef.current, false);
  }
  drawingCanvasHasContent.current = false;
  lastDrawPosRef.current = null;

  if (eraserV2Enabled && eraserToolRef.current) {
    eraserToolRef.current.cancel();
    eraserToolRef.current = null;
    eraserRoiRef.current = null;
  }

  endMaskHealingStroke();
  resetShapeDragRefs();
};

export const createClearDrawingCanvasDispatcher = (
  options: ClearDrawingCanvasOptions
): (() => void) => () => {
  clearDrawingCanvas(options);
};
