import { resolveSmoothedSizePressure, type StrokePressureState } from './strokePressure';

type MutableRef<T> = { current: T };

type ResolveStrokePressureForRenderArgs = {
  rawPressure: number;
  nowHighRes: number;
  strokePressureRef: MutableRef<StrokePressureState>;
  pressureEnabled: boolean;
  updateStrokePresResPressure: (pressure: number, now: number) => void;
  maxPressureDecayPerMs: number;
  minDropPerEvent: number;
  instantPressureSampleWindow: number;
};

export const resolveStrokePressureForRender = ({
  rawPressure,
  nowHighRes,
  strokePressureRef,
  pressureEnabled,
  updateStrokePresResPressure,
  maxPressureDecayPerMs,
  minDropPerEvent,
  instantPressureSampleWindow,
}: ResolveStrokePressureForRenderArgs): number => {
  const p = Math.max(0, Math.min(1, rawPressure));
  updateStrokePresResPressure(p, nowHighRes);
  return resolveSmoothedSizePressure({
    stats: strokePressureRef.current,
    pressure: p,
    now: nowHighRes,
    pressureEnabled,
    maxPressureDecayPerMs,
    minDropPerEvent,
    instantPressureSampleWindow,
  });
};

type ResetPressureDitherStateArgs = {
  resetStrokePressureDitherRuntime: () => void;
  clearBgOffHoleCanvas: () => void;
};

export const resetPressureDitherState = ({
  resetStrokePressureDitherRuntime,
  clearBgOffHoleCanvas,
}: ResetPressureDitherStateArgs): void => {
  resetStrokePressureDitherRuntime();
  clearBgOffHoleCanvas();
};
