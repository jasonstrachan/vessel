import type { UseDrawingHandlersBridgeRuntimesOptions } from '@/hooks/canvas/useDrawingHandlersBridgeRuntimes';
import type { useDrawingHandlersColorCycleBridge } from '@/hooks/canvas/useDrawingHandlersColorCycleBridge';
import type { UseDrawingHandlersRuntimeSetupStageOptions } from '@/hooks/canvas/useDrawingHandlersBridgeRuntimes.types';

interface BuildDrawingHandlersBridgeRuntimeSetupStageOptions {
  options: UseDrawingHandlersBridgeRuntimesOptions['options'];
  refs: UseDrawingHandlersBridgeRuntimesOptions['refs'];
  storeRef: UseDrawingHandlersBridgeRuntimesOptions['storeRef'];
  shapeMode: UseDrawingHandlersBridgeRuntimesOptions['shapeMode'];
  toolsRef: UseDrawingHandlersBridgeRuntimesOptions['toolsRef'];
  captureCanvasToActiveLayer: UseDrawingHandlersBridgeRuntimesOptions['captureCanvasToActiveLayer'];
  strokeBrushRuntime: UseDrawingHandlersBridgeRuntimesOptions['strokeBrushRuntime'];
  finalizeBrushRuntime: UseDrawingHandlersBridgeRuntimesOptions['finalizeBrushRuntime'];
  shapeBrushRuntime: UseDrawingHandlersBridgeRuntimesOptions['shapeBrushRuntime'];
  playbackBrushRuntime: UseDrawingHandlersBridgeRuntimesOptions['playbackBrushRuntime'];
  userBrushEngine: UseDrawingHandlersBridgeRuntimesOptions['userBrushEngine'];
  shapeRuntime: UseDrawingHandlersBridgeRuntimesOptions['shapeRuntime'];
  brushToolRuntime: UseDrawingHandlersBridgeRuntimesOptions['brushToolRuntime'];
  colorCycleRuntime: ReturnType<typeof useDrawingHandlersColorCycleBridge>;
}

export const buildDrawingHandlersBridgeRuntimeSetupStageOptions = ({
  options,
  refs,
  storeRef,
  shapeMode,
  toolsRef,
  captureCanvasToActiveLayer,
  strokeBrushRuntime,
  finalizeBrushRuntime,
  shapeBrushRuntime,
  playbackBrushRuntime,
  userBrushEngine,
  shapeRuntime,
  brushToolRuntime,
  colorCycleRuntime,
}: BuildDrawingHandlersBridgeRuntimeSetupStageOptions): UseDrawingHandlersRuntimeSetupStageOptions => ({
  options,
  refs,
  storeRef,
  shapeMode,
  toolsRef,
  captureCanvasToActiveLayer,
  strokeBrushRuntime,
  finalizeBrushRuntime,
  shapeBrushRuntime,
  playbackBrushRuntime,
  userBrushEngine,
  shapeRuntime,
  brushToolRuntime,
  colorCycleRuntime,
});
