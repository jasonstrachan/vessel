import type { useColorCyclePlaybackHandlers } from '@/hooks/canvas/useColorCyclePlaybackHandlers';
import { CC_DEBUG } from '@/debug/ccDebug';

type PlaybackHandlerArgs = Parameters<typeof useColorCyclePlaybackHandlers>[0];

export type BuildColorCyclePlaybackHandlerArgsInput =
  PlaybackHandlerArgs['startCoreArgs'] &
  Omit<PlaybackHandlerArgs['startWrapperArgs']['traceArgs'], 'ccDebug'> &
  Omit<PlaybackHandlerArgs['playbackArgs'], 'skipCcLogThrottleMs'> & {
    skipCcLogThrottleMs: number;
  };

export const buildColorCyclePlaybackHandlerArgs = (
  args: BuildColorCyclePlaybackHandlerArgsInput
): PlaybackHandlerArgs => {
  const {
    brushEngine,
    ensureOverlayInitialized,
    renderAllColorCycleLayers,
    storeRef,
    getEffectiveColorCyclePlaying,
    cancelDeferredOverlayRender,
    scheduleDeferredOverlayRender,
    ccLog,
    ccGroup,
    ccGroupEnd,
    dumpLayerFlags,
    debugWarn,
    continuousColorCycleAnimationRef,
    continuousColorCycleAnimationActiveRef,
    startingColorCycleAnimationRef,
    lastStartAtRef,
    drawingCanvasRef,
    drawingCtxRef,
    drawingCanvasHasContent,
    firstPaintRef,
    lastRendererLogTS,
    startCooldownMs,
    startingRef,
    animationHandleRef,
    traceStateRef,
    throttleMs,
    startPlaybackRef,
    project,
    startupKickDoneRef,
    skipStartLogAtRef,
    skipStopLogAtRef,
    skipCcLogThrottleMs,
    stopContinuousColorCycleAnimation,
    initDrawingCanvas,
    shapeMode,
  } = args;

  return {
    startCoreArgs: {
      brushEngine,
      ensureOverlayInitialized,
      renderAllColorCycleLayers,
      storeRef,
      getEffectiveColorCyclePlaying,
      cancelDeferredOverlayRender,
      scheduleDeferredOverlayRender,
      ccLog,
      ccGroup,
      ccGroupEnd,
      dumpLayerFlags,
      debugWarn,
      continuousColorCycleAnimationRef,
      continuousColorCycleAnimationActiveRef,
      startingColorCycleAnimationRef,
      lastStartAtRef,
      drawingCanvasRef,
      drawingCtxRef,
      drawingCanvasHasContent,
      firstPaintRef,
      lastRendererLogTS,
      startCooldownMs,
    },
    startWrapperArgs: {
      traceArgs: {
        ccDebug: CC_DEBUG,
        startingRef,
        animationHandleRef,
        traceStateRef,
        throttleMs,
      },
    },
    playbackArgs: {
      startPlaybackRef,
      cancelDeferredOverlayRender,
      project,
      ensureOverlayInitialized,
      getEffectiveColorCyclePlaying,
      startupKickDoneRef,
      storeRef,
      continuousColorCycleAnimationActiveRef,
      startingColorCycleAnimationRef,
      skipStartLogAtRef,
      skipStopLogAtRef,
      skipCcLogThrottleMs,
      ccLog,
      stopContinuousColorCycleAnimation,
      drawingCtxRef,
      drawingCanvasRef,
      drawingCanvasHasContent,
      initDrawingCanvas,
      shapeMode,
    },
  };
};
