import { parseColor } from './colorUtils';

import type { BrushSettings } from '@/types';

export type RegularDitherVariety = {
  phaseOffset?: { x: number; y: number };
  toneBias: number;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const clamp255 = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};

export const resolveRegularDitherVariety = ({
  settings,
  palette,
}: {
  settings: BrushSettings;
  palette: string[];
}): RegularDitherVariety => {
  const diversity = clamp01((settings.ditherPatternDiversity ?? 100) / 100);
  if (diversity <= 0) {
    return { toneBias: 0 };
  }

  const foreground = settings.color ?? palette[0] ?? '#000';
  const [r, g, b] = parseColor(foreground);
  const hash = hashString([
    foreground,
    palette.join('|'),
    settings.ditherAlgorithm ?? 'sierra-lite',
    settings.patternStyle ?? 'dots',
    Math.round(settings.ditherPaletteSpread ?? 0),
  ].join(':'));
  const luminance01 = clamp01((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
  const colorTone = ((hash >>> 8) & 0xff) / 255 - 0.5;
  const contrastTone = 0.5 - luminance01;
  const rawToneBias = Math.round((colorTone * 26 + contrastTone * 18) * diversity);
  const toneBias = (() => {
    if (luminance01 < 0.18) {
      return Math.max(Math.round(18 * diversity), rawToneBias);
    }
    if (luminance01 > 0.92) {
      return Math.min(-Math.round(28 * diversity), rawToneBias);
    }
    return rawToneBias;
  })();

  return {
    phaseOffset: {
      x: Math.round(((hash & 0x0f) - 8) * diversity),
      y: Math.round((((hash >>> 4) & 0x0f) - 8) * diversity),
    },
    toneBias,
  };
};

export const applyRegularDitherVarietyToImageData = (
  imageData: ImageData,
  variety: RegularDitherVariety
): ImageData => {
  if (variety.toneBias === 0) {
    return imageData;
  }

  const data = new Uint8ClampedArray(imageData.data);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      continue;
    }
    data[i] = clamp255(data[i] + variety.toneBias);
    data[i + 1] = clamp255(data[i + 1] + variety.toneBias);
    data[i + 2] = clamp255(data[i + 2] + variety.toneBias);
  }
  return new ImageData(data, imageData.width, imageData.height);
};
