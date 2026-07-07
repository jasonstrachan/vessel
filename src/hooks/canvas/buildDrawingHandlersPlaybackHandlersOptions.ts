import type {
  RuntimeBridgeArgs,
  UseDrawingHandlersRuntimeSetupBridgeOptions,
} from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge.types';

interface BuildDrawingHandlersPlaybackHandlersOptions {
  project: UseDrawingHandlersRuntimeSetupBridgeOptions['project'];
  storeRef: UseDrawingHandlersRuntimeSetupBridgeOptions['storeRef'];
  shapeMode: UseDrawingHandlersRuntimeSetupBridgeOptions['shapeMode'];
  brushRuntime: RuntimeBridgeArgs['playbackHandlersOptions']['playbackRuntimeOptions']['brushRuntime'];
  colorCycleRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['colorCycleRuntime'];
  feedbackMessageRef: UseDrawingHandlersRuntimeSetupBridgeOptions['feedbackMessageRef'];
}

export const buildDrawingHandlersPlaybackHandlersOptions = ({
  project,
  storeRef,
  shapeMode,
  brushRuntime,
  colorCycleRuntime,
  feedbackMessageRef,
}: BuildDrawingHandlersPlaybackHandlersOptions): RuntimeBridgeArgs['playbackHandlersOptions'] => ({
  playbackRuntimeOptions: {
    brushRuntime: {
      isColorCycleAnimating: brushRuntime.isColorCycleAnimating,
      updateColorCycleAnimation: brushRuntime.updateColorCycleAnimation,
      renderColorCycle: brushRuntime.renderColorCycle,
    },
    ensureOverlayInitialized: colorCycleRuntime.ensureOverlayInitialized,
    renderAllColorCycleLayers: colorCycleRuntime.renderAllColorCycleLayers,
    storeRef,
    getEffectiveColorCyclePlaying: colorCycleRuntime.getEffectiveColorCyclePlaying,
    cancelDeferredOverlayRender: colorCycleRuntime.cancelDeferredOverlayRender,
    scheduleDeferredOverlayRender: colorCycleRuntime.scheduleDeferredOverlayRender,
    project,
    stopContinuousColorCycleAnimation: colorCycleRuntime.stopContinuousColorCycleAnimation,
    initDrawingCanvas: colorCycleRuntime.initDrawingCanvas,
    shapeMode,
  },
  feedbackMessageRef,
});
