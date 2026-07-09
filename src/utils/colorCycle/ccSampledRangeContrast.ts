import { parseColor } from '@/hooks/brushEngine/colorUtils';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const formatRgb = (rgb: [number, number, number]): string =>
  `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

const mixChannel = (center: number, value: number, amount: number): number =>
  Math.max(0, Math.min(255, Math.round(center + (value - center) * amount)));

export const resolveCcSampledRangeContrastAmount = (rangeContrast?: number): number => {
  if (!Number.isFinite(rangeContrast)) {
    return 1;
  }
  const contrast01 = clamp01((rangeContrast ?? 100) / 100);
  return Math.pow(contrast01, 1.35);
};

export const resolveRepresentativeSampledColor = (stops: StoredStop[]): [number, number, number] => {
  if (!stops.length) {
    return [0, 0, 0];
  }
  const total = stops.reduce<[number, number, number]>((acc, stop) => {
    const rgb = parseColor(stop.color);
    acc[0] += rgb[0];
    acc[1] += rgb[1];
    acc[2] += rgb[2];
    return acc;
  }, [0, 0, 0]);
  return [
    Math.round(total[0] / stops.length),
    Math.round(total[1] / stops.length),
    Math.round(total[2] / stops.length),
  ];
};

export const applyCcSampledRangeContrast = (
  stops: StoredStop[],
  rangeContrast?: number
): StoredStop[] => {
  if (!stops.length) {
    return [];
  }
  const amount = resolveCcSampledRangeContrastAmount(rangeContrast);
  if (amount >= 0.999) {
    return stops.map((stop) => ({ ...stop }));
  }
  const representative = resolveRepresentativeSampledColor(stops);
  return stops.map((stop) => {
    const rgb = parseColor(stop.color);
    const compressed: [number, number, number] = [
      mixChannel(representative[0], rgb[0], amount),
      mixChannel(representative[1], rgb[1], amount),
      mixChannel(representative[2], rgb[2], amount),
    ];
    return {
      ...stop,
      color: formatRgb(compressed),
    };
  });
};
