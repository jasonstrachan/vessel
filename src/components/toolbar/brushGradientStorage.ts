import type { BrushSettings } from '@/types';
import { GRADIENT_PRESETS } from '@/utils/gradientPresets';
import { logError } from '@/utils/debug';

const CUSTOM_GRADIENTS_STORAGE_KEY = 'vessel_custom_gradients';

export type BrushGradientStop = NonNullable<BrushSettings['colorCycleGradient']>[number];

export type SavedBrushGradient = {
  id: string;
  name: string;
  stops: BrushGradientStop[];
  isDefault?: boolean;
  baseGradientId?: string;
};

const DEFAULT_PRESET_ID_SET = new Set(GRADIENT_PRESETS.map((gradient) => gradient.id));
let savedGradientIdSequence = 0;

export const cloneGradientStops = (stops: BrushGradientStop[]): BrushGradientStop[] =>
  stops.map((stop) => ({ ...stop }));

export const gradientStopsSignature = (stops: BrushGradientStop[]): string =>
  stops
    .map((stop) => `${stop.position.toFixed(4)}|${(stop.opacity ?? 1).toFixed(3)}|${stop.color.toLowerCase()}`)
    .join(',');

const sanitizeGradientStop = (stop: unknown): BrushGradientStop | null => {
  if (!stop || typeof stop !== 'object') {
    return null;
  }

  const candidate = stop as Partial<BrushGradientStop>;
  const position = typeof candidate.position === 'number' ? candidate.position : Number.NaN;
  const color = typeof candidate.color === 'string' ? candidate.color.trim() : '';
  const opacity =
    typeof candidate.opacity === 'number'
      ? candidate.opacity
      : candidate.opacity === undefined
        ? 1
        : Number.NaN;

  if (!Number.isFinite(position) || position < 0 || position > 1 || !color || !Number.isFinite(opacity)) {
    return null;
  }

  return {
    position,
    color,
    opacity: Math.max(0, Math.min(1, opacity)),
  };
};

const sanitizeStoredGradient = (gradient: unknown): SavedBrushGradient | null => {
  if (!gradient || typeof gradient !== 'object') {
    return null;
  }

  const candidate = gradient as Partial<SavedBrushGradient>;
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
  const baseGradientId = typeof candidate.baseGradientId === 'string'
    ? candidate.baseGradientId.trim()
    : undefined;
  const stops = Array.isArray(candidate.stops)
    ? candidate.stops
      .map(sanitizeGradientStop)
      .filter((stop): stop is BrushGradientStop => stop !== null)
      .sort((a, b) => a.position - b.position)
    : [];

  return id && name && stops.length >= 2
    ? {
        id,
        name,
        stops,
        isDefault: false,
        ...(baseGradientId ? { baseGradientId } : {}),
      }
    : null;
};

export const createSavedGradientId = (prefix: 'custom' | 'sampled'): string => {
  savedGradientIdSequence += 1;
  return `${prefix}_${Date.now()}_${savedGradientIdSequence.toString(36)}`;
};

const ensureUniqueGradientIds = (gradients: SavedBrushGradient[]): SavedBrushGradient[] => {
  const seen = new Set<string>();
  return gradients.map((gradient) => {
    if (!seen.has(gradient.id)) {
      seen.add(gradient.id);
      return gradient;
    }
    const id = createSavedGradientId('custom');
    seen.add(id);
    return { ...gradient, id };
  });
};

export const createForkedGradientName = (baseName: string, gradients: SavedBrushGradient[]): string => {
  const rootName = `${baseName} Custom`;
  const existingNames = new Set(gradients.map((gradient) => gradient.name));
  if (!existingNames.has(rootName)) {
    return rootName;
  }

  let suffix = 2;
  while (existingNames.has(`${rootName} ${suffix}`)) {
    suffix += 1;
  }
  return `${rootName} ${suffix}`;
};

export const findGradientByStops = (
  gradients: SavedBrushGradient[],
  stops: BrushGradientStop[],
): SavedBrushGradient | undefined => {
  const signature = gradientStopsSignature(stops);
  return gradients.find((gradient) => gradientStopsSignature(gradient.stops) === signature);
};

export const findDefaultOverrideGradient = (
  gradients: SavedBrushGradient[],
  defaultGradientId: string,
): SavedBrushGradient | undefined => {
  for (let index = gradients.length - 1; index >= 0; index -= 1) {
    const gradient = gradients[index];
    if (!gradient.isDefault && gradient.baseGradientId === defaultGradientId) {
      return gradient;
    }
  }
  return undefined;
};

const inferBaseGradientIdFromName = (gradientName: string): string | undefined => {
  const normalizedName = gradientName.trim().toLowerCase();
  const matchedDefault = GRADIENT_PRESETS.find((preset) => {
    const expectedPrefix = `${preset.name} Custom`.toLowerCase();
    return normalizedName === expectedPrefix || normalizedName.startsWith(`${expectedPrefix} `);
  });
  return matchedDefault?.id;
};

const migrateLegacyDefaultOverrides = (gradients: SavedBrushGradient[]): SavedBrushGradient[] => (
  gradients.map((gradient) => {
    if (gradient.isDefault || gradient.baseGradientId) {
      return gradient;
    }
    const baseGradientId = inferBaseGradientIdFromName(gradient.name);
    return baseGradientId ? { ...gradient, baseGradientId } : gradient;
  })
);

export const shouldAutoSelectGradientId = (id: string): boolean => (
  id.length === 0 || DEFAULT_PRESET_ID_SET.has(id)
);

export const loadSavedBrushGradients = (): SavedBrushGradient[] => {
  const defaults = GRADIENT_PRESETS.map((gradient) => ({
    id: gradient.id,
    name: gradient.name,
    stops: gradient.stops.map((stop) => ({
      ...stop,
      opacity: 'opacity' in stop && typeof stop.opacity === 'number' ? stop.opacity : 1,
    })),
    isDefault: true,
  }));

  if (typeof window === 'undefined') {
    return defaults;
  }

  try {
    const stored = window.localStorage.getItem(CUSTOM_GRADIENTS_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) as unknown : [];
    const customGradients = Array.isArray(parsed)
      ? migrateLegacyDefaultOverrides(ensureUniqueGradientIds(parsed
          .map(sanitizeStoredGradient)
          .filter((gradient): gradient is SavedBrushGradient => (
            gradient !== null && !DEFAULT_PRESET_ID_SET.has(gradient.id)
          ))))
      : [];
    return [...defaults, ...customGradients];
  } catch (error) {
    logError('Failed to load gradients:', error);
    return defaults;
  }
};

export const saveCustomBrushGradients = (gradients: SavedBrushGradient[]): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const customGradients = gradients.filter((gradient) => !gradient.isDefault);
    window.localStorage.setItem(
      CUSTOM_GRADIENTS_STORAGE_KEY,
      JSON.stringify(customGradients)
    );
  } catch (error) {
    logError('Failed to save gradients:', error);
  }
};
