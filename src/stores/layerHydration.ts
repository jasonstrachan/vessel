import type { Layer, LayerColorCycleData } from '@/types';
import type { ColorCycleLayerDocument } from '@/lib/colorCycle/document';

export type ColorCycleLayerHydrationState = 'cold' | 'warm' | 'active';

export const getColorCycleHydrationState = (
  colorCycleData: LayerColorCycleData | null | undefined,
  document?: Pick<ColorCycleLayerDocument, 'residency'> | null,
): ColorCycleLayerHydrationState => {
  if (
    document?.residency === 'cold-archive-ref' ||
    document?.residency === 'static-preview-only'
  ) {
    return 'cold';
  }
  if (!colorCycleData) {
    return 'warm';
  }
  if (colorCycleData.runtimeHydrationState) {
    return colorCycleData.runtimeHydrationState;
  }
  return colorCycleData.deferredRuntimeRestore ? 'cold' : 'warm';
};

export const setColorCycleHydrationState = (
  colorCycleData: LayerColorCycleData,
  nextState: ColorCycleLayerHydrationState,
): LayerColorCycleData => ({
  ...colorCycleData,
  runtimeHydrationState: nextState,
  deferredRuntimeRestore: nextState === 'cold',
});

export const updateLayerColorCycleHydrationState = (
  layer: Layer,
  nextState: ColorCycleLayerHydrationState,
): Layer => {
  if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return layer;
  }
  return {
    ...layer,
    colorCycleData: setColorCycleHydrationState(layer.colorCycleData, nextState),
  };
};

export const isColdColorCycleLayer = (
  layer: Layer | undefined | null,
  document?: Pick<ColorCycleLayerDocument, 'residency'> | null,
): boolean => (
  Boolean(
    layer &&
    layer.layerType === 'color-cycle' &&
    getColorCycleHydrationState(layer.colorCycleData, document) === 'cold'
  )
);

export const updateWarmingColorCycleLayerIds = (
  warmingLayerIds: string[],
  layerId: string,
  isWarming: boolean,
): string[] => {
  const alreadyWarming = warmingLayerIds.includes(layerId);
  if (alreadyWarming === isWarming) {
    return warmingLayerIds;
  }
  return isWarming
    ? [...warmingLayerIds, layerId]
    : warmingLayerIds.filter((candidate) => candidate !== layerId);
};
