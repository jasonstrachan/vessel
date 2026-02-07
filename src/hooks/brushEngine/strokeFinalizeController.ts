import { inflateRect, normalizeRectForCanvas, pick2D, pick2DRead, type Rect } from './engineShared';
import { commitFinalizeNonPressureDither, commitFinalizePressureLinkedDither } from './strokeFinalize';

import type { BrushSettings } from '@/types';

type StrokeSettingsForFinalize = Pick<
  BrushSettings,
  'lostEdge' | 'ditherBackgroundFill' | 'pressureLinkedFillResolution'
>;

type CanvasRef = { current: HTMLCanvasElement | OffscreenCanvas | null };
type RectRef = { current: Rect | null };

export const buildStrokeFinalizeContext = ({
  ctx,
  strokeBoundsRef,
  liveStrokeBoundsRef,
  liveStrokeRawRef,
  liveStrokeDitherRef,
}: {
  ctx: CanvasRenderingContext2D;
  strokeBoundsRef: RectRef;
  liveStrokeBoundsRef: RectRef;
  liveStrokeRawRef: CanvasRef;
  liveStrokeDitherRef: CanvasRef;
}): {
  strokeBounds: Rect | null;
  region: Rect | null;
  rawCanvas: HTMLCanvasElement | OffscreenCanvas | null;
  ditherCanvas: HTMLCanvasElement | OffscreenCanvas | null;
  rawCtx: CanvasRenderingContext2D | null;
  ditherCtx: CanvasRenderingContext2D | null;
} => {
  const strokeBounds = strokeBoundsRef.current ?? liveStrokeBoundsRef.current ?? null;
  const rawCanvas = liveStrokeRawRef.current;
  const ditherCanvas = liveStrokeDitherRef.current;
  const canvasWidth = ctx.canvas?.width ?? 0;
  const canvasHeight = ctx.canvas?.height ?? 0;
  const region = strokeBounds ? normalizeRectForCanvas(strokeBounds, canvasWidth, canvasHeight) : null;
  const rawCtx = rawCanvas ? (pick2DRead(rawCanvas) as CanvasRenderingContext2D | null) : null;
  const ditherCtx = ditherCanvas ? (pick2D(ditherCanvas) as CanvasRenderingContext2D | null) : null;

  return { strokeBounds, region, rawCanvas, ditherCanvas, rawCtx, ditherCtx };
};

export const finalizeStrokeEngineBuffers = ({
  ctx,
  strokeBounds,
  rawCtx,
  brushEngine,
  withAlphaLock,
}: {
  ctx: CanvasRenderingContext2D;
  strokeBounds: Rect | null;
  rawCtx: CanvasRenderingContext2D | null;
  brushEngine: { finalizeStroke: (ctx: CanvasRenderingContext2D) => void };
  withAlphaLock: (
    ctx: CanvasRenderingContext2D,
    draw: (targetCtx: CanvasRenderingContext2D) => void,
    bounds?: Rect
  ) => void;
}): void => {
  if (rawCtx) {
    // Finalize without emitting a new stamp; finalizeStroke() may currently place a tail stamp.
    // Guard against the final "large stamp" by flushing normally (finalizeStroke currently ignores pressure).
    brushEngine.finalizeStroke(rawCtx);
    return;
  }

  withAlphaLock(ctx, (targetCtx) => {
    brushEngine.finalizeStroke(targetCtx);
  }, strokeBounds ?? undefined);
};

