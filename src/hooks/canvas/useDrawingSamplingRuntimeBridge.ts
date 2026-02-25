import { useBrushSamplingCallbacks } from '@/hooks/canvas/useBrushSamplingCallbacks';
import { useCcGradientSamplingCallbacks } from '@/hooks/canvas/useCcGradientSamplingCallbacks';
import { useCcGradientSourceResetEffect } from '@/hooks/canvas/useCcGradientSourceResetEffect';
import { useSamplingCoreCallbacks } from '@/hooks/canvas/useSamplingCoreCallbacks';

interface UseDrawingSamplingRuntimeBridgeOptions {
  samplingCoreOptions: Parameters<typeof useSamplingCoreCallbacks>[0];
  ccGradientSamplingOptions: Omit<Parameters<typeof useCcGradientSamplingCallbacks>[0], 'sampleHexAt'>;
  brushSamplingOptions: Parameters<typeof useBrushSamplingCallbacks>[0];
  ccGradientResetOptions: Omit<
    Parameters<typeof useCcGradientSourceResetEffect>[0],
    'resetCcGradientSample' | 'clearBrushSamplingPreview'
  >;
}

export const useDrawingSamplingRuntimeBridge = ({
  samplingCoreOptions,
  ccGradientSamplingOptions,
  brushSamplingOptions,
  ccGradientResetOptions,
}: UseDrawingSamplingRuntimeBridgeOptions) => {
  const { sampleHexAt, computeAutoSampleStops } = useSamplingCoreCallbacks(samplingCoreOptions);

  const {
    updateCcGradientSample,
    resetCcGradientSample,
    getCcGradientSampleStops,
    updateCcSampledGradient,
    setSharedColorCycleGradientForShapes,
  } = useCcGradientSamplingCallbacks({
    ...ccGradientSamplingOptions,
    sampleHexAt,
  });

  const {
    renderBrushSamplingPreview,
    clearBrushSamplingPreview,
    resetAutoSampleState,
    updateAutoSampledGradient,
    updateDitherGradSamples,
  } = useBrushSamplingCallbacks(brushSamplingOptions);

  useCcGradientSourceResetEffect({
    ...ccGradientResetOptions,
    resetCcGradientSample,
    clearBrushSamplingPreview,
  });

  return {
    sampleHexAt,
    computeAutoSampleStops,
    updateCcGradientSample,
    resetCcGradientSample,
    getCcGradientSampleStops,
    updateCcSampledGradient,
    setSharedColorCycleGradientForShapes,
    renderBrushSamplingPreview,
    clearBrushSamplingPreview,
    resetAutoSampleState,
    updateAutoSampledGradient,
    updateDitherGradSamples,
  };
};
