import type { UseDrawingCanvasRuntimeEffectsBridgeOptions } from './useDrawingCanvasRuntimeEffectsBridge';

export interface BuildDrawingCanvasRuntimeEffectsRedrawArgs {
  redrawBase: UseDrawingCanvasRuntimeEffectsBridgeOptions['redrawCompositeOptionsArgs']['redrawBase'];
  compositeBase: UseDrawingCanvasRuntimeEffectsBridgeOptions['redrawCompositeOptionsArgs']['compositeBase'];
  redrawShared: UseDrawingCanvasRuntimeEffectsBridgeOptions['redrawCompositeOptionsArgs']['shared'];
}

export const buildDrawingCanvasRuntimeEffectsRedrawArgs = ({
  redrawBase,
  compositeBase,
  redrawShared,
}: BuildDrawingCanvasRuntimeEffectsRedrawArgs): BuildDrawingCanvasRuntimeEffectsRedrawArgs => ({
  redrawBase,
  compositeBase,
  redrawShared,
});
