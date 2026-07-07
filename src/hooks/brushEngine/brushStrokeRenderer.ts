import { BrushShape } from '@/types';
import { isStrokeBrush } from '@/utils/brushCategories';

import { type DirectionState, type RotationInput, calculateRotation } from './rotation';
import type { GridSnapSession } from './gridSnapSession';
import { renderGridSnappedStroke } from './gridSnappedStrokeRenderer';
import type { MosaicStrokeRenderer } from './mosaicStrokeRenderer';
import type { createShapeDrawer } from './shapes';
import type { createStrokeProcessor } from './strokeProcessor';
import type { createBrushUtilities } from './utilities';
import type { PixelQueue, RenderSettings } from './types';
import {
  resolveCustomPatternDimensions,
  type BrushEngineConfig,
  type BrushStrokeParams,
  type CustomBrushStrokeData,
} from './brushEngineFacadeTypes';

type ShapeDrawer = ReturnType<typeof createShapeDrawer>;
type StrokeProcessor = ReturnType<typeof createStrokeProcessor>;
type BrushUtilities = ReturnType<typeof createBrushUtilities>;

export interface BrushStrokeRenderContext {
  config: BrushEngineConfig;
  utilities: BrushUtilities;
  strokeProcessor: StrokeProcessor;
  pixelQueue: PixelQueue;
  directionState: DirectionState;
  gridSnapSession: GridSnapSession;
  mosaicRenderer: MosaicStrokeRenderer;
  shapeDrawer: ShapeDrawer;
  setLastStrokeInfo: (pressure: number, customBrushData?: CustomBrushStrokeData) => void;
  initializeCustomStrokeCycleStateIfNeeded: (params: BrushStrokeParams, shape: BrushShape) => void;
  beginStampTracking: (pressure: number, alpha: number) => void;
  endStampTracking: () => void;
  renderPixelPerfectStroke: (
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    settings: RenderSettings
  ) => void;
  renderSmoothStroke: (
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    settings: RenderSettings,
    customBrushData?: CustomBrushStrokeData
  ) => void;
  canDrawAt: (ctx: CanvasRenderingContext2D, x: number, y: number) => boolean;
  shouldSkipNearDuplicateFinalStamp: (point: { x: number; y: number }, settings: RenderSettings) => boolean;
  getNextCustomCyclePhase: () => number;
  getCapturedDataPattern: (customBrushData: CustomBrushStrokeData, phase: number) => ImageData | null;
  sampleGradientColor: (
    stops: Array<{ position: number; color: string; opacity?: number }>,
    position: number
  ) => string;
}

