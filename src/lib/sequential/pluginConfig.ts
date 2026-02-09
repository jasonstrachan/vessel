import type { SequentialBrushSnapshot } from '@/types';

const UTF16_CODE_UNIT_BYTES = 2;

type PrimitivePluginValue = string | number | boolean | null;

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
