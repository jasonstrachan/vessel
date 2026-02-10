import type { SequentialBrushSnapshot } from '@/types';

const UTF16_CODE_UNIT_BYTES = 2;

type PrimitivePluginValue = string | number | boolean | null;
type SequentialDitherAlgorithm =
  | 'floyd-steinberg'
  | 'jarvis-judice-ninke'
  | 'stucki'
  | 'burkes'
  | 'sierra-3'
  | 'sierra-2'
  | 'sierra-lite'
  | 'atkinson'
  | 'bayer'
  | 'blue-noise'
  | 'void-and-cluster'
  | 'pattern';
type SequentialPatternStyle =
  | 'dots'
  | 'lines'
  | 'vertical-lines'
  | 'horizontal-lines'
  | 'crosshatch'
  | 'diagonal'
  | 'tone-adaptive';

const DITHER_ALGORITHM_SET = new Set<SequentialDitherAlgorithm>([
  'floyd-steinberg',
  'jarvis-judice-ninke',
  'stucki',
  'burkes',
  'sierra-3',
  'sierra-2',
  'sierra-lite',
  'atkinson',
  'bayer',
  'blue-noise',
  'void-and-cluster',
  'pattern',
]);
const DITHER_PATTERN_STYLE_SET = new Set<SequentialPatternStyle>([
  'dots',
  'lines',
  'vertical-lines',
  'horizontal-lines',
  'crosshatch',
  'diagonal',
  'tone-adaptive',
]);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const normalizePluginConfigValue = (value: unknown): PrimitivePluginValue | undefined => {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (isFiniteNumber(value)) {
    return value;
  }
  return undefined;
};

const resolveDitherAlgorithm = (
  value: unknown,
  fallback?: unknown
): SequentialDitherAlgorithm => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (DITHER_ALGORITHM_SET.has(normalized as SequentialDitherAlgorithm)) {
      return normalized as SequentialDitherAlgorithm;
    }
  }
  if (typeof fallback === 'string') {
    const normalized = fallback.trim().toLowerCase();
    if (DITHER_ALGORITHM_SET.has(normalized as SequentialDitherAlgorithm)) {
      return normalized as SequentialDitherAlgorithm;
    }
  }
  return 'bayer';
};

const resolveDitherIntensity = (value: unknown, fallback?: unknown): number => {
  const primary = typeof value === 'number' && Number.isFinite(value) ? value : null;
  const backup = typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : null;
  const numeric = primary ?? backup ?? 80;
  return Math.max(0, Math.min(100, numeric));
};

const resolveDitherMatrixSize = (value: unknown, fillResolution?: unknown): 2 | 4 | 8 => {
  if (value === 2 || value === 4 || value === 8) {
    return value;
  }
  if (typeof fillResolution === 'number' && Number.isFinite(fillResolution)) {
    if (fillResolution >= 8) {
      return 8;
    }
    if (fillResolution >= 4) {
      return 4;
    }
    if (fillResolution > 0 && fillResolution <= 2) {
      return 2;
    }
  }
  return 8;
};

const resolvePatternStyle = (value: unknown, fallback?: unknown): SequentialPatternStyle => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (DITHER_PATTERN_STYLE_SET.has(normalized as SequentialPatternStyle)) {
      return normalized as SequentialPatternStyle;
    }
  }
  if (typeof fallback === 'string') {
    const normalized = fallback.trim().toLowerCase();
    if (DITHER_PATTERN_STYLE_SET.has(normalized as SequentialPatternStyle)) {
      return normalized as SequentialPatternStyle;
    }
  }
  return 'dots';
};

const sortedPluginEntries = (
  config?: SequentialBrushSnapshot['pluginConfig'] | null
): Array<[string, PrimitivePluginValue]> => {
  if (!config) {
    return [];
  }

  return Object.keys(config)
    .sort()
    .map((key) => [key, normalizePluginConfigValue(config[key])] as const)
    .filter((entry): entry is [string, PrimitivePluginValue] => typeof entry[1] !== 'undefined');
};

export const serializePluginConfigForKey = (
  config?: SequentialBrushSnapshot['pluginConfig'] | null
): string => {
  const entries = sortedPluginEntries(config);
  if (entries.length === 0) {
    return '';
  }
  return entries
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(';');
};

export const clonePluginConfig = (
  config?: SequentialBrushSnapshot['pluginConfig'] | null
): SequentialBrushSnapshot['pluginConfig'] | null => {
  const entries = sortedPluginEntries(config);
  if (entries.length === 0) {
    return null;
  }
  return Object.fromEntries(entries) as SequentialBrushSnapshot['pluginConfig'];
};

