import type { Layer, LayerColorCycleData } from '@/types';

export type ColorCycleLegacyLayerBufferKey =
  | 'gradientIdBuffer'
  | 'gradientDefIdBuffer'
  | 'phaseBuffer'
  | 'smoothPhaseBuffer'
  | 'smoothFlagsBuffer';

export type ColorCycleLegacyLayerBuffers = Partial<Record<ColorCycleLegacyLayerBufferKey, ArrayBuffer>>;

const LEGACY_LAYER_BUFFER_KEYS: readonly ColorCycleLegacyLayerBufferKey[] = [
  'gradientIdBuffer',
  'gradientDefIdBuffer',
  'phaseBuffer',
  'smoothPhaseBuffer',
  'smoothFlagsBuffer',
];

export const getColorCycleLegacyLayerBuffer = (
  colorCycleData: LayerColorCycleData | null | undefined,
  key: ColorCycleLegacyLayerBufferKey,
): ArrayBuffer | undefined => {
  const value = (colorCycleData as (ColorCycleLegacyLayerBuffers | undefined))?.[key];
  return value instanceof ArrayBuffer ? value : undefined;
};

export const getColorCycleLegacyLayerBufferByteLength = (
  colorCycleData: LayerColorCycleData | null | undefined,
  key: ColorCycleLegacyLayerBufferKey,
): number => getColorCycleLegacyLayerBuffer(colorCycleData, key)?.byteLength ?? 0;

export const getColorCycleLegacyLayerBuffers = (
  layer: Layer | null | undefined,
): ColorCycleLegacyLayerBuffers => {
  if (layer?.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return {};
  }
  const buffers: ColorCycleLegacyLayerBuffers = {};
  for (const key of LEGACY_LAYER_BUFFER_KEYS) {
    const buffer = getColorCycleLegacyLayerBuffer(layer.colorCycleData, key);
    if (buffer) {
      buffers[key] = buffer;
    }
  }
  return buffers;
};
