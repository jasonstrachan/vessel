import type React from 'react';
import { useCallback } from 'react';
import type { ShapePoint } from '@/types';
import { isPointInCanvasShape } from '@/utils/canvasShape';

type CanvasShape = Parameters<typeof isPointInCanvasShape>[0];

interface UseDrawingCanvasPointerUtilsOptions {
  canvasBounds: { x: number; y: number; width: number; height: number } | null;
  activeCanvasShape: CanvasShape | null;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  canvasOffsetX: number;
  canvasOffsetY: number;
  canvasZoom: number;
  project: { width: number; height: number } | null;
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
}

export const useDrawingCanvasPointerUtils = ({
  canvasBounds,
  activeCanvasShape,
  canvasRef,
  canvasOffsetX,
  canvasOffsetY,
  canvasZoom,
  project,
  viewTransformRef,
}: UseDrawingCanvasPointerUtilsOptions) => {
  const getMousePos = useCallback((event: React.MouseEvent<Element> | React.WheelEvent<Element>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, []);

  const clampPointToCanvasBounds = useCallback(
    (point: ShapePoint): ShapePoint => {
      if (!canvasBounds) {
        return point;
      }
      const maxX = canvasBounds.x + canvasBounds.width;
      const maxY = canvasBounds.y + canvasBounds.height;
      return {
        x: Math.min(Math.max(point.x, canvasBounds.x), maxX),
        y: Math.min(Math.max(point.y, canvasBounds.y), maxY),
      };
    },
    [canvasBounds]
  );

  const getWorldPointFromPointerEvent = useCallback(
    (event: React.PointerEvent<Element>): ShapePoint | null => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      return {
        x: (localX - (canvasOffsetX ?? 0)) / (canvasZoom || 1),
        y: (localY - (canvasOffsetY ?? 0)) / (canvasZoom || 1),
      };
    },
    [canvasRef, canvasOffsetX, canvasOffsetY, canvasZoom]
  );

  const isWorldPointInsideCanvasShape = useCallback(
    (point: ShapePoint): boolean => {
      if (!activeCanvasShape) return true;
      return isPointInCanvasShape(activeCanvasShape, point);
    },
    [activeCanvasShape]
  );

  const getViewportPastePosition = useCallback(
    (contentWidth: number, contentHeight: number) => {
      if (!project) {
        return null;
      }

      const canvasElement = canvasRef.current;
      if (!canvasElement) {
        return null;
      }

      const rect = canvasElement.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) {
        return null;
      }

      const { scale, offsetX, offsetY } = viewTransformRef.current;
      const safeScale = scale || 1;

      const centerScreenX = rect.width / 2;
      const centerScreenY = rect.height / 2;

      const centerWorldX = (centerScreenX - offsetX) / safeScale;
      const centerWorldY = (centerScreenY - offsetY) / safeScale;

      const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
      const maxX = Math.max(0, project.width - contentWidth);
      const maxY = Math.max(0, project.height - contentHeight);

      return {
        x: clamp(Math.round(centerWorldX - contentWidth / 2), 0, maxX),
        y: clamp(Math.round(centerWorldY - contentHeight / 2), 0, maxY),
      };
    },
    [canvasRef, project, viewTransformRef]
  );

  return {
    getMousePos,
    clampPointToCanvasBounds,
    getWorldPointFromPointerEvent,
    isWorldPointInsideCanvasShape,
    getViewportPastePosition,
  };
};
