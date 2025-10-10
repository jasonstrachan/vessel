export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function wrap(value: number, min: number, max: number): number {
  const range = max - min;
  if (range === 0) {
    return min;
  }
  let result = (value - min) % range;
  if (result < 0) {
    result += range;
  }
  return result + min;
}
