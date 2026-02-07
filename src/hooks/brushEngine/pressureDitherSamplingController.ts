type MutableRef<T> = { current: T };

type StrokePresResPressureState = {
  last: number;
  stable: number;
  lastTime: number;
};

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
    } else {
      const alpha = p < stats.stable ? 0.8 : 0.45;
      stats.stable = stats.stable + (p - stats.stable) * alpha;
    }
    stats.last = p;
    return;
  }

  if (elapsed <= holdOnZeroMs) {
    return;
  }

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
      console.log('[PresRes]', payload);
    }
  }
  return size;
};

