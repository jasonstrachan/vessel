import type {
  AdjustmentEffect,
  AdjustmentEffectId,
  AdjustmentLayerData,
  ColorAdjustParams,
} from '@/types';

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
};

const defaultHueSatSettings = (): ColorAdjustParams => ({
  hue: 0,
  saturation: 0,
  vibrance: 0,
  lightness: 0,
  contrast: 0,
  red: 0,
  green: 0,
  blue: 0,
  hueRangeEnabled: false,
  hueRangeStart: 0,
  hueRangeEnd: 360,
});

export const ADJUSTMENT_EFFECT_LABELS: Record<AdjustmentEffectId, string> = {
  'hue-sat': 'Hue/Sat',
  'color-grade': 'Colour Grade',
  pixelate: 'Pixelate',
  bloom: 'Bloom',
};

export const createDefaultAdjustmentEffect = (
  id: AdjustmentEffectId = 'hue-sat',
): AdjustmentEffect => {
  switch (id) {
    case 'color-grade':
      return {
        id,
        settings: { brightness: 0, contrast: 0, saturation: 1 },
      };
    case 'pixelate':
      return { id, settings: { cellSize: 4 } };
    case 'bloom':
      return { id, settings: { blurRadius: 2, intensity: 0.3 } };
    case 'hue-sat':
    default:
      return { id: 'hue-sat', settings: defaultHueSatSettings() };
  }
};

export const sanitizeAdjustmentEffect = (
  effect: Partial<AdjustmentEffect> | null | undefined,
): AdjustmentEffect => {
  switch (effect?.id) {
    case 'color-grade': {
      const settings = effect.settings;
      return {
        id: effect.id,
        settings: {
          brightness: clamp(settings?.brightness, -1, 1, 0),
          contrast: clamp(settings?.contrast, -1, 1, 0),
          saturation: clamp(settings?.saturation, 0, 2, 1),
        },
      };
    }
    case 'pixelate':
      return {
        id: effect.id,
        settings: {
          cellSize: Math.round(clamp(effect.settings?.cellSize, 1, 64, 4)),
        },
      };
    case 'bloom':
      return {
        id: effect.id,
        settings: {
          blurRadius: clamp(effect.settings?.blurRadius, 0, 12, 2),
          intensity: clamp(effect.settings?.intensity, 0, 2, 0.3),
        },
      };
    case 'hue-sat': {
      const settings = effect.settings;
      return {
        id: effect.id,
        settings: {
          hue: clamp(settings?.hue, -180, 180, 0),
          saturation: clamp(settings?.saturation, -100, 100, 0),
          vibrance: clamp(settings?.vibrance, -100, 100, 0),
          lightness: clamp(settings?.lightness, -100, 100, 0),
          contrast: clamp(settings?.contrast, -100, 100, 0),
          red: clamp(settings?.red, -100, 100, 0),
          green: clamp(settings?.green, -100, 100, 0),
          blue: clamp(settings?.blue, -100, 100, 0),
          hueRangeEnabled: settings?.hueRangeEnabled === true,
          hueRangeStart: clamp(settings?.hueRangeStart, 0, 360, 0),
          hueRangeEnd: clamp(settings?.hueRangeEnd, 0, 360, 360),
        },
      };
    }
    default:
      return createDefaultAdjustmentEffect();
  }
};

export const sanitizeAdjustmentLayerData = (
  data: Partial<AdjustmentLayerData> | null | undefined,
): AdjustmentLayerData => ({
  effect: sanitizeAdjustmentEffect(data?.effect),
});

export const cloneAdjustmentLayerData = (
  data: AdjustmentLayerData | null | undefined,
): AdjustmentLayerData | undefined => data
  ? { effect: sanitizeAdjustmentEffect(data.effect) }
  : undefined;
