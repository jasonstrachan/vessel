import type { UseDrawingCanvasRuntimeEffectsBridgeOptions } from './useDrawingCanvasRuntimeEffectsBridge';

interface BuildDrawingCanvasRuntimeEffectsBridgeOptionsArgs {
  pointerUtilsOptions: UseDrawingCanvasRuntimeEffectsBridgeOptions['inputBridgeOptionsArgs']['pointerUtilsOptions'];
  shapeEditorBridgeOptions: UseDrawingCanvasRuntimeEffectsBridgeOptions['inputBridgeOptionsArgs']['shapeEditorBridgeOptions'];
  inputHandlersOptions: UseDrawingCanvasRuntimeEffectsBridgeOptions['inputBridgeOptionsArgs']['inputHandlersOptions'];
  keyboardOptions: UseDrawingCanvasRuntimeEffectsBridgeOptions['interactionBridgeOptionsArgs']['keyboardOptions'];
  toolSyncOptions: UseDrawingCanvasRuntimeEffectsBridgeOptions['interactionBridgeOptionsArgs']['toolSyncOptions'];
  redrawBase: UseDrawingCanvasRuntimeEffectsBridgeOptions['redrawCompositeOptionsArgs']['redrawBase'];
  compositeBase: UseDrawingCanvasRuntimeEffectsBridgeOptions['redrawCompositeOptionsArgs']['compositeBase'];
  redrawShared: UseDrawingCanvasRuntimeEffectsBridgeOptions['redrawCompositeOptionsArgs']['shared'];
  cursorEffectsOptions: UseDrawingCanvasRuntimeEffectsBridgeOptions['effectsBuilderArgs']['cursorUiOptions']['cursorEffectsOptions'];
  uiEffectsOptions: UseDrawingCanvasRuntimeEffectsBridgeOptions['effectsBuilderArgs']['cursorUiOptions']['uiEffectsOptions'];
  resizeCenterOptions: UseDrawingCanvasRuntimeEffectsBridgeOptions['effectsBuilderArgs']['resizeCenterOptions'];
}

export const buildDrawingCanvasRuntimeEffectsBridgeOptions = ({
  pointerUtilsOptions,
  shapeEditorBridgeOptions,
  inputHandlersOptions,
  keyboardOptions,
  toolSyncOptions,
  redrawBase,
  compositeBase,
  redrawShared,
  cursorEffectsOptions,
  uiEffectsOptions,
  resizeCenterOptions,
}: BuildDrawingCanvasRuntimeEffectsBridgeOptionsArgs): UseDrawingCanvasRuntimeEffectsBridgeOptions => ({
  inputBridgeOptionsArgs: {
    pointerUtilsOptions,
    shapeEditorBridgeOptions,
    inputHandlersOptions,
  },
  interactionBridgeOptionsArgs: {
    keyboardOptions,
    toolSyncOptions,
  },
  redrawCompositeOptionsArgs: {
    redrawBase,
    compositeBase,
    shared: redrawShared,
  },
  effectsBuilderArgs: {
    cursorUiOptions: {
      cursorEffectsOptions,
      uiEffectsOptions,
    },
    resizeCenterOptions,
  },
});
