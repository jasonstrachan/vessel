import { BrushShape, type BrushSettings } from '@/types';

import type { PixelQueue, RenderSettings } from './types';

type StrokeDrawShape = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  shape: BrushShape,
  antiAliasing: boolean,
  rotation: number,
  risographIntensity: number,
  pattern?: ImageData,
  centerAlignment?: boolean,
  customPatternDimensions?: { width: number; height: number },
) => void;

type PixelPerfectContext = {
  shouldDrawStamp: (
    brushSettings: BrushSettings,
    queue: PixelQueue,
    size?: number,
    isGridSnapping?: boolean,
    speedSamplePxPerMs?: number,
    phaseAdvancePx?: number,
  ) => boolean;
  applyThrottledColorJitter: (color: string, jitterAmount: number) => string;
  drawShape: StrokeDrawShape;
  applyPigmentLift: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    settings: RenderSettings,
    brushSettings: BrushSettings,
  ) => void;
};

export const perfectPixels = (
  ctx: CanvasRenderingContext2D,
  currentX: number,
  currentY: number,
  settings: RenderSettings,
  queue: PixelQueue,
  brushSettings: BrushSettings,
  context: PixelPerfectContext,
): void => {
  const roundedX = Math.round(currentX);
  const roundedY = Math.round(currentY);
  const usePixelSpacing = settings.pixelAlignment ||
    settings.shape === BrushShape.PIXEL_ROUND ||
    settings.shape === BrushShape.PIXEL_DITHER;
  const spacingThreshold = usePixelSpacing
    ? Math.max(1, Math.round(settings.spacing || 1))
    : Math.max(settings.spacing, 0.0001);

  const liftSpacing = Math.max(1, Math.min(settings.size, settings.size * 0.35));
  const lastLift = queue.lastLiftPosition;
  const distSinceLift = lastLift
    ? Math.max(Math.abs(roundedX - lastLift.x), Math.abs(roundedY - lastLift.y))
    : Infinity;
  if (distSinceLift >= liftSpacing) {
    context.applyPigmentLift(ctx, roundedX, roundedY, settings, brushSettings);
    queue.lastLiftPosition = { x: roundedX, y: roundedY };
  }

  if (!queue.initialized) {
    queue.lastDrawnX = roundedX;
    queue.lastDrawnY = roundedY;
    queue.waitingPixelX = roundedX;
    queue.waitingPixelY = roundedY;
    queue.initialized = true;
    queue.spacingCounter = 0;
    queue.lastStrokePosition = { x: roundedX, y: roundedY };
    queue.accumulatedDistance = 0;

    if (context.shouldDrawStamp(brushSettings, queue, settings.size, false, settings.speedSamplePx, 0)) {
      drawPixelStamp(ctx, roundedX, roundedY, settings, brushSettings, context);
    }
    return;
  }

  const distance = usePixelSpacing
    ? Math.max(
      Math.abs(roundedX - queue.lastStrokePosition.x),
      Math.abs(roundedY - queue.lastStrokePosition.y),
    )
    : Math.sqrt(
      Math.pow(roundedX - queue.lastStrokePosition.x, 2) +
      Math.pow(roundedY - queue.lastStrokePosition.y, 2),
    );
  queue.accumulatedDistance += distance;

  if (Math.abs(roundedX - queue.lastDrawnX) > 1 || Math.abs(roundedY - queue.lastDrawnY) > 1) {
    if (queue.accumulatedDistance >= spacingThreshold) {
      if (context.shouldDrawStamp(
        brushSettings,
        queue,
        settings.size,
        false,
        settings.speedSamplePx,
        distance,
      )) {
        drawPixelStamp(ctx, queue.waitingPixelX, queue.waitingPixelY, settings, brushSettings, context);
      }
      if (usePixelSpacing) {
        queue.accumulatedDistance = Math.max(0, queue.accumulatedDistance - spacingThreshold);
        queue.accumulatedDistance = Math.round(queue.accumulatedDistance);
      } else {
        queue.accumulatedDistance -= spacingThreshold;
      }
      queue.lastStrokePosition = { x: queue.waitingPixelX, y: queue.waitingPixelY };
    }

    queue.lastDrawnX = queue.waitingPixelX;
    queue.lastDrawnY = queue.waitingPixelY;
    queue.waitingPixelX = roundedX;
    queue.waitingPixelY = roundedY;
  } else {
    queue.waitingPixelX = roundedX;
    queue.waitingPixelY = roundedY;
  }

  queue.lastStrokePosition = { x: roundedX, y: roundedY };
};

export const drawPixelPerfectLine = (
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  settings: RenderSettings,
  queue: PixelQueue,
  brushSettings: BrushSettings,
  context: PixelPerfectContext,
): void => {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  let x = x0;
  let y = y0;

  while (true) {
    perfectPixels(ctx, x, y, settings, queue, brushSettings, context);
    if (x === x1 && y === y1) {
      break;
    }

    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
};

const drawPixelStamp = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  settings: RenderSettings,
  brushSettings: BrushSettings,
  context: PixelPerfectContext,
): void => {
  context.applyPigmentLift(ctx, x, y, settings, brushSettings);
  const jitteredColor = context.applyThrottledColorJitter(settings.color, brushSettings.colorJitter || 0);
  ctx.fillStyle = jitteredColor;
  context.drawShape(
    ctx,
    x,
    y,
    settings.size,
    settings.shape,
    false,
    settings.rotation,
    settings.risographIntensity,
    settings.pattern,
    settings.centerAlignment,
    settings.customPatternDimensions,
  );
};
