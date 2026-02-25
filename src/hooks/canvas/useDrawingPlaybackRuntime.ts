import { useColorCyclePlaybackRuntime } from '@/hooks/canvas/useColorCyclePlaybackRuntime';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import { ccGroup, ccGroupEnd, ccLog, dumpLayerFlags } from '@/debug/ccDebug';
import { debugWarn } from '@/utils/debug';
import {
  SKIP_CC_LOG_THROTTLE_MS,
  START_CC_COOLDOWN_MS,
  START_CC_TRACE_THROTTLE_MS,
} from '@/hooks/canvas/drawingHandlersConfig';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type PlaybackArgs = Parameters<typeof useColorCyclePlaybackRuntime>[0];

type UseDrawingPlaybackRuntimeArgs = {
  refs: DrawingHandlerRefs;
  brushEngine: PlaybackArgs['brushEngine'];
  ensureOverlayInitialized: PlaybackArgs['ensureOverlayInitialized'];
  renderAllColorCycleLayers: PlaybackArgs['renderAllColorCycleLayers'];
  storeRef: PlaybackArgs['storeRef'];
  getEffectiveColorCyclePlaying: PlaybackArgs['getEffectiveColorCyclePlaying'];
  cancelDeferredOverlayRender: PlaybackArgs['cancelDeferredOverlayRender'];
  scheduleDeferredOverlayRender: PlaybackArgs['scheduleDeferredOverlayRender'];
  project: PlaybackArgs['project'];
  stopContinuousColorCycleAnimation: PlaybackArgs['stopContinuousColorCycleAnimation'];
  initDrawingCanvas: PlaybackArgs['initDrawingCanvas'];
  shapeMode: PlaybackArgs['shapeMode'];
};

export const useDrawingPlaybackRuntime = ({
  refs,
  brushEngine,
  ensureOverlayInitialized,
  renderAllColorCycleLayers,
  storeRef,
  getEffectiveColorCyclePlaying,
  cancelDeferredOverlayRender,
  scheduleDeferredOverlayRender,
  project,
  stopContinuousColorCycleAnimation,
  initDrawingCanvas,
  shapeMode,
}: UseDrawingPlaybackRuntimeArgs) =>
  useColorCyclePlaybackRuntime({
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
    continuousColorCycleAnimationRef: refs.continuousColorCycleAnimationRef,
    continuousColorCycleAnimationActiveRef: refs.continuousColorCycleAnimationActiveRef,
    startingColorCycleAnimationRef: refs.startingColorCycleAnimationRef,
    lastStartAtRef: refs.lastStartAtRef,
    drawingCanvasRef: refs.drawingCanvasRef,
    drawingCtxRef: refs.drawingCtxRef,
    drawingCanvasHasContent: refs.drawingCanvasHasContent,
    firstPaintRef: refs.firstPaintRef,
    lastRendererLogTS: refs.lastRendererLogTS,
    startCooldownMs: START_CC_COOLDOWN_MS,
    startingRef: refs.startingColorCycleAnimationRef,
    animationHandleRef: refs.continuousColorCycleAnimationRef,
    traceStateRef: refs.startContinuousColorCycleTraceStateRef,
    throttleMs: START_CC_TRACE_THROTTLE_MS,
    startPlaybackRef: refs.startPlaybackRef,
    project,
    startupKickDoneRef: refs.startupKickDoneRef,
    skipStartLogAtRef: refs.skipStartLogAtRef,
    skipStopLogAtRef: refs.skipStopLogAtRef,
    skipCcLogThrottleMs: SKIP_CC_LOG_THROTTLE_MS,
    stopContinuousColorCycleAnimation,
    initDrawingCanvas,
    shapeMode,
  });
