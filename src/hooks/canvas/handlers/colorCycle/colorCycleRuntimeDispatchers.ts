import type React from 'react';
import type { AppState, CCReason } from '@/stores/useAppStore';
import {
  pauseColorCycleForNonCCInteraction,
  resumeColorCycleAfterInteraction,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleInteraction';
import {
  cancelDeferredOverlayRender,
  renderAllColorCycleLayers,
  scheduleDeferredOverlayRender,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleRender';
import { stopContinuousColorCycleAnimationCore } from '@/hooks/canvas/handlers/colorCycle/colorCyclePlayback';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { MaskManager } from '@/layers/MaskManager';
import { bindBrushToCanvas, refreshLayerCCSurface } from '@/hooks/canvas/handlers/colorCycle/colorCycleSurface';

export type CreateColorCycleRuntimeDispatchersArgs = {
  shouldResumeRef: React.MutableRefObject<boolean>;
  recolorWasAnimatingRef: React.MutableRefObject<boolean>;
  storeRef: React.MutableRefObject<AppState>;
  getEffectiveColorCyclePlaying: () => boolean;
  pauseAllBrushCCAnimationsNow: () => boolean;
  ccLog: (label: string, payload?: Record<string, unknown>) => void;
  ccGroup: (label: string, payload?: Record<string, unknown>) => void;
  ccGroupEnd: () => void;
  dumpLayerFlags: () => void;
  maskManager: MaskManager;
  renderAllCCLogTSRef: React.MutableRefObject<number>;
  deferredOverlayRenderHandleRef: React.MutableRefObject<number | null>;
  deferredOverlayRenderKindRef: React.MutableRefObject<'idle' | 'timeout' | null>;
  dispatchFrameUpdate: () => void;
  continuousColorCycleAnimationActiveRef: React.MutableRefObject<boolean>;
  continuousColorCycleAnimationRef: React.MutableRefObject<number | null>;
  colorCycleAnimationRef: React.MutableRefObject<number | null>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  lastStopAtRef: React.MutableRefObject<number>;
  stopCooldownMs: number;
  syntheticStopThrottleMs: number;
  syntheticStopReasons: Set<string>;
};

export const createColorCycleRuntimeDispatchers = (
  args: CreateColorCycleRuntimeDispatchersArgs
): {
  pauseColorCycleForNonCCInteraction: (reason?: CCReason) => void;
  resumeColorCycleAfterInteraction: () => Promise<void>;
  renderAllColorCycleLayers: (targetCtx?: CanvasRenderingContext2D, onlyActiveLayer?: boolean) => boolean;
  cancelDeferredOverlayRender: () => void;
  scheduleDeferredOverlayRender: () => void;
  stopContinuousColorCycleAnimationCore: (reason?: string) => void;
} => {
  const renderAllColorCycleLayersHandler = (
    targetCtx?: CanvasRenderingContext2D,
    onlyActiveLayer: boolean = false
  ): boolean =>
    renderAllColorCycleLayers(
      {
        storeRef: args.storeRef,
        maskManager: args.maskManager,
        renderAllCCLogTSRef: args.renderAllCCLogTSRef,
        ccLog: args.ccLog,
        getColorCycleBrushManager,
        refreshLayerCCSurface,
        bindBrushToCanvas,
      },
      targetCtx,
      onlyActiveLayer
    );

  const cancelDeferredOverlayRenderHandler = (): void => {
    cancelDeferredOverlayRender({
      deferredOverlayRenderHandleRef: args.deferredOverlayRenderHandleRef,
      deferredOverlayRenderKindRef: args.deferredOverlayRenderKindRef,
    });
  };

  return {
    pauseColorCycleForNonCCInteraction: (reason: CCReason = 'shape-preview') => {
      pauseColorCycleForNonCCInteraction({
        reason,
        shouldResumeRef: args.shouldResumeRef,
        recolorWasAnimatingRef: args.recolorWasAnimatingRef,
        storeRef: args.storeRef,
        getEffectiveColorCyclePlaying: args.getEffectiveColorCyclePlaying,
        pauseAllBrushCCAnimationsNow: args.pauseAllBrushCCAnimationsNow,
        ccLog: args.ccLog,
      });
    },
    resumeColorCycleAfterInteraction: async () => {
      await resumeColorCycleAfterInteraction({
        shouldResumeRef: args.shouldResumeRef,
        storeRef: args.storeRef,
        getEffectiveColorCyclePlaying: args.getEffectiveColorCyclePlaying,
        ccGroup: args.ccGroup,
        ccGroupEnd: args.ccGroupEnd,
        ccLog: args.ccLog,
      });
    },
    renderAllColorCycleLayers: renderAllColorCycleLayersHandler,
    cancelDeferredOverlayRender: cancelDeferredOverlayRenderHandler,
    scheduleDeferredOverlayRender: () => {
      scheduleDeferredOverlayRender({
        deferredOverlayRenderHandleRef: args.deferredOverlayRenderHandleRef,
        deferredOverlayRenderKindRef: args.deferredOverlayRenderKindRef,
        renderAllColorCycleLayers: renderAllColorCycleLayersHandler,
        cancelDeferredOverlayRender: cancelDeferredOverlayRenderHandler,
        dispatchFrameUpdate: args.dispatchFrameUpdate,
      });
    },
    stopContinuousColorCycleAnimationCore: (reason = 'unknown') => {
      stopContinuousColorCycleAnimationCore(reason, {
        cancelDeferredOverlayRender: cancelDeferredOverlayRenderHandler,
        storeRef: args.storeRef,
        ccLog: args.ccLog,
        ccGroup: args.ccGroup,
        ccGroupEnd: args.ccGroupEnd,
        dumpLayerFlags: args.dumpLayerFlags,
        pauseAllBrushCCAnimationsNow: args.pauseAllBrushCCAnimationsNow,
        continuousColorCycleAnimationActiveRef: args.continuousColorCycleAnimationActiveRef,
        continuousColorCycleAnimationRef: args.continuousColorCycleAnimationRef,
        colorCycleAnimationRef: args.colorCycleAnimationRef,
        shouldResumeColorCycleAfterInteractionRef: args.shouldResumeRef,
        drawingCtxRef: args.drawingCtxRef,
        drawingCanvasRef: args.drawingCanvasRef,
        drawingCanvasHasContent: args.drawingCanvasHasContent,
        lastStopAtRef: args.lastStopAtRef,
        stopCooldownMs: args.stopCooldownMs,
        syntheticStopThrottleMs: args.syntheticStopThrottleMs,
        syntheticStopReasons: args.syntheticStopReasons,
      });
    },
  };
};
