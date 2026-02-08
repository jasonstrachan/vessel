import { useDrawingCanvasKeyboard } from './useDrawingCanvasKeyboard';
import { useDrawingCanvasToolSync } from './useDrawingCanvasToolSync';

interface UseDrawingCanvasInteractionBridgeOptions {
  keyboardOptions: Parameters<typeof useDrawingCanvasKeyboard>[0];
  toolSyncOptions: Parameters<typeof useDrawingCanvasToolSync>[0];
}

export const useDrawingCanvasInteractionBridge = ({
  keyboardOptions,
  toolSyncOptions,
}: UseDrawingCanvasInteractionBridgeOptions) => {
  useDrawingCanvasKeyboard(keyboardOptions);
  useDrawingCanvasToolSync(toolSyncOptions);
};
