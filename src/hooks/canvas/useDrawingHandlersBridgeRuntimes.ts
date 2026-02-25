import { buildDrawingHandlersBridgeColorCycleStageOptions } from '@/hooks/canvas/buildDrawingHandlersBridgeColorCycleStageOptions';
import { buildDrawingHandlersBridgeRuntimeSetupStageOptions } from '@/hooks/canvas/buildDrawingHandlersBridgeRuntimeSetupStageOptions';
import { useDrawingHandlersColorCycleRuntimeStage } from '@/hooks/canvas/useDrawingHandlersColorCycleRuntimeStage';
import { useDrawingHandlersRuntimeSetupStage } from '@/hooks/canvas/useDrawingHandlersRuntimeSetupStage';
import type { useDrawingBrushToolRuntime } from '@/hooks/canvas/useDrawingBrushToolRuntime';
import type { UseDrawingHandlersRuntimeStagesOptions } from '@/hooks/canvas/useDrawingHandlersRuntimeStages.types';
import type { useDrawingShapeRuntimeBridge } from '@/hooks/canvas/useDrawingShapeRuntimeBridge';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import type { useDrawingHandlersStoreState } from '@/hooks/canvas/useDrawingHandlersStoreState';
import type { useBrushEngineSimplified } from '@/hooks/useBrushEngineSimplified';
import type { useUserBrushEngine } from '@/hooks/useUserBrushEngine';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type StoreState = ReturnType<typeof useDrawingHandlersStoreState>;

export interface UseDrawingHandlersBridgeRuntimesOptions {
  options: UseDrawingHandlersRuntimeStagesOptions;
  refs: DrawingHandlerRefs;
  storeRef: StoreState['storeRef'];
  shapeMode: StoreState['shapeMode'];
  toolsRef: StoreState['toolsRef'];
  captureCanvasToActiveLayer: StoreState['captureCanvasToActiveLayer'];
  activeLayerWidth: StoreState['activeLayerWidth'];
  activeLayerHeight: StoreState['activeLayerHeight'];
  brushEngine: ReturnType<typeof useBrushEngineSimplified>;
  userBrushEngine: ReturnType<typeof useUserBrushEngine>;
  shapeRuntime: ReturnType<typeof useDrawingShapeRuntimeBridge>;
  brushToolRuntime: ReturnType<typeof useDrawingBrushToolRuntime>;
}

export const useDrawingHandlersBridgeRuntimes = ({
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
}: UseDrawingHandlersBridgeRuntimesOptions) => {
  const colorCycleRuntime = useDrawingHandlersColorCycleRuntimeStage(
    buildDrawingHandlersBridgeColorCycleStageOptions({
      options,
      refs,
      storeRef,
      captureCanvasToActiveLayer,
      activeLayerWidth,
      activeLayerHeight,
    })
  );

  const runtimeHandlers = useDrawingHandlersRuntimeSetupStage(
    buildDrawingHandlersBridgeRuntimeSetupStageOptions({
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
  );

  return {
    colorCycleRuntime,
    runtimeHandlers,
  };
};
