import {
  getSharedAnimationRuntime,
} from '@/hooks/canvas/handlers/animation/animationRuntime';
import { colorCyclePlaybackParticipant } from '@/runtime/playback/colorCyclePlaybackParticipant';
import { PlaybackParticipantRegistry, type PlaybackRuntimeConsumer } from '@/runtime/playback/playbackParticipants';
import { sequentialPlaybackParticipant } from '@/runtime/playback/sequentialPlaybackParticipant';
import type { AppState } from '@/stores/useAppStore';

type Unregister = () => void;

export class PlaybackRuntimeController {
  private readonly registry = new PlaybackParticipantRegistry();

  constructor() {
    this.registry.register(colorCyclePlaybackParticipant);
    this.registry.register(sequentialPlaybackParticipant);
  }

  sync(state: AppState, cause?: string): void {
    this.registry.sync({
      state,
      cause,
      requestAnimationRuntimeStart: () => this.requestAnimationRuntimeStart(),
      requestColorCycleRuntimeStart: () => this.requestColorCycleRuntimeStart(state, cause),
    });
    this.syncAnimationRuntime(state);
  }

  syncColorCycleLayers(state: AppState, cause?: string): void {
    colorCyclePlaybackParticipant.sync({
      state,
      cause,
      requestAnimationRuntimeStart: () => this.requestAnimationRuntimeStart(),
      requestColorCycleRuntimeStart: () => this.requestColorCycleRuntimeStart(state, cause),
    });
    this.syncAnimationRuntime(state);
  }

  registerAnimationConsumer(consumer: PlaybackRuntimeConsumer): Unregister {
    const runtime = getSharedAnimationRuntime();
    const unregister = runtime.register(consumer);
    this.requestAnimationRuntimeStart();
    return unregister;
  }

  requestAnimationRuntimeStart(): void {
    getSharedAnimationRuntime().start();
  }

  requestAnimationRuntimeStop(): void {
    getSharedAnimationRuntime().stop();
  }

  requestColorCycleRuntimeStart(state: AppState, cause?: string): void {
    state.colorCycleRuntimeHandlers.start?.(cause ?? 'playback-controller');
  }

  syncAnimationRuntime(state: AppState): void {
    if (this.registry.hasWork(state)) {
      this.requestAnimationRuntimeStart();
    }
  }
}

const playbackRuntimeController = new PlaybackRuntimeController();

export const getPlaybackRuntimeController = (): PlaybackRuntimeController =>
  playbackRuntimeController;
