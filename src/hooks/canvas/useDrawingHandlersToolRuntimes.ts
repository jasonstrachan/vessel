import { useDrawingHandlersEngineRuntimes } from '@/hooks/canvas/useDrawingHandlersEngineRuntimes';
import { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import { useDrawingHandlersStoreState } from '@/hooks/canvas/useDrawingHandlersStoreState';
import { useDrawingHandlersToolRuntimeBridges } from '@/hooks/canvas/useDrawingHandlersToolRuntimeBridges';

export const useDrawingHandlersToolRuntimes = () => {
  const {
    brushStampRuntime,
    strokeBrushRuntime,
    finalizeBrushRuntime,
    shapeBrushRuntime,
    playbackBrushRuntime,
    userBrushEngine,
  } = useDrawingHandlersEngineRuntimes();
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
    brushStampRuntime,
    userBrushEngine,
  });

  return {
    refs,
    strokeBrushRuntime,
    finalizeBrushRuntime,
    shapeBrushRuntime,
    playbackBrushRuntime,
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
