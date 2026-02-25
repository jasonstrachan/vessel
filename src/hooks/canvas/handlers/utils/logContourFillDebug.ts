import { useAppStore } from '@/stores/useAppStore';
import { BrushShape } from '@/types';
import { debugLog } from '@/utils/debug';

const SUPPORTED_MODES = new Set(['contour', 'lines', 'lines2']);

export const isContourFillLoggingEnabled = (): boolean => {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.NEXT_PUBLIC_ENABLE_CONTOUR_DEBUG_LOGS !== 'false';
};

export const shouldLogContourFill = (
  mode: string | undefined,
  brushShape: BrushShape | undefined
): boolean => {
  if (!mode || !brushShape) return false;
  if (!SUPPORTED_MODES.has(mode)) return false;
  return (
    brushShape === BrushShape.CONTOUR_POLYGON ||
    brushShape === BrushShape.CONTOUR_LINES2
  );
};

export const logContourFillDebug = (message: string, data?: Record<string, unknown>): void => {
  if (!isContourFillLoggingEnabled()) return;

  const store = useAppStore.getState();
  const mode = store.tools.brushSettings.shapeGradientMode || 'contour';
  const brushShape = store.tools.brushSettings.brushShape;

  if (!shouldLogContourFill(mode, brushShape)) return;

  const contextData = {
    fillMode: mode,
    brushShape,
    ...data,
  };

  if (typeof console !== 'undefined') {
    console.log('[ContourFill]', message, contextData);
  }

  debugLog('[ContourFill]', message, contextData);
};
