import { BrushShape, type BrushSettings } from '@/types';
import { DEFAULT_COLOR_CYCLE_GRADIENT } from '@/utils/colorCycleGradients';
import { getCustomBrushColorCycleDefaultMode } from '@/utils/customBrushColorCycle';

import { rasterizeGridPath, snapPointToGrid, type GridSpacing } from './gridStroke';
import type { createShapeDrawer } from './shapes';
import type { PixelQueue, RenderSettings } from './types';
import type { CustomBrushStrokeData } from './brushEngineFacadeTypes';

type ShapeDrawer = ReturnType<typeof createShapeDrawer>;

interface RenderGridSnappedStrokeArgs {
  ctx: CanvasRenderingContext2D;
  from: { x: number; y: number };
  to: { x: number; y: number };
  snapSpacing: GridSpacing;
  settings: RenderSettings;
  customBrushData?: CustomBrushStrokeData;
  brushSettings: BrushSettings;
  pixelQueue: PixelQueue;
  isPixelBrush: boolean;
  isPixelSquare: boolean;
  getNextCustomCyclePhase: () => number;
  getCapturedDataPattern: (customBrushData: CustomBrushStrokeData, phase: number) => ImageData | null;
  sampleGradientColor: (
    stops: Array<{ position: number; color: string; opacity?: number }>,
    position: number
  ) => string;
  shapeDrawer: ShapeDrawer;
  canDrawAt: (ctx: CanvasRenderingContext2D, x: number, y: number) => boolean;
}

const resolveGridStamp = ({
  ctx,
  settings,
  customBrushData,
  brushSettings,
  getNextCustomCyclePhase,
  getCapturedDataPattern,
  sampleGradientColor,
}: Pick<RenderGridSnappedStrokeArgs, 'ctx' | 'settings' | 'customBrushData' | 'brushSettings' | 'getNextCustomCyclePhase' | 'getCapturedDataPattern' | 'sampleGradientColor'>): {
  stampPattern: ImageData | undefined;
  stampIsColorizable: boolean | undefined;
} => {
  const hasCapturedDataCustomBrush =
    settings.shape === BrushShape.CUSTOM &&
    (customBrushData?.colorCycleMode ??
      getCustomBrushColorCycleDefaultMode(customBrushData?.colorCycle)) === 'captured-data';
  const shouldReplayCustomColorCycle =
    settings.shape === BrushShape.CUSTOM &&
    (brushSettings.customBrushColorCycle === true || hasCapturedDataCustomBrush);

  let stampPattern = settings.pattern;
  let stampIsColorizable = settings.isColorizable;
  if (!shouldReplayCustomColorCycle) {
    ctx.fillStyle = settings.color;
    return { stampPattern, stampIsColorizable };
  }

  const phase = getNextCustomCyclePhase();
  const capturedPattern = customBrushData
    ? getCapturedDataPattern(customBrushData, phase)
    : null;
  if (capturedPattern) {
    stampPattern = capturedPattern;
    stampIsColorizable = false;
    ctx.fillStyle = settings.color;
  } else {
    ctx.fillStyle = sampleGradientColor(
      brushSettings.colorCycleGradient?.length
        ? brushSettings.colorCycleGradient
        : DEFAULT_COLOR_CYCLE_GRADIENT,
      phase,
    );
  }

  return { stampPattern, stampIsColorizable };
};

export const renderGridSnappedStroke = (args: RenderGridSnappedStrokeArgs): void => {
  const {
    ctx,
    from,
    to,
    snapSpacing,
    settings,
    pixelQueue,
    isPixelBrush,
    isPixelSquare,
    brushSettings,
  } = args;
  const snappedFrom = snapPointToGrid(from, snapSpacing);
  const snappedTo = snapPointToGrid(to, snapSpacing);

  ctx.imageSmoothingEnabled = !(isPixelBrush || isPixelSquare || !brushSettings.antialiasing);

  if (!pixelQueue.initialized) {
    pixelQueue.initialized = true;
    pixelQueue.lastStrokePosition = { x: snappedFrom.x, y: snappedFrom.y };
    pixelQueue.accumulatedDistance = 0;
  }

  const stampedPositions = pixelQueue.stampedGridPositions || new Set<string>();

  const drawSnappedStamp = (x: number, y: number) => {
    const posKey = `${x},${y}`;
    if (stampedPositions.has(posKey)) {
      return;
    }

    if (args.canDrawAt(ctx, x, y)) {
      const { stampPattern, stampIsColorizable } = resolveGridStamp(args);
      args.shapeDrawer(
        ctx,
        x,
        y,
        settings.size,
        settings.shape,
        settings.antiAliasing,
        settings.rotation,
        settings.risographIntensity,
        stampPattern,
        stampIsColorizable,
        settings.customPatternDimensions,
      );
    }
    stampedPositions.add(posKey);
  };

  for (const point of rasterizeGridPath(snappedFrom, snappedTo, snapSpacing)) {
    drawSnappedStamp(point.x, point.y);
  }

  pixelQueue.stampedGridPositions = stampedPositions;
  pixelQueue.lastStrokePosition = { x: snappedTo.x, y: snappedTo.y };
  pixelQueue.lastDrawnX = snappedTo.x;
  pixelQueue.lastDrawnY = snappedTo.y;
};
