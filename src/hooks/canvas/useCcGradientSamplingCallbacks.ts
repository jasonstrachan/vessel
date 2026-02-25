import { useCallback } from 'react';
import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import { getFgParamsFromState } from '@/hooks/canvas/handlers/colorCycle/ensureActiveColorCycleGradientSlot';
import {
  CC_SAMPLED_RUNTIME_FLUSH_THROTTLE_MS,
  CC_SAMPLE_COUNT_WRITE_MS,
} from '@/hooks/canvas/drawingHandlersConfig';
import {
  setSharedColorCycleGradientForShapesController,
  updateCcSampledGradientController,
  writeCcGradientSampleCountController,
} from '@/hooks/canvas/handlers/colorCycle/ccGradientSamplingController';
import {
  resetCcGradientSampleState,
  updateCcGradientSampleSession,
  type CcGradientSampleSession,
} from '@/hooks/canvas/handlers/colorCycle/ccGradientSampling';
import type { AutoSampleStops } from '@/hooks/canvas/handlers/shapes/ShapeFinalizeHandler';

export const useCcGradientSamplingCallbacks = ({
  storeRef,
  sampleHexAt,
  ccGradientSampleSessionRef,
  ccGradientSampleLastUpdateRef,
  ccGradientSampleCountRef,
  ccGradientSampleCountLastUpdateRef,
  ccSampledLastUpdateRef,
  ccSampledRuntimeFlushAtRef,
  autoSampleForkRef,
  ccLog,
}: {
  storeRef: React.MutableRefObject<AppState>;
  sampleHexAt: (x: number, y: number) => string;
  ccGradientSampleSessionRef: React.MutableRefObject<CcGradientSampleSession>;
  ccGradientSampleLastUpdateRef: React.MutableRefObject<number>;
  ccGradientSampleCountRef: React.MutableRefObject<number>;
  ccGradientSampleCountLastUpdateRef: React.MutableRefObject<number>;
  ccSampledLastUpdateRef: React.MutableRefObject<number>;
  ccSampledRuntimeFlushAtRef: React.MutableRefObject<number>;
  autoSampleForkRef: React.MutableRefObject<boolean>;
  ccLog: (message: string, data?: Record<string, unknown>) => void;
}) => {
  const updateCcGradientSample = useCallback((sourcePts: Array<{ x: number; y: number }>, strokeId?: string | null) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    updateCcGradientSampleSession({
      session: ccGradientSampleSessionRef.current,
      sourcePts,
      now,
      lastUpdateRef: ccGradientSampleLastUpdateRef,
      sampleColor: sampleHexAt,
      allowTiny: false,
      strokeId,
    });
  }, [ccGradientSampleLastUpdateRef, ccGradientSampleSessionRef, sampleHexAt]);

  const resetCcGradientSample = useCallback(() => {
    resetCcGradientSampleState({
      session: ccGradientSampleSessionRef.current,
      lastUpdateRef: ccGradientSampleLastUpdateRef,
      sampleCountRef: ccGradientSampleCountRef,
      sampleCountLastUpdateRef: ccGradientSampleCountLastUpdateRef,
    });
  }, [
    ccGradientSampleCountLastUpdateRef,
    ccGradientSampleCountRef,
    ccGradientSampleLastUpdateRef,
    ccGradientSampleSessionRef,
  ]);

  const getCcGradientSampleStops = useCallback(
    () => ccGradientSampleSessionRef.current.stops,
    [ccGradientSampleSessionRef]
  );

  const writeCcGradientSampleCount = useCallback(
    (nextCount: number, now: number, force: boolean = false) => {
      writeCcGradientSampleCountController(nextCount, now, force, {
        sampleCountRef: ccGradientSampleCountRef,
        sampleCountLastUpdateRef: ccGradientSampleCountLastUpdateRef,
        storeRef,
        sampleCountWriteMs: CC_SAMPLE_COUNT_WRITE_MS,
      });
    },
    [ccGradientSampleCountLastUpdateRef, ccGradientSampleCountRef, storeRef]
  );

  const updateCcSampledGradient = useCallback(
    (
      sourcePts: Array<{ x: number; y: number }>,
      options?: { layerId?: string | null; markKind?: 'stroke' | 'shape' }
    ) => {
      updateCcSampledGradientController(sourcePts, options, {
        storeRef,
        sampleHexAt,
        ccSampledLastUpdateRef,
        ccSampledRuntimeFlushAtRef,
        sampledRuntimeFlushThrottleMs: CC_SAMPLED_RUNTIME_FLUSH_THROTTLE_MS,
        resolveFgParamsFromState: getFgParamsFromState,
        writeCcGradientSampleCount,
        ccLog,
      });
    },
    [
      ccLog,
      ccSampledLastUpdateRef,
      ccSampledRuntimeFlushAtRef,
      sampleHexAt,
      storeRef,
      writeCcGradientSampleCount,
    ]
  );

  const setSharedColorCycleGradientForShapes = useCallback((stops: AutoSampleStops | null) => {
    setSharedColorCycleGradientForShapesController(stops, {
      storeRef,
      autoSampleForkRef,
    });
  }, [autoSampleForkRef, storeRef]);

  return {
    updateCcGradientSample,
    resetCcGradientSample,
    getCcGradientSampleStops,
    writeCcGradientSampleCount,
    updateCcSampledGradient,
    setSharedColorCycleGradientForShapes,
  };
};
