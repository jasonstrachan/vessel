import { BrushShape, type BrushSettings } from '@/types';

import type { createShapeDrawer } from './shapes';
import type { createBrushUtilities } from './utilities';
import type { PixelQueue, RenderSettings } from './types';
import type { CustomBrushStrokeData } from './brushEngineFacadeTypes';

type ShapeDrawer = ReturnType<typeof createShapeDrawer>;
type BrushUtilities = ReturnType<typeof createBrushUtilities>;

interface FinalizeStrokeArgs {
  ctx: CanvasRenderingContext2D;
  brushSettings: BrushSettings;
  pixelQueue: PixelQueue;
  lastStrokePressure: number | null;
  lastCustomBrushData: CustomBrushStrokeData | null;
  utilities: BrushUtilities;
  shapeDrawer: ShapeDrawer;
}

export const finalizePixelStroke = ({
  ctx,
  brushSettings,
  pixelQueue,
  lastStrokePressure,
  lastCustomBrushData,
  utilities,
  shapeDrawer,
}: FinalizeStrokeArgs): void => {
  if (
    brushSettings.antialiasing ||
    !pixelQueue.initialized ||
    (
      pixelQueue.waitingPixelX === pixelQueue.lastDrawnX &&
      pixelQueue.waitingPixelY === pixelQueue.lastDrawnY
    )
  ) {
    return;
  }

  let baseSize = brushSettings.size;
  if (lastCustomBrushData && !lastCustomBrushData.isResampler) {
    const maxDimension = Math.max(lastCustomBrushData.width, lastCustomBrushData.height);
    baseSize = Math.max(1, brushSettings.size ?? maxDimension);
  } else if (lastCustomBrushData?.isResampler) {
    baseSize = brushSettings.size;
  }

  const pressure = lastStrokePressure ?? 1;
  const size = utilities.calculatePressureSize(baseSize, pressure);
  const opacity = utilities.calculatePressureOpacity(brushSettings.opacity, pressure);
  const settings: RenderSettings = {
    size,
    opacity,
    color: brushSettings.color,
    antiAliasing: false,
    pixelAlignment: true,
    spacing: brushSettings.spacing,
    rotation: 0,
    shape: brushSettings.brushShape || BrushShape.ROUND,
    risographIntensity: brushSettings.risographIntensity || 0,
    blendMode: ctx.globalCompositeOperation,
  };

  ctx.fillStyle = settings.color;
  ctx.globalAlpha = settings.opacity;

  shapeDrawer(
    ctx,
    pixelQueue.waitingPixelX,
    pixelQueue.waitingPixelY,
    settings.size,
    settings.shape,
    false,
    settings.rotation,
    settings.risographIntensity,
  );
};
