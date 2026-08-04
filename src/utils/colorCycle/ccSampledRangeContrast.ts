import { parseColor } from '@/hooks/brushEngine/colorUtils';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const SOURCE_RANGE_POINT = 70;
const MAX_RANGE_MULTIPLIER = 1.75;

const formatRgb = (rgb: [number, number, number]): string =>
  `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

const mixChannel = (center: number, value: number, amount: number): number =>
  Math.max(0, Math.min(255, Math.round(center + (value - center) * amount)));

export const resolveCcSampledRangeContrastAmount = (rangeContrast?: number): number => {
  if (!Number.isFinite(rangeContrast)) {
    return 1;
  }
  const contrast = clamp01((rangeContrast ?? SOURCE_RANGE_POINT) / 100) * 100;
  if (contrast <= SOURCE_RANGE_POINT) {
    return Math.pow(contrast / SOURCE_RANGE_POINT, 1.35);
  }
  const expansion = (contrast - SOURCE_RANGE_POINT) / (100 - SOURCE_RANGE_POINT);
  return 1 + Math.pow(expansion, 1.15) * (MAX_RANGE_MULTIPLIER - 1);
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
  rangeContrast?: number,
  representativeColor?: string | null,
): StoredStop[] => {
  if (!stops.length) {
    return [];
  }
  const amount = resolveCcSampledRangeContrastAmount(rangeContrast);
  if (Math.abs(amount - 1) < 0.001) {
    return stops.map((stop) => ({ ...stop }));
  }
  const representative = representativeColor
    ? parseColor(representativeColor)
    : resolveRepresentativeSampledColor(stops);
  return stops.map((stop) => {
    const rgb = parseColor(stop.color);
    const compressed: [number, number, number] = [
      mixChannel(representative[0], rgb[0], amount),
      mixChannel(representative[1], rgb[1], amount),
      mixChannel(representative[2], rgb[2], amount),
    ];
    if (
      compressed[0] === rgb[0]
      && compressed[1] === rgb[1]
      && compressed[2] === rgb[2]
    ) {
      return { ...stop };
    }
    return {
      ...stop,
      color: formatRgb(compressed),
    };
  });
};
