import { normalizeRectForCanvas, pick2D, pick2DRead, type Rect } from './engineShared';

import type { BrushSettings } from '@/types';

export const renderLiveStrokePreview = ({
  visibleCtx,
  liveRenderScheduledRef,
  liveStrokeRawRef,
  liveStrokeDitherRef,
  liveStrokeBoundsRef,
  strokeBoundsRef,
  liveDirtyRectRef,
  shouldApplyStrokeDither,
  brushSettings,
  isDitherStrokeBrush,
  isPixelDitherNoBg,
  warnIfDitherStrokePath,
  withAlphaLock,
  applyStrokeDither,
  applyStrokeRisographOverlay,
}: {
  visibleCtx: CanvasRenderingContext2D;
  liveRenderScheduledRef: { current: boolean };
  liveStrokeRawRef: { current: HTMLCanvasElement | OffscreenCanvas | null };
  liveStrokeDitherRef: { current: HTMLCanvasElement | OffscreenCanvas | null };
  liveStrokeBoundsRef: { current: Rect | null };
  strokeBoundsRef: { current: Rect | null };
  liveDirtyRectRef: { current: Rect | null };
  shouldApplyStrokeDither: boolean;
  brushSettings: BrushSettings;
  isDitherStrokeBrush: boolean;
  isPixelDitherNoBg: boolean;
  warnIfDitherStrokePath: (context: string) => void;
  withAlphaLock: (
    ctx: CanvasRenderingContext2D,
    draw: (target: CanvasRenderingContext2D) => void,
    bounds?: Rect
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
  applyStrokeRisographOverlay: (
    ctx: CanvasRenderingContext2D,
    bounds: Rect | null,
    source?: HTMLCanvasElement | null
  ) => void;
}): void => {
  liveRenderScheduledRef.current = false;

  const rawCanvas = liveStrokeRawRef.current;
  const ditherCanvas = liveStrokeDitherRef.current;
  const strokeBounds = liveStrokeBoundsRef.current ?? strokeBoundsRef.current;
  if (!rawCanvas || !strokeBounds) {
    return;
  }

  const canvasWidth = visibleCtx.canvas?.width ?? 0;
  const canvasHeight = visibleCtx.canvas?.height ?? 0;
  const region = normalizeRectForCanvas(strokeBounds, canvasWidth, canvasHeight);
  const { x, y, width, height } = region;
  if (width <= 0 || height <= 0) {
    return;
  }

  const rawCtx = pick2DRead(rawCanvas) as CanvasRenderingContext2D | null;
  if (!rawCtx) {
    return;
  }

  if (
    shouldApplyStrokeDither &&
    brushSettings.pressureLinkedFillResolution &&
    ditherCanvas
  ) {
    const regionToBlit = liveDirtyRectRef.current ?? strokeBounds;
    liveDirtyRectRef.current = null;
    if (regionToBlit) {
      const dCtx = pick2D(ditherCanvas) as CanvasRenderingContext2D | null;
      if (dCtx) {
        const { x: bx, y: by, width: bw, height: bh } = normalizeRectForCanvas(
          regionToBlit,
          dCtx.canvas?.width ?? 0,
          dCtx.canvas?.height ?? 0
        );
        if (isDitherStrokeBrush && brushSettings.ditherBackgroundFill === false) {
          visibleCtx.clearRect(bx, by, bw, bh);
        } else if (brushSettings.ditherBackgroundFill === false) {
          warnIfDitherStrokePath('preview-clear');
        }
        const ditherSource = ditherCanvas instanceof HTMLCanvasElement ? ditherCanvas : null;
        if (isPixelDitherNoBg) {
          visibleCtx.drawImage(
            ditherCanvas as CanvasImageSource,
            bx, by, bw, bh,
            bx, by, bw, bh
          );
        } else {
          withAlphaLock(visibleCtx, (targetCtx) => {
            targetCtx.drawImage(ditherCanvas as CanvasImageSource, bx, by, bw, bh, bx, by, bw, bh);
          }, strokeBounds);
        }
        applyStrokeRisographOverlay(visibleCtx, strokeBounds, ditherSource);
      }
    }
    return;
  }

  if (shouldApplyStrokeDither && ditherCanvas) {
    const dCtx = pick2D(ditherCanvas) as CanvasRenderingContext2D | null;
    if (dCtx) {
      const fullDirty = liveDirtyRectRef.current ?? strokeBounds;
      liveDirtyRectRef.current = null;

      const ditherRegion = fullDirty;

      const { x: dx, y: dy, width: dw, height: dh } = normalizeRectForCanvas(
        ditherRegion,
        dCtx.canvas?.width ?? 0,
        dCtx.canvas?.height ?? 0
      );

      if (brushSettings.ditherBackgroundFill !== false) {
        dCtx.drawImage(rawCanvas as CanvasImageSource, dx, dy, dw, dh, dx, dy, dw, dh);
        applyStrokeDither(dCtx, ditherRegion, rawCtx);
      } else {
        applyStrokeDither(dCtx, ditherRegion, rawCtx, { mergeExisting: false });
      }

      const blitRect = normalizeRectForCanvas(
        fullDirty,
        dCtx.canvas?.width ?? 0,
        dCtx.canvas?.height ?? 0
      );

      const ditherSource = ditherCanvas instanceof HTMLCanvasElement ? ditherCanvas : null;
      if (isPixelDitherNoBg) {
        visibleCtx.drawImage(
          ditherCanvas as CanvasImageSource,
          blitRect.x, blitRect.y, blitRect.width, blitRect.height,
          blitRect.x, blitRect.y, blitRect.width, blitRect.height
        );
      } else {
        withAlphaLock(visibleCtx, (targetCtx) => {
          targetCtx.drawImage(
            ditherCanvas as CanvasImageSource,
            blitRect.x, blitRect.y, blitRect.width, blitRect.height,
            blitRect.x, blitRect.y, blitRect.width, blitRect.height
          );
        }, fullDirty);
      }
      applyStrokeRisographOverlay(visibleCtx, fullDirty, ditherSource ?? (rawCanvas instanceof HTMLCanvasElement ? rawCanvas : null));
      return;
    }
  }

  const rawSource = rawCanvas instanceof HTMLCanvasElement ? rawCanvas : null;
  if (isPixelDitherNoBg) {
    visibleCtx.drawImage(rawCanvas as CanvasImageSource, x, y, width, height, x, y, width, height);
  } else {
    withAlphaLock(visibleCtx, (targetCtx) => {
      targetCtx.drawImage(rawCanvas as CanvasImageSource, x, y, width, height, x, y, width, height);
    }, strokeBounds);
  }
  applyStrokeRisographOverlay(visibleCtx, strokeBounds, rawSource);
};
