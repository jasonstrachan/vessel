import type React from 'react';
import { useCallback } from 'react';
import type { ShapePoint } from '@/types';

interface UseDrawingCanvasPointerHandlersOptions {
  canvasShapeEditorActive: boolean;
  allowPointerDownOutsideCanvasShape?: boolean;
  isSpacePressedRef: React.MutableRefObject<boolean>;
  getWorldPointFromPointerEvent: (event: React.PointerEvent<Element>) => ShapePoint | null;
  isWorldPointInsideCanvasShape: (point: ShapePoint) => boolean;
  handleCanvasShapePointerDown: (event: React.PointerEvent<Element>) => void;
  handleCanvasShapePointerMove: (event: React.PointerEvent<Element>) => void;
  handleCanvasShapePointerUp: (event: React.PointerEvent<Element>) => void;
  cancelCanvasShapePointer: () => void;
  basePointerDown: (event: React.PointerEvent<Element>) => void;
  basePointerMove: (event: React.PointerEvent<Element>) => void;
  basePointerUp: (event: React.PointerEvent<Element>) => void;
  basePointerEnter: () => void;
  basePointerLeave: () => void;
  basePointerCancel: (event: React.PointerEvent<Element>) => void;
}

export const useDrawingCanvasPointerHandlers = ({
  canvasShapeEditorActive,
  allowPointerDownOutsideCanvasShape = false,
  isSpacePressedRef,
  getWorldPointFromPointerEvent,
  isWorldPointInsideCanvasShape,
  handleCanvasShapePointerDown,
  handleCanvasShapePointerMove,
  handleCanvasShapePointerUp,
  cancelCanvasShapePointer,
  basePointerDown,
  basePointerMove,
  basePointerUp,
  basePointerEnter,
  basePointerLeave,
  basePointerCancel,
}: UseDrawingCanvasPointerHandlersOptions) => {
  const shouldBlockPointerDownForShape = useCallback(
    (event: React.PointerEvent<Element>): boolean => {
      if (isSpacePressedRef.current) {
        return false;
      }
      if (allowPointerDownOutsideCanvasShape) {
        return false;
      }
      const world = getWorldPointFromPointerEvent(event);
      if (!world) return false;
      return !isWorldPointInsideCanvasShape(world);
    },
    [
      allowPointerDownOutsideCanvasShape,
      getWorldPointFromPointerEvent,
      isSpacePressedRef,
      isWorldPointInsideCanvasShape,
    ]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<Element>) => {
      if (canvasShapeEditorActive && !isSpacePressedRef.current) {
        handleCanvasShapePointerDown(event);
        return;
      }
      if (!canvasShapeEditorActive && shouldBlockPointerDownForShape(event)) {
        return;
      }
      basePointerDown(event);
    },
    [
      basePointerDown,
      canvasShapeEditorActive,
      handleCanvasShapePointerDown,
      isSpacePressedRef,
      shouldBlockPointerDownForShape,
    ]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<Element>) => {
      if (canvasShapeEditorActive && !isSpacePressedRef.current) {
        handleCanvasShapePointerMove(event);
        return;
      }
      basePointerMove(event);
    },
    [basePointerMove, canvasShapeEditorActive, handleCanvasShapePointerMove, isSpacePressedRef]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<Element>) => {
      if (canvasShapeEditorActive && !isSpacePressedRef.current) {
        handleCanvasShapePointerUp(event);
        return;
      }
      basePointerUp(event);
    },
    [basePointerUp, canvasShapeEditorActive, handleCanvasShapePointerUp, isSpacePressedRef]
  );

  const handlePointerEnter = useCallback(() => {
    if (canvasShapeEditorActive && !isSpacePressedRef.current) {
      return;
    }
    basePointerEnter();
  }, [basePointerEnter, canvasShapeEditorActive, isSpacePressedRef]);

  const handlePointerLeave = useCallback(() => {
    if (canvasShapeEditorActive && !isSpacePressedRef.current) {
      return;
    }
    basePointerLeave();
  }, [basePointerLeave, canvasShapeEditorActive, isSpacePressedRef]);

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<Element>) => {
      if (canvasShapeEditorActive && !isSpacePressedRef.current) {
        cancelCanvasShapePointer();
        return;
      }
      basePointerCancel(event);
    },
    [basePointerCancel, cancelCanvasShapePointer, canvasShapeEditorActive, isSpacePressedRef]
  );

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerEnter,
    handlePointerLeave,
    handlePointerCancel,
  };
};
