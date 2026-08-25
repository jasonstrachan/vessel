import {
  AUTO_CONVERT_MAX_COVERAGE,
  AUTO_CONVERT_MAX_FOCUS,
  AUTO_CONVERT_MAX_RESOLUTION,
  AUTO_CONVERT_MAX_SHAPES,
  AUTO_CONVERT_MIN_COVERAGE,
  AUTO_CONVERT_MIN_FOCUS,
  AUTO_CONVERT_MIN_RESOLUTION,
  AUTO_CONVERT_MIN_SHAPES,
} from '@/constants/colorCycleAutoConvert';

export type ColorCycleAutoConvertSettings = {
  shapes: number;
  focus: number;
  coverage: number;
  resolutionRange: [number, number];
};

const AUTO_CONVERT_SETTINGS_STORAGE_KEY = 'vessel-color-cycle-auto-convert-settings';

export const DEFAULT_AUTO_CONVERT_SETTINGS: ColorCycleAutoConvertSettings = {
  shapes: 24,
  focus: 50,
  coverage: 100,
  resolutionRange: [1, 8],
};

const clampInteger = (value: unknown, minimum: number, maximum: number, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
};

const sanitizeSettings = (value: unknown): ColorCycleAutoConvertSettings => {
  if (!value || typeof value !== 'object') {
    return {
      ...DEFAULT_AUTO_CONVERT_SETTINGS,
      resolutionRange: [...DEFAULT_AUTO_CONVERT_SETTINGS.resolutionRange],
    };
  }
  const stored = value as Partial<ColorCycleAutoConvertSettings>;
  const storedRange = Array.isArray(stored.resolutionRange)
    ? stored.resolutionRange
    : DEFAULT_AUTO_CONVERT_SETTINGS.resolutionRange;
  const firstResolution = clampInteger(
    storedRange[0],
    AUTO_CONVERT_MIN_RESOLUTION,
    AUTO_CONVERT_MAX_RESOLUTION,
    DEFAULT_AUTO_CONVERT_SETTINGS.resolutionRange[0],
  );
  const secondResolution = clampInteger(
    storedRange[1],
    AUTO_CONVERT_MIN_RESOLUTION,
    AUTO_CONVERT_MAX_RESOLUTION,
    DEFAULT_AUTO_CONVERT_SETTINGS.resolutionRange[1],
  );
  return {
    shapes: clampInteger(
      stored.shapes,
      AUTO_CONVERT_MIN_SHAPES,
      AUTO_CONVERT_MAX_SHAPES,
      DEFAULT_AUTO_CONVERT_SETTINGS.shapes,
    ),
    focus: clampInteger(
      stored.focus,
      AUTO_CONVERT_MIN_FOCUS,
      AUTO_CONVERT_MAX_FOCUS,
      DEFAULT_AUTO_CONVERT_SETTINGS.focus,
    ),
    coverage: clampInteger(
      stored.coverage,
      AUTO_CONVERT_MIN_COVERAGE,
      AUTO_CONVERT_MAX_COVERAGE,
      DEFAULT_AUTO_CONVERT_SETTINGS.coverage,
    ),
    resolutionRange: [
      Math.min(firstResolution, secondResolution),
      Math.max(firstResolution, secondResolution),
    ],
  };
};

export const loadColorCycleAutoConvertSettings = (): ColorCycleAutoConvertSettings => {
  if (typeof window === 'undefined') {
    return sanitizeSettings(null);
  }
  try {
    const stored = window.localStorage.getItem(AUTO_CONVERT_SETTINGS_STORAGE_KEY);
    return sanitizeSettings(stored ? JSON.parse(stored) : null);
  } catch {
    return sanitizeSettings(null);
  }
};

export const saveColorCycleAutoConvertSettings = (
  settings: ColorCycleAutoConvertSettings,
): void => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(
      AUTO_CONVERT_SETTINGS_STORAGE_KEY,
      JSON.stringify(sanitizeSettings(settings)),
    );
  } catch {
    // Persistence is best effort when browser storage is unavailable or full.
  }
};
