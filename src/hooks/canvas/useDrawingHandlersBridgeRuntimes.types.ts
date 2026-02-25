import type { useDrawingHandlersColorCycleBridge } from '@/hooks/canvas/useDrawingHandlersColorCycleBridge';
import type { UseDrawingHandlersBridgeRuntimesOptions } from '@/hooks/canvas/useDrawingHandlersBridgeRuntimes';

export type UseDrawingHandlersColorCycleRuntimeStageOptions = Pick<
  UseDrawingHandlersBridgeRuntimesOptions,
  | 'options'
  | 'refs'
  | 'storeRef'
  | 'captureCanvasToActiveLayer'
  | 'activeLayerWidth'
  | 'activeLayerHeight'
>;

type ColorCycleRuntime = ReturnType<typeof useDrawingHandlersColorCycleBridge>;

export type UseDrawingHandlersRuntimeSetupStageOptions = Pick<
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
> & {
  colorCycleRuntime: ColorCycleRuntime;
};
