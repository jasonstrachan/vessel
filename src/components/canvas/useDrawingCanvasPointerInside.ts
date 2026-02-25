import { useCallback, type MutableRefObject, type RefObject } from 'react';
import type { CanvasShape } from '@/types';
import { isPointerInsideCanvasAtPosition } from './pointerInsideCanvas';

interface UseDrawingCanvasPointerInsideOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  mousePositionRef: MutableRefObject<{ x: number; y: number }>;
  activeCanvasShape: CanvasShape | null;
  canvasOffsetX: number | null;
  canvasOffsetY: number | null;
  canvasZoom: number;
}

export const useDrawingCanvasPointerInside = ({
  canvasRef,
  mousePositionRef,
  activeCanvasShape,
  canvasOffsetX,
  canvasOffsetY,
  canvasZoom,
}: UseDrawingCanvasPointerInsideOptions) => {
  return useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return false;
    }

    return isPointerInsideCanvasAtPosition({
      pointer: mousePositionRef.current,
      rect,
      activeCanvasShape,
      canvasOffsetX: canvasOffsetX ?? 0,
      canvasOffsetY: canvasOffsetY ?? 0,
      canvasZoom: canvasZoom || 1,
    });
  }, [activeCanvasShape, canvasOffsetX, canvasOffsetY, canvasRef, canvasZoom, mousePositionRef]);
};
