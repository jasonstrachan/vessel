import { parseColor } from './colorUtils';

import type { BrushSettings } from '@/types';

export type DitherVarietyPoint = { x: number; y: number };

export type RegularDitherVariety = {
  phaseOffset?: { x: number; y: number };
  toneBias: number;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const clamp255 = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const mixHash = (hash: number, value: number): number => {
  let next = (hash ^ value) >>> 0;
  next = Math.imul(next ^ (next >>> 16), 0x7feb352d) >>> 0;
  next = Math.imul(next ^ (next >>> 15), 0x846ca68b) >>> 0;
  return (next ^ (next >>> 16)) >>> 0;
};

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};

export const computeRegularDitherShapeSeed = (points: DitherVarietyPoint[]): number => {
  if (!points.length) {
    return 0;
  }

  let hash = 0x811c9dc5;
  for (const point of points) {
    hash = mixHash(hash, Math.round(point.x * 16));
    hash = mixHash(hash, Math.round(point.y * 16));
  }
  return mixHash(hash, points.length);
};

export const resolveRegularDitherVariety = ({
  settings,
  palette,
  seed,
}: {
  settings: BrushSettings;
  palette: string[];
  seed?: number;
}): RegularDitherVariety => {
  const diversity = clamp01((settings.ditherPatternDiversity ?? 100) / 100);
  if (diversity <= 0) {
    return { toneBias: 0 };
  }

  const foreground = settings.color ?? palette[0] ?? '#000';
  const [r, g, b] = parseColor(foreground);
  const colorHash = hashString([
    foreground,
    palette.join('|'),
    settings.ditherAlgorithm ?? 'sierra-lite',
    settings.patternStyle ?? 'dots',
    Math.round(settings.ditherPaletteSpread ?? 0),
  ].join(':'));
  const hash = mixHash(seed ?? 0, colorHash);
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
