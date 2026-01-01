import type { Layer } from '@/types';

export const isColorCycleLayerWithData = (
  layer: Layer | undefined | null
): layer is Layer & { colorCycleData: NonNullable<Layer['colorCycleData']> } =>
  Boolean(layer && layer.layerType === 'color-cycle' && layer.colorCycleData);
