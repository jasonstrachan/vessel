import type { UseDrawingCanvasRuntimeEffectsBridgeOptions } from './useDrawingCanvasRuntimeEffectsBridge';

export interface BuildDrawingCanvasRuntimeEffectsUiArgs {
  cursorEffectsOptions: UseDrawingCanvasRuntimeEffectsBridgeOptions['effectsBuilderArgs']['cursorUiOptions']['cursorEffectsOptions'];
  uiEffectsOptions: UseDrawingCanvasRuntimeEffectsBridgeOptions['effectsBuilderArgs']['cursorUiOptions']['uiEffectsOptions'];
  resizeCenterOptions: UseDrawingCanvasRuntimeEffectsBridgeOptions['effectsBuilderArgs']['resizeCenterOptions'];
}

export const buildDrawingCanvasRuntimeEffectsUiArgs = ({
  cursorEffectsOptions,
  uiEffectsOptions,
  resizeCenterOptions,
}: BuildDrawingCanvasRuntimeEffectsUiArgs): BuildDrawingCanvasRuntimeEffectsUiArgs => ({
  cursorEffectsOptions,
  uiEffectsOptions,
  resizeCenterOptions,
});
