import { BrushShape, type BrushSettings } from '@/types';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';

export const computeStrokeCapturePadding = (
  settings?: BrushSettings | null,
  customBrush?: CustomBrushStrokeData | null
): number => {
  if (!settings) {
    return 0;
  }

  const sliderSize = typeof settings.size === 'number' && Number.isFinite(settings.size)
    ? settings.size
    : 1;

  let effectiveSize = sliderSize;

  if (customBrush && !customBrush.isResampler) {
    const maxDimension = Math.max(customBrush.width ?? 0, customBrush.height ?? 0);
    if (Number.isFinite(maxDimension) && maxDimension > 0) {
      const scale = sliderSize / 100;
      effectiveSize = Math.max(1, maxDimension * (Number.isFinite(scale) ? scale : 1));
    }
  } else if (customBrush?.isResampler) {
    effectiveSize = Math.max(1, sliderSize);
  }

  if (settings.pressureEnabled) {
    const maxPressure = typeof settings.maxPressure === 'number' && Number.isFinite(settings.maxPressure)
      ? settings.maxPressure
      : undefined;
    if (typeof maxPressure === 'number') {
      effectiveSize = Math.max(effectiveSize, maxPressure);
    }
  }

  const radius = Math.max(1, effectiveSize) / 2;
  const antialiasPadding = settings.antialiasing ? 2 : 0;
  const softEdgePadding = settings.brushShape && (
    settings.brushShape === BrushShape.ROUND ||
    settings.brushShape === BrushShape.RISOGRAPH_SOFT ||
    settings.brushShape === BrushShape.RISOGRAPH_ULTRA
  ) ? 2 : 0;

  return radius + Math.max(antialiasPadding, softEdgePadding);
};
