import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';

export interface SequentialFrameCursorSnapshot {
  frame: number;
  frameCount: number;
  fps: number;
  timeMs: number;
  updatedAtMs: number;
}

let frame = 0;
let frameCount = 1;
let fps = 12;
let timeMs = 0;
let updatedAtMs = 0;
let exportTimeMs: number | null = null;

const normalizeFrame = (nextFrame: number, nextFrameCount: number): number => {
  const safeCount = Number.isFinite(nextFrameCount)
    ? Math.max(1, Math.round(nextFrameCount))
    : 1;
  const safeFrame = Number.isFinite(nextFrame) ? Math.round(nextFrame) : 0;
  const normalized = safeFrame % safeCount;
  return normalized < 0 ? normalized + safeCount : normalized;
};

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export const getSequentialFrameCursor = (): SequentialFrameCursorSnapshot => ({
  frame,
  frameCount,
  fps,
  timeMs,
  updatedAtMs,
});

export const frameAtSequentialTime = ({
  clipTimeMs,
  clipFps,
  clipFrameCount,
}: {
  clipTimeMs: number;
  clipFps: number;
  clipFrameCount: number;
}): number => {
  const safeFps = Number.isFinite(clipFps) ? Math.max(1, Math.round(clipFps)) : 1;
  const safeFrameCount = Number.isFinite(clipFrameCount)
    ? Math.max(1, Math.round(clipFrameCount))
    : 1;
  const safeTimeMs = Number.isFinite(clipTimeMs) ? Math.max(0, clipTimeMs) : 0;
  const resolvedFrame = Math.floor((safeTimeMs * safeFps) / 1000);
  return normalizeFrame(resolvedFrame, safeFrameCount);
};

export const setSequentialFrameCursor = ({
  nextFrame,
  nextFrameCount,
  nextFps,
  timestampMs,
}: {
  nextFrame: number;
  nextFrameCount: number;
  nextFps?: number;
  timestampMs?: number;
}): SequentialFrameCursorSnapshot => {
  frameCount = Number.isFinite(nextFrameCount) ? Math.max(1, Math.round(nextFrameCount)) : 1;
  const resolvedFps = nextFps ?? fps;
  fps = Number.isFinite(resolvedFps) ? Math.max(1, Math.round(resolvedFps)) : 1;
  frame = normalizeFrame(nextFrame, frameCount);
  timeMs = (frame * 1000) / fps;
  updatedAtMs = Number.isFinite(timestampMs) ? Math.max(0, timestampMs ?? 0) : nowMs();
  return getSequentialFrameCursor();
};

export const advanceSequentialTransport = ({
  deltaMs,
  sourceFps,
  sourceFrameCount,
  timestampMs,
}: {
  deltaMs: number;
  sourceFps: number;
  sourceFrameCount: number;
  timestampMs?: number;
}): SequentialFrameCursorSnapshot => {
  fps = Number.isFinite(sourceFps) ? Math.max(1, Math.round(sourceFps)) : 1;
  frameCount = Number.isFinite(sourceFrameCount)
    ? Math.max(1, Math.round(sourceFrameCount))
    : 1;
  const safeDeltaMs = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
  timeMs = Math.max(0, timeMs + safeDeltaMs);
  frame = frameAtSequentialTime({
    clipTimeMs: timeMs,
    clipFps: fps,
    clipFrameCount: frameCount,
  });
  updatedAtMs = Number.isFinite(timestampMs) ? Math.max(0, timestampMs ?? 0) : nowMs();
  return getSequentialFrameCursor();
};

export const beginSequentialExportTimeline = (): (() => void) => {
  exportTimeMs = timeMs;
  return () => {
    exportTimeMs = null;
  };
};

export const setSequentialExportTime = (nextTimeMs: number): void => {
  if (exportTimeMs === null) {
    return;
  }
  exportTimeMs = Number.isFinite(nextTimeMs) ? Math.max(0, nextTimeMs) : 0;
};

export const resetSequentialFrameCursorFromState = (state: AppState): SequentialFrameCursorSnapshot => {
  const activeSequentialLayer = state.layers.find(
    (layer) => layer.id === state.activeLayerId && layer.layerType === 'sequential',
  );
  return setSequentialFrameCursor({
    nextFrame: state.sequentialRecord.currentFrame,
    nextFrameCount:
      activeSequentialLayer?.sequentialData?.frameCount ?? state.sequentialRecord.frameCount,
    nextFps: activeSequentialLayer?.sequentialData?.fps ?? state.sequentialRecord.fps,
  });
};

export const advanceSequentialFrameCursor = ({
  step,
  nextFrameCount,
  timestampMs,
}: {
  step: number;
  nextFrameCount: number;
  timestampMs?: number;
}): SequentialFrameCursorSnapshot =>
  setSequentialFrameCursor({
    nextFrame: frame + Math.round(step),
    nextFrameCount,
    timestampMs,
  });

export const getSequentialRenderFrame = (state: {
  sequentialRecord?: { frameCount?: number; currentFrame?: number; isPointerDown?: boolean };
  colorCyclePlayback?: { desiredPlaying?: boolean };
}): number => {
  const runtimePlaybackActive =
    Boolean(state.colorCyclePlayback?.desiredPlaying) ||
    Boolean(state.sequentialRecord?.isPointerDown);
  if (!runtimePlaybackActive) {
    return Math.max(0, Math.round(state.sequentialRecord?.currentFrame ?? frame));
  }
  const safeFrameCount = Math.max(1, Math.round(state.sequentialRecord?.frameCount ?? frameCount));
  return normalizeFrame(frame, safeFrameCount);
};

export const getSequentialLayerRenderFrame = (
  state: {
    sequentialRecord?: { currentFrame?: number; isPointerDown?: boolean };
    colorCyclePlayback?: { desiredPlaying?: boolean };
    activeLayerId?: string | null;
  },
  layer: Pick<Layer, 'id' | 'layerType' | 'sequentialData'>,
): number => {
  const clip = layer.sequentialData;
  if (layer.layerType !== 'sequential' || !clip) {
    return 0;
  }
  const hasRuntimeTime =
    exportTimeMs !== null ||
    Boolean(state.colorCyclePlayback?.desiredPlaying) ||
    Boolean(state.sequentialRecord?.isPointerDown);
  if (!hasRuntimeTime && state.activeLayerId === layer.id) {
    return normalizeFrame(state.sequentialRecord?.currentFrame ?? frame, clip.frameCount);
  }
  return frameAtSequentialTime({
    clipTimeMs: exportTimeMs ?? timeMs,
    clipFps: clip.fps,
    clipFrameCount: clip.frameCount,
  });
};
