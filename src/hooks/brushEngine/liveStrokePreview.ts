import { inflateRect, normalizeRectForCanvas, pick2D, pick2DRead, type Rect } from './engineShared';

import { BrushShape, type BrushSettings } from '@/types';

export const renderLiveStrokePreview = ({
  restoreBase = false,
  previewSource,
  visibleCtx,
  liveRenderScheduledRef,
  liveStrokeRawRef,
  liveStrokeDitherRef,
  liveStrokeBaseRef,
  liveStrokeBoundsRef,
  strokeBoundsRef,
  liveDirtyRectRef,
  shouldApplyStrokeDither,
  brushSettings,
  warnIfDitherStrokePath,
  withAlphaLock,
  applyStrokeDither,
  applyStrokeRisographOverlay,
  applyLostEdgeMaskInRegion,
}: {
  restoreBase?: boolean;
  previewSource?: { canvas: HTMLCanvasElement; bounds: Rect } | null;
  visibleCtx: CanvasRenderingContext2D;
  liveRenderScheduledRef: { current: boolean };
  liveStrokeRawRef: { current: HTMLCanvasElement | OffscreenCanvas | null };
  liveStrokeDitherRef: { current: HTMLCanvasElement | OffscreenCanvas | null };
  liveStrokeBaseRef: { current: HTMLCanvasElement | OffscreenCanvas | null };
  liveStrokeBoundsRef: { current: Rect | null };
  strokeBoundsRef: { current: Rect | null };
  liveDirtyRectRef: { current: Rect | null };
  shouldApplyStrokeDither: boolean;
  brushSettings: BrushSettings;
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
  applyLostEdgeMaskInRegion?: (
    ctx: CanvasRenderingContext2D,
    region: Rect | null,
    lostEdgePercent?: number,
  ) => void;
  applyStrokeRisographOverlay: (
    ctx: CanvasRenderingContext2D,
    bounds: Rect | null,
    source?: HTMLCanvasElement | null
  ) => void;
}): void => {
  liveRenderScheduledRef.current = false;

  const isEraserStroke = restoreBase || visibleCtx.globalCompositeOperation === 'destination-out';
  const hasReleasePresentation = isEraserStroke &&
    !(shouldApplyStrokeDither && brushSettings.pressureLinkedFillResolution);
  const presentation = hasReleasePresentation ? previewSource : null;
  const rawCanvas = presentation?.canvas ?? liveStrokeRawRef.current;
  const ditherCanvas = liveStrokeDitherRef.current;
  const strokeBounds = hasReleasePresentation || shouldApplyStrokeDither
    ? strokeBoundsRef.current ?? liveStrokeBoundsRef.current
    : liveStrokeBoundsRef.current ?? strokeBoundsRef.current;
  if (!rawCanvas || !strokeBounds) {
    return;
  }

  const canvasWidth = visibleCtx.canvas?.width ?? 0;
  const canvasHeight = visibleCtx.canvas?.height ?? 0;
  const presentationBounds = presentation?.bounds ?? strokeBounds;
  const region = normalizeRectForCanvas(presentationBounds, canvasWidth, canvasHeight);
  // Finalization samples the admitted stroke bounds before authoring its cap.
  // Old tentative footprints belong only to redraw, never the effect domain.
  const effectRegion = normalizeRectForCanvas(strokeBounds, canvasWidth, canvasHeight);
  const { x, y, width, height } = region;
  if (width <= 0 || height <= 0) {
    return;
  }

  const rawCtx = pick2DRead(rawCanvas) as CanvasRenderingContext2D | null;
  if (!rawCtx) {
    return;
  }
  const restoreBaseRegion = (bounds: Rect): void => {
    const baseCanvas = liveStrokeBaseRef.current;
    if (!baseCanvas) {
      warnIfDitherStrokePath('missing-base-snapshot');
      return;
    }
    const restored = normalizeRectForCanvas(bounds, canvasWidth, canvasHeight);
    visibleCtx.save();
    visibleCtx.beginPath();
    visibleCtx.rect(restored.x, restored.y, restored.width, restored.height);
    visibleCtx.clip();
    visibleCtx.globalCompositeOperation = 'copy';
    visibleCtx.globalAlpha = 1;
    visibleCtx.drawImage(
      baseCanvas as CanvasImageSource,
      restored.x, restored.y, restored.width, restored.height,
      restored.x, restored.y, restored.width, restored.height
    );
    visibleCtx.restore();
  };

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
        restoreBaseRegion({ x: bx, y: by, width: bw, height: bh });
        const ditherSource = ditherCanvas instanceof HTMLCanvasElement ? ditherCanvas : null;
        withAlphaLock(visibleCtx, (targetCtx) => {
          targetCtx.drawImage(ditherCanvas as CanvasImageSource, bx, by, bw, bh, bx, by, bw, bh);
        }, strokeBounds);
        applyStrokeRisographOverlay(visibleCtx, strokeBounds, ditherSource);
      }
    }
    return;
  }

  if (shouldApplyStrokeDither && ditherCanvas) {
    const dCtx = pick2D(ditherCanvas) as CanvasRenderingContext2D | null;
    if (dCtx) {
      // Palette diffusion and pattern phase depend on the sampled domain. Match
      // finalization instead of moving that domain with each pointer update.
      const fullDirty = region;
      liveDirtyRectRef.current = null;

      const ditherRegion = effectRegion;

      const clearRegion = normalizeRectForCanvas(fullDirty, canvasWidth, canvasHeight);
      dCtx.clearRect(clearRegion.x, clearRegion.y, clearRegion.width, clearRegion.height);
      if (brushSettings.ditherBackgroundFill !== false) {
        applyStrokeDither(dCtx, ditherRegion, rawCtx);
      } else {
        applyStrokeDither(dCtx, ditherRegion, rawCtx, { mergeExisting: false });
      }

      const blitRect = normalizeRectForCanvas(
        isEraserStroke ? effectRegion : fullDirty,
        dCtx.canvas?.width ?? 0,
        dCtx.canvas?.height ?? 0
      );

      const ditherSource = ditherCanvas instanceof HTMLCanvasElement ? ditherCanvas : null;
      restoreBaseRegion(fullDirty);
      withAlphaLock(visibleCtx, (targetCtx) => {
        targetCtx.drawImage(
          ditherCanvas as CanvasImageSource,
          blitRect.x, blitRect.y, blitRect.width, blitRect.height,
          blitRect.x, blitRect.y, blitRect.width, blitRect.height
        );
      }, isEraserStroke ? strokeBounds : fullDirty);
      applyStrokeRisographOverlay(visibleCtx, fullDirty, ditherSource ?? (rawCanvas instanceof HTMLCanvasElement ? rawCanvas : null));
      return;
    }
  }

  if (isEraserStroke && (brushSettings.lostEdge ?? 0) > 0 &&
    ditherCanvas && applyLostEdgeMaskInRegion) {
    const effectCtx = pick2D(ditherCanvas) as CanvasRenderingContext2D | null;
    if (effectCtx) {
      // Start from completed raw on every publication; neither accepted raw nor
      // the facade's cached release-cap source may accumulate erosion.
      const inflated = inflateRect(effectRegion, 2);
      const sampleRegion = normalizeRectForCanvas({
        ...inflated, x: Math.max(0, inflated.x), y: Math.max(0, inflated.y),
      }, canvasWidth, canvasHeight);
      effectCtx.clearRect(region.x, region.y, region.width, region.height);
      const previousAlpha = effectCtx.globalAlpha;
      const previousComposite = effectCtx.globalCompositeOperation;
      effectCtx.globalAlpha = 1;
      effectCtx.globalCompositeOperation = 'copy';
      effectCtx.drawImage(rawCanvas as CanvasImageSource,
        sampleRegion.x, sampleRegion.y, sampleRegion.width, sampleRegion.height,
        sampleRegion.x, sampleRegion.y, sampleRegion.width, sampleRegion.height);
      effectCtx.globalAlpha = previousAlpha;
      effectCtx.globalCompositeOperation = previousComposite;
      applyLostEdgeMaskInRegion(effectCtx, inflateRect(effectRegion, 2), brushSettings.lostEdge);
      restoreBaseRegion(region);
      withAlphaLock(visibleCtx, (targetCtx) => {
        targetCtx.drawImage(ditherCanvas as CanvasImageSource,
          effectRegion.x, effectRegion.y, effectRegion.width, effectRegion.height,
          effectRegion.x, effectRegion.y, effectRegion.width, effectRegion.height);
      }, strokeBounds);
      return;
    }
  }

  const rawSource = rawCanvas instanceof HTMLCanvasElement ? rawCanvas : null;
  restoreBaseRegion(region);
  withAlphaLock(visibleCtx, (targetCtx) => {
    targetCtx.drawImage(rawCanvas as CanvasImageSource, x, y, width, height, x, y, width, height);
  }, presentationBounds);
  if (brushSettings.brushShape !== BrushShape.RESAMPLER) {
    applyStrokeRisographOverlay(visibleCtx, presentationBounds, rawSource);
  }
};
