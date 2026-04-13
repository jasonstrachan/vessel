import type { DisplayFilterConfig, DisplayFilterId } from '@/types';

type DisplayFilterForId<I extends DisplayFilterId> = Extract<DisplayFilterConfig, { id: I }>;

const FILTER_ORDER: DisplayFilterId[] = [
  'pixelate',
  'bloom',
  'color-grade',
  'lcd-mask',
  'noise',
];

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
};

const roundToStep = (value: number, step: number): number => {
  if (!Number.isFinite(step) || step <= 0) {
    return value;
  }
  return Math.round(value / step) * step;
};

const sanitizePixelate = (filter?: Partial<DisplayFilterForId<'pixelate'>>): DisplayFilterConfig => ({
  id: 'pixelate',
  enabled: filter?.enabled === true,
  settings: {
    cellSize: Math.max(1, Math.round(clamp(
      filter?.settings?.cellSize,
      1,
      64,
      3,
    ))),
  },
});

const sanitizeBloom = (filter?: Partial<DisplayFilterForId<'bloom'>>): DisplayFilterConfig => ({
  id: 'bloom',
  enabled: filter?.enabled === true,
  settings: {
    blurRadius: Math.max(0, roundToStep(clamp(
      filter?.settings?.blurRadius,
      0,
      12,
      1.5,
    ), 0.5)),
    intensity: roundToStep(clamp(
      filter?.settings?.intensity,
      0,
      1,
      0.18,
    ), 0.01),
  },
});

const sanitizeColorGrade = (filter?: Partial<DisplayFilterForId<'color-grade'>>): DisplayFilterConfig => ({
  id: 'color-grade',
  enabled: filter?.enabled === true,
  settings: {
    brightness: roundToStep(clamp(
      filter?.settings?.brightness,
      -1,
      1,
      -0.02,
    ), 0.01),
    contrast: roundToStep(clamp(
      filter?.settings?.contrast,
      -1,
      1,
      0.08,
    ), 0.01),
    saturation: roundToStep(clamp(
      filter?.settings?.saturation,
      0,
      2,
      0.88,
    ), 0.01),
  },
});

const sanitizeLcdMask = (filter?: Partial<DisplayFilterForId<'lcd-mask'>>): DisplayFilterConfig => ({
  id: 'lcd-mask',
  enabled: filter?.enabled === true,
  settings: {
    stripeOpacity: roundToStep(clamp(
      filter?.settings?.stripeOpacity,
      0,
      1,
      0.16,
    ), 0.01),
    scanlineOpacity: roundToStep(clamp(
      filter?.settings?.scanlineOpacity,
      0,
      1,
      0.05,
    ), 0.01),
  },
});

const sanitizeNoise = (filter?: Partial<DisplayFilterForId<'noise'>>): DisplayFilterConfig => ({
  id: 'noise',
  enabled: filter?.enabled === true,
  settings: {
    opacity: roundToStep(clamp(
      filter?.settings?.opacity,
      0,
      1,
      0.08,
    ), 0.01),
    scale: roundToStep(clamp(
      filter?.settings?.scale,
      1,
      8,
      2,
    ), 0.5),
  },
});

export const createDefaultDisplayFilters = (): DisplayFilterConfig[] => ([
  sanitizePixelate(),
  sanitizeBloom(),
  sanitizeColorGrade(),
  sanitizeLcdMask(),
  sanitizeNoise(),
]);

const sanitizeDisplayFilter = (filter?: Partial<DisplayFilterConfig>): DisplayFilterConfig => {
  switch (filter?.id) {
    case 'pixelate':
      return sanitizePixelate(filter);
    case 'bloom':
      return sanitizeBloom(filter);
    case 'color-grade':
      return sanitizeColorGrade(filter);
    case 'lcd-mask':
      return sanitizeLcdMask(filter);
    case 'noise':
      return sanitizeNoise(filter);
    default:
      return sanitizePixelate();
  }
};

export const sanitizeDisplayFilters = (
  filters?: Array<Partial<DisplayFilterConfig>> | null,
): DisplayFilterConfig[] => {
  const byId = new Map<DisplayFilterId, Partial<DisplayFilterConfig>>();
  for (const filter of filters ?? []) {
    if (
      filter &&
      typeof filter === 'object' &&
      typeof filter.id === 'string' &&
      FILTER_ORDER.includes(filter.id as DisplayFilterId)
    ) {
      byId.set(filter.id as DisplayFilterId, filter);
    }
  }

  return FILTER_ORDER.map((id) => sanitizeDisplayFilter(byId.get(id) ?? { id }));
};

export const cloneDisplayFilters = (filters?: DisplayFilterConfig[] | null): DisplayFilterConfig[] =>
  sanitizeDisplayFilters(filters ?? createDefaultDisplayFilters());

export const hasEnabledDisplayFilters = (filters?: DisplayFilterConfig[] | null): boolean =>
  (filters ?? []).some((filter) => filter.enabled);

export const getDisplayFilterById = <I extends DisplayFilterId>(
  filters: DisplayFilterConfig[] | null | undefined,
  id: I,
): DisplayFilterForId<I> | undefined =>
  (filters ?? []).find((filter): filter is DisplayFilterForId<I> => filter.id === id);
