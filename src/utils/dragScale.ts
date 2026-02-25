export interface DragScaleOptions {
  startDistance: number;
  currentDistance: number;
  startValue: number;
  min?: number;
  max?: number;
  exponent?: number;
}

const clamp = (value: number, min?: number, max?: number): number => {
  let result = value;
  if (min !== undefined) {
    result = Math.max(min, result);
  }
  if (max !== undefined) {
    result = Math.min(max, result);
  }
  return result;
};

export const computeDragScaledValue = ({
  startDistance,
  currentDistance,
  startValue,
  min,
  max,
  exponent,
}: DragScaleOptions): number => {
  const safeStart = Math.max(startDistance, 1e-3);
  const safeCurrent = Math.max(currentDistance, 1e-3);
  const baseRatio = safeCurrent / safeStart;
  const appliedRatio = exponent && exponent !== 1
    ? Math.pow(baseRatio, exponent)
    : baseRatio;

  const scaled = startValue * appliedRatio;
  return clamp(scaled, min, max);
};
