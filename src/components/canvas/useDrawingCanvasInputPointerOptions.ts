import { useMemo } from 'react';
import { useDrawingCanvasInputHandlers } from './useDrawingCanvasInputHandlers';

type UseDrawingCanvasInputPointerOptionsArgs =
  Parameters<typeof useDrawingCanvasInputHandlers>[0]['pointerOptions'];

export const useDrawingCanvasInputPointerOptions = ({
  canvasShapeEditorActive,
  isSpacePressedRef,
  getWorldPointFromPointerEvent,
  isWorldPointInsideCanvasShape,
  handleCanvasShapePointerDown,
  handleCanvasShapePointerMove,
  handleCanvasShapePointerUp,
  cancelCanvasShapePointer,
}: UseDrawingCanvasInputPointerOptionsArgs) =>
  useMemo(
    () => ({
      canvasShapeEditorActive,
      isSpacePressedRef,
      getWorldPointFromPointerEvent,
      isWorldPointInsideCanvasShape,
      handleCanvasShapePointerDown,
      handleCanvasShapePointerMove,
      handleCanvasShapePointerUp,
      cancelCanvasShapePointer,
    }),
    [
      canvasShapeEditorActive,
      cancelCanvasShapePointer,
      getWorldPointFromPointerEvent,
      handleCanvasShapePointerDown,
      handleCanvasShapePointerMove,
      handleCanvasShapePointerUp,
      isSpacePressedRef,
      isWorldPointInsideCanvasShape,
    ]
  );
