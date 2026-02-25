import { useColorCycleHistoryRuntime } from '@/hooks/canvas/useColorCycleHistoryRuntime';
import { useColorCycleRuntimeBindings } from '@/hooks/canvas/useColorCycleRuntimeBindings';
import { useCcGradientSampleSessionRef } from '@/hooks/canvas/useCcGradientSampleSessionRef';
import { useDrawingSamplingRuntimeBridge } from '@/hooks/canvas/useDrawingSamplingRuntimeBridge';
import { useDrawingColorCycleOverlayRuntimeBridge } from '@/hooks/canvas/useDrawingColorCycleOverlayRuntimeBridge';
import { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type ColorCycleHistoryRuntimeArgs = Parameters<typeof useColorCycleHistoryRuntime>[0];
type DrawingSamplingRuntimeArgs = Parameters<typeof useDrawingSamplingRuntimeBridge>[0];
type DrawingColorCycleOverlayRuntimeArgs = Parameters<typeof useDrawingColorCycleOverlayRuntimeBridge>[0];
type ColorCycleRuntimeBindingsArgs = Parameters<typeof useColorCycleRuntimeBindings>[0];

interface UseDrawingHandlersColorCycleBridgeOptions {
  refs: DrawingHandlerRefs;
  colorCycleBindingsOptions: ColorCycleRuntimeBindingsArgs;
  colorCycleHistoryOptions: ColorCycleHistoryRuntimeArgs;
  drawingSamplingOptions: Omit<DrawingSamplingRuntimeArgs, 'ccGradientSamplingOptions'> & {
    ccGradientSamplingOptions: Omit<DrawingSamplingRuntimeArgs['ccGradientSamplingOptions'], 'ccGradientSampleSessionRef'>;
  };
  colorCycleOverlayOptions: Omit<DrawingColorCycleOverlayRuntimeArgs, 'refs' | 'getEffectiveColorCyclePlaying'>;
}

export const useDrawingHandlersColorCycleBridge = ({
  refs,
  colorCycleBindingsOptions,
  colorCycleHistoryOptions,
  drawingSamplingOptions,
  colorCycleOverlayOptions,
}: UseDrawingHandlersColorCycleBridgeOptions) => {
  const { getEffectiveColorCyclePlaying, getBrushForLayer, scheduleRecompose } =
    useColorCycleRuntimeBindings(colorCycleBindingsOptions);

  const {
    finalizeQueueRef,
    scheduleHistoryCommit,
    commitRasterOverlay,
    scheduleDeferredColorCycleSave,
    scheduleDeferredColorCycleSaveWithState,
  } = useColorCycleHistoryRuntime(colorCycleHistoryOptions);

  const ccGradientSampleSessionRef = useCcGradientSampleSessionRef();

  const {
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
  } = useDrawingSamplingRuntimeBridge({
    ...drawingSamplingOptions,
    ccGradientSamplingOptions: {
      ...drawingSamplingOptions.ccGradientSamplingOptions,
      ccGradientSampleSessionRef,
    },
  });

  const {
    pauseColorCycleForNonCCInteraction,
    resumeColorCycleAfterInteraction,
    renderAllColorCycleLayers,
    cancelDeferredOverlayRender,
    scheduleDeferredOverlayRender,
    stopContinuousColorCycleAnimation,
    initDrawingCanvas,
    ensureOverlayInitialized,
  } = useDrawingColorCycleOverlayRuntimeBridge({
    refs,
    ...colorCycleOverlayOptions,
    getEffectiveColorCyclePlaying,
  });

  return {
    getEffectiveColorCyclePlaying,
    getBrushForLayer,
    scheduleRecompose,
    finalizeQueueRef,
    scheduleHistoryCommit,
    commitRasterOverlay,
    scheduleDeferredColorCycleSave,
    scheduleDeferredColorCycleSaveWithState,
    ccGradientSampleSessionRef,
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
    pauseColorCycleForNonCCInteraction,
    resumeColorCycleAfterInteraction,
    renderAllColorCycleLayers,
    cancelDeferredOverlayRender,
    scheduleDeferredOverlayRender,
    stopContinuousColorCycleAnimation,
    initDrawingCanvas,
    ensureOverlayInitialized,
  };
};
