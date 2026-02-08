import { useDrawingCanvasCompositeRebuild } from './useDrawingCanvasCompositeRebuild';
import { useDrawingCanvasCursorEffects } from './useDrawingCanvasCursorEffects';
import { useDrawingCanvasInputBridge } from './useDrawingCanvasInputBridge';
import { useDrawingCanvasInteractionBridge } from './useDrawingCanvasInteractionBridge';
import { useDrawingCanvasRedrawEffects } from './useDrawingCanvasRedrawEffects';
import { useDrawingCanvasResizeCenter } from './useDrawingCanvasResizeCenter';
import { useDrawingCanvasUiEffects } from './useDrawingCanvasUiEffects';

interface UseDrawingCanvasEffectsBridgeOptions {
  redrawEffectsOptions: Parameters<typeof useDrawingCanvasRedrawEffects>[0];
  interactionBridgeOptions: Parameters<typeof useDrawingCanvasInteractionBridge>[0];
  inputBridgeOptions: Parameters<typeof useDrawingCanvasInputBridge>[0];
  cursorEffectsOptions: Parameters<typeof useDrawingCanvasCursorEffects>[0];
  compositeRebuildOptions: Parameters<typeof useDrawingCanvasCompositeRebuild>[0];
  uiEffectsOptions: Parameters<typeof useDrawingCanvasUiEffects>[0];
  resizeCenterOptions: Parameters<typeof useDrawingCanvasResizeCenter>[0];
}

export const useDrawingCanvasEffectsBridge = ({
  redrawEffectsOptions,
  interactionBridgeOptions,
  inputBridgeOptions,
  cursorEffectsOptions,
  compositeRebuildOptions,
  uiEffectsOptions,
  resizeCenterOptions,
}: UseDrawingCanvasEffectsBridgeOptions) => {
  useDrawingCanvasRedrawEffects(redrawEffectsOptions);
  useDrawingCanvasInteractionBridge(interactionBridgeOptions);
  const inputHandlers = useDrawingCanvasInputBridge(inputBridgeOptions);
  useDrawingCanvasCursorEffects(cursorEffectsOptions);
  useDrawingCanvasCompositeRebuild(compositeRebuildOptions);
  useDrawingCanvasUiEffects(uiEffectsOptions);
  useDrawingCanvasResizeCenter(resizeCenterOptions);
  return inputHandlers;
};
