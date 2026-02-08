import { useDrawingPlaybackLifecycleEffects } from '@/hooks/canvas/useDrawingPlaybackLifecycleEffects';
import { useDrawingPlaybackOverlayEffects } from '@/hooks/canvas/useDrawingPlaybackOverlayEffects';
import { useDrawingPlaybackStartupKickEffect } from '@/hooks/canvas/useDrawingPlaybackStartupKickEffect';
import { useDrawingPlaybackStoreTraceEffect } from '@/hooks/canvas/useDrawingPlaybackStoreTraceEffect';
import { useDrawingPlaybackSyncEffect } from '@/hooks/canvas/useDrawingPlaybackSyncEffect';
import type { UseDrawingPlaybackEffectsOptions } from '@/hooks/canvas/useDrawingPlaybackEffects.types';

export const useDrawingPlaybackEffects = ({
  startPlaybackRef,
  startContinuousColorCycleAnimation,
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
}: UseDrawingPlaybackEffectsOptions) => {
  useDrawingPlaybackLifecycleEffects({
    startPlaybackRef,
    startContinuousColorCycleAnimation,
    cancelDeferredOverlayRender,
  });

  useDrawingPlaybackStartupKickEffect({
    project,
    ensureOverlayInitialized,
    getEffectiveColorCyclePlaying,
    startupKickDoneRef,
    startContinuousColorCycleAnimation,
  });

  useDrawingPlaybackSyncEffect({
    startContinuousColorCycleAnimation,
    stopContinuousColorCycleAnimation,
    getEffectiveColorCyclePlaying,
    storeRef,
    continuousColorCycleAnimationActiveRef,
    startingColorCycleAnimationRef,
    skipStartLogAtRef,
    skipStopLogAtRef,
    skipCcLogThrottleMs,
    ccLog,
  });

  // Keep overlay/init effects isolated from playback/store sync effects.
  useDrawingPlaybackOverlayEffects({
    drawingCtxRef,
    drawingCanvasRef,
    drawingCanvasHasContent,
    initDrawingCanvas,
    shapeMode,
  });

  useDrawingPlaybackStoreTraceEffect({ storeRef, ccLog });
};
