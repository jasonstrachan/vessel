import type { ColorCycleSampledMotion } from '@/types';

const normalizeByte = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(255, Math.round(value)));
};

export const normalizeColorCycleSampledMotion = (
  value: unknown,
): ColorCycleSampledMotion | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ColorCycleSampledMotion>;
  const phaseByte = normalizeByte(candidate.phaseByte);
  const speedByte = normalizeByte(candidate.speedByte);
  const flowByte = normalizeByte(candidate.flowByte);
  if (
    phaseByte === null ||
    speedByte === null ||
    (flowByte !== 1 && flowByte !== 2 && flowByte !== 3)
  ) {
    return null;
  }

  return { phaseByte, speedByte, flowByte };
};
