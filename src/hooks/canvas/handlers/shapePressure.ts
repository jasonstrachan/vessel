import { debugLog } from '@/utils/debug';
import type React from 'react';
import {
  computePressureResolution,
  createPressureResolutionState,
  resolvePressureLinkedFillMaxResolution,
} from '@/utils/pressureResolution';

export type ShapePressureRefs = {
  latestShapePressureRef: React.MutableRefObject<number>;
  lastNonZeroShapePressureRef: React.MutableRefObject<number>;
  latestShapePixelSizeRef: React.MutableRefObject<number | null>;
  shapeSampleCountRef: React.MutableRefObject<number>;
  penLiftHoldUntilRef: React.MutableRefObject<number>;
  shapeMaxPressureRef: React.MutableRefObject<number>;
  hadValidShapePressureRef: React.MutableRefObject<boolean>;
  lastStablePressureRef: React.MutableRefObject<number>;
  lastShapePressureTimeRef: React.MutableRefObject<number>;
  shapePressureGainRef: React.MutableRefObject<number>;
  shapePixelResStateRef: React.MutableRefObject<ReturnType<typeof createPressureResolutionState>>;
};

export type ShapePressureConstants = {
  maxPressureDecayPerMs: number;
  minDropPerEvent: number;
  smoothing: number;
  sampleWindow: number;
};

export type ShapePressureDeps = {
  computeShapePixelSize: (pressure: number) => number;
  debugEnabled: () => boolean;
};

export type CreateUpdateShapePressureDispatcherArgs = {
  refs: ShapePressureRefs;
  constants: ShapePressureConstants;
  deps: ShapePressureDeps;
};

export type CreateResetShapePressureStateDispatcherArgs = {
  refs: ShapePressureRefs;
};

export const createShapePressureRefs = ({
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
}: {
  latestShapePressureRef: React.MutableRefObject<number>;
  lastNonZeroShapePressureRef: React.MutableRefObject<number>;
  latestShapePixelSizeRef: React.MutableRefObject<number | null>;
  shapeSampleCountRef: React.MutableRefObject<number>;
  penLiftHoldUntilRef: React.MutableRefObject<number>;
  shapeMaxPressureRef: React.MutableRefObject<number>;
  hadValidShapePressureRef: React.MutableRefObject<boolean>;
  lastStablePressureRef: React.MutableRefObject<number>;
  lastShapePressureTimeRef: React.MutableRefObject<number>;
  shapePressureGainRef: React.MutableRefObject<number>;
  shapePixelResStateRef: React.MutableRefObject<ReturnType<typeof createPressureResolutionState>>;
}): void => {
  latestShapePressureRef.current = 0.5;
  lastNonZeroShapePressureRef.current = 0.5;
  latestShapePixelSizeRef.current = null;
  shapeSampleCountRef.current = 0;
  penLiftHoldUntilRef.current = 0;
  shapeMaxPressureRef.current = 1;
  hadValidShapePressureRef.current = false;
  lastStablePressureRef.current = 0.5;
  lastShapePressureTimeRef.current = 0;
  shapePressureGainRef.current = 1;
  shapePixelResStateRef.current = createPressureResolutionState(1);
};

export const shapePressureDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return Boolean((window as { __shapePressureDebug?: unknown }).__shapePressureDebug);
};

export const computeShapePixelSize = ({
  pressure,
  baseResolution,
  maxResolution,
  pressureLinked,
  stateRef,
}: {
  pressure: number;
  baseResolution: number;
  maxResolution?: number;
  pressureLinked: boolean;
  stateRef: React.MutableRefObject<ReturnType<typeof createPressureResolutionState>>;
}): number => {
  if (!pressureLinked) {
    return computePressureResolution(baseResolution, Math.max(0, Math.min(1, pressure)), false);
  }
  const resolvedMax = resolvePressureLinkedFillMaxResolution({
    fillResolution: baseResolution,
    pressureLinkedFillMaxResolution: maxResolution,
  });
  return computePressureResolution(
    baseResolution,
    Math.max(0, Math.min(1, pressure)),
    true,
    stateRef.current,
    undefined,
    resolvedMax
  );
};

export const updateShapePressure = ({
  refs,
  constants,
  deps,
  pressure,
  timestamp,
  rawPressure,
}: {
  refs: ShapePressureRefs;
  constants: ShapePressureConstants;
  deps: ShapePressureDeps;
  pressure?: number;
  timestamp?: number;
  rawPressure?: number;
}): void => {
  const rawVal = typeof rawPressure === 'number' ? rawPressure : pressure;
  const val = typeof rawVal === 'number' ? Math.max(0, Math.min(1, rawVal)) : 0;

  const now = timestamp || (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const prevSample = refs.latestShapePressureRef.current || 0;
  const smoothed = prevSample === 0 ? val : prevSample + (val - prevSample) * constants.smoothing;

  // RATCHET LOGIC
  if (refs.lastShapePressureTimeRef.current === 0) {
    refs.lastShapePressureTimeRef.current = now;
    refs.lastStablePressureRef.current = smoothed;
  }

  const elapsed = now - refs.lastShapePressureTimeRef.current;
  refs.lastShapePressureTimeRef.current = now;
  refs.shapeSampleCountRef.current += 1;

  const isPenLift = val <= 0.02;
  const isEarlySample = refs.shapeSampleCountRef.current <= constants.sampleWindow;

  if (isPenLift) {
    // Freeze stable on lift; keep lastStablePressureRef as-is.
  } else if (smoothed >= refs.lastStablePressureRef.current || isEarlySample) {
    refs.lastStablePressureRef.current = smoothed;
  } else {
    const isLowPressure = smoothed < 0.25;
    const decayMultiplier = isLowPressure ? 4.0 : 1.0;
    const timeDrop = Math.max(0, elapsed * constants.maxPressureDecayPerMs * decayMultiplier);
    const maxDrop = Math.max(timeDrop, constants.minDropPerEvent);
    refs.lastStablePressureRef.current = Math.max(smoothed, refs.lastStablePressureRef.current - maxDrop);
  }

  refs.hadValidShapePressureRef.current = true;
  refs.latestShapePixelSizeRef.current = deps.computeShapePixelSize(refs.lastStablePressureRef.current);

  if (val > 0.01) {
    refs.shapeMaxPressureRef.current = Math.max(refs.shapeMaxPressureRef.current, val);
    refs.lastNonZeroShapePressureRef.current = val;
  }
  refs.latestShapePressureRef.current = smoothed;

  if (deps.debugEnabled() && typeof console !== 'undefined') {
    debugLog('raw-console', '[shape-pressure]', {
      raw: val,
      stable: refs.lastStablePressureRef.current,
      maxSeen: refs.shapeMaxPressureRef.current,
      px: refs.latestShapePixelSizeRef.current,
    });
  }
};

export const createUpdateShapePressureDispatcher = ({
  refs,
  constants,
  deps,
}: CreateUpdateShapePressureDispatcherArgs): ((p?: number, timestamp?: number, raw?: number) => void) =>
  (p?: number, timestamp?: number, raw?: number) => {
    updateShapePressure({
      refs,
      constants,
      deps,
      pressure: p,
      timestamp,
      rawPressure: raw,
    });
  };

export const createResetShapePressureStateDispatcher = ({
  refs,
}: CreateResetShapePressureStateDispatcherArgs): (() => void) => () => {
  createShapePressureRefs(refs);
};
