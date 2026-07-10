import type { Layer } from '@/types';
import { DEFAULT_BRUSH_COLOR_CYCLE_SPEED } from '@/constants/colorCycle';
import { sanitizeBrushColorCycleSpeed } from '@/utils/colorCycleSpeed';

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

export const resolveExplicitLayerColorCycleBaseSpeed = (data: ColorCycleLike): number | undefined => {
  if (typeof data?.layerBaseSpeedCps === 'number' && Number.isFinite(data.layerBaseSpeedCps)) {
    return data.layerBaseSpeedCps;
  }
  if (typeof data?.controllerSpeedCps === 'number' && Number.isFinite(data.controllerSpeedCps)) {
    return data.controllerSpeedCps;
  }
  return undefined;
};

export const resolveExplicitLayerColorCycleBaseSpeedFromLayer = (
  layer: Layer | null | undefined
): number | undefined => {
  return resolveExplicitLayerColorCycleBaseSpeed(layer?.colorCycleData);
};

/**
 * Resolves the actual per-pixel motion speed used when a legacy/cold layer has
 * no canonical speed buffer. `layerBaseSpeedCps` is a layer multiplier; the
 * deprecated controller/brush fields are already-resolved legacy speeds.
 */
export const resolveLayerColorCycleFallbackSpeedCps = (
  data: ColorCycleLike,
  fallbackWriteSpeedCps: number = DEFAULT_BRUSH_COLOR_CYCLE_SPEED,
): number => {
  const layerMultiplier = data?.layerBaseSpeedCps;
  if (typeof layerMultiplier === 'number' && Number.isFinite(layerMultiplier)) {
    if (layerMultiplier <= 0 || fallbackWriteSpeedCps <= 0) {
      return 0;
    }
    const writeSpeed = sanitizeBrushColorCycleSpeed(fallbackWriteSpeedCps);
    return sanitizeBrushColorCycleSpeed(writeSpeed * layerMultiplier, writeSpeed);
  }

  const controllerSpeed = data?.controllerSpeedCps;
  if (typeof controllerSpeed === 'number' && Number.isFinite(controllerSpeed)) {
    return controllerSpeed <= 0 ? 0 : sanitizeBrushColorCycleSpeed(controllerSpeed);
  }

  const brushSpeed = data?.brushSpeed;
  if (typeof brushSpeed === 'number' && Number.isFinite(brushSpeed)) {
    return brushSpeed <= 0 ? 0 : sanitizeBrushColorCycleSpeed(brushSpeed);
  }

  return fallbackWriteSpeedCps <= 0
    ? 0
    : sanitizeBrushColorCycleSpeed(fallbackWriteSpeedCps);
};
