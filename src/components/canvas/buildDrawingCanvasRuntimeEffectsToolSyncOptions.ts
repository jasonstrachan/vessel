import type { UseDrawingCanvasRuntimeEffectsBridgeOptions } from './useDrawingCanvasRuntimeEffectsBridge';

export type BuildDrawingCanvasRuntimeEffectsToolSyncOptionsArgs =
  UseDrawingCanvasRuntimeEffectsBridgeOptions['interactionBridgeOptionsArgs']['toolSyncOptions'];

export const buildDrawingCanvasRuntimeEffectsToolSyncOptions = (
  options: BuildDrawingCanvasRuntimeEffectsToolSyncOptionsArgs
): UseDrawingCanvasRuntimeEffectsBridgeOptions['interactionBridgeOptionsArgs']['toolSyncOptions'] =>
  options;