export const normalizeSequentialDitherPluginConfig = ({
  config,
  brushDitherAlgorithm,
  brushDitherIntensity,
  brushPatternStyle,
  brushDitherBackgroundFill,
  fillResolution,
}: {
  config?: SequentialBrushSnapshot['pluginConfig'] | null;
  brushDitherAlgorithm?: SequentialBrushSnapshot['ditherAlgorithm'] | null;
  brushDitherIntensity?: number;
  brushPatternStyle?: string;
  brushDitherBackgroundFill?: boolean;
  fillResolution?: number;
}): NonNullable<SequentialBrushSnapshot['pluginConfig']> => {
  const nextConfig = clonePluginConfig(config) ?? {};
  const ditherAlgorithm = resolveDitherAlgorithm(nextConfig.ditherAlgorithm, brushDitherAlgorithm);
  const ditherIntensity = resolveDitherIntensity(nextConfig.ditherIntensity, brushDitherIntensity);
  const ditherBayerMatrixSize = resolveDitherMatrixSize(
    nextConfig.ditherBayerMatrixSize,
    fillResolution
  );
  const patternStyle = resolvePatternStyle(nextConfig.patternStyle, brushPatternStyle);
  const ditherBackgroundFill =
    typeof nextConfig.ditherBackgroundFill === 'boolean'
      ? nextConfig.ditherBackgroundFill
      : brushDitherBackgroundFill !== false;

  return {
    ...nextConfig,
    ditherAlgorithm,
    ditherIntensity,
    ditherBayerMatrixSize,
    ditherBackgroundFill,
    patternStyle,
  };
};

export const normalizeSequentialParticlePluginConfig = ({
  config,
}: {
  config?: SequentialBrushSnapshot['pluginConfig'] | null;
}): NonNullable<SequentialBrushSnapshot['pluginConfig']> => {
  const nextConfig = clonePluginConfig(config) ?? {};
  const particleDensity = Number.isFinite(nextConfig.particleDensity)
    ? Math.max(1, Math.min(200, nextConfig.particleDensity ?? 20))
    : 20;
  const particleScatterRadius = Number.isFinite(nextConfig.particleScatterRadius)
    ? Math.max(0.1, Math.min(5, nextConfig.particleScatterRadius ?? 1.5))
    : 1.5;

  return {
    ...nextConfig,
    particleDensity,
    particleScatterRadius,
  };
};

export const normalizeSequentialSpamPluginConfig = ({
  config,
}: {
  config?: SequentialBrushSnapshot['pluginConfig'] | null;
}): NonNullable<SequentialBrushSnapshot['pluginConfig']> => {
  const nextConfig = clonePluginConfig(config) ?? {};
  const spamFont =
    typeof nextConfig.spamFont === 'string' && nextConfig.spamFont.length > 0
      ? nextConfig.spamFont
      : null;
  const spamContentType =
    typeof nextConfig.spamContentType === 'string' && nextConfig.spamContentType.length > 0
      ? nextConfig.spamContentType
      : null;
  const spamCustomText =
    typeof nextConfig.spamCustomText === 'string' && nextConfig.spamCustomText.length > 0
      ? nextConfig.spamCustomText
      : null;

  return {
    ...nextConfig,
    spamFont,
    spamContentType,
    spamCustomText,
  };
};

export const normalizeSequentialPluginConfigForReplay = ({
  pluginBrushId,
  config,
  brushDitherAlgorithm,
  brushDitherIntensity,
  brushPatternStyle,
  brushDitherBackgroundFill,
  fillResolution,
}: {
  pluginBrushId?: string | null;
  config?: SequentialBrushSnapshot['pluginConfig'] | null;
  brushDitherAlgorithm?: SequentialBrushSnapshot['ditherAlgorithm'] | null;
  brushDitherIntensity?: number;
  brushPatternStyle?: string;
  brushDitherBackgroundFill?: boolean;
  fillResolution?: number;
}): SequentialBrushSnapshot['pluginConfig'] | null => {
  if (!pluginBrushId) {
    return clonePluginConfig(config);
  }
  switch (pluginBrushId) {
    case 'dither-brush':
      return normalizeSequentialDitherPluginConfig({
        config,
        brushDitherAlgorithm,
        brushDitherIntensity,
        brushPatternStyle,
        brushDitherBackgroundFill,
        fillResolution,
      });
    case 'particle-brush':
      return normalizeSequentialParticlePluginConfig({ config });
    case 'spam-brush':
      return normalizeSequentialSpamPluginConfig({ config });
    default:
      return clonePluginConfig(config);
  }
};

export const estimatePluginConfigPayloadBytes = (
  config?: SequentialBrushSnapshot['pluginConfig'] | null
): number => {
  const entries = sortedPluginEntries(config);
  return entries.reduce((sum, [key, value]) => {
    let valueBytes = 0;
    if (typeof value === 'string') {
      valueBytes = value.length * UTF16_CODE_UNIT_BYTES;
    } else if (typeof value === 'number') {
      valueBytes = 8;
    } else if (typeof value === 'boolean') {
      valueBytes = 1;
    }
    return sum + key.length * UTF16_CODE_UNIT_BYTES + valueBytes + 2;
  }, 0);
};
