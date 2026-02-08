import type React from 'react';
import { BrushShape, type Layer } from '@/types';
import type { AppState, CCReason } from '@/stores/useAppStore';
import {
  selectColorCycleSuspendDepth,
  selectEffectiveColorCyclePlaying,
  selectSequentialCaptureActive,
} from '@/stores/useAppStore';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import { clearSharedColorCycleRuntimeConsumer } from '@/hooks/canvas/handlers/colorCycle/colorCyclePlayback';

type PauseAllDeps = {
  pausedCCLayerIdsRef: React.MutableRefObject<string[]>;
  recolorWasAnimatingRef: React.MutableRefObject<boolean>;
  storeRef: React.MutableRefObject<AppState>;
  getEffectiveColorCyclePlaying: () => boolean;
  getColorCycleBrushManager: () => { getBrush: (layerId: string) => { pause?: () => void; stopAnimation?: () => void } | null | undefined };
  continuousColorCycleAnimationRef: React.MutableRefObject<number | null>;
  continuousColorCycleAnimationActiveRef: React.MutableRefObject<boolean>;
  cancelAnimationFrame: (handle: number) => void;
  ccGroup: (label: string, payload?: Record<string, unknown>) => void;
  ccGroupEnd: () => void;
  ccLog: (label: string, payload?: Record<string, unknown>) => void;
  dumpLayerFlags: () => void;
};

type ResumePausedDeps = {
  pausedCCLayerIdsRef: React.MutableRefObject<string[]>;
  recolorWasAnimatingRef: React.MutableRefObject<boolean>;
  storeRef: React.MutableRefObject<AppState>;
  getEffectiveColorCyclePlaying: () => boolean;
  getColorCycleBrushManager: () => { getBrush: (layerId: string) => { startAnimation?: () => void } | null | undefined };
};

type PauseDeps = {
  reason?: CCReason;
  shouldResumeRef: React.MutableRefObject<boolean>;
  recolorWasAnimatingRef: React.MutableRefObject<boolean>;
  storeRef: React.MutableRefObject<AppState>;
  getEffectiveColorCyclePlaying: () => boolean;
  pauseAllBrushCCAnimationsNow: () => boolean;
  ccLog: (label: string, payload?: Record<string, unknown>) => void;
};

type ResumeDeps = {
  shouldResumeRef: React.MutableRefObject<boolean>;
  storeRef: React.MutableRefObject<AppState>;
  getEffectiveColorCyclePlaying: () => boolean;
  ccGroup: (label: string, payload?: Record<string, unknown>) => void;
  ccGroupEnd: () => void;
  ccLog: (label: string, payload?: Record<string, unknown>) => void;
};

export type CreatePauseAllBrushCCAnimationsDispatcherArgs = {
  pausedCCLayerIdsRef: React.MutableRefObject<string[]>;
  recolorWasAnimatingRef: React.MutableRefObject<boolean>;
  storeRef: React.MutableRefObject<AppState>;
  getEffectiveColorCyclePlaying: () => boolean;
  getColorCycleBrushManager: () => { getBrush: (layerId: string) => { pause?: () => void; stopAnimation?: () => void } | null | undefined };
  continuousColorCycleAnimationRef: React.MutableRefObject<number | null>;
  continuousColorCycleAnimationActiveRef: React.MutableRefObject<boolean>;
  cancelAnimationFrame: (handle: number) => void;
  ccGroup: (label: string, payload?: Record<string, unknown>) => void;
  ccGroupEnd: () => void;
  ccLog: (label: string, payload?: Record<string, unknown>) => void;
  dumpLayerFlags: () => void;
};

