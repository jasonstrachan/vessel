import { useMemo } from 'react';
import type { BrushShape } from '@/types';
import { resolveDefaultCursorStyle } from './defaultCursorStyle';

interface UseDrawingCanvasDefaultCursorStyleOptions {
  currentTool: string;
  brushShape: BrushShape | undefined;
  shapeMode: boolean;
}

export const useDrawingCanvasDefaultCursorStyle = ({
  currentTool,
  brushShape,
  shapeMode,
}: UseDrawingCanvasDefaultCursorStyleOptions) => {
  return useMemo(
    () =>
      resolveDefaultCursorStyle({
        currentTool: currentTool as Parameters<typeof resolveDefaultCursorStyle>[0]['currentTool'],
        brushShape,
        shapeMode,
      }),
    [brushShape, currentTool, shapeMode]
  );
};
