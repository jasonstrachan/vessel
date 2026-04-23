import type { Layer, LayerColorCycleData } from '@/types';

export type ColorCycleLayerHydrationState = 'cold' | 'warm' | 'active';

export const getColorCycleHydrationState = (
  colorCycleData: LayerColorCycleData | null | undefined,
): ColorCycleLayerHydrationState => {
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

export const isColdColorCycleLayer = (layer: Layer | undefined | null): boolean => (
  Boolean(layer && layer.layerType === 'color-cycle' && getColorCycleHydrationState(layer.colorCycleData) === 'cold')
);
