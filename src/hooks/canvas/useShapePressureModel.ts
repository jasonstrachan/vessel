import { useCallback, useMemo, useRef } from 'react';
import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import { createPressureResolutionState } from '@/utils/pressureResolution';
import {
  computeShapePixelSize as computeShapePixelSizeExternal,
  createResetShapePressureStateDispatcher,
  createUpdateShapePressureDispatcher,
  shapePressureDebugEnabled as shapePressureDebugEnabledExternal,
} from '@/hooks/canvas/handlers/shapePressure';

const MAX_PRESSURE_DECAY_PER_MS = 0.003;
const MIN_DROP_PER_EVENT = 0.01;
const SHAPE_PRESSURE_SMOOTHING = 0.6;
const SHAPE_PRESSURE_SAMPLE_WINDOW = 5;

export const useShapePressureModel = ({
  storeRef,
}: {
  storeRef: React.MutableRefObject<AppState>;
}) => {
  const latestShapePressureRef = useRef(0.5);
  const lastNonZeroShapePressureRef = useRef(0.5);
  const latestShapePixelSizeRef = useRef<number | null>(null);
  const shapeSampleCountRef = useRef(0);
  const penLiftHoldUntilRef = useRef<number>(0);
  const shapeMaxPressureRef = useRef(1);
  const hadValidShapePressureRef = useRef(false);
  const lastStablePressureRef = useRef(0.5);
  const lastShapePressureTimeRef = useRef<number>(0);
  const shapePressureGainRef = useRef(1);
  const shapePixelResStateRef = useRef(createPressureResolutionState(1));

  const resetShapePressureState = useCallback(() => {
    createResetShapePressureStateDispatcher({
      refs: {
        latestShapePressureRef,
        lastNonZeroShapePressureRef,
        latestShapePixelSizeRef,
        shapeSampleCountRef,
        penLiftHoldUntilRef,
        shapeMaxPressureRef,
        hadValidShapePressureRef,
        lastStablePressureRef,
        lastShapePressureTimeRef,
        shapePressureGainRef,
        shapePixelResStateRef,
      },
    })();
  }, []);

  const computeShapePixelSize = useCallback((pressure: number): number => {
    const settings = storeRef.current.tools.brushSettings;
    const base = Math.max(1, Math.round(settings.fillResolution || 1));
    return computeShapePixelSizeExternal({
      pressure,
      baseResolution: base,
      maxResolution: settings.pressureLinkedFillMaxResolution,
      pressureLinked: Boolean(settings.pressureLinkedFillResolution),
      stateRef: shapePixelResStateRef,
    });
  }, [storeRef]);

  const updateShapePressure = useMemo(
    () =>
      createUpdateShapePressureDispatcher({
        refs: {
          latestShapePressureRef,
          lastNonZeroShapePressureRef,
          latestShapePixelSizeRef,
          shapeSampleCountRef,
          penLiftHoldUntilRef,
          shapeMaxPressureRef,
          hadValidShapePressureRef,
          lastStablePressureRef,
          lastShapePressureTimeRef,
          shapePressureGainRef,
          shapePixelResStateRef,
        },
        constants: {
          maxPressureDecayPerMs: MAX_PRESSURE_DECAY_PER_MS,
          minDropPerEvent: MIN_DROP_PER_EVENT,
          smoothing: SHAPE_PRESSURE_SMOOTHING,
          sampleWindow: SHAPE_PRESSURE_SAMPLE_WINDOW,
        },
        deps: {
          computeShapePixelSize,
          debugEnabled: shapePressureDebugEnabledExternal,
        },
      }),
    [computeShapePixelSize]
  );

  return {
    latestShapePressureRef,
    lastNonZeroShapePressureRef,
    latestShapePixelSizeRef,
    shapeMaxPressureRef,
    hadValidShapePressureRef,
    lastStablePressureRef,
    resetShapePressureState,
    computeShapePixelSize,
    updateShapePressure,
  };
};
