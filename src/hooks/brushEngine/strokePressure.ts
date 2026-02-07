export type StrokePressureState = {
  min: number;
  max: number;
  lastNonZero: number;
  last: number;
  stable: number;
  isTail: boolean;
  lastTime: number;
  sampleCount: number;
};

export type StrokePresResPressureState = {
  last: number;
  stable: number;
  lastTime: number;
};

export const createInitialStrokePressureState = (): StrokePressureState => ({
  min: 1,
  max: 0,
  lastNonZero: 0,
  last: 0,
  stable: 0,
  isTail: false,
  lastTime: 0,
  sampleCount: 0,
});

export const createInitialStrokePresResPressureState = (): StrokePresResPressureState => ({
  last: 0,
  stable: 0,
  lastTime: 0,
});

export const updateStrokePressureRatchet = ({
  stats,
  pressure,
  now,
  maxPressureDecayPerMs,
  minDropPerEvent,
  instantPressureSampleWindow,
}: {
  stats: StrokePressureState;
  pressure: number;
  now: number;
  maxPressureDecayPerMs: number;
  minDropPerEvent: number;
  instantPressureSampleWindow: number;
}): number => {
  const p = Math.max(0, Math.min(1, Number.isFinite(pressure) ? pressure : 0));
  const alpha = 0.6;
  const smoothed = stats.last === 0 ? p : (stats.last + (p - stats.last) * alpha);

  if (stats.lastTime === 0) {
    stats.lastTime = now;
  }
  const elapsed = now - stats.lastTime;
  stats.lastTime = now;

  stats.sampleCount += 1;
  const isEarlySample = stats.sampleCount <= instantPressureSampleWindow;
  const isPenLift = p <= 0.02;

  if (isPenLift) {
    // Freeze stable on pen-lift; leave latched value intact.
  } else if (smoothed >= stats.stable || isEarlySample) {
    stats.stable = smoothed;
  } else {
    const isLowPressure = smoothed < 0.25;
    const decayMultiplier = isLowPressure ? 4.0 : 1.0;
    const timeDrop = Math.max(0, elapsed * maxPressureDecayPerMs * decayMultiplier);
    const maxDrop = Math.max(timeDrop, minDropPerEvent);
    stats.stable = Math.max(smoothed, stats.stable - maxDrop);
  }

  if (p > 0.01) {
    stats.min = Math.min(stats.min, p);
    stats.max = Math.max(stats.max, p);
    stats.lastNonZero = p;
    stats.last = p;
  } else {
    stats.last = p;
  }

  return stats.stable > 0 ? stats.stable : p;
};

export const resolveSmoothedSizePressure = ({
  stats,
  pressure,
  now,
  pressureEnabled,
  maxPressureDecayPerMs,
  minDropPerEvent,
  instantPressureSampleWindow,
}: {
  stats: StrokePressureState;
  pressure: number;
  now: number;
  pressureEnabled: boolean;
  maxPressureDecayPerMs: number;
  minDropPerEvent: number;
  instantPressureSampleWindow: number;
}): number => {
  const p = Math.max(0, Math.min(1, Number.isFinite(pressure) ? pressure : 0));
  const stablePressure = updateStrokePressureRatchet({
    stats,
    pressure: p,
    now,
    maxPressureDecayPerMs,
    minDropPerEvent,
    instantPressureSampleWindow,
  });
  return pressureEnabled ? Math.max(0.01, stablePressure) : p;
};
