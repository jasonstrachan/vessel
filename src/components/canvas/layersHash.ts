import type { Layer } from '@/types';

export const buildLayersHash = (layers: Layer[]): string => {
  return layers
    .map((layer) => `${layer.id}_${layer.visible}_${layer.opacity}_${layer.imageData?.data?.length || 0}`)
    .join('|');
};
