import { useMemo } from 'react';
import { useShapeDrawingHandlers } from '@/hooks/canvas/useShapeDrawingHandlers';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import { CC_DEBUG } from '@/debug/ccDebug';
import { appendSegmentWithDynamicResampling } from '@/utils/shapeMaker';
import { FF } from '@/config/ccFeatureFlags';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import {
  commitRasterShapeFill,
  finalizeDitherGradientShape,
  finalizeRasterShapeFill,
} from '@/hooks/canvas/handlers/shapes/ShapeFinalizeHandler';
import {
  computeFallbackLinearDirection,
  runColorCycleShapeFill,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleShapeFill';
import { isColorCycleLayerWithData } from '@/hooks/canvas/utils/layerGuards';
import { applyBackdropFromSnapshot } from '@/hooks/canvas/utils/canvasBackdrop';
import {
  ensureLayerSnapshotWithRetry,
  inflateShapeBeforeSnapshot,
} from '@/hooks/canvas/utils/snapshots';
import { ROI_PADDING_PX } from '@/hooks/canvas/drawingHandlersConfig';
import {
  boundingBoxToCaptureRegion,
  captureRegionFromPoints,
  createBoundingBox,
  mergeBoundingBox,
} from '@/hooks/canvas/utils/captureRegions';
import { getColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';
import { runIdle } from '@/hooks/canvas/utils/idle';
import { bindBrushToCanvas } from '@/hooks/canvas/handlers/colorCycle/colorCycleSurface';
import { createEnsureActiveColorCycleGradientSlotDispatcher } from '@/hooks/canvas/handlers/colorCycle/ensureActiveColorCycleGradientSlotDispatcher';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type ShapeArgs = Parameters<typeof useShapeDrawingHandlers>[0];

type UseDrawingShapeRuntimeArgs = {
  refs: DrawingHandlerRefs;
  shapeMode: ShapeArgs['shapeMode'];
  toolsRef: ShapeArgs['toolsRef'];
  latestShapePressureRef: ShapeArgs['latestShapePressureRef'];
  lastStablePressureRef: ShapeArgs['lastStablePressureRef'];
  ccGradientSampleSessionRef: ShapeArgs['ccGradientSampleSessionRef'];
  hadValidShapePressureRef: ShapeArgs['hadValidShapePressureRef'];
  latestShapePixelSizeRef: ShapeArgs['latestShapePixelSizeRef'];
  shapeMaxPressureRef: ShapeArgs['shapeMaxPressureRef'];
  finalizeQueueRef: ShapeArgs['finalizeQueueRef'];
  storeRef: ShapeArgs['storeRef'];
  project: ShapeArgs['project'];
  isBusyRef: ShapeArgs['isBusyRef'];
  brushEngine: ShapeArgs['brushEngine'];
  sampleColorAt: ShapeArgs['sampleColorAt'];
  sampleHexAt: ShapeArgs['sampleHexAt'];
  initDrawingCanvas: ShapeArgs['initDrawingCanvas'];
  startDrawing: ShapeArgs['startDrawing'];
  continueDrawing: ShapeArgs['continueDrawing'];
  seedManualStrokeBoundingBox: ShapeArgs['seedManualStrokeBoundingBox'];
  triggerSimpleShapePreview: ShapeArgs['triggerSimpleShapePreview'];
  resetShapeDragRefs: ShapeArgs['resetShapeDragRefs'];
  resetShapePressureState: ShapeArgs['resetShapePressureState'];
  resetCcGradientSample: ShapeArgs['resetCcGradientSample'];
  updateShapePressure: ShapeArgs['updateShapePressure'];
  pauseColorCycleForNonCCInteraction: ShapeArgs['pauseColorCycleForNonCCInteraction'];
  resumeColorCycleAfterInteraction: ShapeArgs['resumeColorCycleAfterInteraction'];
  updateAutoSampledGradient: ShapeArgs['updateAutoSampledGradient'];
  updateCcSampledGradient: ShapeArgs['updateCcSampledGradient'];
  updateCcGradientSample: ShapeArgs['updateCcGradientSample'];
  updateDitherGradSamples: ShapeArgs['updateDitherGradSamples'];
  capturePendingShapeSnapshot: ShapeArgs['capturePendingShapeSnapshot'];
  clearShapeBeforeSnapshot: ShapeArgs['clearShapeBeforeSnapshot'];
  computeAutoSampleStops: ShapeArgs['computeAutoSampleStops'];
  computeShapePixelSize: ShapeArgs['computeShapePixelSize'];
  finalizeDrawing: ShapeArgs['finalizeDrawing'];
  scheduleDeferredColorCycleSaveWithState: ShapeArgs['scheduleDeferredColorCycleSaveWithState'];
  setSharedColorCycleGradient: ShapeArgs['setSharedColorCycleGradient'];
  logError: ShapeArgs['logError'];
  withTiming: ShapeArgs['withTiming'];
  timeAsync: ShapeArgs['timeAsync'];
  timeSync: ShapeArgs['timeSync'];
  ccLog: ShapeArgs['ccLog'];
  perfMark: ShapeArgs['perfMark'];
  perfMeasure: ShapeArgs['perfMeasure'];
  debugTime: ShapeArgs['debugTime'];
  debugTimeEnd: ShapeArgs['debugTimeEnd'];
  resetAutoSampleState: ShapeArgs['resetAutoSampleState'];
  resetPolygonState: ShapeArgs['resetPolygonState'];
  captureCanvasToActiveLayer: ShapeArgs['captureCanvasToActiveLayer'];
  scheduleHistoryCommit: ShapeArgs['scheduleHistoryCommit'];
};

export const useDrawingShapeRuntime = ({
  refs,
  shapeMode,
  toolsRef,
  latestShapePressureRef,
  lastStablePressureRef,
  ccGradientSampleSessionRef,
  hadValidShapePressureRef,
  latestShapePixelSizeRef,
  shapeMaxPressureRef,
  finalizeQueueRef,
  storeRef,
  project,
  isBusyRef,
  brushEngine,
  sampleColorAt,
  sampleHexAt,
  initDrawingCanvas,
  startDrawing,
  continueDrawing,
  seedManualStrokeBoundingBox,
  triggerSimpleShapePreview,
  resetShapeDragRefs,
  resetShapePressureState,
  resetCcGradientSample,
  updateShapePressure,
  pauseColorCycleForNonCCInteraction,
  resumeColorCycleAfterInteraction,
  updateAutoSampledGradient,
  updateCcSampledGradient,
  updateCcGradientSample,
  updateDitherGradSamples,
  capturePendingShapeSnapshot,
  clearShapeBeforeSnapshot,
  computeAutoSampleStops,
  computeShapePixelSize,
  finalizeDrawing,
  scheduleDeferredColorCycleSaveWithState,
  setSharedColorCycleGradient,
  logError,
  withTiming,
  timeAsync,
  timeSync,
  ccLog,
  perfMark,
  perfMeasure,
  debugTime,
  debugTimeEnd,
  resetAutoSampleState,
  resetPolygonState,
  captureCanvasToActiveLayer,
  scheduleHistoryCommit,
}: UseDrawingShapeRuntimeArgs) => {
  const ensureActiveColorCycleGradientSlot = useMemo(
    () => createEnsureActiveColorCycleGradientSlotDispatcher(),
    []
  );

  return useShapeDrawingHandlers({
    shapeMode,
    toolsRef,
    isPointerDownRef: refs.isPointerDownRef,
    isDrawingShapeRef: refs.isDrawingShapeRef,
    isSelectingDirectionRef: refs.isSelectingDirectionRef,
    directionPreviewRef: refs.directionPreviewRef,
    shapePointsRef: refs.shapePointsRef,
    shapeDragStartRef: refs.shapeDragStartRef,
    shapeDragLastRef: refs.shapeDragLastRef,
    shapeDragMovedRef: refs.shapeDragMovedRef,
    latestShapePressureRef,
    lastStablePressureRef,
    shapeBeforeImageRef: refs.shapeBeforeImageRef,
    strokeBoundingBoxRef: refs.strokeBoundingBoxRef,
    strokeCapturePaddingRef: refs.strokeCapturePaddingRef,
    drawingCtxRef: refs.drawingCtxRef,
    drawingCanvasRef: refs.drawingCanvasRef,
    drawingCanvasHasContent: refs.drawingCanvasHasContent,
    autoSamplePointsRef: refs.autoSamplePointsRef,
    autoSampleForkRef: refs.autoSampleForkRef,
    autoSampleLastUpdateRef: refs.autoSampleLastUpdateRef,
    ccSampledPointsRef: refs.ccSampledPointsRef,
    ccGradientSampleSessionRef,
    ccGradientSampleLastUpdateRef: refs.ccGradientSampleLastUpdateRef,
    hadValidShapePressureRef,
    latestShapePixelSizeRef,
    shapeMaxPressureRef,
    ccShapePreviewPauseStartedRef: refs.ccShapePreviewPauseStartedRef,
    activeStrokeSessionRef: refs.activeStrokeSessionRef,
    finalizeQueueRef,
    storeRef,
    project,
    isBusyRef,
    brushEngine,
    getColorCycleBrushManager,
    getColorCycleBrushFlags,
    sampleColorAt,
    sampleHexAt,
    initDrawingCanvas,
    startDrawing,
    continueDrawing,
    seedManualStrokeBoundingBox,
    triggerSimpleShapePreview,
    resetShapeDragRefs,
    resetShapePressureState,
    resetCcGradientSample,
    updateShapePressure,
    pauseColorCycleForNonCCInteraction,
    resumeColorCycleAfterInteraction,
    updateAutoSampledGradient,
    updateCcSampledGradient,
    updateCcGradientSample,
    updateDitherGradSamples,
    capturePendingShapeSnapshot,
    clearShapeBeforeSnapshot,
    createBoundingBox,
    mergeBoundingBox,
    appendSegmentWithDynamicResampling,
    computeAutoSampleStops,
    computeShapePixelSize,
    finalizeDrawing,
    finalizeDitherGradientShape,
    finalizeRasterShapeFill,
    runColorCycleShapeFill,
    computeFallbackLinearDirection,
    ensureActiveColorCycleGradientSlot,
    captureRegionFromPoints,
    boundingBoxToCaptureRegion,
    commitRasterShapeFill,
    runIdle,
    scheduleDeferredColorCycleSaveWithState,
    bindBrushToCanvas,
    captureColorCycleBrushState,
    isColorCycleLayerWithData,
    setSharedColorCycleGradient,
    logError,
    withTiming,
    timeAsync,
    timeSync,
    ccLog,
    ccDebug: CC_DEBUG,
    perfMark,
    perfMeasure,
    debugTime,
    debugTimeEnd,
    resetAutoSampleState,
    resetPolygonState,
    inflateShapeBeforeSnapshot,
    ensureLayerSnapshotWithRetry,
    applyBackdropFromSnapshot,
    captureCanvasToActiveLayer,
    scheduleHistoryCommit,
    ROI_PADDING_PX,
    FF,
  });
};
