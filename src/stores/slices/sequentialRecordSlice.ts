import type { StateCreator } from 'zustand';

import historyManager from '@/history/historyService';
import { createSequentialSettingsDelta } from '@/history/deltas/sequentialFrameDelta';
import { appendPendingCompositeDirtyBatches } from '@/stores/layers/layerCompositeDirtyBatches';
import { markCompositeSegmentsDirtyByLayerIds } from '@/stores/layers/layerCompositeInvalidation';
import { setSequentialFrameCursor } from '@/runtime/playback/sequentialFrameCursor';

type AppState = import('../useAppStore').AppState;

const MIN_RECORD_FPS = 1;
const MAX_RECORD_FPS = 60;
const MIN_RECORD_FRAME_COUNT = 1;
const MAX_RECORD_FRAME_COUNT = 512;
const MIN_TIME_SMEAR = 0.1;
const MAX_TIME_SMEAR = 160;

const DEFAULT_RECORD_FPS = 12;
const DEFAULT_RECORD_FRAME_COUNT = 24;
const DEFAULT_TIME_SMEAR = 40;
const DEFAULT_TEMPORAL_SPREAD_FRAMES = 1;
const DEFAULT_TRAIL_FALLOFF = 0;
const DEFAULT_BURST_FRAMES = 1;
const DEFAULT_GAP_FRAMES = 0;

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
  temporalSpreadFrames: number;
  trailFalloff: number;
  burstFrames: number;
  gapFrames: number;
  currentFrame: number;
  durationMs: number;
  sessionStartMs: number | null;
  recordArmed: boolean;
  isPointerDown: boolean;
  isCaptureActive: boolean;
  metrics: SequentialRuntimeMetrics;
}

