import { useBrushEngineSimplified } from '@/hooks/useBrushEngineSimplified';
import type { DrawingCanvasRuntimeStateBundle } from './useDrawingCanvasRuntimeStateBundle';
import { useDrawingCanvasColorCycleRuntime } from './useDrawingCanvasColorCycleRuntime';
import { useDrawingCanvasVisualRuntimeSetup } from './useDrawingCanvasVisualRuntimeSetup';

interface UseDrawingCanvasRuntimeVisualStageOptions {
  state: DrawingCanvasRuntimeStateBundle;
}

export const useDrawingCanvasRuntimeVisualStage = ({
  state,
}: UseDrawingCanvasRuntimeVisualStageOptions) => {
  const visualRuntime = useDrawingCanvasVisualRuntimeSetup({
    runtime: {
      colorCycleBrushManagerRef: state.colorCycleBrushManagerRef,
      shouldUseColorCycleWorker: state.shouldUseColorCycleWorker,
      hasWarnedColorCycleWorkerRef: state.hasWarnedColorCycleWorkerRef,
      layers: state.layers,
      compositeSegmentsVersion: state.compositeSegmentsVersion,
      getCompositeSegmentsSnapshot: state.getCompositeSegmentsSnapshot,
      layerMapRef: state.layerMapRef,
      compositeSegmentsRef: state.compositeSegmentsRef,
      pendingColorCycleRefreshRef: state.pendingColorCycleRefreshRef,
      maskManager: state.maskManager,
    },
    pointer: {
      canvasRef: state.canvasRef,
      mousePositionRef: state.mousePositionRef,
      activeCanvasShape: state.activeCanvasShape,
      canvasOffsetX: state.canvasOffsetX,
      canvasOffsetY: state.canvasOffsetY,
      canvasZoom: state.canvasZoom,
    },
    cursor: {
      currentTool: state.tools.currentTool,
      brushShape: state.tools.brushSettings.brushShape,
      shapeMode: state.tools.shapeMode,
    },
  });

  const brushEngine = useBrushEngineSimplified();

  const { updateColorCycleGradientRef, setColorCycleFlowModeRef, colorCycleManagerRef } =
    useDrawingCanvasColorCycleRuntime({
      brushEngine: {
        updateColorCycleGradient: brushEngine.updateColorCycleGradient,
        setColorCycleFlowMode: brushEngine.setColorCycleFlowMode,
      },
      setNeedsRedraw: state.setNeedsRedraw,
    });

  return {
    visualRuntime,
    brushEngine,
    colorCycleRuntime: {
      updateColorCycleGradientRef,
      setColorCycleFlowModeRef,
      colorCycleManagerRef,
    },
  };
};
