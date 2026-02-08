import type { StateCreator } from 'zustand';

type AppState = import('../useAppStore').AppState;

const MIN_RECORD_FPS = 1;
const MAX_RECORD_FPS = 60;
const MIN_RECORD_FRAME_COUNT = 1;
const MAX_RECORD_FRAME_COUNT = 512;
const MIN_TIME_SMEAR = 0.1;
const MAX_TIME_SMEAR = 8;

const DEFAULT_RECORD_FPS = 12;
const DEFAULT_RECORD_FRAME_COUNT = 12;
const DEFAULT_TIME_SMEAR = 1;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const normalizeFrameIndex = (frame: number, frameCount: number): number => {
  if (frameCount <= 0) return 0;
  const normalized = frame % frameCount;
  return normalized < 0 ? normalized + frameCount : normalized;
};

const deriveDurationMs = (frameCount: number, fps: number): number => {
  const safeFrameCount = Math.max(MIN_RECORD_FRAME_COUNT, frameCount);
  const safeFps = Math.max(MIN_RECORD_FPS, fps);
  return Math.round((safeFrameCount * 1000) / safeFps);
};

export interface SequentialRuntimeMetrics {
  lastTickMs: number;
  avgTickMs: number;
  tickCount: number;
  frameCacheEntries: number;
  frameCacheHits: number;
  frameCacheMisses: number;
}

export interface SequentialRecordState {
  fps: number;
  frameCount: number;
  timeSmear: number;
  currentFrame: number;
  durationMs: number;
  sessionStartMs: number | null;
  isPointerDown: boolean;
  isCaptureActive: boolean;
  metrics: SequentialRuntimeMetrics;
}

export interface SequentialRecordSlice {
  sequentialRecord: SequentialRecordState;
  setRecordFPS: (fps: number) => void;
  setRecordFrameCount: (frameCount: number) => void;
  setTimeSmear: (timeSmear: number) => void;
  stepSequentialFrame: (step?: number) => void;
  setSequentialFrame: (frame: number) => void;
  setSequentialPointerDown: (isPointerDown: boolean) => void;
  setSequentialCaptureActive: (isCaptureActive: boolean) => void;
  recordSequentialRuntimeTick: (tickMs: number) => void;
  setSequentialFrameCacheStats: (stats: Partial<Pick<SequentialRuntimeMetrics, 'frameCacheEntries' | 'frameCacheHits' | 'frameCacheMisses'>>) => void;
  resetSequentialRuntimeMetrics: () => void;
}

const createDefaultMetrics = (): SequentialRuntimeMetrics => ({
  lastTickMs: 0,
  avgTickMs: 0,
  tickCount: 0,
  frameCacheEntries: 0,
  frameCacheHits: 0,
  frameCacheMisses: 0,
});