export interface SequentialRecordSlice {
  sequentialRecord: SequentialRecordState;
  setRecordFPS: (fps: number) => void;
  setRecordFrameCount: (
    frameCount: number,
    mode?: 'preserve' | 'trim' | 'retime',
  ) => void;
  setTimeSmear: (timeSmear: number) => void;
  setTemporalSpreadFrames: (frames: number) => void;
  setSequentialTrailFalloff: (falloff: number) => void;
  setSequentialBurstFrames: (frames: number) => void;
  setSequentialGapFrames: (frames: number) => void;
  setSequentialRecordArmed: (recordArmed: boolean) => void;
  stepSequentialFrame: (step?: number) => void;
  setSequentialFrame: (frame: number) => void;
  publishSequentialFrame: (frame: number, frameCount?: number) => void;
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
    temporalSpreadFrames: DEFAULT_TEMPORAL_SPREAD_FRAMES,
    trailFalloff: DEFAULT_TRAIL_FALLOFF,
    burstFrames: DEFAULT_BURST_FRAMES,
    gapFrames: DEFAULT_GAP_FRAMES,
    currentFrame: 0,
    durationMs: deriveDurationMs(DEFAULT_RECORD_FRAME_COUNT, DEFAULT_RECORD_FPS),
    sessionStartMs: null,
    recordArmed: false,
    isPointerDown: false,
    isCaptureActive: false,
    metrics: createDefaultMetrics(),
  },
  setRecordFPS: (fps) =>
    set((state) => {
      const nextFps = Math.round(clamp(fps, MIN_RECORD_FPS, MAX_RECORD_FPS));
      const nextDurationMs = deriveDurationMs(state.sequentialRecord.frameCount, nextFps);
      const activeSequentialLayerIndex = state.layers.findIndex(
        (layer) => layer.id === state.activeLayerId && layer.layerType === 'sequential' && !!layer.sequentialData
      );
      const shouldUpdateActiveLayer = activeSequentialLayerIndex >= 0;
      if (!shouldUpdateActiveLayer && nextFps === state.sequentialRecord.fps) {
        return state;
      }

      let nextLayers = state.layers;
      if (shouldUpdateActiveLayer) {
        const activeLayer = state.layers[activeSequentialLayerIndex];
        const layerSequential = activeLayer.sequentialData!;
        if (layerSequential.fps !== nextFps) {
          const updatedLayer = {
            ...activeLayer,
            sequentialData: {
              ...layerSequential,
              fps: nextFps,
              durationMs: deriveDurationMs(
                Math.max(MIN_RECORD_FRAME_COUNT, Math.round(layerSequential.frameCount)),
                nextFps
              ),
            },
          };
          nextLayers = [...state.layers];
          const txn = historyManager.begin('settings-change', {
            layerId: activeLayer.id,
            setting: 'sequential-fps',
          });
          try {
            txn.push(createSequentialSettingsDelta({
              layerId: activeLayer.id,
              before: layerSequential,
              after: updatedLayer.sequentialData,
              recordBefore: {
                fps: state.sequentialRecord.fps,
                durationMs: state.sequentialRecord.durationMs,
              },
              recordAfter: {
                fps: nextFps,
                durationMs: nextDurationMs,
              },
            }));
            txn.commit('Change sequence FPS');
          } catch (error) {
            txn.cancel();
            throw error;
          }
          nextLayers[activeSequentialLayerIndex] = updatedLayer;
        }
      }
      if (nextLayers === state.layers && nextFps === state.sequentialRecord.fps) {
        return state;
      }
      return {
        layers: nextLayers,
        ...(nextLayers !== state.layers && state.activeLayerId ? {
          layersNeedRecomposition: true,
          compositeSegments: markCompositeSegmentsDirtyByLayerIds(
            state.compositeSegments,
            [state.activeLayerId],
          ),
          pendingCompositeDirtyBatches: appendPendingCompositeDirtyBatches(state, [state.activeLayerId]),
        } : {}),
        sequentialRecord: {
          ...state.sequentialRecord,
          fps: nextFps,
          durationMs: nextDurationMs,
        },
      };
    }),
  setRecordFrameCount: (frameCount, mode = 'preserve') =>
    set((state) => {
      const nextFrameCount = Math.round(
        clamp(frameCount, MIN_RECORD_FRAME_COUNT, MAX_RECORD_FRAME_COUNT)
      );
      const nextCurrentFrame = normalizeFrameIndex(state.sequentialRecord.currentFrame, nextFrameCount);
      const nextDurationMs = deriveDurationMs(nextFrameCount, state.sequentialRecord.fps);
      const activeSequentialLayerIndex = state.layers.findIndex(
        (layer) => layer.id === state.activeLayerId && layer.layerType === 'sequential' && !!layer.sequentialData
      );
      const shouldUpdateActiveLayer = activeSequentialLayerIndex >= 0;
      if (!shouldUpdateActiveLayer && nextFrameCount === state.sequentialRecord.frameCount) {
        return state;
      }

      let nextLayers = state.layers;
      if (shouldUpdateActiveLayer) {
        const activeLayer = state.layers[activeSequentialLayerIndex];
        const layerSequential = activeLayer.sequentialData!;
        const normalizedLayerFps = Math.max(MIN_RECORD_FPS, Math.round(layerSequential.fps));
        const previousFrameCount = Math.max(
          MIN_RECORD_FRAME_COUNT,
          Math.round(layerSequential.frameCount),
        );
        const mappedEvents = mode === 'trim'
          ? layerSequential.events.filter((event) => event.frameIndex < nextFrameCount)
          : mode === 'retime'
            ? layerSequential.events.map((event) => {
                const previousFrame = normalizeFrameIndex(event.frameIndex, previousFrameCount);
                const frameIndex = previousFrameCount <= 1 || nextFrameCount <= 1
                  ? 0
                  : Math.round(
                      (previousFrame / (previousFrameCount - 1)) * (nextFrameCount - 1),
                    );
                return frameIndex === event.frameIndex ? event : { ...event, frameIndex };
              })
            : layerSequential.events;
        const nextEvents = mappedEvents.length === layerSequential.events.length &&
          mappedEvents.every((event, index) => event === layerSequential.events[index])
          ? layerSequential.events : mappedEvents;
        const updatedLayer = {
          ...activeLayer,
          sequentialData: {
            ...layerSequential,
            frameCount: nextFrameCount,
            durationMs: deriveDurationMs(nextFrameCount, normalizedLayerFps),
            events: nextEvents,
          },
        };
        if (nextFrameCount !== layerSequential.frameCount || nextEvents !== layerSequential.events) {
          const txn = historyManager.begin('settings-change', {
            layerId: activeLayer.id,
            setting: 'sequential-frames',
            mode,
          });
          try {
            txn.push(createSequentialSettingsDelta({
              layerId: activeLayer.id,
              before: layerSequential,
              after: updatedLayer.sequentialData,
              recordBefore: {
                frameCount: state.sequentialRecord.frameCount,
                durationMs: state.sequentialRecord.durationMs,
                currentFrame: state.sequentialRecord.currentFrame,
              },
              recordAfter: {
                frameCount: nextFrameCount,
                durationMs: nextDurationMs,
                currentFrame: nextCurrentFrame,
              },
            }));
            txn.commit('Change sequence frames');
          } catch (error) {
            txn.cancel();
            throw error;
          }
          nextLayers = [...state.layers];
          nextLayers[activeSequentialLayerIndex] = updatedLayer;
        }
      }
      if (nextLayers === state.layers &&
        nextFrameCount === state.sequentialRecord.frameCount &&
        nextCurrentFrame === state.sequentialRecord.currentFrame) {
        return state;
      }
      return {
        layers: nextLayers,
        ...(nextLayers !== state.layers && state.activeLayerId ? {
          layersNeedRecomposition: true,
          compositeSegments: markCompositeSegmentsDirtyByLayerIds(
            state.compositeSegments,
            [state.activeLayerId],
          ),
          pendingCompositeDirtyBatches: appendPendingCompositeDirtyBatches(state, [state.activeLayerId]),
        } : {}),
        sequentialRecord: {
          ...state.sequentialRecord,
          frameCount: nextFrameCount,
          currentFrame: nextCurrentFrame,
          durationMs: nextDurationMs,
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
  setTemporalSpreadFrames: (frames) =>
    set((state) => ({
      sequentialRecord: {
        ...state.sequentialRecord,
        temporalSpreadFrames: Math.round(clamp(frames, 1, 32)),
      },
    })),
  setSequentialTrailFalloff: (falloff) =>
    set((state) => ({
      sequentialRecord: {
        ...state.sequentialRecord,
        trailFalloff: clamp(falloff, 0, 1),
      },
    })),
  setSequentialBurstFrames: (frames) =>
    set((state) => ({
      sequentialRecord: {
        ...state.sequentialRecord,
        burstFrames: Math.round(clamp(frames, 1, 32)),
      },
    })),
  setSequentialGapFrames: (frames) =>
    set((state) => ({
      sequentialRecord: {
        ...state.sequentialRecord,
        gapFrames: Math.round(clamp(frames, 0, 64)),
      },
    })),
  setSequentialRecordArmed: (recordArmed) =>
    set((state) => ({
      sequentialRecord: {
        ...state.sequentialRecord,
        recordArmed,
        isCaptureActive: recordArmed ? state.sequentialRecord.isCaptureActive : false,
      },
    })),
  stepSequentialFrame: (step = 1) =>
    set((state) => {
      const currentFrame = normalizeFrameIndex(
        state.sequentialRecord.currentFrame + Math.round(step),
        state.sequentialRecord.frameCount
      );
      setSequentialFrameCursor({
        nextFrame: currentFrame,
        nextFrameCount: state.sequentialRecord.frameCount,
        nextFps: state.sequentialRecord.fps,
      });
      return {
        sequentialRecord: {
          ...state.sequentialRecord,
          currentFrame,
        },
      };
    }),
  setSequentialFrame: (frame) =>
    set((state) => {
      const currentFrame = normalizeFrameIndex(Math.round(frame), state.sequentialRecord.frameCount);
      setSequentialFrameCursor({
        nextFrame: currentFrame,
        nextFrameCount: state.sequentialRecord.frameCount,
        nextFps: state.sequentialRecord.fps,
      });
      return {
        sequentialRecord: {
          ...state.sequentialRecord,
          currentFrame,
        },
      };
    }),
  publishSequentialFrame: (frame, frameCount) =>
    set((state) => {
      const currentFrame = normalizeFrameIndex(
        Math.round(frame),
        frameCount ?? state.sequentialRecord.frameCount,
      );
      if (currentFrame === state.sequentialRecord.currentFrame) {
        return state;
      }
      return {
        sequentialRecord: {
          ...state.sequentialRecord,
          currentFrame,
        },
      };
    }),
  setSequentialPointerDown: (isPointerDown) =>
    set((state) => {
      const previous = state.sequentialRecord;
      const nextSessionStartMs = isPointerDown
        ? previous.sessionStartMs ?? Date.now()
        : null;
      if (
        previous.isPointerDown === isPointerDown &&
        previous.sessionStartMs === nextSessionStartMs
      ) {
        return state;
      }
      return {
        sequentialRecord: {
          ...previous,
          isPointerDown,
          isCaptureActive: isPointerDown ? previous.isCaptureActive : false,
          sessionStartMs: nextSessionStartMs,
        },
      };
    }),
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
