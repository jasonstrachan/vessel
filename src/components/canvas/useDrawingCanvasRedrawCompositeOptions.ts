import { useDrawingCanvasEffectsBridge } from './useDrawingCanvasEffectsBridge';

type EffectsBridgeOptions = Parameters<typeof useDrawingCanvasEffectsBridge>[0];

interface UseDrawingCanvasRedrawCompositeOptionsArgs {
  redrawBase: Omit<
    EffectsBridgeOptions['redrawEffectsOptions'],
    'setLayersNeedRecomposition' | 'setNeedsRedraw' | 'canvasRef' | 'drawRef' | 'viewTransformRef'
  >;
  compositeBase: Omit<
    EffectsBridgeOptions['compositeRebuildOptions'],
    'setLayersNeedRecomposition' | 'setNeedsRedraw' | 'canvasRef' | 'drawRef' | 'viewTransformRef'
  >;
  shared: Pick<
    EffectsBridgeOptions['redrawEffectsOptions'],
    'setLayersNeedRecomposition' | 'setNeedsRedraw' | 'canvasRef' | 'drawRef' | 'viewTransformRef'
  >;
}

export const useDrawingCanvasRedrawCompositeOptions = ({
  redrawBase,
  compositeBase,
  shared,
}: UseDrawingCanvasRedrawCompositeOptionsArgs) => ({
  redrawEffectsOptions: {
    ...redrawBase,
    ...shared,
  },
  compositeRebuildOptions: {
    ...compositeBase,
    ...shared,
  },
});
