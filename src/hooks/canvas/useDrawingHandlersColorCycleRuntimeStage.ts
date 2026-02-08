import { useDrawingHandlersColorCycleBridge } from '@/hooks/canvas/useDrawingHandlersColorCycleBridge';
import { buildDrawingHandlersColorCycleBridgeOptions } from '@/hooks/canvas/buildDrawingHandlersColorCycleBridgeOptions';
import { buildDrawingHandlersRuntimeStagesColorCycleArgs } from '@/hooks/canvas/buildDrawingHandlersRuntimeStagesColorCycleArgs';
import type { UseDrawingHandlersColorCycleRuntimeStageOptions } from '@/hooks/canvas/useDrawingHandlersBridgeRuntimes.types';

export const useDrawingHandlersColorCycleRuntimeStage = ({
  options,
  refs,
  storeRef,
  captureCanvasToActiveLayer,
  activeLayerWidth,
  activeLayerHeight,
}: UseDrawingHandlersColorCycleRuntimeStageOptions) =>
  useDrawingHandlersColorCycleBridge(
    buildDrawingHandlersColorCycleBridgeOptions(
      buildDrawingHandlersRuntimeStagesColorCycleArgs({
        options,
        refs,
        storeRef,
        captureCanvasToActiveLayer,
        activeLayerWidth,
        activeLayerHeight,
      })
    )
  );
