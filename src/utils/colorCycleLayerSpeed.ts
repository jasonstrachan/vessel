import type { Layer } from '@/types';

type ColorCycleLike = {
  layerBaseSpeedCps?: number;
  controllerSpeedCps?: number;
  brushSpeed?: number;
} | null | undefined;

export const resolveLayerColorCycleBaseSpeed = (data: ColorCycleLike): number | undefined => {
  if (typeof data?.layerBaseSpeedCps === 'number' && Number.isFinite(data.layerBaseSpeedCps)) {
    return data.layerBaseSpeedCps;
  }
  if (typeof data?.controllerSpeedCps === 'number' && Number.isFinite(data.controllerSpeedCps)) {
    return data.controllerSpeedCps;
  }
  if (typeof data?.brushSpeed === 'number' && Number.isFinite(data.brushSpeed)) {
    return data.brushSpeed;
  }
  return undefined;
};

export const resolveLayerColorCycleBaseSpeedFromLayer = (layer: Layer | null | undefined): number | undefined => {
  return resolveLayerColorCycleBaseSpeed(layer?.colorCycleData);
};
