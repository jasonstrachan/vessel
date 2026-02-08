import type { UseDrawingCanvasSetupBridgeOptions } from './useDrawingCanvasSetupBridge';

interface BuildDrawingCanvasSetupOptionsArgs {
  projectState: Pick<UseDrawingCanvasSetupBridgeOptions, 'project' | 'projectFilename'>;
  toolState: Pick<
    UseDrawingCanvasSetupBridgeOptions,
    | 'currentTool'
    | 'brushSettings'
    | 'fillSettings'
    | 'eraserSettings'
    | 'shapeMode'
    | 'customBrushCapture'
  >;
  handlerState: Pick<
    UseDrawingCanvasSetupBridgeOptions,
    'setFloatingPaste' | 'mousePositionRef' | 'brushCursorHandleRef'
  >;
}

export const buildDrawingCanvasSetupOptions = ({
  projectState,
  toolState,
  handlerState,
}: BuildDrawingCanvasSetupOptionsArgs): UseDrawingCanvasSetupBridgeOptions => ({
  ...projectState,
  ...toolState,
  ...handlerState,
});
