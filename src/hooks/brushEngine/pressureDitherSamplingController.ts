type MutableRef<T> = { current: T };

type StrokePresResPressureState = {
  last: number;
  stable: number;
  lastTime: number;
};
const STROKE_PRES_RES_LIFT_THRESHOLD = 0.16;
const STROKE_PRES_RES_LOW_PRESSURE_DECAY_MS = 140;

export const updateStrokePresResPressure = ({
  pressure,
  now,
  statsRef,
  holdOnZeroMs,
}: {
  pressure: number;
  now: number;
  statsRef: MutableRef<StrokePresResPressureState>;
  holdOnZeroMs: number;
}): void => {
  const stats = statsRef.current;
  const p = Math.max(0, Math.min(1, Number.isFinite(pressure) ? pressure : 0));

  const previousTime = stats.lastTime;
  const elapsed = previousTime > 0 ? Math.max(0, now - previousTime) : 0;
  stats.lastTime = now;

  if (p > 0) {
    if (stats.stable <= 0) {
      stats.stable = p;
    } else if (p <= STROKE_PRES_RES_LIFT_THRESHOLD) {
      // Near pen-lift, decay smoothly toward the live pressure so pres-res can still return to 1px.
      const dt = elapsed > 0 ? elapsed : 16;
      const decayWindowMs = Math.max(STROKE_PRES_RES_LOW_PRESSURE_DECAY_MS, holdOnZeroMs);
      const alpha = 1 - Math.exp(-dt / decayWindowMs);
      stats.stable = stats.stable + (p - stats.stable) * alpha;
    } else {
      const alpha = p < stats.stable ? 0.6 : 0.45;
      stats.stable = stats.stable + (p - stats.stable) * alpha;
    }
    stats.last = p;
    return;
  }

  if (elapsed <= holdOnZeroMs) {
    return;
  }

  stats.stable = 0;
  stats.last = 0;
};

export const getStrokeDitherPixelSize = ({
  statsRef,
  fallbackPressure,
  computePressureScaledResolution,
  isPresResDebugEnabled,
  presResLastLogAtRef,
  presResLastLoggedPixelSizeRef,
  appendPresResTrace,
}: {
  statsRef: MutableRef<StrokePresResPressureState>;
  fallbackPressure: number;
  computePressureScaledResolution: (pressure: number) => number;
  isPresResDebugEnabled: () => boolean;
  presResLastLogAtRef: MutableRef<number>;
  presResLastLoggedPixelSizeRef: MutableRef<number | null>;
  appendPresResTrace: (entry: Record<string, unknown>) => void;
}): number => {
  const stats = statsRef.current;
  let p = stats.stable;
  if (typeof p !== 'number' || p <= 0) {
    p = stats.last;
  }
  if (typeof p !== 'number' || p <= 0) {
    p = fallbackPressure;
  }
  p = Math.max(0, Math.min(1, p));
  const size = computePressureScaledResolution(p);
  if (isPresResDebugEnabled()) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const lastAt = presResLastLogAtRef.current;
    const lastPx = presResLastLoggedPixelSizeRef.current;
    const pixelChanged = lastPx == null || Math.abs(size - lastPx) >= 1;
    if (pixelChanged || now - lastAt >= 120) {
      presResLastLogAtRef.current = now;
      presResLastLoggedPixelSizeRef.current = size;
      const payload = {
        pressureUsed: Number(p.toFixed(4)),
        stablePressure: Number((stats.stable || 0).toFixed(4)),
        lastPressure: Number((stats.last || 0).toFixed(4)),
        pixelSize: size,
      };
      appendPresResTrace({
        t: Date.now(),
        source: 'engine',
        ...payload,
      });
    }
  }
  return size;
};
