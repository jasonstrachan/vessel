import { useDrawingHandlersRuntimeSetupBridge } from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge';
import { buildDrawingHandlersRuntimeSetupBridgeOptions } from '@/hooks/canvas/buildDrawingHandlersRuntimeSetupBridgeOptions';
import { buildDrawingHandlersRuntimeStagesSetupArgs } from '@/hooks/canvas/buildDrawingHandlersRuntimeStagesSetupArgs';
import type { UseDrawingHandlersRuntimeSetupStageOptions } from '@/hooks/canvas/useDrawingHandlersBridgeRuntimes.types';

export const useDrawingHandlersRuntimeSetupStage = ({
  options,
  refs,
  storeRef,
  shapeMode,
  toolsRef,
  captureCanvasToActiveLayer,
  brushEngine,
  userBrushEngine,
  shapeRuntime,
  brushToolRuntime,
  colorCycleRuntime,
}: UseDrawingHandlersRuntimeSetupStageOptions) =>
  useDrawingHandlersRuntimeSetupBridge(
    buildDrawingHandlersRuntimeSetupBridgeOptions(
      buildDrawingHandlersRuntimeStagesSetupArgs({
        options,
        refs,
        storeRef,
        shapeMode,
        toolsRef,
        captureCanvasToActiveLayer,
        brushEngine,
        userBrushEngine,
        shapeRuntime,
        brushToolRuntime,
        colorCycleRuntime,
      })
    )
  );
