import { useStoreSelectorRef } from '@/hooks/useStoreSelectorRef';
import { useAppStore } from '@/stores/useAppStore';
import {
  selectActiveLayerId,
  selectLayers,
  selectLayersNeedRecomposition,
  selectReferenceLayerId,
  selectSetLayersNeedRecomposition,
} from '@/stores/selectors/layersSelectors';
import { selectFloatingPaste } from '@/stores/selectors/pasteSelectors';
import {
  selectBrushSettings,
  selectCurrentTool,
  selectEraserSettings,
  selectFillSettings,
  selectGlobalBrushSize,
  selectPolygonGradientState,
  selectPreviousTool,
  selectRecolorSampling,
  selectShapeMode,
} from '@/stores/selectors/toolsSelectors';

export const useDrawingCanvasStoreState = () => {
  const project = useAppStore((state) => state.project);
  const setCanvasShapeDraft = useAppStore((state) => state.setCanvasShapeDraft);
  const commitCanvasShape = useAppStore((state) => state.commitCanvasShape);
  const cancelCanvasShapeEdit = useAppStore((state) => state.cancelCanvasShapeEdit);
  const layers = useAppStore(selectLayers);
  const referenceLayerId = useAppStore(selectReferenceLayerId);
  const preferReferenceSampling = useAppStore((state) => state.colorPickerPreferReferenceLayer);
  const activeLayerId = useAppStore(selectActiveLayerId);
  const selectionStart = useAppStore((state) => state.selectionStart);
  const selectionEnd = useAppStore((state) => state.selectionEnd);
  const selectionClipboardRef = useStoreSelectorRef((state) => state.selectionClipboard);
  const floatingPaste = useAppStore(selectFloatingPaste);
  const layersNeedRecomposition = useAppStore(selectLayersNeedRecomposition);
  const canvasZoom = useAppStore((state) => state.canvas.zoom);
  const canvasOffsetX = useAppStore((state) => state.canvas.offsetX);
  const canvasOffsetY = useAppStore((state) => state.canvas.offsetY);
  const displayMode = useAppStore((state) => state.canvas.displayMode);
  const projectFilename = useAppStore((state) => state.projectFilename);
  const compositeBitmap = useAppStore((state) => state.currentCompositeBitmap);
  const compositeLayersToCanvas = useAppStore((state) => state.compositeLayersToCanvas);
  const compositeSegmentsVersion = useAppStore((state) => state.compositeSegmentsVersion);
  const getCompositeSegmentsSnapshot = useAppStore((state) => state.getCompositeSegmentsSnapshot);
  const currentTool = useAppStore(selectCurrentTool);
  const brushSettings = useAppStore(selectBrushSettings);
  const fillSettings = useAppStore(selectFillSettings);
  const eraserSettings = useAppStore(selectEraserSettings);
  const shapeMode = useAppStore(selectShapeMode);
  const customBrushCapture = useAppStore((state) => state.tools.customBrushCapture);
  const previousTool = useAppStore(selectPreviousTool);
  const colorAdjustActive = useAppStore((state) => state.colorAdjust.active);
  const globalBrushSize = useAppStore(selectGlobalBrushSize);
  const palette = useAppStore((state) => state.palette);
  const polygonGradientState = useAppStore(selectPolygonGradientState);
  const recolorSampling = useAppStore(selectRecolorSampling);
  const currentBrushPresetId = useAppStore((state) => state.currentBrushPreset?.id ?? null);
  const setActiveColor = useAppStore((state) => state.setActiveColor);
  const setBrushSettings = useAppStore((state) => state.setBrushSettings);
  const updateRecolorSampling = useAppStore((state) => state.updateRecolorSampling);
  const stopRecolorSampling = useAppStore((state) => state.stopRecolorSampling);
  const setRectangleBrushState = useAppStore((state) => state.setRectangleBrushState);
  const setLayersNeedRecomposition = useAppStore(selectSetLayersNeedRecomposition);
  const setSelectionBounds = useAppStore((state) => state.setSelectionBounds);
  const clearSelection = useAppStore((state) => state.clearSelection);
  const selectionMask = useAppStore((state) => state.selectionMask);
  const selectionMaskBounds = useAppStore((state) => state.selectionMaskBounds);
  const setFloatingPaste = useAppStore((state) => state.setFloatingPaste);
  const updateFloatingPastePosition = useAppStore((state) => state.updateFloatingPastePosition);
  const commitFloatingPaste = useAppStore((state) => state.commitFloatingPaste);
  const cancelFloatingPaste = useAppStore((state) => state.cancelFloatingPaste);
  const setCurrentOffscreenCanvas = useAppStore((state) => state.setCurrentOffscreenCanvas);
  const renderStaticComposite = useAppStore((state) => state.renderStaticComposite);
  const setCanvasDimensions = useAppStore((state) => state.setCanvasDimensions);
  const setZoom = useAppStore((state) => state.setZoom);
  const setCanvasOffset = useAppStore((state) => state.setCanvasOffset);
  const setCanvasViewport = useAppStore((state) => state.setCanvasViewport);
  const undo = useAppStore((state) => state.undo);
  const redo = useAppStore((state) => state.redo);
  const updateLayer = useAppStore((state) => state.updateLayer);
  const applyColorAdjust = useAppStore((state) => state.applyColorAdjust);
  const cancelColorAdjust = useAppStore((state) => state.cancelColorAdjust);
  const setCustomBrushFreehandPath = useAppStore((state) => state.setCustomBrushFreehandPath);

  return {
    project,
    setCanvasShapeDraft,
    commitCanvasShape,
    cancelCanvasShapeEdit,
    layers,
    referenceLayerId,
    preferReferenceSampling,
    activeLayerId,
    selectionStart,
    selectionEnd,
    selectionClipboardRef,
    floatingPaste,
    layersNeedRecomposition,
    canvasZoom,
    canvasOffsetX,
    canvasOffsetY,
    displayMode,
    projectFilename,
    compositeBitmap,
    compositeLayersToCanvas,
    compositeSegmentsVersion,
    getCompositeSegmentsSnapshot,
    currentTool,
    brushSettings,
    fillSettings,
    eraserSettings,
    shapeMode,
    customBrushCapture,
    previousTool,
    colorAdjustActive,
    globalBrushSize,
    palette,
    polygonGradientState,
    recolorSampling,
    currentBrushPresetId,
    setActiveColor,
    setBrushSettings,
    updateRecolorSampling,
    stopRecolorSampling,
    setRectangleBrushState,
    setLayersNeedRecomposition,
    setSelectionBounds,
    clearSelection,
    selectionMask,
    selectionMaskBounds,
    setFloatingPaste,
    updateFloatingPastePosition,
    commitFloatingPaste,
    cancelFloatingPaste,
    setCurrentOffscreenCanvas,
    renderStaticComposite,
    setCanvasDimensions,
    setZoom,
    setCanvasOffset,
    setCanvasViewport,
    undo,
    redo,
    updateLayer,
    applyColorAdjust,
    cancelColorAdjust,
    setCustomBrushFreehandPath,
  };
};
