import type { UseDrawingHandlersBridgeRuntimesOptions } from '@/hooks/canvas/useDrawingHandlersBridgeRuntimes';
import type { UseDrawingHandlersColorCycleRuntimeStageOptions } from '@/hooks/canvas/useDrawingHandlersBridgeRuntimes.types';

interface BuildDrawingHandlersBridgeColorCycleStageOptions {
  options: UseDrawingHandlersBridgeRuntimesOptions['options'];
  refs: UseDrawingHandlersBridgeRuntimesOptions['refs'];
  storeRef: UseDrawingHandlersBridgeRuntimesOptions['storeRef'];
  captureCanvasToActiveLayer: UseDrawingHandlersBridgeRuntimesOptions['captureCanvasToActiveLayer'];
  activeLayerWidth: UseDrawingHandlersBridgeRuntimesOptions['activeLayerWidth'];
  activeLayerHeight: UseDrawingHandlersBridgeRuntimesOptions['activeLayerHeight'];
}

export const buildDrawingHandlersBridgeColorCycleStageOptions = ({
  options,
  refs,
  storeRef,
  captureCanvasToActiveLayer,
  activeLayerWidth,
  activeLayerHeight,
}: BuildDrawingHandlersBridgeColorCycleStageOptions): UseDrawingHandlersColorCycleRuntimeStageOptions => ({
  options,
  refs,
  storeRef,
  captureCanvasToActiveLayer,
  activeLayerWidth,
  activeLayerHeight,
});
