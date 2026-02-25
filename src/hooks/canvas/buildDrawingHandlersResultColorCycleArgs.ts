import type { UseDrawingHandlersResultArgsBridgeOptions } from '@/hooks/canvas/useDrawingHandlersResultArgsBridge.types';

interface BuildDrawingHandlersResultColorCycleArgsOptions {
  colorCycleRuntime: UseDrawingHandlersResultArgsBridgeOptions['colorCycleRuntime'];
}

export const buildDrawingHandlersResultColorCycleArgs = ({
  colorCycleRuntime,
}: BuildDrawingHandlersResultColorCycleArgsOptions) => ({
  initDrawingCanvas: colorCycleRuntime.initDrawingCanvas,
  stopContinuousColorCycleAnimation: colorCycleRuntime.stopContinuousColorCycleAnimation,
  resumeColorCycleAfterInteraction: colorCycleRuntime.resumeColorCycleAfterInteraction,
  commitRasterOverlay: colorCycleRuntime.commitRasterOverlay,
  updateDitherGradSamples: colorCycleRuntime.updateDitherGradSamples,
  getCcGradientSampleStops: colorCycleRuntime.getCcGradientSampleStops,
});
