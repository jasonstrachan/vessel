import { parseColor } from '@/hooks/brushEngine/colorUtils';
import { parseCssColor } from '@/utils/color/parseCssColor';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const SOURCE_RANGE_POINT = 70;
const MAX_RANGE_MULTIPLIER = 1.75;

const parseContrastColor = (color: string) => {
  const [r, g, b] = parseColor(color);
  const fallback = { r, g, b, a: 255 };
  const parsed = parseCssColor(color, fallback);
  return Number.isFinite(parsed.r + parsed.g + parsed.b + parsed.a) ? parsed : fallback;
};

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
    const rgb = parseContrastColor(stop.color);
    acc[0] += rgb.r;
    acc[1] += rgb.g;
    acc[2] += rgb.b;
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
  const representativeRgba = representativeColor ? parseContrastColor(representativeColor) : null;
  const representative = representativeRgba
    ? [representativeRgba.r, representativeRgba.g, representativeRgba.b]
    : resolveRepresentativeSampledColor(stops);
  return stops.map((stop) => {
    const { r, g, b, a } = parseContrastColor(stop.color);
    const compressed: [number, number, number] = [
      mixChannel(representative[0], r, amount),
      mixChannel(representative[1], g, amount),
      mixChannel(representative[2], b, amount),
    ];
    if (
      compressed[0] === r
      && compressed[1] === g
      && compressed[2] === b
    ) {
      return { ...stop };
    }
    return {
      ...stop,
      color: a === 255
        ? `rgb(${compressed.join(', ')})`
        : `rgba(${compressed.join(', ')}, ${a / 255})`,
    };
  });
};