const resolveCustomBrushSnapSpacing = (
  brushShape: BrushShape | undefined,
  customBrushData: CustomBrushStrokeData | undefined,
  customBrushSnapEnabled: boolean | undefined,
  size: number,
): { x: number; y: number } | null => {
  if (!customBrushData || !customBrushSnapEnabled || brushShape !== BrushShape.CUSTOM) {
    return null;
  }

  const width = Number(customBrushData.width);
  const height = Number(customBrushData.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const maxDimension = Math.max(width, height);
  if (maxDimension <= 0) {
    return null;
  }

  return {
    x: Math.max(1, Math.round((width * size) / maxDimension)),
    y: Math.max(1, Math.round((height * size) / maxDimension)),
  };
};

const resolveStrokeRotation = (
  brushSettings: BrushEngineConfig['brushSettings'],
  shape: BrushShape,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pressure: number,
  velocity: number,
  directionState: DirectionState,
): number => {
  if (!isStrokeBrush(shape)) {
    return 0;
  }

  const rotationConfig = brushSettings.rotationConfig
    ? {
      ...brushSettings.rotationConfig,
      enabled: brushSettings.rotationConfig.enabled || brushSettings.rotationEnabled || false,
    }
    : {
      enabled: brushSettings.rotationEnabled || false,
      mode: 'direction' as const,
      smoothing: 0.5,
      offset: 0,
      jitter: 0,
    };

  if (!rotationConfig.enabled) {
    return 0;
  }

  const rotationInput: RotationInput = {
    from,
    to,
    pressure,
    velocity,
  };

  const rotation = calculateRotation(rotationConfig, rotationInput, directionState);
  return !brushSettings.rotationConfig && brushSettings.rotationEnabled
    ? rotation * 0.5
    : rotation;
};

export const renderBrushStrokeWithServices = (
  ctx: CanvasRenderingContext2D,
  params: BrushStrokeParams,
  renderContext: BrushStrokeRenderContext,
): void => {
  const { from, to, pressure, velocity, customBrushData } = params;
  const { config, utilities, strokeProcessor, pixelQueue } = renderContext;
  const { brushSettings } = config;

  let baseSize = brushSettings.size;
  if (customBrushData && !customBrushData.isResampler) {
    const maxDimension = Math.max(customBrushData.width, customBrushData.height);
    baseSize = Math.max(1, brushSettings.size ?? maxDimension);
  } else if (customBrushData?.isResampler) {
    baseSize = brushSettings.size;
  }
  const size = utilities.calculatePressureSize(baseSize, pressure);
  const opacity = utilities.calculatePressureOpacity(brushSettings.opacity, pressure);

  renderContext.setLastStrokeInfo(pressure, customBrushData);

  const smoothedVelocity = strokeProcessor.calculateSmoothedVelocity(velocity);
  const spacing = utilities.calculateBrushSpacing(size, smoothedVelocity, customBrushData);

  const customBrushSnapSpacing = resolveCustomBrushSnapSpacing(
    brushSettings.brushShape,
    customBrushData,
    brushSettings.customBrushSnapEnabled,
    size,
  );
  const isGridSnapping = utilities.shouldApplyGridSnap() || Boolean(customBrushSnapSpacing);
  const drawFrom = from;
  const drawTo = to;

  const configuredShape = customBrushData ? BrushShape.CUSTOM : (brushSettings.brushShape || BrushShape.ROUND);
  const ditherTipShape = brushSettings.ditherStrokeTipShape ?? 'round';
  const shape =
    configuredShape === BrushShape.PIXEL_DITHER && ditherTipShape !== 'round'
      ? BrushShape.PIXEL_DITHER
      : configuredShape === BrushShape.PIXEL_DITHER
        ? BrushShape.PIXEL_ROUND
        : configuredShape;
  const isPixelBrush = shape === BrushShape.PIXEL_ROUND || shape === BrushShape.PIXEL_DITHER;
  const isPixelSquare = shape === BrushShape.SQUARE && !brushSettings.antialiasing;
  const rotation = resolveStrokeRotation(
    brushSettings,
    shape,
    drawFrom,
    drawTo,
    pressure,
    smoothedVelocity,
    renderContext.directionState,
  );

  const settings: RenderSettings = {
    size,
    opacity,
    color: brushSettings.color || '#000000',
    antiAliasing: brushSettings.antialiasing,
    pixelAlignment: !brushSettings.antialiasing,
    spacing,
    speedSamplePx: Math.max(0, smoothedVelocity),
    rotation,
    shape,
    risographIntensity: brushSettings.risographIntensity || 0,
    blendMode: ctx.globalCompositeOperation,
    pattern: customBrushData?.imageData,
    isColorizable: customBrushData?.isColorizable,
    customPatternDimensions: resolveCustomPatternDimensions(customBrushData),
  };

  renderContext.initializeCustomStrokeCycleStateIfNeeded(params, shape);
  const hasCapturedDataCustomBrush =
    settings.shape === BrushShape.CUSTOM &&
    customBrushData?.colorCycle?.schemaVersion === 2 &&
    customBrushData.colorCycle.mode === 'captured-data';

  ctx.fillStyle = settings.color;
  ctx.globalAlpha = settings.opacity;
  renderContext.beginStampTracking(pressure, settings.opacity);
  try {
    if (settings.shape === BrushShape.MOSAIC) {
      renderContext.mosaicRenderer.renderStroke(ctx, drawFrom, drawTo, pressure, rotation);
      return;
    }

    if (isGridSnapping) {
      const snapMode = customBrushSnapSpacing ? 'custom' : 'grid';
      const snapSpacing = renderContext.gridSnapSession.resolve(snapMode, customBrushSnapSpacing ?? {
        x: utilities.calculateGridSpacing(pressure),
        y: utilities.calculateGridSpacing(pressure),
      }, pixelQueue);
      renderGridSnappedStroke({
        ctx,
        from: drawFrom,
        to: drawTo,
        snapSpacing,
        settings,
        customBrushData,
        brushSettings,
        pixelQueue,
        isPixelBrush,
        isPixelSquare,
        getNextCustomCyclePhase: renderContext.getNextCustomCyclePhase,
        getCapturedDataPattern: renderContext.getCapturedDataPattern,
        sampleGradientColor: renderContext.sampleGradientColor,
        shapeDrawer: renderContext.shapeDrawer,
        canDrawAt: renderContext.canDrawAt,
      });
      return;
    }

    const forceSmoothForCapturedCustom = hasCapturedDataCustomBrush;
    if (!forceSmoothForCapturedCustom && (isPixelBrush || isPixelSquare || !brushSettings.antialiasing)) {
      ctx.imageSmoothingEnabled = false;
      renderContext.renderPixelPerfectStroke(ctx, drawFrom, drawTo, settings);
      return;
    }

    ctx.imageSmoothingEnabled = true;
    renderContext.renderSmoothStroke(ctx, drawFrom, drawTo, settings, customBrushData);
  } finally {
    renderContext.endStampTracking();
  }
};
