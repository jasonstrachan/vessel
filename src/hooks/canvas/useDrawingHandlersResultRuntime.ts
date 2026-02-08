import { buildDrawingHandlersResultArgs } from '@/hooks/canvas/buildDrawingHandlersResultArgs';
import { buildDrawingHandlersResultRuntimeHandlers } from '@/hooks/canvas/buildDrawingHandlersResultRuntimeHandlers';
import { useDrawingHandlersResultArgsBridge } from '@/hooks/canvas/useDrawingHandlersResultArgsBridge';
import { useDrawingHandlersResultBridge } from '@/hooks/canvas/useDrawingHandlersResultBridge';
import type { useDrawingHandlersRuntimeStages } from '@/hooks/canvas/useDrawingHandlersRuntimeStages';

type RuntimeStages = ReturnType<typeof useDrawingHandlersRuntimeStages>;

interface UseDrawingHandlersResultRuntimeOptions {
  refs: RuntimeStages['refs'];
  shapeRuntime: RuntimeStages['shapeRuntime'];
  brushToolRuntime: RuntimeStages['brushToolRuntime'];
  colorCycleRuntime: RuntimeStages['colorCycleRuntime'];
  runtimeHandlers: RuntimeStages['runtimeHandlers'];
}

export const useDrawingHandlersResultRuntime = ({
  refs,
  shapeRuntime,
  brushToolRuntime,
  colorCycleRuntime,
  runtimeHandlers,
}: UseDrawingHandlersResultRuntimeOptions) =>
  useDrawingHandlersResultBridge(
    useDrawingHandlersResultArgsBridge(
      buildDrawingHandlersResultArgs({
        refs,
        shapeRuntime,
        brushToolRuntime,
        colorCycleRuntime,
        runtimeHandlers: buildDrawingHandlersResultRuntimeHandlers({ runtimeHandlers }),
      })
    )
  );
