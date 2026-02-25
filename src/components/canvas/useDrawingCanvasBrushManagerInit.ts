import { useEffect, type MutableRefObject } from 'react';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';

interface UseDrawingCanvasBrushManagerInitOptions {
  colorCycleBrushManagerRef: MutableRefObject<ColorCycleBrushManager | null>;
  getBrushManager: () => ColorCycleBrushManager;
}

export const useDrawingCanvasBrushManagerInit = ({
  colorCycleBrushManagerRef,
  getBrushManager,
}: UseDrawingCanvasBrushManagerInitOptions) => {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    colorCycleBrushManagerRef.current = getBrushManager();
  }, [colorCycleBrushManagerRef, getBrushManager]);
};
