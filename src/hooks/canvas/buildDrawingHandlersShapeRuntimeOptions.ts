import { ccLog } from '@/debug/ccDebug';
import { perfMark, perfMeasure, timeAsync, timeSync } from '@/utils/perf/ccPerfProbe';
import { logError } from '@/utils/debug';
import type {
  RuntimeBridgeArgs,
  UseDrawingHandlersRuntimeSetupBridgeOptions,
} from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge.types';

interface BuildDrawingHandlersShapeRuntimeOptions {
  project: UseDrawingHandlersRuntimeSetupBridgeOptions['project'];
  storeRef: UseDrawingHandlersRuntimeSetupBridgeOptions['storeRef'];
  sampleColorAt: UseDrawingHandlersRuntimeSetupBridgeOptions['sampleColorAt'];
  isBusyRef: UseDrawingHandlersRuntimeSetupBridgeOptions['isBusyRef'];
  shapeMode: UseDrawingHandlersRuntimeSetupBridgeOptions['shapeMode'];
  toolsRef: UseDrawingHandlersRuntimeSetupBridgeOptions['toolsRef'];
  captureCanvasToActiveLayer: UseDrawingHandlersRuntimeSetupBridgeOptions['captureCanvasToActiveLayer'];
  withTiming: UseDrawingHandlersRuntimeSetupBridgeOptions['withTiming'];
  debugTime: UseDrawingHandlersRuntimeSetupBridgeOptions['debugTime'];
  debugTimeEnd: UseDrawingHandlersRuntimeSetupBridgeOptions['debugTimeEnd'];
  brushEngine: UseDrawingHandlersRuntimeSetupBridgeOptions['brushEngine'];
  shapeRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['shapeRuntime'];
  brushToolRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['brushToolRuntime'];
  colorCycleRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['colorCycleRuntime'];
}

export const buildDrawingHandlersShapeRuntimeOptions = ({
  project,
  storeRef,
  sampleColorAt,
  isBusyRef,
  shapeMode,
  toolsRef,
  captureCanvasToActiveLayer,
  withTiming,
  debugTime,
  debugTimeEnd,
  brushEngine,
  shapeRuntime,
  brushToolRuntime,
  colorCycleRuntime,
}: BuildDrawingHandlersShapeRuntimeOptions): RuntimeBridgeArgs['shapeLifecycleOptions']['shapeRuntimeOptions'] => ({
  shapeMode,
  toolsRef,
  latestShapePressureRef: shapeRuntime.latestShapePressureRef,
  lastStablePressureRef: shapeRuntime.lastStablePressureRef,
  ccGradientSampleSessionRef: colorCycleRuntime.ccGradientSampleSessionRef,
  hadValidShapePressureRef: shapeRuntime.hadValidShapePressureRef,
  latestShapePixelSizeRef: shapeRuntime.latestShapePixelSizeRef,
  shapeMaxPressureRef: shapeRuntime.shapeMaxPressureRef,
  finalizeQueueRef: colorCycleRuntime.finalizeQueueRef,
  storeRef,
  project,
  isBusyRef,
  brushEngine: brushEngine as RuntimeBridgeArgs['shapeLifecycleOptions']['shapeRuntimeOptions']['brushEngine'],
  sampleColorAt,
  sampleHexAt: colorCycleRuntime.sampleHexAt,
  initDrawingCanvas: colorCycleRuntime.initDrawingCanvas,
  seedManualStrokeBoundingBox: shapeRuntime.seedManualStrokeBoundingBox,
  triggerSimpleShapePreview: shapeRuntime.triggerSimpleShapePreview,
  resetShapeDragRefs: shapeRuntime.resetShapeDragRefs,
  resetShapePressureState: shapeRuntime.resetShapePressureState,
  resetCcGradientSample: colorCycleRuntime.resetCcGradientSample,
  updateShapePressure: shapeRuntime.updateShapePressure,
  pauseColorCycleForNonCCInteraction: colorCycleRuntime.pauseColorCycleForNonCCInteraction,
  resumeColorCycleAfterInteraction: colorCycleRuntime.resumeColorCycleAfterInteraction,
  updateAutoSampledGradient: colorCycleRuntime.updateAutoSampledGradient,
  updateCcSampledGradient: colorCycleRuntime.updateCcSampledGradient,
  updateCcGradientSample: colorCycleRuntime.updateCcGradientSample,
  updateDitherGradSamples: colorCycleRuntime.updateDitherGradSamples,
  computeAutoSampleStops: colorCycleRuntime.computeAutoSampleStops,
  computeShapePixelSize: shapeRuntime.computeShapePixelSize,
  scheduleDeferredColorCycleSaveWithState:
    colorCycleRuntime.scheduleDeferredColorCycleSaveWithState,
  setSharedColorCycleGradient: colorCycleRuntime.setSharedColorCycleGradientForShapes,
  logError,
  withTiming,
  timeAsync,
  timeSync,
  ccLog,
  perfMark,
  perfMeasure,
  debugTime,
  debugTimeEnd,
  resetAutoSampleState: colorCycleRuntime.resetAutoSampleState,
  resetPolygonState: brushToolRuntime.resetPolygonState,
  captureCanvasToActiveLayer,
  scheduleHistoryCommit: colorCycleRuntime.scheduleHistoryCommit,
});
