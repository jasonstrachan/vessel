import { useMemo } from 'react';
import type { BrushSettings, BrushShape } from '@/types';
import { resolveDefaultCursorStyle } from './defaultCursorStyle';

interface UseDrawingCanvasDefaultCursorStyleOptions {
  currentTool: string;
  brushShape: BrushShape | undefined;
  shapeMode: boolean;
  colorCycleFillMode?: BrushSettings['colorCycleFillMode'];
}

export const useDrawingCanvasDefaultCursorStyle = ({
  currentTool,
  brushShape,
  shapeMode,
  colorCycleFillMode,
}: UseDrawingCanvasDefaultCursorStyleOptions) => {
  return useMemo(
    () =>
      resolveDefaultCursorStyle({
        currentTool: currentTool as Parameters<typeof resolveDefaultCursorStyle>[0]['currentTool'],
        brushShape,
        shapeMode,
        colorCycleFillMode,
      }),
    [brushShape, colorCycleFillMode, currentTool, shapeMode]
  );
};
