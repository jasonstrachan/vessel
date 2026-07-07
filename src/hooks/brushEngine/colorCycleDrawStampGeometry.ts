import { BrushShape, type BrushSettings } from '@/types';
import { applyPressureCurve } from '@/utils/pressureCurve';

import type { CustomBrushStrokeData } from './BrushEngineFacade';
import type { PaintedColorCycleStamp } from './colorCycleStrokeMaskHeal';

type ColorCycleDrawStampSettings = Pick<
  BrushSettings,
  | 'size'
  | 'brushShape'
  | 'colorCycleStampShape'
  | 'customBrushSnapEnabled'
>;

export const resolveColorCycleStampTargetSize = ({
  pressure,
  pressureActive,
  brushSize,
  minPercent,
  maxPercent,
}: {
  pressure: number;
  pressureActive: boolean;
  brushSize: number;
  minPercent: number;
  maxPercent: number;
}): number => {
  if (!pressureActive) {
    return Math.max(1, brushSize);
  }
  const safePressure = Number.isFinite(pressure)
    ? Math.max(0, Math.min(1, pressure))
    : 1;
  return Math.max(
    1,
    brushSize * applyPressureCurve(safePressure, minPercent, maxPercent, 'linear'),
  );
};

export const resolveColorCycleCustomSnapSpacing = ({
  brushSettings,
  brushSize,
  customStamp,
}: {
  brushSettings: Pick<ColorCycleDrawStampSettings, 'customBrushSnapEnabled'>;
  brushSize: number;
  customStamp?: CustomBrushStrokeData;
}): { x: number; y: number } | null => {
  if (!brushSettings.customBrushSnapEnabled || !customStamp) {
    return null;
  }

  const width = Number(customStamp.width);
  const height = Number(customStamp.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const maxDimension = Math.max(width, height);
  if (maxDimension <= 0) {
    return null;
  }

  return {
    x: Math.max(1, Math.round((width * brushSize) / maxDimension)),
    y: Math.max(1, Math.round((height * brushSize) / maxDimension)),
  };
};

export const getColorCycleCustomStampMetrics = ({
  customStamp,
  pressure,
  rotation,
  pressureActive,
  brushSize,
  minPercent,
  maxPercent,
}: {
  customStamp: CustomBrushStrokeData;
  pressure: number;
  rotation: number;
  pressureActive: boolean;
  brushSize: number;
  minPercent: number;
  maxPercent: number;
}): { width: number; height: number } => {
  const baseWidth = Math.max(1, customStamp.width);
  const baseHeight = Math.max(1, customStamp.height);
  const maxDimension = Math.max(baseWidth, baseHeight);
  const targetSize = resolveColorCycleStampTargetSize({
    pressure,
    pressureActive,
    brushSize,
    minPercent,
    maxPercent,
  });
  const scale = maxDimension > 0 ? targetSize / maxDimension : 1;
  const scaledWidth = Math.max(1, Math.round(baseWidth * scale));
  const scaledHeight = Math.max(1, Math.round(baseHeight * scale));
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    width: Math.max(1, Math.ceil(Math.abs(scaledWidth * cos) + Math.abs(scaledHeight * sin))),
    height: Math.max(1, Math.ceil(Math.abs(scaledWidth * sin) + Math.abs(scaledHeight * cos))),
  };
};

export const getColorCyclePaintedStampMetrics = ({
  brushSettings,
  brushSize,
  customStamp,
  pressure,
  rotation,
  pressureActive,
  minPercent,
  maxPercent,
}: {
  brushSettings: ColorCycleDrawStampSettings;
  brushSize: number;
  customStamp?: CustomBrushStrokeData;
  pressure: number;
  rotation: number;
  pressureActive: boolean;
  minPercent: number;
  maxPercent: number;
}): {
  width: number;
  height: number;
  shape: PaintedColorCycleStamp['shape'];
} => {
  if (customStamp) {
    const metrics = getColorCycleCustomStampMetrics({
      customStamp,
      pressure,
      rotation,
      pressureActive,
      brushSize,
      minPercent,
      maxPercent,
    });
    return {
      ...metrics,
      shape: brushSettings.colorCycleStampShape ?? 'square',
    };
  }
  const shape = brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE
    ? BrushShape.COLOR_CYCLE_TRIANGLE
    : (brushSettings.colorCycleStampShape ?? 'square');
  return {
    width: Math.max(1, Math.ceil(brushSize) + 4),
    height: Math.max(1, Math.ceil(brushSize) + 4),
    shape,
  };
};
