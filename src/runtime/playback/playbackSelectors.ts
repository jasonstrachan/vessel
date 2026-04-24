import type { AppState } from '@/stores/useAppStore';
import type { ColorCycleUIState } from '@/stores/slices/colorCycleSlice';
import type { SequentialRecordState } from '@/stores/slices/sequentialRecordSlice';
import { createPlaybackRuntimeState } from '@/runtime/playback/playbackState';

export type PlaybackToggleAction = 'play' | 'pause' | 'resume';

export interface PlaybackToggleUi {
  action: PlaybackToggleAction;
  label: 'Play' | 'Pause' | 'Resume';
  icon: '▶' | '⏸' | '↻';
}

const PLAYBACK_TOGGLE_PLAY: PlaybackToggleUi = { action: 'play', label: 'Play', icon: '▶' };
const PLAYBACK_TOGGLE_PAUSE: PlaybackToggleUi = { action: 'pause', label: 'Pause', icon: '⏸' };
const PLAYBACK_TOGGLE_RESUME: PlaybackToggleUi = { action: 'resume', label: 'Resume', icon: '↻' };

export const selectColorCyclePlayback = (state: AppState): ColorCycleUIState =>
  state.colorCyclePlayback;

export const selectColorCycleDesiredPlaying = (state: AppState): boolean =>
  state.colorCyclePlayback.desiredPlaying;

export const selectPlaybackSpeedScale = (state: AppState): number => {
  return Number.isFinite(state.colorCyclePlayback.playbackSpeedScale)
    ? state.colorCyclePlayback.playbackSpeedScale
    : 1;
};

export const selectColorCycleSuspendDepth = (state: AppState): number =>
  state.colorCyclePlayback.suspendDepth;

export const selectEffectiveColorCyclePlaying = (state: AppState): boolean =>
  createPlaybackRuntimeState(state).effectivePlaying;

export const selectColorCyclePlaybackUiState = (
  state: AppState
): 'paused' | 'suspended' | 'playing' => {
  const runtimeState = createPlaybackRuntimeState(state);
  if (!runtimeState.desiredPlaying) {
    return 'paused';
  }
  return runtimeState.suspended ? 'suspended' : 'playing';
};

export const selectColorCyclePlaybackToggleAction = (
  state: AppState
): PlaybackToggleAction => {
  const uiState = selectColorCyclePlaybackUiState(state);
  if (uiState === 'playing') {
    return 'pause';
  }
  if (uiState === 'suspended') {
    return 'resume';
  }
  return 'play';
};

export const selectSequentialRecordState = (state: AppState): SequentialRecordState =>
  state.sequentialRecord;

export const selectSequentialPlaybackActive = (state: AppState): boolean => {
  if (!selectColorCycleDesiredPlaying(state)) {
    return false;
  }
  return state.layers.some((layer) => layer.layerType === 'sequential');
};

export const selectSequentialCaptureActive = (state: AppState): boolean =>
  createPlaybackRuntimeState(state).capturing;

export const selectGlobalAnimationActive = (state: AppState): boolean =>
  selectEffectiveColorCyclePlaying(state) ||
  selectSequentialPlaybackActive(state) ||
  selectSequentialCaptureActive(state);

export const selectPlaybackToggleUi = (state: AppState): PlaybackToggleUi => {
  const action = selectSequentialCaptureActive(state)
    ? 'pause'
    : selectColorCyclePlaybackToggleAction(state);
  if (action === 'pause') {
    return PLAYBACK_TOGGLE_PAUSE;
  }
  if (action === 'resume') {
    return PLAYBACK_TOGGLE_RESUME;
  }
  return PLAYBACK_TOGGLE_PLAY;
};
