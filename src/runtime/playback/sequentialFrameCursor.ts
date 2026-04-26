import type { AppState } from '@/stores/useAppStore';

export interface SequentialFrameCursorSnapshot {
  frame: number;
  frameCount: number;
  updatedAtMs: number;
}

let frame = 0;
let frameCount = 1;
let updatedAtMs = 0;

const normalizeFrame = (nextFrame: number, nextFrameCount: number): number => {
  const safeCount = Math.max(1, Math.round(nextFrameCount));
  const normalized = Math.round(nextFrame) % safeCount;
  return normalized < 0 ? normalized + safeCount : normalized;
};

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export const getSequentialFrameCursor = (): SequentialFrameCursorSnapshot => ({
  frame,
  frameCount,
  updatedAtMs,
});

export const setSequentialFrameCursor = ({
  nextFrame,
  nextFrameCount,
  timestampMs,
}: {
  nextFrame: number;
  nextFrameCount: number;
  timestampMs?: number;
}): SequentialFrameCursorSnapshot => {
  frameCount = Math.max(1, Math.round(nextFrameCount));
  frame = normalizeFrame(nextFrame, frameCount);
  updatedAtMs = Number.isFinite(timestampMs) ? Math.max(0, timestampMs ?? 0) : nowMs();
  return getSequentialFrameCursor();
};

export const resetSequentialFrameCursorFromState = (state: AppState): SequentialFrameCursorSnapshot =>
  setSequentialFrameCursor({
    nextFrame: state.sequentialRecord.currentFrame,
    nextFrameCount: state.sequentialRecord.frameCount,
  });

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
  if (!Number.isFinite(state.sequentialRecord?.frameCount)) {
    return Math.max(0, Math.round(state.sequentialRecord?.currentFrame ?? frame));
  }
  const safeFrameCount = Math.max(1, Math.round(state.sequentialRecord?.frameCount ?? frameCount));
  const storeFrame = normalizeFrame(state.sequentialRecord?.currentFrame ?? frame, safeFrameCount);
  const runtimeFrame = normalizeFrame(frame, safeFrameCount);
  const runtimePlaybackActive =
    Boolean(state.colorCyclePlayback?.desiredPlaying) ||
    Boolean(state.sequentialRecord?.isPointerDown);
  return runtimePlaybackActive ? runtimeFrame : storeFrame;
};