export const finalizeStrokeAfterEngine = ({
  ctx,
  strokeBounds,
  region,
  rawCanvas,
  ditherCanvas,
  rawCtx,
  ditherCtx,
  shouldApplyStrokeDither,
  settings,
  applyLostEdgeMaskInRegion,
  withAlphaLock,
  committedPixelSizeRef,
  lastPressureDitherPixelSizeRef,
  getStrokeDitherPixelSize,
  ditherRegionWithCurrentPressure,
  applyStrokeDither,
  isPixelDitherNoBg,
  applyStrokeRisographOverlay,
  isDitherStrokeBrush,
  warnIfDitherStrokePath,
  finalizeAndReset,
}: {
  ctx: CanvasRenderingContext2D;
  strokeBounds: Rect | null;
  region: Rect | null;
  rawCanvas: HTMLCanvasElement | OffscreenCanvas | null;
  ditherCanvas: HTMLCanvasElement | OffscreenCanvas | null;
  rawCtx: CanvasRenderingContext2D | null;
  ditherCtx: CanvasRenderingContext2D | null;
  shouldApplyStrokeDither: boolean;
  settings: StrokeSettingsForFinalize;
  applyLostEdgeMaskInRegion: (
    ctx: CanvasRenderingContext2D,
    region: Rect | null,
    lostEdgePercent?: number
  ) => void;
  withAlphaLock: (
    ctx: CanvasRenderingContext2D,
    draw: (targetCtx: CanvasRenderingContext2D) => void,
    bounds?: Rect
  ) => void;
  committedPixelSizeRef: { current: number | null };
  lastPressureDitherPixelSizeRef: { current: number | null };
  getStrokeDitherPixelSize: () => number;
  ditherRegionWithCurrentPressure: (
    ctx: CanvasRenderingContext2D,
    region: { x: number; y: number; width: number; height: number },
    sampleCtx?: CanvasRenderingContext2D,
    options?: {
      mergeExisting?: boolean;
      overridePressure?: number;
      overridePixelSize?: number;
      bgOffMode?: 'direct' | 'accumulate';
      bgOffComposite?: 'copy' | 'source-over';
      settingsOverride?: BrushSettings;
    }
  ) => void;
  applyStrokeDither: (
    ctx: CanvasRenderingContext2D,
    bounds: Rect | null,
    sampleCtx?: CanvasRenderingContext2D,
    options?: {
      mergeExisting?: boolean;
      overridePressure?: number;
      overridePixelSize?: number;
      bgOffMode?: 'direct' | 'accumulate';
      bgOffComposite?: 'copy' | 'source-over';
      settingsOverride?: BrushSettings;
    }
  ) => void;
  isPixelDitherNoBg: boolean;
  applyStrokeRisographOverlay: (
    ctx: CanvasRenderingContext2D,
    bounds: Rect | null,
    source?: HTMLCanvasElement | null
  ) => void;
  isDitherStrokeBrush: boolean;
  warnIfDitherStrokePath: (context: string) => void;
  finalizeAndReset: (clearCoverage: boolean) => Rect | null;
}): Rect | null => {
  if (
    !shouldApplyStrokeDither &&
    rawCtx &&
    strokeBounds &&
    region &&
    region.width > 0 &&
    region.height > 0
  ) {
    if (settings.lostEdge && settings.lostEdge > 0) {
      applyLostEdgeMaskInRegion(rawCtx, inflateRect(region, 2), settings.lostEdge);
    }
    const { x, y, width, height } = region;
    withAlphaLock(ctx, (targetCtx) => {
      targetCtx.drawImage(
        rawCanvas as CanvasImageSource,
        x, y, width, height,
        x, y, width, height
      );
    }, strokeBounds);
    return finalizeAndReset(true);
  }

  if (
    settings.pressureLinkedFillResolution &&
    shouldApplyStrokeDither &&
    strokeBounds &&
    ditherCanvas &&
    region
  ) {
    commitFinalizePressureLinkedDither({
      ctx,
      strokeBounds,
      region,
      rawCanvas: rawCanvas ?? null,
      ditherCanvas,
      committedPixelSizeRef,
      lastPressureDitherPixelSizeRef,
      getStrokeDitherPixelSize,
      ditherBackgroundFill: settings.ditherBackgroundFill,
      ditherRegionWithCurrentPressure,
      isPixelDitherNoBg,
      withAlphaLock,
      applyStrokeRisographOverlay,
      isDitherStrokeBrush,
      warnIfDitherStrokePath,
    });
    return finalizeAndReset(true);
  }

  if (
    !settings.pressureLinkedFillResolution &&
    strokeBounds &&
    region &&
    region.width > 0 &&
    region.height > 0 &&
    rawCtx &&
    ditherCtx &&
    ditherCanvas
  ) {
    const committed = commitFinalizeNonPressureDither({
      ctx,
      strokeBounds,
      region,
      rawCanvas: rawCanvas ?? null,
      ditherCanvas,
      rawCtx,
      ditherCtx,
      ditherBackgroundFill: settings.ditherBackgroundFill,
      ditherRegionWithCurrentPressure,
      applyStrokeDither,
      isPixelDitherNoBg,
      withAlphaLock,
      applyStrokeRisographOverlay,
      isDitherStrokeBrush,
      warnIfDitherStrokePath,
    });
    return finalizeAndReset(committed);
  }

  return finalizeAndReset(true);
};
