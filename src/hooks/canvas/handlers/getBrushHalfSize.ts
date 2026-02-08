import type React from 'react';
import type { AppState } from '@/stores/useAppStore';

export const getBrushHalfSize = (state: AppState): number => {
  const brushSize = state.tools.brushSettings.size ?? state.globalBrushSize;
  const eraserSettings = state.tools.eraserSettings;
  const effectiveSize =
    eraserSettings.linkSizeToBrush === false
      ? eraserSettings.size ?? brushSize
      : brushSize;
  return Math.max(1, effectiveSize ?? 1) / 2;
};

export const createBrushHalfSizeGetter = (
  storeRef: React.MutableRefObject<AppState>
): (() => number) => () => getBrushHalfSize(storeRef.current);
