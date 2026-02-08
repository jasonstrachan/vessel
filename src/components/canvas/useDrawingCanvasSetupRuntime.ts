import { buildDrawingCanvasSetupOptions } from './buildDrawingCanvasSetupOptions';
import {
  useDrawingCanvasSetupBridge,
  type UseDrawingCanvasSetupBridgeOptions,
} from './useDrawingCanvasSetupBridge';

interface UseDrawingCanvasSetupRuntimeOptions {
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

export const useDrawingCanvasSetupRuntime = ({
  projectState,
  toolState,
  handlerState,
}: UseDrawingCanvasSetupRuntimeOptions) =>
  useDrawingCanvasSetupBridge(
    buildDrawingCanvasSetupOptions({
      projectState,
      toolState,
      handlerState,
    })
  );
