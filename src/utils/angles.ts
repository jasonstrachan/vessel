const TAU = Math.PI * 2;

/**
 * Unwrap an angle (in radians) so that it stays continuous relative to the previous value.
 * Keeps the delta between consecutive angles within [-π, π] by adding or subtracting 2π multiples.
 */
export const unwrapAngle = (previous: number | undefined, next: number): number => {
  if (!Number.isFinite(next)) {
    return next;
  }
  if (previous === undefined || !Number.isFinite(previous)) {
    return next;
  }

  let unwrapped = next;
  let delta = unwrapped - previous;
  while (delta > Math.PI) {
    unwrapped -= TAU;
    delta = unwrapped - previous;
  }
  while (delta < -Math.PI) {
    unwrapped += TAU;
    delta = unwrapped - previous;
  }
  return unwrapped;
};
