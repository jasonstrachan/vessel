import { buildDrawingCanvasEffectsBridgeOptions } from './buildDrawingCanvasEffectsBridgeOptions';
import { useDrawingCanvasEffectsBridge } from './useDrawingCanvasEffectsBridge';
import { useDrawingCanvasInputBridgeOptions } from './useDrawingCanvasInputBridgeOptions';
import { useDrawingCanvasInteractionBridgeOptions } from './useDrawingCanvasInteractionBridgeOptions';
import { useDrawingCanvasRedrawCompositeOptions } from './useDrawingCanvasRedrawCompositeOptions';

type InputBridgeOptionsArgs = Parameters<typeof useDrawingCanvasInputBridgeOptions>[0];
type InteractionBridgeOptionsArgs = Parameters<typeof useDrawingCanvasInteractionBridgeOptions>[0];
type RedrawCompositeOptionsArgs = Parameters<typeof useDrawingCanvasRedrawCompositeOptions>[0];
type EffectsBuilderArgs = Omit<
  Parameters<typeof buildDrawingCanvasEffectsBridgeOptions>[0],
  'inputBridgeOptions' | 'interactionBridgeOptions' | 'redrawEffectsOptions' | 'compositeRebuildOptions'
>;

export interface UseDrawingCanvasRuntimeEffectsBridgeOptions {
  inputBridgeOptionsArgs: InputBridgeOptionsArgs;
  interactionBridgeOptionsArgs: InteractionBridgeOptionsArgs;
  redrawCompositeOptionsArgs: RedrawCompositeOptionsArgs;
  effectsBuilderArgs: EffectsBuilderArgs;
}

export const useDrawingCanvasRuntimeEffectsBridge = ({
  inputBridgeOptionsArgs,
  interactionBridgeOptionsArgs,
  redrawCompositeOptionsArgs,
  effectsBuilderArgs,
}: UseDrawingCanvasRuntimeEffectsBridgeOptions) => {
  const inputBridgeOptions = useDrawingCanvasInputBridgeOptions(inputBridgeOptionsArgs);
  const interactionBridgeOptions = useDrawingCanvasInteractionBridgeOptions(
    interactionBridgeOptionsArgs
  );
  const { redrawEffectsOptions, compositeRebuildOptions } =
    useDrawingCanvasRedrawCompositeOptions(redrawCompositeOptionsArgs);

  const effectsBridgeOptions = buildDrawingCanvasEffectsBridgeOptions({
    ...effectsBuilderArgs,
    inputBridgeOptions,
    interactionBridgeOptions,
    redrawEffectsOptions,
    compositeRebuildOptions,
  });

  return useDrawingCanvasEffectsBridge(effectsBridgeOptions);
};
