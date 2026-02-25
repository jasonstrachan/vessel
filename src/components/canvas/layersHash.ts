import type { Layer } from '@/types';

export const buildLayersHash = (layers: Layer[]): string => {
  return layers
    .map((layer) => {
      const colorCycleMaskVersion = layer.colorCycleData?.eraseMaskVersion ?? 0;
      const colorCycleAnimating = layer.colorCycleData?.isAnimating ? 1 : 0;
      const imageLength = layer.imageData?.data?.length || 0;
      const version = layer.version ?? 0;
      return [
        layer.id,
        layer.order,
        layer.layerType,
        layer.visible ? 1 : 0,
        layer.opacity,
        layer.blendMode,
        imageLength,
        version,
        colorCycleMaskVersion,
        colorCycleAnimating,
      ].join('_');
    })
    .join('|');
};
