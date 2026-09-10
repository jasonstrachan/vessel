import type { ColorAdjustParams, ColorAdjustTargetParams } from '@/types';

type TargetParams = Pick<ColorAdjustParams, 'hueRangeEnabled' | 'hueRangeStart' | 'hueRangeEnd'> & ColorAdjustTargetParams;

const wrap = (hue: number): number => ((hue % 360) + 360) % 360;
const falloff = (distance: number, softness: number): number => {
  if (distance <= 0) return 1;
  if (softness <= 0) return 0;
  return Math.max(0, 1 - distance / softness);
};

// Measure the original colour so adjustments cannot move their own selection.
export const getColorAdjustTargetWeight = (
  hue: number,
  saturation: number,
  lightness: number,
  params: TargetParams,
): number => {
  let weight = 1;
  if (params.hueRangeEnabled && !(params.hueRangeStart === 0 && params.hueRangeEnd === 360)) {
    const start = wrap(params.hueRangeStart);
    const end = wrap(params.hueRangeEnd);
    const value = wrap(hue);
    const inside = start <= end ? value >= start && value <= end : value >= start || value <= end;
    const distance = inside ? 0 : Math.min(wrap(start - value), wrap(value - end));
    // A grey has no hue; it can still be selected with lightness/saturation alone.
    weight = saturation === 0 ? 0 : falloff(distance, params.hueRangeSoftness ?? 0);
  }
  if (params.saturationRangeEnabled) {
    weight *= falloff(Math.max((params.saturationRangeStart ?? 0) - saturation,
      saturation - (params.saturationRangeEnd ?? 100), 0), params.saturationRangeSoftness ?? 0);
  }
  if (params.lightnessRangeEnabled) {
    weight *= falloff(Math.max((params.lightnessRangeStart ?? 0) - lightness,
      lightness - (params.lightnessRangeEnd ?? 100), 0), params.lightnessRangeSoftness ?? 0);
  }
  return weight;
};

export const getPickedColorAdjustTarget = (hue: number, saturation: number, lightness: number) => ({
  hueRangeEnabled: saturation > 0,
  hueRangeStart: wrap(hue - 15),
  hueRangeEnd: wrap(hue + 15),
  saturationRangeStart: Math.max(0, saturation - 10),
  saturationRangeEnd: Math.min(100, saturation + 10),
  lightnessRangeStart: Math.max(0, lightness - 10),
  lightnessRangeEnd: Math.min(100, lightness + 10),
  ...(saturation === 0 ? { saturationRangeEnabled: true, lightnessRangeEnabled: true } : {}),
});
