import { useMemo } from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { BrushSettings, Tool } from '@/types';

interface UseDrawingCanvasToolsSnapshotOptions {
  currentTool: Tool;
  selectionMode: AppState['tools']['selectionMode'];
  brushSettings: BrushSettings;
  fillSettings: {
    threshold: number;
    contiguous: boolean;
    eraseInstead: boolean;
  };
  wandSettings: {
    threshold: number;
    contiguous: boolean;
  };
  eraserSettings: AppState['tools']['eraserSettings'];
  shapeMode: boolean;
  customBrushCapture: AppState['tools']['customBrushCapture'];
}

export const useDrawingCanvasToolsSnapshot = ({
  currentTool,
  selectionMode,
  brushSettings,
  fillSettings,
  wandSettings,
  eraserSettings,
  shapeMode,
  customBrushCapture,
}: UseDrawingCanvasToolsSnapshotOptions) => {
  return useMemo(
    () => ({
      currentTool,
      selectionMode,
      brushSettings,
      fillSettings,
      wandSettings,
      eraserSettings,
      shapeMode,
      customBrushCapture,
    }),
    [brushSettings, currentTool, customBrushCapture, eraserSettings, fillSettings, selectionMode, shapeMode, wandSettings]
  );
};
