import type { MutableRefObject } from 'react';
import type { AppState } from '@/stores/useAppStore';

export interface DrawingPlaybackSyncCoreOptions {
  startContinuousColorCycleAnimation: (reason?: string) => void;
  stopContinuousColorCycleAnimation: (reason?: string) => void;
  storeRef: MutableRefObject<AppState>;
  continuousColorCycleAnimationActiveRef: MutableRefObject<boolean>;
  startingColorCycleAnimationRef: MutableRefObject<boolean>;
  skipStartLogAtRef: MutableRefObject<Record<string, number>>;
  skipStopLogAtRef: MutableRefObject<Record<string, number>>;
  skipCcLogThrottleMs: number;
  ccLog: (label: string, payload?: Record<string, unknown>) => void;
}

export interface UseDrawingPlaybackSyncEffectOptions extends DrawingPlaybackSyncCoreOptions {
  getEffectiveColorCyclePlaying: () => boolean;
}
