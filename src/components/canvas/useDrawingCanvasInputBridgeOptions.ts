import { useDrawingCanvasInputBridge } from './useDrawingCanvasInputBridge';

type InputBridgeOptions = Parameters<typeof useDrawingCanvasInputBridge>[0];

interface UseDrawingCanvasInputBridgeOptionsArgs {
  pointerUtilsOptions: InputBridgeOptions['pointerUtilsOptions'];
  shapeEditorBridgeOptions: InputBridgeOptions['shapeEditorBridgeOptions'];
  inputHandlersOptions: InputBridgeOptions['inputHandlersBridgeOptions'];
}

export const useDrawingCanvasInputBridgeOptions = ({
  pointerUtilsOptions,
  shapeEditorBridgeOptions,
  inputHandlersOptions,
}: UseDrawingCanvasInputBridgeOptionsArgs): InputBridgeOptions => ({
  pointerUtilsOptions,
  shapeEditorBridgeOptions,
  inputHandlersBridgeOptions: inputHandlersOptions,
});
