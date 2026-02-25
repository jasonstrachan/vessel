import { perfMark, perfMeasure } from '@/utils/perf/ccPerfProbe';
import { logError } from '@/utils/debug';
import {
  boundingBoxToCaptureRegion,
  rectToCaptureRegion,
  unionCaptureRegions,
} from '@/hooks/canvas/utils/captureRegions';
import {
  captureLayerRegionImageData,
  ensureLayerSnapshotWithRetry,
} from '@/hooks/canvas/utils/snapshots';
import type {
  RuntimeBridgeArgs,
  UseDrawingHandlersRuntimeSetupBridgeOptions,
} from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge.types';

interface BuildDrawingHandlersFinalizeContextOptions {
  storeRef: UseDrawingHandlersRuntimeSetupBridgeOptions['storeRef'];
  isBusyRef: UseDrawingHandlersRuntimeSetupBridgeOptions['isBusyRef'];
  captureCanvasToActiveLayer: UseDrawingHandlersRuntimeSetupBridgeOptions['captureCanvasToActiveLayer'];
  withTiming: UseDrawingHandlersRuntimeSetupBridgeOptions['withTiming'];
  debugTime: UseDrawingHandlersRuntimeSetupBridgeOptions['debugTime'];
  debugTimeEnd: UseDrawingHandlersRuntimeSetupBridgeOptions['debugTimeEnd'];
  brushToolRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['brushToolRuntime'];
  colorCycleRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['colorCycleRuntime'];
}

export const buildDrawingHandlersFinalizeContextOptions = ({
  storeRef,
  isBusyRef,
  captureCanvasToActiveLayer,
  withTiming,
  debugTime,
  debugTimeEnd,
  brushToolRuntime,
  colorCycleRuntime,
}: BuildDrawingHandlersFinalizeContextOptions): RuntimeBridgeArgs['finalizeRuntimeOptions']['contextOptions'] => ({
  storeRef,
  captureCanvasToActiveLayer,
  scheduleHistoryCommit: colorCycleRuntime.scheduleHistoryCommit,
  withTiming,
  logError,
  endMaskHealingStroke: brushToolRuntime.endMaskHealingStroke,
  resetAutoSampleState: colorCycleRuntime.resetAutoSampleState,
  clearStrokeSession: brushToolRuntime.clearStrokeSession,
  resumeColorCycleAfterInteraction: colorCycleRuntime.resumeColorCycleAfterInteraction,
  isBusyRef,
  boundingBoxToCaptureRegion,
  rectToCaptureRegion,
  unionCaptureRegions,
  captureLayerRegionImageData,
  ensureLayerSnapshotWithRetry,
  debugTime,
  debugTimeEnd,
  perfMark,
  perfMeasure,
});
