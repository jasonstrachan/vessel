import type { useDrawingHandlersColorCycleRuntimeStage } from '@/hooks/canvas/useDrawingHandlersColorCycleRuntimeStage';
import type { useDrawingHandlersRuntimeSetupStage } from '@/hooks/canvas/useDrawingHandlersRuntimeSetupStage';
import type { UseDrawingHandlersBridgeRuntimesOptions } from '@/hooks/canvas/useDrawingHandlersBridgeRuntimes';

type RuntimeSetupStageArgs = Parameters<typeof useDrawingHandlersRuntimeSetupStage>[0];
type ColorCycleRuntime = ReturnType<typeof useDrawingHandlersColorCycleRuntimeStage>;

interface BuildDrawingHandlersRuntimeSetupStageArgsOptions
  extends Pick<
    UseDrawingHandlersBridgeRuntimesOptions,
    | 'options'
    | 'refs'
    | 'storeRef'
    | 'shapeMode'
    | 'toolsRef'
    | 'captureCanvasToActiveLayer'
    | 'brushEngine'
    | 'userBrushEngine'
    | 'shapeRuntime'
    | 'brushToolRuntime'
  > {
  colorCycleRuntime: ColorCycleRuntime;
}

export const buildDrawingHandlersRuntimeSetupStageArgs = ({
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
}: BuildDrawingHandlersRuntimeSetupStageArgsOptions): RuntimeSetupStageArgs => ({
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
});
