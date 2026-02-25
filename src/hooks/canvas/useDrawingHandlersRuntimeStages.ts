import { useDrawingHandlersBridgeRuntimes } from '@/hooks/canvas/useDrawingHandlersBridgeRuntimes';
import { useDrawingHandlersToolRuntimes } from '@/hooks/canvas/useDrawingHandlersToolRuntimes';
import type { UseDrawingHandlersRuntimeStagesOptions } from '@/hooks/canvas/useDrawingHandlersRuntimeStages.types';

export const useDrawingHandlersRuntimeStages = ({
  project,
  isBusyRef,
  sampleColorAt,
  perf,
}: UseDrawingHandlersRuntimeStagesOptions) => {
  const options: UseDrawingHandlersRuntimeStagesOptions = {
    project,
    isBusyRef,
    sampleColorAt,
    perf,
  };
  const {
    refs,
    brushEngine,
    userBrushEngine,
    storeRef,
    shapeMode,
    toolsRef,
    captureCanvasToActiveLayer,
    activeLayerWidth,
    activeLayerHeight,
    shapeRuntime,
    brushToolRuntime,
  } = useDrawingHandlersToolRuntimes();

  const { colorCycleRuntime, runtimeHandlers } = useDrawingHandlersBridgeRuntimes({
    options,
    refs,
    storeRef,
    shapeMode,
    toolsRef,
    captureCanvasToActiveLayer,
    activeLayerWidth,
    activeLayerHeight,
    brushEngine,
    userBrushEngine,
    shapeRuntime,
    brushToolRuntime,
  });

  return {
    refs,
    shapeRuntime,
    brushToolRuntime,
    colorCycleRuntime,
    runtimeHandlers,
  };
};
