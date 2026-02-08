import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { PixelQueue } from '@/hooks/brushEngine/types';
import { resetColorCyclePixelQueue as resetColorCyclePixelQueueExternal } from '@/hooks/canvas/handlers/strokeBatching';

export const prepareStrokeStartColorCycleState = ({
  currentState,
  isColorCycleBrush,
  getEffectiveColorCyclePlaying,
  pauseNonColorCycleInteraction,
  colorCycleDistanceRef,
  colorCycleLastPosRef,
  colorCycleLastRotationRef,
  colorCyclePixelQueueRef,
  createPixelQueue,
  brushEngine,
  colorCycleAnimationRef,
}: {
  currentState: AppState;
  isColorCycleBrush: boolean;
  getEffectiveColorCyclePlaying: () => boolean;
  pauseNonColorCycleInteraction: () => void;
  colorCycleDistanceRef: React.MutableRefObject<number>;
  colorCycleLastPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  colorCycleLastRotationRef: React.MutableRefObject<number | undefined>;
  colorCyclePixelQueueRef: React.MutableRefObject<PixelQueue | null>;
  createPixelQueue: () => PixelQueue;
  brushEngine: { resetColorCycle: () => void } | null;
  colorCycleAnimationRef: React.MutableRefObject<number | null>;
}): boolean => {
  void currentState;
  let colorCyclePlayingAtStrokeStart = false;
  colorCycleLastRotationRef.current = undefined;

  if (!isColorCycleBrush) {
    pauseNonColorCycleInteraction();
    return colorCyclePlayingAtStrokeStart;
  }

  const globalIsPlaying = getEffectiveColorCyclePlaying();
  colorCyclePlayingAtStrokeStart = globalIsPlaying;
  const shouldAnimateLive = !globalIsPlaying;

  colorCycleDistanceRef.current = 0;
  colorCycleLastPosRef.current = null;
  colorCycleLastRotationRef.current = undefined;

  resetColorCyclePixelQueueExternal(colorCyclePixelQueueRef, { createPixelQueue });

  brushEngine?.resetColorCycle();

  if (!shouldAnimateLive) {
    colorCycleAnimationRef.current = null;
  }

  return colorCyclePlayingAtStrokeStart;
};
