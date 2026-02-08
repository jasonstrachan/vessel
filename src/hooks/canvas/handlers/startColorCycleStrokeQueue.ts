import type React from 'react';
import type { PixelQueue } from '@/hooks/brushEngine/types';
import type { AppState } from '@/stores/useAppStore';
import { getCcEffectiveSpacing } from '@/hooks/canvas/utils/ccSpacing';
import { selectEffectiveColorCyclePlaying } from '@/stores/useAppStore';

export const prepareColorCycleStrokeQueue = ({
  currentState,
  colorCyclePixelQueue,
  createPixelQueue,
  scheduleRecompose,
}: {
  currentState: AppState;
  colorCyclePixelQueue: React.MutableRefObject<PixelQueue | null>;
  createPixelQueue: () => PixelQueue;
  scheduleRecompose: (roi?: { x: number; y: number; width: number; height: number }) => void;
}): {
  pixelQueue: PixelQueue;
  spacingScreenPx: number;
  markDirty: (cx: number, cy: number) => void;
} => {
  const effectiveSpacing = getCcEffectiveSpacing(currentState);
  const pausedForStart = !selectEffectiveColorCyclePlaying(currentState);
  const pixelQueue = colorCyclePixelQueue.current ?? (() => {
    const queue = createPixelQueue();
    colorCyclePixelQueue.current = queue;
    return queue;
  })();
  const brushSize = currentState.tools.brushSettings.size || 1;
  const recomposeHalf = Math.ceil(brushSize / 2) + 2;
  const spacingScreenPx = pausedForStart
    ? Math.max(1, Math.round(effectiveSpacing * 1.25))
    : effectiveSpacing;
  const markDirty = (cx: number, cy: number) => {
    if (!pausedForStart) {
      return;
    }
    const width = recomposeHalf * 2;
    const height = width;
    const x = Math.floor(cx - recomposeHalf);
    const y = Math.floor(cy - recomposeHalf);
    if (typeof pixelQueue.addDirtyRect === 'function') {
      pixelQueue.addDirtyRect(x, y, width, height);
    } else {
      scheduleRecompose({ x, y, width, height });
    }
  };

  return { pixelQueue, spacingScreenPx, markDirty };
};
