import { useCallback, useMemo, useRef } from 'react';
import { drawVisibleCompositeStack } from './drawingCanvasCompositeStack';
import { useDrawingCanvasBaseRenderer } from './useDrawingCanvasBaseRenderer';
import { useDrawingCanvasCompositeBuffers } from './useDrawingCanvasCompositeBuffers';
import { useDrawingCanvasLayerRendering } from './useDrawingCanvasLayerRendering';
import { useDrawingCanvasSampling } from './useDrawingCanvasSampling';
import { buildLayersHash } from './layersHash';

type SamplingOptions = Parameters<typeof useDrawingCanvasSampling>[0];
type CompositeBuffersOptions = Parameters<typeof useDrawingCanvasCompositeBuffers>[0];
type LayerRenderingOptions = Parameters<typeof useDrawingCanvasLayerRendering>[0];
type BaseRendererOptions = Omit<
  Parameters<typeof useDrawingCanvasBaseRenderer>[0],
  'renderSplitComposites' | 'drawNonActiveVisibleLayers'
>;

export interface UseDrawingCanvasRenderSetupBridgeOptions {
  layers: LayerRenderingOptions['layers'];
  referenceLayerId: SamplingOptions['referenceLayerId'];
  preferReferenceSampling: SamplingOptions['preferReferenceSampling'];
  referenceAssets: SamplingOptions['referenceAssets'];
  referenceSamplingSource: SamplingOptions['referenceSamplingSource'];
  compositeCanvasRef: SamplingOptions['compositeCanvasRef'];
  compositeBuffersOptions: CompositeBuffersOptions;
  layerRenderingOptions: LayerRenderingOptions;
  baseRendererOptions: BaseRendererOptions;
}

export const useDrawingCanvasRenderSetupBridge = ({
  layers,
  referenceLayerId,
  preferReferenceSampling,
  referenceAssets,
  referenceSamplingSource,
  compositeCanvasRef,
  compositeBuffersOptions,
  layerRenderingOptions,
  baseRendererOptions,
}: UseDrawingCanvasRenderSetupBridgeOptions) => {
  const layersHash = useMemo(() => buildLayersHash(layers), [layers]);

  const lastSampleRef = useRef<{
    x: number;
    y: number;
    color: string;
    layerId: string | null;
    preferReference: boolean;
  }>({
    x: -1,
    y: -1,
    color: '#000000',
    layerId: null,
    preferReference: true,
  });

  const { renderSplitComposites, rebuildStaticComposite } = useDrawingCanvasCompositeBuffers(
    compositeBuffersOptions
  );

  const drawNonActiveVisibleLayers = useDrawingCanvasLayerRendering(layerRenderingOptions);
  const { compositeSegmentsRef, layerMapRef, compositeBitmap } = baseRendererOptions;
  const renderSamplingComposite = useCallback<NonNullable<SamplingOptions['renderSamplingComposite']>>(
    (context, region) => {
      drawVisibleCompositeStack({
        ctx: context,
        visibleRect: region,
        useSplitOverlay: false,
        underCompositeCanvas: null,
        isActivelyErasing: false,
        drawNonActiveVisibleLayers,
        segments: compositeSegmentsRef.current,
        layerMap: layerMapRef.current,
        compositeBitmap,
        compositeCanvas: compositeCanvasRef.current,
      });
    },
    [compositeBitmap, compositeCanvasRef, compositeSegmentsRef, drawNonActiveVisibleLayers, layerMapRef],
  );
  const { sampleColorAtPosition, sampleColorsAlongLine } = useDrawingCanvasSampling({
    compositeCanvasRef,
    renderSamplingComposite,
    lastSampleRef,
    layers,
    referenceLayerId,
    preferReferenceSampling,
    referenceAssets,
    referenceSamplingSource,
  });

  const drawBase = useDrawingCanvasBaseRenderer({
    ...baseRendererOptions,
    renderSplitComposites,
    drawNonActiveVisibleLayers,
  });

  return {
    layersHash,
    lastSampleRef,
    sampleColorAtPosition,
    sampleColorsAlongLine,
    renderSplitComposites,
    rebuildStaticComposite,
    drawBase,
  };
};
