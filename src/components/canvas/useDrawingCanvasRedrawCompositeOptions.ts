import { useDrawingCanvasEffectsBridge } from './useDrawingCanvasEffectsBridge';

type EffectsBridgeOptions = Parameters<typeof useDrawingCanvasEffectsBridge>[0];

interface UseDrawingCanvasRedrawCompositeOptionsArgs {
  redrawBase: Omit<
    EffectsBridgeOptions['redrawEffectsOptions'],
    'setLayersNeedRecomposition' | 'setNeedsRedraw'
  >;
  compositeBase: Omit<
    EffectsBridgeOptions['compositeRebuildOptions'],
    'setLayersNeedRecomposition' | 'setNeedsRedraw'
  >;
  shared: {
    setLayersNeedRecomposition: EffectsBridgeOptions['compositeRebuildOptions']['setLayersNeedRecomposition'];
    setNeedsRedraw: EffectsBridgeOptions['redrawEffectsOptions']['setNeedsRedraw'];
  };
}

export const useDrawingCanvasRedrawCompositeOptions = ({
  redrawBase,
  compositeBase,
  shared,
}: UseDrawingCanvasRedrawCompositeOptionsArgs) => ({
  redrawEffectsOptions: {
    ...redrawBase,
    setNeedsRedraw: shared.setNeedsRedraw,
  },
  compositeRebuildOptions: {
    ...compositeBase,
    ...shared,
  },
});
