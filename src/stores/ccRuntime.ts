import {
  getPlaybackRuntimeController,
} from '@/runtime/playback/PlaybackRuntimeController';
import {
  resetColorCyclePlaybackParticipantForTests,
} from '@/runtime/playback/colorCyclePlaybackParticipant';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';

export function resetCCRuntimesForTests(): void {
  resetColorCyclePlaybackParticipantForTests();
}

export function syncPlaybackColorCycleLayers(layers: Layer[], cause?: string): void {
  if (!Array.isArray(layers) || layers.length === 0) {
    return;
  }
  const state = useAppStore.getState();
  getPlaybackRuntimeController().syncColorCycleLayers(
    {
      ...state,
      layers,
    },
    cause
  );
}

/**
 * Synchronize color-cycle runtime state from layer data into live brush instances.
 * Compatibility entrypoint. New callers should use PlaybackRuntimeController.
 */
export function syncCCRuntimes(layers: Layer[], cause?: string): void {
  syncPlaybackColorCycleLayers(layers, cause);
}
