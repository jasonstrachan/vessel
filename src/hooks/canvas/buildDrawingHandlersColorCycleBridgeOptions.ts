import { ccLog } from '@/debug/ccDebug';
import type { useDrawingHandlersColorCycleBridge } from '@/hooks/canvas/useDrawingHandlersColorCycleBridge';
import { boundingBoxToCaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import type { useDrawingHandlersStoreState } from '@/hooks/canvas/useDrawingHandlersStoreState';

type ColorCycleBridgeOptions = Parameters<typeof useDrawingHandlersColorCycleBridge>[0];
type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type StoreState = ReturnType<typeof useDrawingHandlersStoreState>;

interface BuildDrawingHandlersColorCycleBridgeOptionsArgs {
  refs: DrawingHandlerRefs;
  storeRef: StoreState['storeRef'];
  project: { width: number; height: number } | null;
  captureCanvasToActiveLayer: StoreState['captureCanvasToActiveLayer'];
  activeLayerWidth: StoreState['activeLayerWidth'];
  activeLayerHeight: StoreState['activeLayerHeight'];
  sampleColorAt?: (x: number, y: number) => string;
  withTiming: ColorCycleBridgeOptions['colorCycleHistoryOptions']['withTiming'];
  logError: ColorCycleBridgeOptions['colorCycleHistoryOptions']['logError'];
  perfMark: ColorCycleBridgeOptions['colorCycleHistoryOptions']['perfMark'];
  perfMeasure: ColorCycleBridgeOptions['colorCycleHistoryOptions']['perfMeasure'];
  debugTime: ColorCycleBridgeOptions['colorCycleHistoryOptions']['debugTime'];
  debugTimeEnd: ColorCycleBridgeOptions['colorCycleHistoryOptions']['debugTimeEnd'];
  debugVerbose: ColorCycleBridgeOptions['colorCycleHistoryOptions']['debugVerbose'];
}

export const buildDrawingHandlersColorCycleBridgeOptions = ({
  refs,
  storeRef,
  project,
  captureCanvasToActiveLayer,
  activeLayerWidth,
  activeLayerHeight,
  sampleColorAt,
  withTiming,
  logError,
  perfMark,
  perfMeasure,
  debugTime,
  debugTimeEnd,
  debugVerbose,
}: BuildDrawingHandlersColorCycleBridgeOptionsArgs): ColorCycleBridgeOptions => ({
  refs,
  colorCycleBindingsOptions: { storeRef },
  colorCycleHistoryOptions: {
    withTiming,
    logError,
    captureCanvasToActiveLayer,
    project,
    boundingBoxToCaptureRegion,
    perfMark,
    perfMeasure,
    debugTime,
    debugTimeEnd,
    debugVerbose,
  },
  drawingSamplingOptions: {
    samplingCoreOptions: {
      storeRef,
      drawingCanvasRef: refs.drawingCanvasRef,
      drawingCtxRef: refs.drawingCtxRef,
      drawingCanvasHasContent: refs.drawingCanvasHasContent,
      sampleColorAt,
    },
    ccGradientSamplingOptions: {
      storeRef,
      ccGradientSampleLastUpdateRef: refs.ccGradientSampleLastUpdateRef,
      ccGradientSampleCountRef: refs.ccGradientSampleCountRef,
      ccGradientSampleCountLastUpdateRef: refs.ccGradientSampleCountLastUpdateRef,
      ccSampledLastUpdateRef: refs.ccSampledLastUpdateRef,
      ccSampledRuntimeFlushAtRef: refs.ccSampledRuntimeFlushAtRef,
      autoSampleForkRef: refs.autoSampleForkRef,
      ccLog,
    },
    brushSamplingOptions: {
      storeRef,
      drawingCanvasRef: refs.drawingCanvasRef,
      drawingCtxRef: refs.drawingCtxRef,
      drawingCanvasHasContent: refs.drawingCanvasHasContent,
      sampleColorAt,
      autoSamplePointsRef: refs.autoSamplePointsRef,
      autoSampleLastUpdateRef: refs.autoSampleLastUpdateRef,
      autoSampleForkRef: refs.autoSampleForkRef,
      autoSampleLastAppliedHashRef: refs.autoSampleLastAppliedHashRef,
      brushSamplingPreviewActiveRef: refs.brushSamplingPreviewActiveRef,
      ditherGradSampleLastUpdateRef: refs.ditherGradSampleLastUpdateRef,
    },
    ccGradientResetOptions: {
      storeRef,
      activeLayerIdRef: refs.activeLayerIdRef,
      isPointerDownRef: refs.isPointerDownRef,
      ccSampledPointsRef: refs.ccSampledPointsRef,
      ccSampledLastUpdateRef: refs.ccSampledLastUpdateRef,
      ccGradientSampleCountRef: refs.ccGradientSampleCountRef,
      ccGradientSampleCountLastUpdateRef: refs.ccGradientSampleCountLastUpdateRef,
    },
  },
  colorCycleOverlayOptions: {
    storeRef,
    project,
    activeLayerWidth,
    activeLayerHeight,
  },
});
