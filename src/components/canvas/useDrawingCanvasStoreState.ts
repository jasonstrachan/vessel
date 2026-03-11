import { useStoreSelectorRef } from '@/hooks/useStoreSelectorRef';
import { useAppStore } from '@/stores/useAppStore';
import { useShallow } from 'zustand/react/shallow';

export const useDrawingCanvasStoreState = () => {
  const stateValues = useAppStore(
    useShallow((state) => ({
      project: state.project,
      projectFilename: state.projectFilename,
      layers: state.layers,
      referenceLayerId: state.referenceLayerId,
      preferReferenceSampling: state.colorPickerPreferReferenceLayer,
      activeLayerId: state.activeLayerId,
      selectionStart: state.selectionStart,
      selectionEnd: state.selectionEnd,
      floatingPaste: state.floatingPaste,
      layersNeedRecomposition: state.layersNeedRecomposition,
      canvasZoom: state.canvas.zoom,
      canvasOffsetX: state.canvas.offsetX,
      canvasOffsetY: state.canvas.offsetY,
      displayMode: state.canvas.displayMode,
      compositeBitmap: state.currentCompositeBitmap,
      compositeSegmentsVersion: state.compositeSegmentsVersion,
      currentTool: state.tools.currentTool,
      selectionMode: state.tools.selectionMode,
      brushSettings: state.tools.brushSettings,
      fillSettings: state.tools.fillSettings,
      wandSettings: state.tools.wandSettings,
      eraserSettings: state.tools.eraserSettings,
      shapeMode: state.tools.shapeMode,
      customBrushCapture: state.tools.customBrushCapture,
      previousTool: state.tools.previousTool,
      colorAdjustActive: state.colorAdjust.active,
      globalBrushSize: state.globalBrushSize,
      palette: state.palette,
      polygonGradientState: state.polygonGradientState,
      recolorSampling: state.recolorSampling,
      currentBrushPresetId: state.currentBrushPreset?.id ?? null,
      temporaryCustomBrush: state.temporaryCustomBrush,
      selectionMask: state.selectionMask,
      selectionMaskBounds: state.selectionMaskBounds,
      selectionVectorPath: state.selectionVectorPath,
      historyMaxSize: state.history.maxHistorySize,
    }))
  );

  const actionValues = useAppStore(
    useShallow((state) => ({
      setCanvasShapeDraft: state.setCanvasShapeDraft,
      commitCanvasShape: state.commitCanvasShape,
      cancelCanvasShapeEdit: state.cancelCanvasShapeEdit,
      compositeLayersToCanvas: state.compositeLayersToCanvas,
      getCompositeSegmentsSnapshot: state.getCompositeSegmentsSnapshot,
      setActiveColor: state.setActiveColor,
      setBrushSettings: state.setBrushSettings,
      updateRecolorSampling: state.updateRecolorSampling,
      stopRecolorSampling: state.stopRecolorSampling,
      setRectangleBrushState: state.setRectangleBrushState,
      setLayersNeedRecomposition: state.setLayersNeedRecomposition,
      setSelectionBounds: state.setSelectionBounds,
      clearSelection: state.clearSelection,
      extractSelectionToFloatingPaste: state.extractSelectionToFloatingPaste,
      setFloatingPaste: state.setFloatingPaste,
      updateFloatingPastePosition: state.updateFloatingPastePosition,
      commitFloatingPaste: state.commitFloatingPaste,
      cancelFloatingPaste: state.cancelFloatingPaste,
      setCurrentOffscreenCanvas: state.setCurrentOffscreenCanvas,
      renderStaticComposite: state.renderStaticComposite,
      getCustomBrushByIdUnsafe: state.getCustomBrushByIdUnsafe,
      setHistorySize: state.setHistorySize,
      setCanvasDimensions: state.setCanvasDimensions,
      setZoom: state.setZoom,
      setCanvasOffset: state.setCanvasOffset,
      setCanvasViewport: state.setCanvasViewport,
      undo: state.undo,
      redo: state.redo,
      updateLayer: state.updateLayer,
      applyColorAdjust: state.applyColorAdjust,
      cancelColorAdjust: state.cancelColorAdjust,
      setCustomBrushFreehandPath: state.setCustomBrushFreehandPath,
    }))
  );

  const selectionClipboardRef = useStoreSelectorRef((state) => state.selectionClipboard);

  return {
    ...stateValues,
    ...actionValues,
    selectionClipboardRef,
  };
};
