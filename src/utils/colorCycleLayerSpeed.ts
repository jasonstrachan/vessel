import type { Layer } from '@/types';
import {
  DEFAULT_BRUSH_COLOR_CYCLE_SPEED,
  DEFAULT_CC_LAYER_SPEED_MULTIPLIER,
  MAX_CC_LAYER_SPEED_MULTIPLIER,
  MAX_CC_LAYER_SPEED_SCALE,
  MIN_CC_LAYER_SPEED_MULTIPLIER,
} from '@/constants/colorCycle';
import { sanitizeBrushColorCycleSpeed } from '@/utils/colorCycleSpeed';

type ColorCycleLike = {
  layerBaseSpeedCps?: number;
  controllerSpeedCps?: number;
  brushSpeed?: number;
} | null | undefined;

export const sanitizeColorCycleLayerSpeedMultiplier = (
  multiplier?: number | null,
  fallback: number = DEFAULT_CC_LAYER_SPEED_MULTIPLIER,
): number => {
  const resolvedFallback = Number.isFinite(fallback)
    ? Math.max(
        MIN_CC_LAYER_SPEED_MULTIPLIER,
        Math.min(MAX_CC_LAYER_SPEED_MULTIPLIER, fallback),
      )
    : DEFAULT_CC_LAYER_SPEED_MULTIPLIER;
  if (!Number.isFinite(multiplier)) {
    return resolvedFallback;
  }
  return Math.max(
    MIN_CC_LAYER_SPEED_MULTIPLIER,
    Math.min(MAX_CC_LAYER_SPEED_MULTIPLIER, multiplier as number),
  );
};

export const sanitizeColorCycleGlobalPlaybackSpeedScale = (
  scale?: number | null,
  fallback: number = 1,
): number => {
  const resolvedFallback = Number.isFinite(fallback)
    ? Math.max(0, Math.min(MAX_CC_LAYER_SPEED_SCALE, fallback))
    : 1;
  if (!Number.isFinite(scale)) {
    return resolvedFallback;
  }
  return Math.max(0, Math.min(MAX_CC_LAYER_SPEED_SCALE, scale as number));
};

export const composeColorCyclePlaybackSpeedScale = (
  layerMultiplier?: number | null,
  globalPlaybackScale?: number | null,
): number => {
  const resolvedGlobalScale = sanitizeColorCycleGlobalPlaybackSpeedScale(globalPlaybackScale);
  return sanitizeColorCycleLayerSpeedMultiplier(layerMultiplier) * resolvedGlobalScale;
};

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

/** Resolves uncapped effective playback speed for scalar-based export fallbacks. */
export const resolveLayerColorCycleFallbackPlaybackSpeedCps = (
  data: ColorCycleLike,
  fallbackWriteSpeedCps: number = DEFAULT_BRUSH_COLOR_CYCLE_SPEED,
): number => {
  const layerMultiplier = data?.layerBaseSpeedCps;
  if (typeof layerMultiplier === 'number' && Number.isFinite(layerMultiplier)) {
    if (layerMultiplier <= 0 || fallbackWriteSpeedCps <= 0) {
      return 0;
    }
    return sanitizeBrushColorCycleSpeed(fallbackWriteSpeedCps)
      * sanitizeColorCycleLayerSpeedMultiplier(layerMultiplier);
  }
  return resolveLayerColorCycleFallbackSpeedCps(data, fallbackWriteSpeedCps);
};
