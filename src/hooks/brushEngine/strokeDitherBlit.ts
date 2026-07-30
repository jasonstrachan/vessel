import type { Rect } from './engineShared';

export const blitDitheredRegionWithOverlay = ({
  ctx,
  ditherCanvas,
  rawCanvas,
  baseCanvas,
  strokeBounds,
  region,
  withAlphaLock,
  applyStrokeRisographOverlay,
  bgOff,
  clearBgOffOnTarget,
  isDitherStrokeBrush,
  warnIfDitherStrokePath,
  warnContext,
  includeRawFallbackForOverlay,
}: {
  ctx: CanvasRenderingContext2D;
  ditherCanvas: HTMLCanvasElement | OffscreenCanvas | null;
  rawCanvas: HTMLCanvasElement | OffscreenCanvas | null;
  baseCanvas: HTMLCanvasElement | OffscreenCanvas | null;
  strokeBounds: Rect;
  region: Rect;
  withAlphaLock: (
    ctx: CanvasRenderingContext2D,
    draw: (targetCtx: CanvasRenderingContext2D) => void,
    bounds?: Rect
  ) => void;
  applyStrokeRisographOverlay: (
    ctx: CanvasRenderingContext2D,
    bounds: Rect | null,
    source?: HTMLCanvasElement | null
  ) => void;
  bgOff: boolean;
  clearBgOffOnTarget: boolean;
  isDitherStrokeBrush: boolean;
  warnIfDitherStrokePath: (context: string) => void;
  warnContext: string;
  includeRawFallbackForOverlay: boolean;
}): void => {
  if (!ditherCanvas) {
    return;
  }
  const { x, y, width, height } = region;
  const ditherSource = ditherCanvas instanceof HTMLCanvasElement ? ditherCanvas : null;

  if (bgOff && clearBgOffOnTarget) {
    if (isDitherStrokeBrush && baseCanvas) {
      ctx.save();
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(
        baseCanvas as CanvasImageSource,
        x, y, width, height,
        x, y, width, height
      );
      ctx.restore();
    } else {
      warnIfDitherStrokePath(warnContext);
    }
  }

  withAlphaLock(ctx, (targetCtx) => {
    targetCtx.drawImage(ditherCanvas as CanvasImageSource, x, y, width, height, x, y, width, height);
  }, strokeBounds);

  const rawSource = rawCanvas instanceof HTMLCanvasElement ? rawCanvas : null;
  applyStrokeRisographOverlay(
    ctx,
    strokeBounds,
    ditherSource ?? (includeRawFallbackForOverlay ? rawSource : null)
  );
};
