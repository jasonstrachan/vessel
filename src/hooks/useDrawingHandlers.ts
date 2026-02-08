import type React from 'react';
import { logError } from '../utils/debug';
import { perfMark, perfMeasure, timeAsync } from '@/utils/perf/ccPerfProbe';
import { buildUseDrawingHandlersRuntimeStagesOptions } from '@/hooks/canvas/buildUseDrawingHandlersRuntimeStagesOptions';
import { useDrawingHandlersRuntimeStages } from '@/hooks/canvas/useDrawingHandlersRuntimeStages';
import { useDrawingHandlersResultRuntime } from '@/hooks/canvas/useDrawingHandlersResultRuntime';
import {
  createDrawingHandlersPerf,
} from '@/hooks/canvas/drawingHandlersConfig';

export {
  AUTO_SAMPLE_MAX_STOPS,
  MIN_AUTO_SAMPLE_PREVIEW_DISTANCE,
  computeAutoSampleStopsFromPolyline,
  computeDitherGradSampleStopsFromPolyline,
  computePolylineLength,
  dedupePolylineForSampling
} from '@/hooks/canvas/utils/autoSampleGradient';
export { __TESTING__ } from '@/hooks/canvas/drawingHandlersTestingExports';

interface UseDrawingHandlersProps {
  project: { width: number; height: number } | null;
  screenToWorld: (x: number, y: number) => { x: number; y: number };
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isBusyRef?: React.MutableRefObject<boolean>;
  sampleColorAt?: (x: number, y: number) => string;
}

const { debugTime, debugTimeEnd, debugVerbose, withTiming } = createDrawingHandlersPerf({
  perfMark,
  perfMeasure,
  timeAsync,
});
export function useDrawingHandlers({
  project,
  screenToWorld: _screenToWorld,
  viewTransformRef: _viewTransformRef,
  canvasRef: _canvasRef,
  isBusyRef,
  sampleColorAt,
}: UseDrawingHandlersProps) {
  // Unused props in this harness; kept for API compatibility
  void _screenToWorld;
  void _viewTransformRef;
  void _canvasRef;
  const {
    refs: drawingHandlerRefs,
    shapeRuntime,
    brushToolRuntime,
    colorCycleRuntime,
    runtimeHandlers,
  } = useDrawingHandlersRuntimeStages(
    buildUseDrawingHandlersRuntimeStagesOptions({
      project,
      isBusyRef,
      sampleColorAt,
      perf: {
        withTiming,
        logError,
        perfMark,
        perfMeasure,
        debugTime,
        debugTimeEnd,
        debugVerbose,
      },
    })
  );

  return useDrawingHandlersResultRuntime({
    refs: drawingHandlerRefs,
    shapeRuntime,
    brushToolRuntime,
    colorCycleRuntime,
    runtimeHandlers,
  });
}

export type DrawingHandlers = ReturnType<typeof useDrawingHandlers>;
