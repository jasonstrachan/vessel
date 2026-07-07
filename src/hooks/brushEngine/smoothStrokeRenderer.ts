import { BrushShape, type BrushSettings } from '@/types';
import { DEFAULT_COLOR_CYCLE_GRADIENT } from '@/utils/colorCycleGradients';

import type { CustomBrushCycleReplayService } from './customBrushCycleReplay';
import type { createShapeDrawer } from './shapes';
import type { createStrokeProcessor } from './strokeProcessor';
import type { PixelQueue, RenderSettings } from './types';
import type { CustomBrushStrokeData } from './brushEngineFacadeTypes';

type ShapeDrawer = ReturnType<typeof createShapeDrawer>;
type StrokeProcessor = ReturnType<typeof createStrokeProcessor>;

interface RenderSmoothStrokeArgs {
  ctx: CanvasRenderingContext2D;
  from: { x: number; y: number };
  to: { x: number; y: number };
  settings: RenderSettings;
  customBrushData?: CustomBrushStrokeData;
  brushSettings: BrushSettings;
  pixelQueue: PixelQueue;
  strokeProcessor: Pick<StrokeProcessor, 'shouldDrawStamp'>;
  customBrushCycleReplay: CustomBrushCycleReplayService;
  shapeDrawer: ShapeDrawer;
  canDrawAt: (ctx: CanvasRenderingContext2D, x: number, y: number) => boolean;
  shouldSkipNearDuplicateFinalStamp: (point: { x: number; y: number }, settings: RenderSettings) => boolean;
}

const resolveCustomCycleStamp = ({
  customBrushData,
  customBrushCycleReplay,
  brushSettings,
  settings,
  ctx,
}: Pick<RenderSmoothStrokeArgs, 'customBrushData' | 'customBrushCycleReplay' | 'brushSettings' | 'settings' | 'ctx'>): {
  stampPattern: ImageData | undefined;
  stampIsColorizable: boolean | undefined;
} => {
  const hasCapturedDataCustomBrush =
    settings.shape === BrushShape.CUSTOM &&
    customBrushData?.colorCycle?.schemaVersion === 2 &&
    customBrushData.colorCycle.mode === 'captured-data';
  const shouldReplayCustomColorCycle =
    settings.shape === BrushShape.CUSTOM &&
    (brushSettings.customBrushColorCycle === true || hasCapturedDataCustomBrush);

  let stampPattern = settings.pattern;
  let stampIsColorizable = settings.isColorizable;
  if (!shouldReplayCustomColorCycle) {
    ctx.fillStyle = settings.color;
    return { stampPattern, stampIsColorizable };
  }

  const phase = customBrushCycleReplay.getNextPhase();
  const capturedPattern = customBrushData
    ? customBrushCycleReplay.getCapturedDataPattern(customBrushData, phase)
    : null;
  if (capturedPattern) {
    stampPattern = capturedPattern;
    stampIsColorizable = false;
    ctx.fillStyle = settings.color;
  } else {
    ctx.fillStyle = customBrushCycleReplay.sampleGradientColor(
      brushSettings.colorCycleGradient?.length
        ? brushSettings.colorCycleGradient
        : DEFAULT_COLOR_CYCLE_GRADIENT,
      phase,
    );
  }

  return { stampPattern, stampIsColorizable };
};

const drawSmoothStamp = (
  args: RenderSmoothStrokeArgs,
  point: { x: number; y: number },
) => {
  if (!args.canDrawAt(args.ctx, point.x, point.y)) {
    return;
  }

  const { stampPattern, stampIsColorizable } = resolveCustomCycleStamp(args);
  args.shapeDrawer(
    args.ctx,
    point.x,
    point.y,
    args.settings.size,
    args.settings.shape,
    args.settings.antiAliasing,
    args.settings.rotation,
    args.settings.risographIntensity,
    stampPattern,
    stampIsColorizable,
    args.settings.customPatternDimensions,
  );
};

export const renderSmoothStroke = (args: RenderSmoothStrokeArgs): void => {
  const { from, to, settings, pixelQueue, strokeProcessor, brushSettings } = args;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  const spacingThreshold = Math.max(1, settings.spacing || 1);
  const steps = Math.max(1, Math.ceil(distance));

  if (!pixelQueue.initialized) {
    pixelQueue.initialized = true;
    pixelQueue.lastStrokePosition = { x: from.x, y: from.y };
    pixelQueue.accumulatedDistance = 0;
  }

  for (let i = 0; i < steps; i += 1) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;

    const lastPos = pixelQueue.lastStrokePosition;
    const dxSeg = x - lastPos.x;
    const dySeg = y - lastPos.y;
    const segDistance = Math.sqrt(dxSeg * dxSeg + dySeg * dySeg);
    pixelQueue.accumulatedDistance += segDistance;
    pixelQueue.lastStrokePosition = { x, y };

    if (!strokeProcessor.shouldDrawStamp(
      brushSettings,
      pixelQueue,
      settings.size,
      false,
      settings.speedSamplePx,
      segDistance,
    )) {
      continue;
    }

    if (pixelQueue.accumulatedDistance < spacingThreshold) {
      continue;
    }

    pixelQueue.accumulatedDistance -= spacingThreshold;
    drawSmoothStamp(args, { x, y });
  }

  if (distance <= 0 || !strokeProcessor.shouldDrawStamp(
    brushSettings,
    pixelQueue,
    settings.size,
    false,
    settings.speedSamplePx,
    distance,
  )) {
    return;
  }

  const lastPos = pixelQueue.lastStrokePosition;
  const dxSeg = to.x - lastPos.x;
  const dySeg = to.y - lastPos.y;
  const segDistance = Math.sqrt(dxSeg * dxSeg + dySeg * dySeg);
  pixelQueue.accumulatedDistance += segDistance;
  pixelQueue.lastStrokePosition = { x: to.x, y: to.y };

  if (pixelQueue.accumulatedDistance < spacingThreshold) {
    return;
  }

  pixelQueue.accumulatedDistance -= spacingThreshold;
  if (!args.shouldSkipNearDuplicateFinalStamp(to, settings)) {
    drawSmoothStamp(args, to);
  }
};
