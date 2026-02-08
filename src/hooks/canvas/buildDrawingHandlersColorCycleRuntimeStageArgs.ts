import type { useDrawingHandlersColorCycleRuntimeStage } from '@/hooks/canvas/useDrawingHandlersColorCycleRuntimeStage';
import type { UseDrawingHandlersBridgeRuntimesOptions } from '@/hooks/canvas/useDrawingHandlersBridgeRuntimes';

type ColorCycleRuntimeStageArgs = Parameters<typeof useDrawingHandlersColorCycleRuntimeStage>[0];

export const buildDrawingHandlersColorCycleRuntimeStageArgs = ({
  options,
  refs,
  storeRef,
  captureCanvasToActiveLayer,
  activeLayerWidth,
  activeLayerHeight,
}: Pick<
  UseDrawingHandlersBridgeRuntimesOptions,
  | 'options'
  | 'refs'
  | 'storeRef'
  | 'captureCanvasToActiveLayer'
  | 'activeLayerWidth'
  | 'activeLayerHeight'
>): ColorCycleRuntimeStageArgs => ({
  options,
  refs,
  storeRef,
  captureCanvasToActiveLayer,
  activeLayerWidth,
  activeLayerHeight,
});
