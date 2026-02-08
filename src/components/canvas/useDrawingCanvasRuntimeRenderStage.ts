import type { DrawingCanvasRuntimeStateBundle } from './useDrawingCanvasRuntimeStateBundle';
import { useDrawingCanvasRenderRuntimeSetup } from './useDrawingCanvasRenderRuntimeSetup';

interface UseDrawingCanvasRuntimeRenderStageOptions {
  state: DrawingCanvasRuntimeStateBundle;
  colorCycleManagerRef: Parameters<
    typeof useDrawingCanvasRenderRuntimeSetup
  >[0]['baseRendererOptions']['colorCycleManagerRef'];
}

export const useDrawingCanvasRuntimeRenderStage = ({
  state,
  colorCycleManagerRef,
}: UseDrawingCanvasRuntimeRenderStageOptions) =>
  useDrawingCanvasRenderRuntimeSetup({
    layers: state.layers,
    referenceLayerId: state.referenceLayerId,
    preferReferenceSampling: state.preferReferenceSampling,
    compositeCanvasRef: state.compositeCanvasRef,
    layerRenderShared: {
      project: state.project,
      layers: state.layers,
      activeLayerId: state.activeLayerId,
      brushShape: state.tools.brushSettings.brushShape,
      antialiasing: state.tools.brushSettings.antialiasing,
      displayMode: state.displayMode,
      layerTransferCacheRef: state.layerTransferCacheRef,
    },
    staticCompositeOptions: {
      underCompositeCanvasRef: state.underCompositeCanvasRef,
      overCompositeCanvasRef: state.overCompositeCanvasRef,
      underCompositeHasContentRef: state.underCompositeHasContentRef,
      overCompositeHasContentRef: state.overCompositeHasContentRef,
      compositeCanvasRef: state.compositeCanvasRef,
      renderStaticComposite: state.renderStaticComposite,
      setCurrentOffscreenCanvas: state.setCurrentOffscreenCanvas,
    },
    baseRendererOptions: {
      project: state.project,
      activeCanvasShape: state.activeCanvasShape,
      canvasShapeEditor: state.canvasShapeEditor,
      checkerPatternCanvasRef: state.checkerPatternCanvasRef,
      checkerPatternCacheRef: state.checkerPatternCacheRef,
      currentTool: state.tools.currentTool,
      displayMode: state.displayMode,
      compositeCanvasDirtyRef: state.compositeCanvasDirtyRef,
      compositeSegmentsRef: state.compositeSegmentsRef,
      layerMapRef: state.layerMapRef,
      compositeBitmap: state.compositeBitmap,
      colorCycleManagerRef,
      floatingPaste: state.floatingPaste,
      marchingAntsOffset: state.marchingAntsOffset,
      pasteCanvasRef: state.pasteCanvasRef,
      lastPasteInfoRef: state.lastPasteInfoRef,
      selectionStart: state.selectionStart,
      selectionEnd: state.selectionEnd,
      selectionMask: state.selectionMask,
      selectionMaskBounds: state.selectionMaskBounds,
    },
  });
