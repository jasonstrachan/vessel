import type { AppState } from '@/stores/useAppStore';

export type PlaybackRuntimeConsumer = (timestampMs: number, deltaMs: number) => void;

export interface PlaybackParticipantSyncContext {
  state: AppState;
  cause?: string;
  requestAnimationRuntimeStart: () => void;
  requestColorCycleRuntimeStart: () => void;
}

export interface PlaybackParticipant {
  readonly id: string;
  hasWork(state: AppState): boolean;
  sync(context: PlaybackParticipantSyncContext): void;
}

export class PlaybackParticipantRegistry {
  private readonly participants = new Map<string, PlaybackParticipant>();

  register(participant: PlaybackParticipant): void {
    this.participants.set(participant.id, participant);
  }

  unregister(id: string): void {
    this.participants.delete(id);
  }

  hasWork(state: AppState): boolean {
    for (const participant of this.participants.values()) {
      if (participant.hasWork(state)) {
        return true;
      }
    }
    return false;
  }

  sync(context: PlaybackParticipantSyncContext): void {
    this.participants.forEach((participant) => participant.sync(context));
  }
}
