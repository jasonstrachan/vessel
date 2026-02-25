import { useDrawingCanvasInputHandlers } from './useDrawingCanvasInputHandlers';
import { useDrawingCanvasInputPointerOptions } from './useDrawingCanvasInputPointerOptions';

type UseDrawingCanvasInputHandlersArgs = Parameters<typeof useDrawingCanvasInputHandlers>[0];
type UseDrawingCanvasInputPointerOptionsArgs =
  Parameters<typeof useDrawingCanvasInputPointerOptions>[0];

type UseDrawingCanvasInputHandlersBridgeOptions = Omit<
  UseDrawingCanvasInputHandlersArgs,
  'pointerOptions'
> &
  UseDrawingCanvasInputPointerOptionsArgs;

export const useDrawingCanvasInputHandlersBridge = ({
  canvasShapeEditorActive,
  isSpacePressedRef,
  getWorldPointFromPointerEvent,
  isWorldPointInsideCanvasShape,
  handleCanvasShapePointerDown,
  handleCanvasShapePointerMove,
  handleCanvasShapePointerUp,
  cancelCanvasShapePointer,
  ...handlerOptions
}: UseDrawingCanvasInputHandlersBridgeOptions) => {
  const pointerOptions = useDrawingCanvasInputPointerOptions({
    canvasShapeEditorActive,
    isSpacePressedRef,
    getWorldPointFromPointerEvent,
    isWorldPointInsideCanvasShape,
    handleCanvasShapePointerDown,
    handleCanvasShapePointerMove,
    handleCanvasShapePointerUp,
    cancelCanvasShapePointer,
  });

  return useDrawingCanvasInputHandlers({
    ...handlerOptions,
    isSpacePressedRef,
    pointerOptions,
  });
};
