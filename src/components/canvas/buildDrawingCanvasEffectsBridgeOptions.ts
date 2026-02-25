import { useDrawingCanvasEffectsBridge } from './useDrawingCanvasEffectsBridge';

type EffectsBridgeOptions = Parameters<typeof useDrawingCanvasEffectsBridge>[0];

type BuildEffectsBridgeOptionsArgs = {
  redrawEffectsOptions: EffectsBridgeOptions['redrawEffectsOptions'];
  interactionBridgeOptions: EffectsBridgeOptions['interactionBridgeOptions'];
  inputBridgeOptions: EffectsBridgeOptions['inputBridgeOptions'];
  compositeRebuildOptions: EffectsBridgeOptions['compositeRebuildOptions'];
  cursorUiOptions: {
    cursorEffectsOptions: EffectsBridgeOptions['cursorEffectsOptions'];
    uiEffectsOptions: EffectsBridgeOptions['uiEffectsOptions'];
  };
  resizeCenterOptions: EffectsBridgeOptions['resizeCenterOptions'];
};

export const buildDrawingCanvasEffectsBridgeOptions = ({
  redrawEffectsOptions,
  interactionBridgeOptions,
  inputBridgeOptions,
  compositeRebuildOptions,
  cursorUiOptions,
  resizeCenterOptions,
}: BuildEffectsBridgeOptionsArgs): EffectsBridgeOptions => ({
  redrawEffectsOptions,
  interactionBridgeOptions,
  inputBridgeOptions,
  cursorEffectsOptions: cursorUiOptions.cursorEffectsOptions,
  compositeRebuildOptions,
  uiEffectsOptions: cursorUiOptions.uiEffectsOptions,
  resizeCenterOptions,
});
