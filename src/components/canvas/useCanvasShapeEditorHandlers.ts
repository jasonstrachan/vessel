import { useCallback, type MutableRefObject, type RefObject } from 'react';
import type { ShapePoint } from '@/types';
import { buildCanvasShapeFromTool, buildFreehandShape } from '@/utils/canvasShape';

export type CanvasShapeDraft = ReturnType<typeof buildCanvasShapeFromTool>;
type CanvasShapeTool = NonNullable<Parameters<typeof buildCanvasShapeFromTool>[0]>;

interface CanvasShapeEditorState {
  active: boolean;
  tool: CanvasShapeTool | null;
}

interface CanvasShapeEditState {
  isDrawing: boolean;
  start: ShapePoint | null;
}

interface UseCanvasShapeEditorHandlersOptions {
  canvasShapeEditor: CanvasShapeEditorState;
  canvasBounds: { x: number; y: number; width: number; height: number } | null;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvasShapeEditRef: MutableRefObject<CanvasShapeEditState>;
  freehandPointsRef: MutableRefObject<ShapePoint[]>;
  getWorldPointFromPointerEvent: (event: React.PointerEvent<HTMLCanvasElement>) => ShapePoint | null;
  clampPointToCanvasBounds: (point: ShapePoint) => ShapePoint;
  updateCanvasShapeDraft: (shape: CanvasShapeDraft | null) => void;
}

export const useCanvasShapeEditorHandlers = ({
  canvasShapeEditor,
  canvasBounds,
  canvasRef,
  canvasShapeEditRef,
  freehandPointsRef,
  getWorldPointFromPointerEvent,
  clampPointToCanvasBounds,
  updateCanvasShapeDraft,
}: UseCanvasShapeEditorHandlersOptions) => {
  const handleCanvasShapePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!canvasShapeEditor.active || !canvasShapeEditor.tool || !canvasBounds) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      const world = getWorldPointFromPointerEvent(event);
      if (!world) return;

      event.preventDefault();
      event.stopPropagation();

      const clamped = clampPointToCanvasBounds(world);
      canvasShapeEditRef.current.isDrawing = true;
      canvasShapeEditRef.current.start = clamped;
      freehandPointsRef.current = [clamped];

      const shape = buildCanvasShapeFromTool(
        canvasShapeEditor.tool,
        clamped,
        clamped,
        freehandPointsRef.current,
        canvasBounds
      );
      updateCanvasShapeDraft(shape);
      canvasRef.current?.setPointerCapture?.(event.pointerId);
    },
    [
      canvasBounds,
      canvasRef,
      canvasShapeEditRef,
      canvasShapeEditor.active,
      canvasShapeEditor.tool,
      clampPointToCanvasBounds,
      freehandPointsRef,
      getWorldPointFromPointerEvent,
      updateCanvasShapeDraft,
    ]
  );

  const handleCanvasShapePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!canvasShapeEditor.active || !canvasShapeEditor.tool || !canvasBounds) {
        return;
      }
      if (!canvasShapeEditRef.current.isDrawing) {
        return;
      }
      const world = getWorldPointFromPointerEvent(event);
      if (!world) return;

      event.preventDefault();
      event.stopPropagation();

      const clamped = clampPointToCanvasBounds(world);
      const start = canvasShapeEditRef.current.start ?? clamped;

      if (canvasShapeEditor.tool === 'freehand') {
        const last = freehandPointsRef.current[freehandPointsRef.current.length - 1];
        const dx = clamped.x - (last?.x ?? clamped.x);
        const dy = clamped.y - (last?.y ?? clamped.y);
        if (dx * dx + dy * dy >= 1) {
          freehandPointsRef.current.push(clamped);
        }
      }

      const shape = buildCanvasShapeFromTool(
        canvasShapeEditor.tool,
        start,
        clamped,
        freehandPointsRef.current,
        canvasBounds
      );
      updateCanvasShapeDraft(shape);
    },
    [
      canvasBounds,
      canvasShapeEditRef,
      canvasShapeEditor.active,
      canvasShapeEditor.tool,
      clampPointToCanvasBounds,
      freehandPointsRef,
      getWorldPointFromPointerEvent,
      updateCanvasShapeDraft,
    ]
  );

  const handleCanvasShapePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!canvasShapeEditor.active || !canvasShapeEditor.tool || !canvasBounds) {
        return;
      }
      if (!canvasShapeEditRef.current.isDrawing) {
        return;
      }
      const world = getWorldPointFromPointerEvent(event);
      if (!world) return;

      event.preventDefault();
      event.stopPropagation();

      const clamped = clampPointToCanvasBounds(world);
      const start = canvasShapeEditRef.current.start ?? clamped;

      let shape: CanvasShapeDraft;
      if (canvasShapeEditor.tool === 'freehand') {
        if (freehandPointsRef.current.length === 0) {
          freehandPointsRef.current = [clamped];
        }
        shape = buildFreehandShape(freehandPointsRef.current, canvasBounds);
      } else {
        shape = buildCanvasShapeFromTool(
          canvasShapeEditor.tool,
          start,
          clamped,
          freehandPointsRef.current,
          canvasBounds
        );
      }

      canvasShapeEditRef.current.isDrawing = false;
      canvasShapeEditRef.current.start = null;
      updateCanvasShapeDraft(shape);
      canvasRef.current?.releasePointerCapture?.(event.pointerId);
    },
    [
      canvasBounds,
      canvasRef,
      canvasShapeEditRef,
      canvasShapeEditor.active,
      canvasShapeEditor.tool,
      clampPointToCanvasBounds,
      freehandPointsRef,
      getWorldPointFromPointerEvent,
      updateCanvasShapeDraft,
    ]
  );

  const cancelCanvasShapePointer = useCallback(() => {
    canvasShapeEditRef.current.isDrawing = false;
    canvasShapeEditRef.current.start = null;
  }, [canvasShapeEditRef]);

  return {
    handleCanvasShapePointerDown,
    handleCanvasShapePointerMove,
    handleCanvasShapePointerUp,
    cancelCanvasShapePointer,
  };
};
