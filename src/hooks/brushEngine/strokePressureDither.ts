type NumberRef = { current: number };
type NullableNumberRef = { current: number | null };

export const resolveCommittedPressurePixelSize = ({
  desiredPixelSize,
  now,
  committedPixelSizeRef,
  pendingPixelSizeRef,
  pendingSinceRef,
  stableMs = 70,
}: {
  desiredPixelSize: number;
  now: number;
  committedPixelSizeRef: NullableNumberRef;
  pendingPixelSizeRef: NullableNumberRef;
  pendingSinceRef: NumberRef;
  stableMs?: number;
}): number => {
  const committedPixelSize = committedPixelSizeRef.current ?? desiredPixelSize;
  if (desiredPixelSize !== committedPixelSize) {
    if (desiredPixelSize < committedPixelSize) {
      committedPixelSizeRef.current = desiredPixelSize;
      pendingPixelSizeRef.current = null;
    } else {
      if (pendingPixelSizeRef.current !== desiredPixelSize) {
        pendingPixelSizeRef.current = desiredPixelSize;
        pendingSinceRef.current = now;
      }
      if (now - pendingSinceRef.current >= stableMs) {
        committedPixelSizeRef.current = desiredPixelSize;
        pendingPixelSizeRef.current = null;
      }
    }
  } else {
    pendingPixelSizeRef.current = null;
  }

  return committedPixelSizeRef.current ?? desiredPixelSize;
};

export const beginPressureDitherPass = ({
  now,
  activePixelSize,
  bgOff,
  minIntervalMs,
  minDeltaRes,
  lastPressureDitherTimeRef,
  lastPressureDitherPixelSizeRef,
}: {
  now: number;
  activePixelSize: number;
  bgOff: boolean;
  minIntervalMs: number;
  minDeltaRes: number;
  lastPressureDitherTimeRef: NumberRef;
  lastPressureDitherPixelSizeRef: NullableNumberRef;
}): { pixelSizeChanged: boolean } | null => {
  const lastPixelSize = lastPressureDitherPixelSizeRef.current ?? activePixelSize;
  const minInterval = bgOff ? 55 : minIntervalMs;
  const minDelta = bgOff ? 1.25 : minDeltaRes;

  const tooSoon = now - lastPressureDitherTimeRef.current < minInterval;
  const tinyDelta = Math.abs(activePixelSize - lastPixelSize) < minDelta;
  const resolutionDecreased = activePixelSize < lastPixelSize;

  if (tooSoon && tinyDelta && !resolutionDecreased) {
    return null;
  }

  lastPressureDitherTimeRef.current = now;
  const previousCommitted = lastPressureDitherPixelSizeRef.current ?? activePixelSize;
  const pixelSizeChanged = activePixelSize !== previousCommitted;
  lastPressureDitherPixelSizeRef.current = activePixelSize;
  return { pixelSizeChanged };
};
