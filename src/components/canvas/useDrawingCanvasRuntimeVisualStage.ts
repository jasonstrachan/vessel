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
      colorCycleFillMode: state.tools.brushSettings.colorCycleFillMode,
    },
  });

  const brushEngine = useBrushEngineSimplified();

  const { updateColorCycleGradientRef, setColorCycleFlowModeRef, colorCycleManagerRef } =
    useDrawingCanvasColorCycleRuntime({
      brushRuntime: {
        updateColorCycleGradient: brushEngine.updateColorCycleGradient,
        setColorCycleFlowMode: brushEngine.setColorCycleFlowMode,
      },
      setNeedsRedraw: state.setNeedsRedraw,
    });

  return {
    visualRuntime,
    handlerBrushRuntime: {
      drawRectangleGradient: brushEngine.drawRectangleGradient,
    },
    brushRuntime: {
      applyStrokeDither: brushEngine.applyStrokeDither,
      drawContourPolygon: brushEngine.drawContourPolygon,
      drawRectangleGradient: brushEngine.drawRectangleGradient,
      resetColorCycle: brushEngine.resetColorCycle,
      fillCcGradientConcentric: brushEngine.fillCcGradientConcentric,
      renderColorCycle: brushEngine.renderColorCycle,
      drawPolygonGradient: brushEngine.drawPolygonGradient,
    },
    shapeBrushRuntime: {
      drawContourPolygon: brushEngine.drawContourPolygon,
      drawCrossHatchPolygon: brushEngine.drawCrossHatchPolygon,
      drawDelaunayPolygon: brushEngine.drawDelaunayPolygon,
      drawPolygonGradient: brushEngine.drawPolygonGradient,
    },
    colorCycleRuntime: {
      updateColorCycleGradientRef,
      setColorCycleFlowModeRef,
      colorCycleManagerRef,
    },
  };
};
