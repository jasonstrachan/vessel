import type {
  RuntimeBridgeArgs,
  UseDrawingHandlersRuntimeSetupBridgeOptions,
} from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge.types';

interface BuildDrawingHandlersPlaybackHandlersOptions {
  project: UseDrawingHandlersRuntimeSetupBridgeOptions['project'];
  storeRef: UseDrawingHandlersRuntimeSetupBridgeOptions['storeRef'];
  shapeMode: UseDrawingHandlersRuntimeSetupBridgeOptions['shapeMode'];
  brushEngine: UseDrawingHandlersRuntimeSetupBridgeOptions['brushEngine'];
  colorCycleRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['colorCycleRuntime'];
  feedbackMessageRef: UseDrawingHandlersRuntimeSetupBridgeOptions['feedbackMessageRef'];
}

export const buildDrawingHandlersPlaybackHandlersOptions = ({
  project,
  storeRef,
  shapeMode,
  brushEngine,
  colorCycleRuntime,
  feedbackMessageRef,
}: BuildDrawingHandlersPlaybackHandlersOptions): RuntimeBridgeArgs['playbackHandlersOptions'] => ({
  playbackRuntimeOptions: {
    brushEngine:
      brushEngine as RuntimeBridgeArgs['playbackHandlersOptions']['playbackRuntimeOptions']['brushEngine'],
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
