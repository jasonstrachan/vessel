import { OKLabConverter } from '@/lib/colorCycle/colorSpace/OKLabConverter';
import { parseColor } from '@/hooks/brushEngine/colorUtils';
import { parseCssColor } from '@/utils/color/parseCssColor';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';
import { ensurePalette } from '@/lib/colorCycle/paletteService';
import type { GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import type { BrushSettings } from '@/types';

export const canUseCcInkSpread = (settings: BrushSettings, source: string, kind: 'stroke' | 'shape'): boolean => {
  if (source === 'fg' || settings.colorCyclePickupEnabled ||
      (source === 'manual' && settings.colorCycleGradientIsRuntimePalette)) return false;
  return kind === 'stroke'
    ? Boolean(settings.colorCycleStampDitherEnabled) && !settings.colorCyclePencilEnabled &&
      settings.colorCycleStampDitherBgFill !== false
    : Boolean(settings.ditherEnabled) &&
      (!settings.ccFlatCycleDither || (settings.ditherGradBgFill ?? settings.ditherBackgroundFill) !== false);
};

/** Bake the source loop before splitting so both moving inks retain its mixture. */
export const buildCcCycleInkPalettes = (
  stops: StoredStop[],
  spread: number | undefined,
  seamProfile?: GradientSeamProfile,
) => {
  const rgba = ensurePalette({ stops, seamProfile }).rgba;
  const targets = Array.from({ length: rgba.length / 4 }, (_, i) => ({
    position: i / (rgba.length / 4 - 1),
    color: `rgba(${rgba[i * 4]}, ${rgba[i * 4 + 1]}, ${rgba[i * 4 + 2]}, ${rgba[i * 4 + 3] / 255})`,
  }));
  return buildCcInkPalettes(targets, spread);
};

export const createCcFixedInkPreview = (stops: StoredStop[], settings: BrushSettings) => {
  if (!settings.ccFlatCycleDither || !settings.ditherEnabled || settings.colorCycleUseForegroundGradient ||
      settings.colorCyclePickupEnabled ||
      (settings.ccGradientSource !== 'sampled' && settings.colorCycleGradientIsRuntimePalette)) return null;
  const inks = buildCcCycleInkPalettes(stops,
    (settings.ditherGradBgFill ?? settings.ditherBackgroundFill) !== false ? settings.ditherPaletteSpread : 0,
    settings.colorCycleGradientSeamProfile);
  const primary = ensurePalette({ stops: inks.primary, seamProfile: 'hard' }).rgba;
  const secondary = ensurePalette({ stops: inks.secondary, seamProfile: 'hard' }).rgba;
  return (index: number, useSecondary = false): [number, number, number, number] => {
    const rgba = useSecondary ? secondary : primary;
    const offset = Math.max(0, Math.min(255, index - 1)) * 4;
    return [rgba[offset], rgba[offset + 1], rgba[offset + 2], rgba[offset + 3]];
  };
};

const toLinear = (byte: number): number => {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const toByte = (linear: number): number => Math.round(255 * (
  linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055
));

/** Separate inks while preserving their area-weighted linear-light mixture. */
export const buildCcInkPalettes = (stops: StoredStop[], spread = 0, primaryCoverage = 0.5): {
  primary: StoredStop[];
  secondary: StoredStop[];
} => {
  const amount = Number.isFinite(spread) ? Math.max(0, Math.min(100, spread)) / 100 : 0;
  const coverage = Number.isFinite(primaryCoverage) ? Math.max(0, Math.min(1, primaryCoverage)) : 0.5;
  const primary: StoredStop[] = [];
  const secondary: StoredStop[] = [];
  for (const stop of stops) {
    if (amount === 0 || coverage === 0 || coverage === 1) {
      primary.push({ ...stop });
      secondary.push({ ...stop });
      continue;
    }
    const fallback = parseColor(stop.color);
    const { r, g, b, a: alpha } = parseCssColor(stop.color, {
      r: fallback[0], g: fallback[1], b: fallback[2], a: 255,
    });
    const lab = OKLabConverter.rgbToOKLab({ r, g, b });
    const chroma = Math.hypot(lab.a, lab.b);
    const weight = chroma * chroma / (chroma * chroma + 0.06 ** 2);
    const mean = (r + g + b) / 3;
    const axis = [mean - r, mean - g, mean - b];
    const magnitude = Math.max(...axis.map(Math.abs));
    const directions = axis.map((component, channel) =>
      (channel === 2 ? 1 : -1) * (1 - weight) +
      (magnitude > 0 ? component / magnitude : 0) * weight,
    );
    // Hue adaptation chooses the direction, not the strength of the control.
    // Blended axes can partially cancel; normalize before applying Spread so
    // 100 still reaches the available gamut boundary for interior colours.
    const directionMagnitude = Math.max(...directions.map(Math.abs));
    const a: number[] = [];
    const other: number[] = [];
    for (const [channel, byte] of [r, g, b].entries()) {
      const target = toLinear(byte);
      // Move smoothly from neutral cool/warm inks to an opposing axis suited
      // to the target hue. No hue-angle seam or near-grey threshold can flip it.
      const direction = directions[channel] / directionMagnitude;
      const distance = direction > 0
        ? Math.min((1 - target) / (1 - coverage), target / coverage)
        : Math.min(target / (1 - coverage), (1 - target) / coverage);
      const delta = direction * distance * amount;
      a.push(toByte(Math.max(0, Math.min(1, target + (1 - coverage) * delta))));
      other.push(toByte(Math.max(0, Math.min(1, target - coverage * delta))));
    }
    const ink = (rgb: number[]): StoredStop => ({
      ...stop, color: `rgba(${rgb.join(', ')}, ${alpha / 255})`,
    });
    primary.push(ink(a));
    secondary.push(ink(other));
  }
  return { primary, secondary };
};
