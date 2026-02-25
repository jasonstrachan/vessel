import type { UseDrawingCanvasRenderSetupBridgeOptions } from './useDrawingCanvasRenderSetupBridge';

type LayerRenderShared = Pick<
  UseDrawingCanvasRenderSetupBridgeOptions['layerRenderingOptions'],
  'project' | 'layers' | 'activeLayerId' | 'brushShape' | 'antialiasing' | 'displayMode' | 'layerTransferCacheRef'
>;

interface BuildDrawingCanvasRenderSetupOptionsArgs {
  layers: UseDrawingCanvasRenderSetupBridgeOptions['layers'];
  referenceLayerId: UseDrawingCanvasRenderSetupBridgeOptions['referenceLayerId'];
  preferReferenceSampling: UseDrawingCanvasRenderSetupBridgeOptions['preferReferenceSampling'];
  compositeCanvasRef: UseDrawingCanvasRenderSetupBridgeOptions['compositeCanvasRef'];
  layerRenderShared: LayerRenderShared;
  staticCompositeOptions: Pick<
    UseDrawingCanvasRenderSetupBridgeOptions['compositeBuffersOptions'],
    | 'underCompositeCanvasRef'
    | 'overCompositeCanvasRef'
    | 'underCompositeHasContentRef'
    | 'overCompositeHasContentRef'
    | 'compositeCanvasRef'
    | 'renderStaticComposite'
    | 'setCurrentOffscreenCanvas'
  >;
  baseRendererOptions: Omit<
    UseDrawingCanvasRenderSetupBridgeOptions['baseRendererOptions'],
    | 'layers'
    | 'activeLayerId'
    | 'brushShape'
    | 'antialiasing'
    | 'layerTransferCacheRef'
    | 'compositeCanvasRef'
    | 'underCompositeCanvasRef'
    | 'underCompositeHasContentRef'
    | 'overCompositeCanvasRef'
    | 'overCompositeHasContentRef'
  >;
}

export const buildDrawingCanvasRenderSetupOptions = ({
  layers,
  referenceLayerId,
  preferReferenceSampling,
  compositeCanvasRef,
  layerRenderShared,
  staticCompositeOptions,
  baseRendererOptions,
}: BuildDrawingCanvasRenderSetupOptionsArgs): UseDrawingCanvasRenderSetupBridgeOptions => {
  const {
    layers: sharedLayers,
    activeLayerId,
    brushShape,
    antialiasing,
  } = layerRenderShared;

  return {
    layers,
    referenceLayerId,
    preferReferenceSampling,
    compositeCanvasRef,
    compositeBuffersOptions: {
      ...layerRenderShared,
      ...staticCompositeOptions,
    },
    layerRenderingOptions: {
      ...layerRenderShared,
    },
    baseRendererOptions: {
      ...baseRendererOptions,
      layers: sharedLayers,
      activeLayerId,
      brushShape,
      antialiasing,
      compositeCanvasRef,
      underCompositeCanvasRef: staticCompositeOptions.underCompositeCanvasRef,
      underCompositeHasContentRef: staticCompositeOptions.underCompositeHasContentRef,
      overCompositeCanvasRef: staticCompositeOptions.overCompositeCanvasRef,
      overCompositeHasContentRef: staticCompositeOptions.overCompositeHasContentRef,
    },
  };
};
