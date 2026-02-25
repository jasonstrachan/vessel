import { useDrawingHandlersEngineRuntimes } from '@/hooks/canvas/useDrawingHandlersEngineRuntimes';
import { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import { useDrawingHandlersStoreState } from '@/hooks/canvas/useDrawingHandlersStoreState';
import { useDrawingHandlersToolRuntimeBridges } from '@/hooks/canvas/useDrawingHandlersToolRuntimeBridges';

export const useDrawingHandlersToolRuntimes = () => {
  const { brushEngine, userBrushEngine } = useDrawingHandlersEngineRuntimes();
  const {
    captureCanvasToActiveLayer,
    shapeMode,
    activeLayerWidth,
    activeLayerHeight,
    toolsRef,
    storeRef,
  } = useDrawingHandlersStoreState();

  const refs = useDrawingHandlerRefs();

  const { shapeRuntime, brushToolRuntime } = useDrawingHandlersToolRuntimeBridges({
    refs,
    storeRef,
    brushEngine,
    userBrushEngine,
  });

  return {
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
  };
};