export const createSequentialRecordSlice: StateCreator<AppState, [], [], SequentialRecordSlice> = (set) => ({
  sequentialRecord: {
    fps: DEFAULT_RECORD_FPS,
    frameCount: DEFAULT_RECORD_FRAME_COUNT,
    timeSmear: DEFAULT_TIME_SMEAR,
    currentFrame: 0,
    durationMs: deriveDurationMs(DEFAULT_RECORD_FRAME_COUNT, DEFAULT_RECORD_FPS),
    sessionStartMs: null,
    isPointerDown: false,
    isCaptureActive: false,
    metrics: createDefaultMetrics(),
  },
  setRecordFPS: (fps) =>
    set((state) => {
      const nextFps = Math.round(clamp(fps, MIN_RECORD_FPS, MAX_RECORD_FPS));
      if (nextFps === state.sequentialRecord.fps) {
        return state;
      }
      return {
        sequentialRecord: {
          ...state.sequentialRecord,
          fps: nextFps,
          durationMs: deriveDurationMs(state.sequentialRecord.frameCount, nextFps),
        },
      };
    }),
  setRecordFrameCount: (frameCount) =>
    set((state) => {
      const nextFrameCount = Math.round(
        clamp(frameCount, MIN_RECORD_FRAME_COUNT, MAX_RECORD_FRAME_COUNT)
      );
      if (nextFrameCount === state.sequentialRecord.frameCount) {
        return state;
      }
      return {
        sequentialRecord: {
          ...state.sequentialRecord,
          frameCount: nextFrameCount,
          currentFrame: normalizeFrameIndex(state.sequentialRecord.currentFrame, nextFrameCount),
          durationMs: deriveDurationMs(nextFrameCount, state.sequentialRecord.fps),
        },
      };
    }),
  setTimeSmear: (timeSmear) =>
    set((state) => {
      const nextTimeSmear = clamp(timeSmear, MIN_TIME_SMEAR, MAX_TIME_SMEAR);
      if (nextTimeSmear === state.sequentialRecord.timeSmear) {
        return state;
      }
      return {
        sequentialRecord: {
          ...state.sequentialRecord,
          timeSmear: nextTimeSmear,
        },
      };
    }),
  stepSequentialFrame: (step = 1) =>
    set((state) => ({
      sequentialRecord: {
        ...state.sequentialRecord,
        currentFrame: normalizeFrameIndex(
          state.sequentialRecord.currentFrame + Math.round(step),
          state.sequentialRecord.frameCount
        ),
      },
    })),
  setSequentialFrame: (frame) =>
    set((state) => ({
      sequentialRecord: {
        ...state.sequentialRecord,
        currentFrame: normalizeFrameIndex(Math.round(frame), state.sequentialRecord.frameCount),
      },
    })),
  setSequentialPointerDown: (isPointerDown) =>
    set((state) => ({
      sequentialRecord: {
        ...state.sequentialRecord,
        isPointerDown,
        sessionStartMs: isPointerDown
          ? state.sequentialRecord.sessionStartMs ?? Date.now()
          : null,
      },
    })),
  setSequentialCaptureActive: (isCaptureActive) =>
    set((state) => ({
      sequentialRecord: {
        ...state.sequentialRecord,
        isCaptureActive,
      },
    })),
  recordSequentialRuntimeTick: (tickMs) =>
    set((state) => {
      const tickCount = state.sequentialRecord.metrics.tickCount + 1;
      const safeTickMs = Number.isFinite(tickMs) ? Math.max(0, tickMs) : 0;
      const previousAvg = state.sequentialRecord.metrics.avgTickMs;
      const avgTickMs = previousAvg + (safeTickMs - previousAvg) / tickCount;
      return {
        sequentialRecord: {
          ...state.sequentialRecord,
          metrics: {
            ...state.sequentialRecord.metrics,
            tickCount,
            lastTickMs: safeTickMs,
            avgTickMs,
          },
        },
      };
    }),
  setSequentialFrameCacheStats: (stats) =>
    set((state) => {
      const previousMetrics = state.sequentialRecord.metrics;
      const nextFrameCacheEntries =
        typeof stats.frameCacheEntries === 'number'
          ? Math.max(0, Math.round(stats.frameCacheEntries))
          : previousMetrics.frameCacheEntries;
      const nextFrameCacheHits =
        typeof stats.frameCacheHits === 'number'
          ? Math.max(0, Math.round(stats.frameCacheHits))
          : previousMetrics.frameCacheHits;
      const nextFrameCacheMisses =
        typeof stats.frameCacheMisses === 'number'
          ? Math.max(0, Math.round(stats.frameCacheMisses))
          : previousMetrics.frameCacheMisses;

      if (
        nextFrameCacheEntries === previousMetrics.frameCacheEntries &&
        nextFrameCacheHits === previousMetrics.frameCacheHits &&
        nextFrameCacheMisses === previousMetrics.frameCacheMisses
      ) {
        return state;
      }

      return {
        sequentialRecord: {
          ...state.sequentialRecord,
          metrics: {
            ...previousMetrics,
            frameCacheEntries: nextFrameCacheEntries,
            frameCacheHits: nextFrameCacheHits,
            frameCacheMisses: nextFrameCacheMisses,
          },
        },
      };
    }),
  resetSequentialRuntimeMetrics: () =>
    set((state) => ({
      sequentialRecord: {
        ...state.sequentialRecord,
        metrics: createDefaultMetrics(),
      },
    })),
});
