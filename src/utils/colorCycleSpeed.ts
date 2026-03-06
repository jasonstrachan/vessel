import {
  DEFAULT_BRUSH_COLOR_CYCLE_SPEED,
  MAX_BRUSH_COLOR_CYCLE_SPEED,
  MIN_ANIMATED_BRUSH_COLOR_CYCLE_SPEED,
  MIN_BRUSH_COLOR_CYCLE_SPEED,
} from '@/constants/colorCycle';

const SPEED_BYTE_RANGE = 254;
const MIN_SPEED_QUANT_STEP = 0.005;

export const quantizeColorCycleSpeed = (speed?: number | null): number | null => {
  if (!Number.isFinite(speed)) {
    return null;
  }
  const clamped = Math.max(0, speed as number);
  const step = Math.max(MIN_SPEED_QUANT_STEP, clamped * 0.02);
  if (!Number.isFinite(step) || step <= 0) {
    return clamped;
  }
  return Math.round(clamped / step) * step;
};

export const sanitizeBrushColorCycleSpeed = (
  speed?: number | null,
  fallback: number = DEFAULT_BRUSH_COLOR_CYCLE_SPEED,
): number => {
  const candidate = Number.isFinite(speed) ? (speed as number) : fallback;
  const resolvedFallback = Number.isFinite(fallback) ? fallback : DEFAULT_BRUSH_COLOR_CYCLE_SPEED;
  const clamped = Math.max(
    MIN_ANIMATED_BRUSH_COLOR_CYCLE_SPEED,
    Math.min(MAX_BRUSH_COLOR_CYCLE_SPEED, candidate > 0 ? candidate : resolvedFallback),
  );
  return Number.isFinite(clamped) ? clamped : DEFAULT_BRUSH_COLOR_CYCLE_SPEED;
};

export const encodeColorCycleSpeedByte = (speed?: number | null): number => {
  if (!Number.isFinite(speed)) {
    return 0;
  }
  if ((speed as number) <= 0) {
    return 0;
  }
  const clamped = Math.max(
    MIN_BRUSH_COLOR_CYCLE_SPEED,
    Math.min(MAX_BRUSH_COLOR_CYCLE_SPEED, speed as number),
  );
  const t = (clamped - MIN_BRUSH_COLOR_CYCLE_SPEED)
    / (MAX_BRUSH_COLOR_CYCLE_SPEED - MIN_BRUSH_COLOR_CYCLE_SPEED || 1);
  const encoded = Math.round(t * SPEED_BYTE_RANGE) + 1;
  return Math.max(1, Math.min(255, encoded));
};

export const decodeColorCycleSpeedByte = (byte: number): number => {
  if (!Number.isFinite(byte) || byte <= 0) {
    return 0;
  }
  const normalized = Math.max(0, Math.min(SPEED_BYTE_RANGE, Math.round(byte) - 1));
  return MIN_BRUSH_COLOR_CYCLE_SPEED
    + (normalized / SPEED_BYTE_RANGE)
      * (MAX_BRUSH_COLOR_CYCLE_SPEED - MIN_BRUSH_COLOR_CYCLE_SPEED);
};
