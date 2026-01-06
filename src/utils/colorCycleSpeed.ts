import {
  MAX_BRUSH_COLOR_CYCLE_SPEED,
  MIN_BRUSH_COLOR_CYCLE_SPEED,
} from '@/constants/colorCycle';

const SPEED_BYTE_RANGE = 254;

export const encodeColorCycleSpeedByte = (speed?: number | null): number => {
  if (!Number.isFinite(speed)) {
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
