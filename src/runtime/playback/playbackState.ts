import type { AppState } from '@/stores/useAppStore';

export type PlaybackRuntimeMode =
  | 'idle'
  | 'playing'
  | 'suspended'
  | 'capturing'
  | 'scrubbing';

export interface PlaybackRuntimeState {
  mode: PlaybackRuntimeMode;
  desiredPlaying: boolean;
  effectivePlaying: boolean;
  suspended: boolean;
  capturing: boolean;
  scrubbing: boolean;
}

export const createPlaybackRuntimeState = (state: AppState): PlaybackRuntimeState => {
  const desiredPlaying = state.colorCyclePlayback.desiredPlaying;
  const suspended = desiredPlaying && state.colorCyclePlayback.suspendDepth > 0;
  const effectivePlaying = desiredPlaying && !suspended;
  const activeLayerId = state.activeLayerId;
  const activeLayer = activeLayerId
    ? state.layers.find((layer) => layer.id === activeLayerId)
    : null;
  const capturing =
    activeLayer?.layerType === 'sequential' &&
    state.sequentialRecord.isPointerDown;
  const scrubbing = false;

  let mode: PlaybackRuntimeMode = 'idle';
  if (scrubbing) {
    mode = 'scrubbing';
  } else if (capturing) {
    mode = 'capturing';
  } else if (suspended) {
    mode = 'suspended';
  } else if (effectivePlaying) {
    mode = 'playing';
  }

  return {
    mode,
    desiredPlaying,
    effectivePlaying,
    suspended,
    capturing,
    scrubbing,
  };
};