export const pauseColorCycleForNonCCInteraction = ({
  reason = 'shape-preview',
  shouldResumeRef,
  recolorWasAnimatingRef,
  storeRef,
  getEffectiveColorCyclePlaying,
  pauseAllBrushCCAnimationsNow,
  ccLog,
}: PauseDeps): void => {
  if (shouldResumeRef.current) {
    ccLog('pauseColorCycleForNonCCInteraction: already scheduled resume');
    return;
  }

  const isPlaying = getEffectiveColorCyclePlaying();
  if (!isPlaying && !recolorWasAnimatingRef.current) {
    return;
  }

  const state = storeRef.current;
  const shape = state.tools.brushSettings.brushShape;
  const isCCBrush =
    shape === BrushShape.COLOR_CYCLE ||
    shape === BrushShape.COLOR_CYCLE_TRIANGLE ||
    shape === BrushShape.COLOR_CYCLE_SHAPE ||
    (shape === BrushShape.CUSTOM && !!state.tools.brushSettings.customBrushColorCycle);

  if (isCCBrush) {
    ccLog('pauseColorCycleForNonCCInteraction skipped (cc brush)', { shape });
    return;
  }

  const activeLayer = state.layers.find((layer) => layer.id === state.activeLayerId);
  if (activeLayer?.layerType === 'sequential') {
    ccLog('pauseColorCycleForNonCCInteraction skipped (active sequential layer)', { reason });
    return;
  }

  if (selectSequentialCaptureActive(state)) {
    ccLog('pauseColorCycleForNonCCInteraction skipped (sequential capture active)', { reason });
    return;
  }

  const wasPlaying = isPlaying;
  ccLog('pauseColorCycleForNonCCInteraction', { wasPlaying, reason });
  const pausedAny = pauseAllBrushCCAnimationsNow();
  ccLog('pauseColorCycleForNonCCInteraction -> pauseAllBrush', { pausedAny });

  if (wasPlaying) {
    shouldResumeRef.current = true;
    ccLog('pauseColorCycleForNonCCInteraction: suspending playback', { reason });
    storeRef.current.suspendColorCycle(reason);
  }
};

export const resumeColorCycleAfterInteraction = async ({
  shouldResumeRef,
  storeRef,
  getEffectiveColorCyclePlaying,
  ccGroup,
  ccGroupEnd,
  ccLog,
}: ResumeDeps): Promise<void> => {
  ccGroup('resumeColorCycleAfterInteraction()');
  const shouldResume = shouldResumeRef.current;
  const globalIsPlaying = getEffectiveColorCyclePlaying();
  ccLog('state', { shouldResume, globalIsPlaying });

  if (!shouldResume) {
    ccGroupEnd();
    return;
  }

  shouldResumeRef.current = false;

  const st = storeRef.current;
  const suspendDepth = selectColorCycleSuspendDepth(st);
  if (suspendDepth > 1) {
    st.forceResumeColorCycle('shape-preview');
    ccLog('forceResumeColorCycle', { suspendDepth });
  } else {
    st.resumeColorCycle('shape-preview');
    ccLog('resumeColorCycle', { suspendDepth });
  }
  ccGroupEnd();
};

export const pauseAllBrushCCAnimationsNow = ({
  pausedCCLayerIdsRef,
  recolorWasAnimatingRef,
  storeRef,
  getEffectiveColorCyclePlaying,
  getColorCycleBrushManager,
  continuousColorCycleAnimationRef,
  continuousColorCycleAnimationActiveRef,
  cancelAnimationFrame,
  ccGroup,
  ccGroupEnd,
  ccLog,
  dumpLayerFlags,
}: PauseAllDeps): boolean => {
  ccGroup('pauseAllBrushCCAnimationsNow()');
  dumpLayerFlags();
  const state = storeRef.current;
  const toResume: string[] = [];
  state.layers.forEach(layer => {
    if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode !== 'recolor') {
      if (layer.colorCycleData?.isAnimating) {
        toResume.push(layer.id);
      }
      const updatedColorCycleData: Layer['colorCycleData'] = {
        ...(layer.colorCycleData ?? {}),
        isAnimating: false,
      };
      state.updateLayer(layer.id, { colorCycleData: updatedColorCycleData });
      ccLog('pause layer', { id: layer.id.slice(-6) });
      try {
        const mgr = getColorCycleBrushManager();
        const brush = mgr.getBrush(layer.id);
        brush?.pause?.();
        brush?.stopAnimation?.();
      } catch {}
    }
  });

  const hadContinuousRuntime =
    continuousColorCycleAnimationActiveRef.current || continuousColorCycleAnimationRef.current !== null;
  if (hadContinuousRuntime) {
    continuousColorCycleAnimationActiveRef.current = false;
    if (continuousColorCycleAnimationRef.current !== null && continuousColorCycleAnimationRef.current > 0) {
      cancelAnimationFrame(continuousColorCycleAnimationRef.current);
    }
    clearSharedColorCycleRuntimeConsumer(storeRef);
    continuousColorCycleAnimationRef.current = null;
    ccLog('cancel global RAF (pause helper)');
    if (typeof window !== 'undefined') {
      window.__ccRafAlive = false;
    }
  }

  try {
    const rm = RecolorManager.getInstance();
    recolorWasAnimatingRef.current = rm.isAnimating();
    if (recolorWasAnimatingRef.current) {
      rm.pause();
      ccLog('pause recolor manager');
    }
  } catch {}

  let globalShouldResume = false;
  try {
    globalShouldResume = getEffectiveColorCyclePlaying();
  } catch {}

  pausedCCLayerIdsRef.current = toResume;
  const result = toResume.length > 0 || globalShouldResume || recolorWasAnimatingRef.current;
  ccLog('pauseAllBrushCCAnimationsNow result', {
    toResume: toResume.map(id => id.slice(-6)),
    globalShouldResume,
    recolorWasAnimating: recolorWasAnimatingRef.current,
    result
  });
  ccGroupEnd();
  return result;
};

