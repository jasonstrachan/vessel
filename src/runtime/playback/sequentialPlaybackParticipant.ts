import type { AppState } from '@/stores/useAppStore';
import {
  selectSequentialCaptureActive,
  selectSequentialPlaybackActive,
} from '@/runtime/playback/playbackSelectors';
import type { PlaybackParticipant } from '@/runtime/playback/playbackParticipants';

export const sequentialPlaybackParticipant: PlaybackParticipant = {
  id: 'sequential',

  hasWork(state: AppState): boolean {
    return selectSequentialPlaybackActive(state) || selectSequentialCaptureActive(state);
  },

  sync({ state, requestAnimationRuntimeStart }): void {
    if (this.hasWork(state)) {
      requestAnimationRuntimeStart();
    }
  },
};
