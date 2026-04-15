import type { DisplayFilterConfig, DisplayFilterId } from '@/types';

type DisplayFilterForId<I extends DisplayFilterId> = Extract<DisplayFilterConfig, { id: I }>;

const FILTER_ORDER: DisplayFilterId[] = [
  'pixelate',
  'round-pixels',
  'bloom',
  'color-grade',
  'lcd-mask',
  'crt',
  'crt-grid',
  'chromatic-aberration',
  'noise',
  'film-noise',
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
      2,
      0.18,
    ), 0.01),
  },
});

const sanitizeRoundPixels = (filter?: Partial<DisplayFilterForId<'round-pixels'>>): DisplayFilterConfig => ({
  id: 'round-pixels',
  enabled: filter?.enabled === true,
  settings: {
    blurRadius: Math.max(0, roundToStep(clamp(
      filter?.settings?.blurRadius,
      0,
      12,
      1.5,
    ), 0.25)),
    threshold: roundToStep(clamp(
      filter?.settings?.threshold,
      0,
      1,
      0.5,
    ), 0.01),
    crush: roundToStep(clamp(
      filter?.settings?.crush,
      0,
      1,
      0.35,
    ), 0.01),
    preserveColor: roundToStep(clamp(
      filter?.settings?.preserveColor,
      0,
      1,
      0.85,
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

const sanitizeCrt = (filter?: Partial<DisplayFilterForId<'crt'>>): DisplayFilterConfig => ({
  id: 'crt',
  enabled: filter?.enabled === true,
  settings: {
    cellSize: Math.max(1, Math.round(clamp(
      filter?.settings?.cellSize,
      1,
      32,
      12,
    ))),
    scanlineIntensity: roundToStep(clamp(
      filter?.settings?.scanlineIntensity,
      0,
      1,
      0.08,
    ), 0.01),
    maskIntensity: roundToStep(clamp(
      filter?.settings?.maskIntensity,
      0,
      1,
      0.07,
    ), 0.01),
    barrelDistortion: roundToStep(clamp(
      filter?.settings?.barrelDistortion,
      0,
      0.4,
      0.15,
    ), 0.01),
    chromaticAberration: roundToStep(clamp(
      filter?.settings?.chromaticAberration,
      0,
      8,
      2,
    ), 0.25),
    beamFocus: roundToStep(clamp(
      filter?.settings?.beamFocus,
      0,
      1,
      0.51,
    ), 0.01),
    brightness: roundToStep(clamp(
      filter?.settings?.brightness,
      0,
      1.5,
      0.5,
    ), 0.01),
    shadowLift: roundToStep(clamp(
      filter?.settings?.shadowLift,
      0,
      0.5,
      0.16,
    ), 0.01),
    vignetteIntensity: roundToStep(clamp(
      filter?.settings?.vignetteIntensity,
      0,
      1,
      0.45,
    ), 0.01),
    flickerIntensity: roundToStep(clamp(
      filter?.settings?.flickerIntensity,
      0,
      1,
      0.2,
    ), 0.01),
    signalArtifacts: roundToStep(clamp(
      filter?.settings?.signalArtifacts,
      0,
      1,
      0.45,
    ), 0.01),
    bloomIntensity: roundToStep(clamp(
      filter?.settings?.bloomIntensity,
      0,
      4,
      1.93,
    ), 0.01),
    bloomRadius: roundToStep(clamp(
      filter?.settings?.bloomRadius,
      0,
      32,
      24,
    ), 0.5),
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

const sanitizeFilmNoise = (filter?: Partial<DisplayFilterForId<'film-noise'>>): DisplayFilterConfig => ({
  id: 'film-noise',
  enabled: filter?.enabled === true,
  settings: {
    opacity: roundToStep(clamp(
      filter?.settings?.opacity,
      0,
      1,
      0.16,
    ), 0.01),
    scale: roundToStep(clamp(
      filter?.settings?.scale,
      1,
      8,
      1.5,
    ), 0.25),
    shadowBias: roundToStep(clamp(
      filter?.settings?.shadowBias,
      0,
      1,
      0.62,
    ), 0.01),
  },
});

const sanitizeChromaticAberration = (
  filter?: Partial<DisplayFilterForId<'chromatic-aberration'>>,
): DisplayFilterConfig => ({
  id: 'chromatic-aberration',
  enabled: filter?.enabled === true,
  settings: {
    offset: roundToStep(clamp(
      filter?.settings?.offset,
      0,
      12,
      2,
    ), 0.25),
    intensity: roundToStep(clamp(
      filter?.settings?.intensity,
      0,
      1,
      0.38,
    ), 0.01),
  },
});

const sanitizeCrtGrid = (filter?: Partial<DisplayFilterForId<'crt-grid'>>): DisplayFilterConfig => ({
  id: 'crt-grid',
  enabled: filter?.enabled === true,
  settings: {
    lineOpacity: roundToStep(clamp(
      filter?.settings?.lineOpacity,
      0,
      1,
      0.14,
    ), 0.01),
    lineSpacing: Math.max(1, Math.round(clamp(
      filter?.settings?.lineSpacing,
      1,
      16,
      4,
    ))),
    phosphorOpacity: roundToStep(clamp(
      filter?.settings?.phosphorOpacity,
      0,
      1,
      0.12,
    ), 0.01),
    scanlineOpacity: roundToStep(clamp(
      filter?.settings?.scanlineOpacity,
      0,
      1,
      0.18,
    ), 0.01),
  },
});

export const createDefaultDisplayFilters = (): DisplayFilterConfig[] => ([
  sanitizePixelate(),
  sanitizeRoundPixels(),
  sanitizeBloom(),
  sanitizeColorGrade(),
  sanitizeLcdMask(),
  sanitizeCrt(),
  sanitizeCrtGrid(),
  sanitizeChromaticAberration(),
  sanitizeNoise(),
  sanitizeFilmNoise(),
]);

const sanitizeDisplayFilter = (filter?: Partial<DisplayFilterConfig>): DisplayFilterConfig => {
  switch (filter?.id) {
    case 'pixelate':
      return sanitizePixelate(filter);
    case 'round-pixels':
      return sanitizeRoundPixels(filter);
    case 'bloom':
      return sanitizeBloom(filter);
    case 'color-grade':
      return sanitizeColorGrade(filter);
    case 'lcd-mask':
      return sanitizeLcdMask(filter);
    case 'crt':
      return sanitizeCrt(filter);
    case 'crt-grid':
      return sanitizeCrtGrid(filter);
    case 'chromatic-aberration':
      return sanitizeChromaticAberration(filter);
    case 'noise':
      return sanitizeNoise(filter);
    case 'film-noise':
      return sanitizeFilmNoise(filter);
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

export const disableDisplayFilters = (
  filters?: DisplayFilterConfig[] | null,
): DisplayFilterConfig[] =>
  sanitizeDisplayFilters(filters ?? createDefaultDisplayFilters()).map((filter) => ({
    ...filter,
    enabled: false,
  }));

export const hasEnabledDisplayFilters = (filters?: DisplayFilterConfig[] | null): boolean =>
  (filters ?? []).some((filter) => filter.enabled);

export const getDisplayFilterById = <I extends DisplayFilterId>(
  filters: DisplayFilterConfig[] | null | undefined,
  id: I,
): DisplayFilterForId<I> | undefined =>
  (filters ?? []).find((filter): filter is DisplayFilterForId<I> => filter.id === id);
