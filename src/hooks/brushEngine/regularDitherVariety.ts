import type { BrushSettings } from '@/types';

export type RegularDitherVariety = {
  diversity: number;
  seed: number;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

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
  const foreground = settings.color ?? palette[0] ?? '#000';

  return {
    diversity,
    seed: hashString([
      foreground,
      palette.join('|'),
      settings.ditherAlgorithm ?? 'sierra-lite',
      settings.patternStyle ?? 'dots',
      Math.round(settings.ditherPaletteSpread ?? 0),
    ].join(':')),
  };
};
