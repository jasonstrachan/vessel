import { BrushShape, type BrushSettings } from '@/types';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';

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
    const { maxPercent } = resolveBrushPressureRange(settings);
    effectiveSize = Math.max(effectiveSize, effectiveSize * (maxPercent / 100));
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
