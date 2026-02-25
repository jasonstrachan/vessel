import type { buildDrawingHandlersColorCycleBridgeOptions } from '@/hooks/canvas/buildDrawingHandlersColorCycleBridgeOptions';
import type { UseDrawingHandlersRuntimeStagesOptions } from '@/hooks/canvas/useDrawingHandlersRuntimeStages.types';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import type { useDrawingHandlersStoreState } from '@/hooks/canvas/useDrawingHandlersStoreState';

type ColorCycleBridgeBuilderArgs = Parameters<typeof buildDrawingHandlersColorCycleBridgeOptions>[0];
type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type StoreState = ReturnType<typeof useDrawingHandlersStoreState>;

interface BuildDrawingHandlersRuntimeStagesColorCycleArgsOptions {
  options: UseDrawingHandlersRuntimeStagesOptions;
  refs: DrawingHandlerRefs;
  storeRef: StoreState['storeRef'];
  captureCanvasToActiveLayer: StoreState['captureCanvasToActiveLayer'];
  activeLayerWidth: StoreState['activeLayerWidth'];
  activeLayerHeight: StoreState['activeLayerHeight'];
}

export const buildDrawingHandlersRuntimeStagesColorCycleArgs = ({
  options,
  refs,
  storeRef,
  captureCanvasToActiveLayer,
  activeLayerWidth,
  activeLayerHeight,
}: BuildDrawingHandlersRuntimeStagesColorCycleArgsOptions): ColorCycleBridgeBuilderArgs => ({
  refs,
  storeRef,
  project: options.project,
  captureCanvasToActiveLayer,
  activeLayerWidth,
  activeLayerHeight,
  sampleColorAt: options.sampleColorAt,
  withTiming: options.perf.withTiming,
  logError: options.perf.logError,
  perfMark: options.perf.perfMark,
  perfMeasure: options.perf.perfMeasure,
  debugTime: options.perf.debugTime,
  debugTimeEnd: options.perf.debugTimeEnd,
  debugVerbose: options.perf.debugVerbose,
});
