import { CC_DEBUG, ccGroup, ccGroupEnd, ccLog, dumpLayerFlags } from '@/debug/ccDebug';
import { SYNTHETIC_CC_STOP_REASONS, SYNTHETIC_STOP_THROTTLE_MS, STOP_COOLDOWN_MS } from '@/hooks/canvas/drawingHandlersConfig';
import { useColorCycleRuntimeControllers } from '@/hooks/canvas/useColorCycleRuntimeControllers';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { getMaskManager } from '@/layers/MaskManager';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type ControllerArgs = Parameters<typeof useColorCycleRuntimeControllers>[0];

type UseDrawingColorCycleRuntimeControllersArgs = {
  refs: DrawingHandlerRefs;
  storeRef: ControllerArgs['pauseAllBrushArgs']['storeRef'];
  getEffectiveColorCyclePlaying: ControllerArgs['pauseAllBrushArgs']['getEffectiveColorCyclePlaying'];
};

export const useDrawingColorCycleRuntimeControllers = ({
  refs,
  storeRef,
  getEffectiveColorCyclePlaying,
}: UseDrawingColorCycleRuntimeControllersArgs) => {
  const cancelAnimationFrameSafe: ControllerArgs['pauseAllBrushArgs']['cancelAnimationFrame'] =
    typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function'
      ? window.cancelAnimationFrame.bind(window)
      : () => {};

  return useColorCycleRuntimeControllers({
    pauseAllBrushArgs: {
      pausedCCLayerIdsRef: refs.pausedCCLayerIdsRef,
      recolorWasAnimatingRef: refs.recolorWasAnimatingRef,
      storeRef,
      getEffectiveColorCyclePlaying,
      getColorCycleBrushManager,
      continuousColorCycleAnimationRef: refs.continuousColorCycleAnimationRef,
      continuousColorCycleAnimationActiveRef: refs.continuousColorCycleAnimationActiveRef,
      cancelAnimationFrame: cancelAnimationFrameSafe,
      ccGroup,
      ccGroupEnd,
      ccLog,
      dumpLayerFlags,
    },
    runtimeDispatchersArgs: {
      shouldResumeRef: refs.shouldResumeColorCycleAfterInteractionRef,
      recolorWasAnimatingRef: refs.recolorWasAnimatingRef,
      storeRef,
      getEffectiveColorCyclePlaying,
      ccLog,
      ccGroup,
      ccGroupEnd,
      dumpLayerFlags,
      maskManager: getMaskManager(),
      renderAllCCLogTSRef: refs.renderAllCCLogTSRef,
      deferredOverlayRenderHandleRef: refs.deferredOverlayRenderHandleRef,
      deferredOverlayRenderKindRef: refs.deferredOverlayRenderKindRef,
      continuousColorCycleAnimationActiveRef: refs.continuousColorCycleAnimationActiveRef,
      continuousColorCycleAnimationRef: refs.continuousColorCycleAnimationRef,
      colorCycleAnimationRef: refs.colorCycleAnimationRef,
      drawingCtxRef: refs.drawingCtxRef,
      drawingCanvasRef: refs.drawingCanvasRef,
      drawingCanvasHasContent: refs.drawingCanvasHasContent,
      lastStopAtRef: refs.lastStopAtRef,
      stopCooldownMs: STOP_COOLDOWN_MS,
      syntheticStopThrottleMs: SYNTHETIC_STOP_THROTTLE_MS,
      syntheticStopReasons: SYNTHETIC_CC_STOP_REASONS,
    },
    stopAnimationArgs: {
      traceArgs: {
      ccDebug: CC_DEBUG,
      },
    },
  });
};
