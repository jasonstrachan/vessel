import { BrushShape, type BrushSettings } from '@/types';

import type { createShapeDrawer } from './shapes';
import type { createBrushUtilities } from './utilities';
import type { PixelQueue, RenderSettings } from './types';
import { resolveCustomPatternDimensions, type CustomBrushStrokeData } from './brushEngineFacadeTypes';

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

export const resolveDeferredPixelStamp = ({
  composite,
  brushSettings,
  pixelQueue,
  lastStrokePressure,
  lastCustomBrushData,
  utilities,
}: Omit<FinalizeStrokeArgs, 'ctx' | 'shapeDrawer'> & {
  composite: GlobalCompositeOperation;
}): { x: number; y: number; settings: RenderSettings } | null => {
  if (
    brushSettings.antialiasing ||
    !pixelQueue.initialized ||
    (
      pixelQueue.waitingPixelX === pixelQueue.lastDrawnX &&
      pixelQueue.waitingPixelY === pixelQueue.lastDrawnY
    )
  ) {
    return null;
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
    blendMode: composite,
    pattern: lastCustomBrushData?.imageData,
    isColorizable: lastCustomBrushData?.isColorizable,
    customPatternDimensions: resolveCustomPatternDimensions(lastCustomBrushData ?? undefined),
  };

  return { x: pixelQueue.waitingPixelX, y: pixelQueue.waitingPixelY, settings };
};

export const finalizePixelStroke = ({ ctx, shapeDrawer, ...args }: FinalizeStrokeArgs): void => {
  const stamp = resolveDeferredPixelStamp({ ...args, composite: ctx.globalCompositeOperation });
  if (!stamp) {
    return;
  }
  const { x, y, settings } = stamp;
  ctx.fillStyle = settings.color;
  ctx.globalAlpha = settings.opacity;

  shapeDrawer(
    ctx,
    x,
    y,
    settings.size,
    settings.shape,
    false,
    settings.rotation,
    settings.risographIntensity,
    settings.pattern,
    settings.isColorizable,
    settings.customPatternDimensions,
  );
};
