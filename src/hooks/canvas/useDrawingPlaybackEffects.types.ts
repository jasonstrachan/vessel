import type { MutableRefObject } from 'react';
import type { AppState } from '@/stores/useAppStore';

export interface UseDrawingPlaybackEffectsOptions {
  startPlaybackRef: MutableRefObject<((reason?: string) => void) | null>;
  startContinuousColorCycleAnimation: (reason?: string) => void;
  cancelDeferredOverlayRender: () => void;
  project: { width: number; height: number } | null;
  ensureOverlayInitialized: () => boolean;
  getEffectiveColorCyclePlaying: () => boolean;
  startupKickDoneRef: MutableRefObject<boolean>;
  storeRef: MutableRefObject<AppState>;
  continuousColorCycleAnimationActiveRef: MutableRefObject<boolean>;
  startingColorCycleAnimationRef: MutableRefObject<boolean>;
  skipStartLogAtRef: MutableRefObject<Record<string, number>>;
  skipStopLogAtRef: MutableRefObject<Record<string, number>>;
  skipCcLogThrottleMs: number;
  ccLog: (label: string, payload?: Record<string, unknown>) => void;
  stopContinuousColorCycleAnimation: (reason?: string) => void;
  drawingCtxRef: MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  drawingCanvasHasContent: MutableRefObject<boolean>;
  initDrawingCanvas: () => void;
  shapeMode: boolean;
}
