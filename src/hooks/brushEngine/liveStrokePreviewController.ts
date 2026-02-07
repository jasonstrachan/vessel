import type { BrushSettings } from '@/types';

import type { Rect } from './engineShared';

export const applyStrokeRisographOverlay = ({
  ctx,
  bounds,
  source,
  risographIntensity,
}: {
  ctx: CanvasRenderingContext2D;
  bounds: Rect | null;
  source?: HTMLCanvasElement | null;
  risographIntensity: number;
}): void => {
  const intensity = risographIntensity || 0;
  if (!bounds || !ctx || intensity <= 0) {
    return;
  }
  const { x, y, width, height } = bounds;
  const prevOp = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  try {
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = Math.min(1, Math.max(0, intensity / 100));
    if (source) {
      ctx.drawImage(source, x, y, width, height, x, y, width, height);
    }
  } catch {
    // best-effort overlay; ignore failures
  } finally {
    ctx.globalCompositeOperation = prevOp;
    ctx.globalAlpha = prevAlpha;
  }
};

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
  renderLiveStrokePreviewUtil,
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
    dstCtx: CanvasRenderingContext2D,
    paint: (targetCtx: CanvasRenderingContext2D) => void,
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
  renderLiveStrokePreviewUtil: (args: {
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
      dstCtx: CanvasRenderingContext2D,
      paint: (targetCtx: CanvasRenderingContext2D) => void,
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
  }) => void;
}): void => {
  renderLiveStrokePreviewUtil({
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
  });
};

export const scheduleLiveStrokeRender = ({
  visibleCtx,
  liveRenderScheduledRef,
  renderLiveStrokePreview,
}: {
  visibleCtx: CanvasRenderingContext2D;
  liveRenderScheduledRef: { current: boolean };
  renderLiveStrokePreview: (visibleCtx: CanvasRenderingContext2D) => void;
}): void => {
  if (liveRenderScheduledRef.current) {
    return;
  }
  liveRenderScheduledRef.current = true;
  const cb = () => renderLiveStrokePreview(visibleCtx);
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(cb);
  } else {
    setTimeout(cb, 16);
  }
};
