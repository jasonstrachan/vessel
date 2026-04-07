import type { StateCreator } from 'zustand';
import {
  MAX_CC_LAYER_SPEED_SCALE,
  MIN_CC_LAYER_SPEED_SCALE,
} from '@/constants/colorCycle';

type AppState = import('../useAppStore').AppState;

export type CCReason =
  | 'toolbar'
  | 'brush-stroke'
  | 'stroke-end'
  | 'shape-preview'
  | 'history-apply'
  | 'visibility-hidden'
  | 'layer-switch'
  | 'startup'
  | 'store-sync'
  | 'auto-start'
  | 'pan'
  | 'active-layer-not-cc'
  | 'shape-tool-start'
  | 'shape-tool-drag'
  | 'pointer-drag'
  | 'layer-create'
  | 'overlay-reinit'
  | 'unknown'
  | 'event';

export interface ColorCycleUIState {
  desiredPlaying: boolean;
  playbackSpeedScale: number;
  suspendDepth: number;
  lastReason?: CCReason;
  recentReasons?: Array<{ reason: CCReason; ts: number }>;
}

export interface ColorCycleRuntimeHandlers {
  start?: (reason?: string) => void;
  stop?: (reason?: string) => void;
  updateGradient?: (stops: Array<{ position: number; color: string }>) => void;
  setFlowMode?: (mode: 'forward' | 'reverse' | 'pingpong') => void;
  setFlowDirection?: (direction: 'forward' | 'backward') => void;
}

export interface ColorCycleSlice {
  colorCyclePlayback: ColorCycleUIState;
  playColorCycle: (reason: CCReason) => void;
  pauseColorCycle: (reason: CCReason) => void;
  setPlaybackSpeedScale: (scale: number) => void;
  suspendColorCycle: (reason: CCReason) => void;
  resumeColorCycle: (reason: CCReason) => void;
  forceResumeColorCycle: (reason: CCReason) => void;
  withColorCycleSuspended: <T>(reason: CCReason, fn: () => T | Promise<T>) => Promise<T>;
  colorCycleRuntimeHandlers: ColorCycleRuntimeHandlers;
  setColorCycleRuntimeHandlers: (handlers: ColorCycleRuntimeHandlers | null) => void;
}

const SHOULD_TRACK_COLOR_CYCLE_REASONS = process.env.NODE_ENV !== 'production';
const MAX_COLOR_CYCLE_RECENT_REASONS = 16;

const appendColorCycleReason = (
  state: ColorCycleUIState,
  reason: CCReason
): ColorCycleUIState['recentReasons'] => {
  if (!SHOULD_TRACK_COLOR_CYCLE_REASONS) {
    return state.recentReasons;
  }
  const base = state.recentReasons ?? [];
  const next = [...base, { reason, ts: Date.now() }];
  const overflow = next.length - MAX_COLOR_CYCLE_RECENT_REASONS;
  return overflow > 0 ? next.slice(overflow) : next;
};

const clampPlaybackSpeedScale = (scale: number): number =>
  Number.isFinite(scale)
    ? Math.max(MIN_CC_LAYER_SPEED_SCALE, Math.min(MAX_CC_LAYER_SPEED_SCALE, scale))
    : 1;

const applyPlaybackSpeedScale = (state: AppState, scale: number) => ({
  colorCyclePlayback: {
    ...state.colorCyclePlayback,
    playbackSpeedScale: scale,
  },
  // Keep runtime playback state and the persisted brush-settings cache in sync.
  tools: {
    ...state.tools,
    brushSettings: {
      ...state.tools.brushSettings,
      colorCycleLayerSpeedScale: scale,
    },
  },
});

export const createColorCycleSlice: StateCreator<AppState, [], [], ColorCycleSlice> = (set) => {
  const playColorCycle = (reason: CCReason) => {
    set((state) => ({
      colorCyclePlayback: {
        ...state.colorCyclePlayback,
        desiredPlaying: true,
        lastReason: reason,
        recentReasons: appendColorCycleReason(state.colorCyclePlayback, reason),
      },
    }));
  };

  const pauseColorCycle = (reason: CCReason) => {
    set((state) => ({
      colorCyclePlayback: {
        ...state.colorCyclePlayback,
        desiredPlaying: false,
        lastReason: reason,
        recentReasons: appendColorCycleReason(state.colorCyclePlayback, reason),
      },
    }));
  };

  const setPlaybackSpeedScale = (scale: number) => {
    set((state) => applyPlaybackSpeedScale(state, clampPlaybackSpeedScale(scale)));
  };

  const suspendColorCycle = (reason: CCReason) => {
    set((state) => {
      const playback = state.colorCyclePlayback;
      const nextDepth = Math.max(0, playback.suspendDepth) + 1;
      return {
        colorCyclePlayback: {
          ...playback,
          suspendDepth: nextDepth,
          lastReason: reason,
          recentReasons: appendColorCycleReason(playback, reason),
        },
      };
    });
  };

  const resumeColorCycle = (reason: CCReason) => {
    set((state) => {
      const playback = state.colorCyclePlayback;
      const nextDepth = Math.max(0, playback.suspendDepth - 1);
      return {
        colorCyclePlayback: {
          ...playback,
          suspendDepth: nextDepth,
          lastReason: reason,
          recentReasons: appendColorCycleReason(playback, reason),
        },
      };
    });
  };

  const forceResumeColorCycle = (reason: CCReason) => {
    set((state) => ({
      colorCyclePlayback: {
        ...state.colorCyclePlayback,
        suspendDepth: 0,
        lastReason: reason,
        recentReasons: appendColorCycleReason(state.colorCyclePlayback, reason),
      },
    }));
  };

  const withColorCycleSuspended = async <T>(
    reason: CCReason,
    fn: () => T | Promise<T>
  ): Promise<T> => {
    suspendColorCycle(reason);
    try {
      return await fn();
    } finally {
      resumeColorCycle(reason);
    }
  };

  return {
    colorCyclePlayback: {
      desiredPlaying: false,
      playbackSpeedScale: 1,
      suspendDepth: 0,
      lastReason: 'startup',
      recentReasons: SHOULD_TRACK_COLOR_CYCLE_REASONS ? [] : undefined,
    },
    playColorCycle,
    pauseColorCycle,
    setPlaybackSpeedScale,
    suspendColorCycle,
    resumeColorCycle,
    forceResumeColorCycle,
    withColorCycleSuspended,
    colorCycleRuntimeHandlers: {},
    setColorCycleRuntimeHandlers: (handlers) =>
      set(() => ({
        colorCycleRuntimeHandlers: handlers ?? {},
      })),
  };
};