export const createPauseAllBrushCCAnimationsDispatcher = (
  args: CreatePauseAllBrushCCAnimationsDispatcherArgs
): (() => boolean) => () =>
  pauseAllBrushCCAnimationsNow({
    pausedCCLayerIdsRef: args.pausedCCLayerIdsRef,
    recolorWasAnimatingRef: args.recolorWasAnimatingRef,
    storeRef: args.storeRef,
    getEffectiveColorCyclePlaying: args.getEffectiveColorCyclePlaying,
    getColorCycleBrushManager: args.getColorCycleBrushManager,
    continuousColorCycleAnimationRef: args.continuousColorCycleAnimationRef,
    continuousColorCycleAnimationActiveRef: args.continuousColorCycleAnimationActiveRef,
    cancelAnimationFrame: args.cancelAnimationFrame,
    ccGroup: args.ccGroup,
    ccGroupEnd: args.ccGroupEnd,
    ccLog: args.ccLog,
    dumpLayerFlags: args.dumpLayerFlags,
  });

export const createEffectiveColorCyclePlayingGetter = (
  storeRef: React.MutableRefObject<AppState>
): (() => boolean) => () => selectEffectiveColorCyclePlaying(storeRef.current);

// NOTE: Currently unused because global playback flow handles resume/restoration.
export const resumePausedBrushCCAnimations = ({
  pausedCCLayerIdsRef,
  recolorWasAnimatingRef,
  storeRef,
  getEffectiveColorCyclePlaying,
  getColorCycleBrushManager,
}: ResumePausedDeps): void => {
  const state = storeRef.current;
  const mgr = getColorCycleBrushManager();
  const ids = pausedCCLayerIdsRef.current;
  let resumedAny = false;

  if (ids && ids.length > 0) {
    ids.forEach(id => {
      try {
        const layer = state.layers.find(l => l.id === id);
        if (!layer) return;
        const updatedColorCycleData: Layer['colorCycleData'] = {
          ...(layer.colorCycleData ?? {}),
          isAnimating: true,
        };
        state.updateLayer(id, { colorCycleData: updatedColorCycleData });
        const brush = mgr.getBrush(id);
        brush?.startAnimation?.();
        resumedAny = true;
      } catch {}
    });
  }
  pausedCCLayerIdsRef.current = [];

  if (recolorWasAnimatingRef.current) {
    try {
      RecolorManager.getInstance().resume();
      resumedAny = true;
    } catch {}
    recolorWasAnimatingRef.current = false;
  }

  const globalIsPlaying = getEffectiveColorCyclePlaying();

  if (globalIsPlaying) {
    const ccLayers = state.layers.filter(
      layer => layer.layerType === 'color-cycle' && layer.colorCycleData?.mode !== 'recolor'
    );
    ccLayers.forEach(layer => {
      const wasAnimating = !!layer.colorCycleData?.isAnimating;
      if (!wasAnimating) {
        const resumedData: Layer['colorCycleData'] = {
          ...(layer.colorCycleData ?? {}),
          isAnimating: true,
        };
        state.updateLayer(layer.id, { colorCycleData: resumedData });
      }
      try {
        const brush = mgr.getBrush(layer.id);
        brush?.startAnimation?.();
      } catch {}
    });
    if (ccLayers.length > 0) {
      resumedAny = true;
    }
  }

  if (resumedAny || globalIsPlaying) {
    // Store-driven playback will notify subscribers.
  }
};
