import { useDrawingCanvasInputHandlersBridge } from './useDrawingCanvasInputHandlersBridge';
import { useDrawingCanvasPointerUtils } from './useDrawingCanvasPointerUtils';
import { useDrawingCanvasShapeEditorBridge } from './useDrawingCanvasShapeEditorBridge';

type PointerUtilsOptions = Parameters<typeof useDrawingCanvasPointerUtils>[0];
type ShapeEditorBridgeOptions = Omit<
  Parameters<typeof useDrawingCanvasShapeEditorBridge>[0],
  'clampPointToCanvasBounds' | 'getWorldPointFromPointerEvent'
>;
type InputHandlersBridgeOptions = Omit<
  Parameters<typeof useDrawingCanvasInputHandlersBridge>[0],
  | 'cancelCanvasShapePointer'
  | 'getMousePos'
  | 'getViewportPastePosition'
  | 'getWorldPointFromPointerEvent'
  | 'handleCanvasShapePointerDown'
  | 'handleCanvasShapePointerMove'
  | 'handleCanvasShapePointerUp'
  | 'isWorldPointInsideCanvasShape'
>;

interface UseDrawingCanvasInputBridgeOptions {
  pointerUtilsOptions: PointerUtilsOptions;
  shapeEditorBridgeOptions: ShapeEditorBridgeOptions;
  inputHandlersBridgeOptions: InputHandlersBridgeOptions;
}

export const useDrawingCanvasInputBridge = ({
  pointerUtilsOptions,
  shapeEditorBridgeOptions,
  inputHandlersBridgeOptions,
}: UseDrawingCanvasInputBridgeOptions) => {
  const {
    getMousePos,
    clampPointToCanvasBounds,
    getWorldPointFromPointerEvent,
    isWorldPointInsideCanvasShape,
    getViewportPastePosition,
  } = useDrawingCanvasPointerUtils(pointerUtilsOptions);

  const {
    handleCanvasShapePointerDown,
    handleCanvasShapePointerMove,
    handleCanvasShapePointerUp,
    cancelCanvasShapePointer,
  } = useDrawingCanvasShapeEditorBridge({
    ...shapeEditorBridgeOptions,
    getWorldPointFromPointerEvent,
    clampPointToCanvasBounds,
  });

  return useDrawingCanvasInputHandlersBridge({
    ...inputHandlersBridgeOptions,
    getMousePos,
    getViewportPastePosition,
    getWorldPointFromPointerEvent,
    isWorldPointInsideCanvasShape,
    handleCanvasShapePointerDown,
    handleCanvasShapePointerMove,
    handleCanvasShapePointerUp,
    cancelCanvasShapePointer,
  });
};
