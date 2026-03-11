import { useDrawingCanvasCompositeRuntimeState } from './useDrawingCanvasCompositeRuntimeState';
import { useDrawingCanvasCoreState } from './useDrawingCanvasCoreState';
import { useDrawingCanvasElementRefs } from './useDrawingCanvasElementRefs';
import { useDrawingCanvasRenderRuntimeRefs } from './useDrawingCanvasRenderRuntimeRefs';
import { useDrawingCanvasSetupRuntime } from './useDrawingCanvasSetupRuntime';
import { useDrawingCanvasShapeEditorValue } from './useDrawingCanvasShapeEditorValue';
import { useDrawingCanvasStoreState } from './useDrawingCanvasStoreState';
import { useDrawingCanvasAdaptiveHistorySize } from './useDrawingCanvasAdaptiveHistorySize';

export const useDrawingCanvasRuntimeStateBundle = () => {
  const coreState = useDrawingCanvasCoreState();
  const shapeEditorState = useDrawingCanvasShapeEditorValue();
  const storeState = useDrawingCanvasStoreState();

  const setupRuntime = useDrawingCanvasSetupRuntime({
    projectState: {
      project: storeState.project,
      projectFilename: storeState.projectFilename,
    },
    toolState: {
      currentTool: storeState.currentTool,
      selectionMode: storeState.selectionMode,
      brushSettings: storeState.brushSettings,
      fillSettings: storeState.fillSettings,
      wandSettings: storeState.wandSettings,
      eraserSettings: storeState.eraserSettings,
      shapeMode: storeState.shapeMode,
      customBrushCapture: storeState.customBrushCapture,
    },
    handlerState: {
      setFloatingPaste: storeState.setFloatingPaste,
      mousePositionRef: coreState.mousePositionRef,
      brushCursorHandleRef: coreState.brushCursorHandleRef,
    },
  });

  const compositeRuntime = useDrawingCanvasCompositeRuntimeState();
  const renderRuntimeRefs = useDrawingCanvasRenderRuntimeRefs();
  const elementRefs = useDrawingCanvasElementRefs({
    canvasRef: coreState.canvasRef,
    wrapperRef: coreState.wrapperRef,
    overlayCanvasRef: renderRuntimeRefs.overlayCanvasRef,
  });

  const runtimeStoreState = {
    project: storeState.project,
    setCanvasShapeDraft: storeState.setCanvasShapeDraft,
    commitCanvasShape: storeState.commitCanvasShape,
    cancelCanvasShapeEdit: storeState.cancelCanvasShapeEdit,
    layers: storeState.layers,
    referenceLayerId: storeState.referenceLayerId,
    preferReferenceSampling: storeState.preferReferenceSampling,
    activeLayerId: storeState.activeLayerId,
    selectionStart: storeState.selectionStart,
    selectionEnd: storeState.selectionEnd,
    selectionClipboardRef: storeState.selectionClipboardRef,
    floatingPaste: storeState.floatingPaste,
    layersNeedRecomposition: storeState.layersNeedRecomposition,
    canvasZoom: storeState.canvasZoom,
    canvasOffsetX: storeState.canvasOffsetX,
    canvasOffsetY: storeState.canvasOffsetY,
    displayMode: storeState.displayMode,
    compositeBitmap: storeState.compositeBitmap,
    compositeLayersToCanvas: storeState.compositeLayersToCanvas,
    compositeSegmentsVersion: storeState.compositeSegmentsVersion,
    getCompositeSegmentsSnapshot: storeState.getCompositeSegmentsSnapshot,
    previousTool: storeState.previousTool,
    colorAdjustActive: storeState.colorAdjustActive,
    globalBrushSize: storeState.globalBrushSize,
    palette: storeState.palette,
    polygonGradientState: storeState.polygonGradientState,
    recolorSampling: storeState.recolorSampling,
    currentBrushPresetId: storeState.currentBrushPresetId,
    temporaryCustomBrush: storeState.temporaryCustomBrush,
    setActiveColor: storeState.setActiveColor,
    setBrushSettings: storeState.setBrushSettings,
    updateRecolorSampling: storeState.updateRecolorSampling,
    stopRecolorSampling: storeState.stopRecolorSampling,
    setRectangleBrushState: storeState.setRectangleBrushState,
    setLayersNeedRecomposition: storeState.setLayersNeedRecomposition,
    setSelectionBounds: storeState.setSelectionBounds,
    clearSelection: storeState.clearSelection,
    extractSelectionToFloatingPaste: storeState.extractSelectionToFloatingPaste,
    selectionMask: storeState.selectionMask,
    selectionMaskBounds: storeState.selectionMaskBounds,
    selectionVectorPath: storeState.selectionVectorPath,
    updateFloatingPastePosition: storeState.updateFloatingPastePosition,
    commitFloatingPaste: storeState.commitFloatingPaste,
    cancelFloatingPaste: storeState.cancelFloatingPaste,
    setCurrentOffscreenCanvas: storeState.setCurrentOffscreenCanvas,
    renderStaticComposite: storeState.renderStaticComposite,
    getCustomBrushByIdUnsafe: storeState.getCustomBrushByIdUnsafe,
    setCanvasDimensions: storeState.setCanvasDimensions,
    setZoom: storeState.setZoom,
    setCanvasOffset: storeState.setCanvasOffset,
    setCanvasViewport: storeState.setCanvasViewport,
    undo: storeState.undo,
    redo: storeState.redo,
    updateLayer: storeState.updateLayer,
    applyColorAdjust: storeState.applyColorAdjust,
    cancelColorAdjust: storeState.cancelColorAdjust,
    setCustomBrushFreehandPath: storeState.setCustomBrushFreehandPath,
  };

  useDrawingCanvasAdaptiveHistorySize({
    project: storeState.project,
    layerCount: storeState.layers.length,
    historyMaxSize: storeState.historyMaxSize,
    setHistorySize: storeState.setHistorySize,
  });

  return {
    ...coreState,
    ...shapeEditorState,
    ...runtimeStoreState,
    ...setupRuntime,
    ...compositeRuntime,
    ...renderRuntimeRefs,
    ...elementRefs,
  };
};

export type DrawingCanvasRuntimeStateBundle = ReturnType<typeof useDrawingCanvasRuntimeStateBundle>;
