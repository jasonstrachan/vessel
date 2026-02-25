import { pick2DRead, type Rect } from './engineShared';
import { blitDitheredRegionWithOverlay } from './strokeDitherBlit';

import type { BrushSettings } from '@/types';

type DitherRegionFn = (
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

type AlphaLockFn = (
  ctx: CanvasRenderingContext2D,
  draw: (targetCtx: CanvasRenderingContext2D) => void,
  bounds?: Rect
) => void;

type OverlayFn = (
  ctx: CanvasRenderingContext2D,
  bounds: Rect | null,
  source?: HTMLCanvasElement | null
) => void;

export const commitFinalizePressureLinkedDither = ({
  ctx,
  strokeBounds,
  region,
  rawCanvas,
  ditherCanvas,
  committedPixelSizeRef,
  lastPressureDitherPixelSizeRef,
  getStrokeDitherPixelSize,
  ditherBackgroundFill,
  ditherRegionWithCurrentPressure,
  isPixelDitherNoBg,
  withAlphaLock,
  applyStrokeRisographOverlay,
  isDitherStrokeBrush,
  warnIfDitherStrokePath,
}: {
  ctx: CanvasRenderingContext2D;
  strokeBounds: Rect;
  region: Rect;
  rawCanvas: HTMLCanvasElement | OffscreenCanvas | null;
  ditherCanvas: HTMLCanvasElement | OffscreenCanvas;
  committedPixelSizeRef: { current: number | null };
  lastPressureDitherPixelSizeRef: { current: number | null };
  getStrokeDitherPixelSize: () => number;
  ditherBackgroundFill: boolean | undefined;
  ditherRegionWithCurrentPressure: DitherRegionFn;
  isPixelDitherNoBg: boolean;
  withAlphaLock: AlphaLockFn;
  applyStrokeRisographOverlay: OverlayFn;
  isDitherStrokeBrush: boolean;
  warnIfDitherStrokePath: (context: string) => void;
}): void => {
  const rawCtxForFinal = rawCanvas ? pick2DRead(rawCanvas) : null;
  const ditherCtxForFinal = pick2DRead(ditherCanvas);
  const finalPixelSize =
    committedPixelSizeRef.current ??
    lastPressureDitherPixelSizeRef.current ??
    getStrokeDitherPixelSize();
  const bgOff = ditherBackgroundFill === false;
  if (rawCtxForFinal && ditherCtxForFinal) {
    const { x, y, width, height } = region;
    if (!bgOff) {
      ditherCtxForFinal.clearRect(x, y, width, height);
    }
    ditherRegionWithCurrentPressure(ditherCtxForFinal as CanvasRenderingContext2D, region, rawCtxForFinal as CanvasRenderingContext2D, {
      overridePixelSize: finalPixelSize,
      bgOffMode: bgOff ? 'direct' : undefined,
      bgOffComposite: bgOff ? 'copy' : undefined
    });
  }

  blitDitheredRegionWithOverlay({
    ctx,
    ditherCanvas,
    rawCanvas,
    strokeBounds,
    region,
    isPixelDitherNoBg,
    withAlphaLock,
    applyStrokeRisographOverlay,
    bgOff,
    clearBgOffOnTarget: true,
    isDitherStrokeBrush,
    warnIfDitherStrokePath,
    warnContext: 'finalize-clear',
    includeRawFallbackForOverlay: false,
  });
};

export const commitFinalizeNonPressureDither = ({
  ctx,
  strokeBounds,
  region,
  rawCanvas,
  ditherCanvas,
  rawCtx,
  ditherCtx,
  ditherBackgroundFill,
  ditherRegionWithCurrentPressure,
  applyStrokeDither,
  isPixelDitherNoBg,
  withAlphaLock,
  applyStrokeRisographOverlay,
  isDitherStrokeBrush,
  warnIfDitherStrokePath,
}: {
  ctx: CanvasRenderingContext2D;
  strokeBounds: Rect;
  region: Rect;
  rawCanvas: HTMLCanvasElement | OffscreenCanvas | null;
  ditherCanvas: HTMLCanvasElement | OffscreenCanvas;
  rawCtx: CanvasRenderingContext2D;
  ditherCtx: CanvasRenderingContext2D;
  ditherBackgroundFill: boolean | undefined;
  ditherRegionWithCurrentPressure: DitherRegionFn;
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
  withAlphaLock: AlphaLockFn;
  applyStrokeRisographOverlay: OverlayFn;
  isDitherStrokeBrush: boolean;
  warnIfDitherStrokePath: (context: string) => void;
}): boolean => {
  const { x, y, width, height } = region;
  const bgOff = ditherBackgroundFill === false;

  if (bgOff) {
    ditherCtx.clearRect(x, y, width, height);
    ditherRegionWithCurrentPressure(ditherCtx, region, rawCtx, { mergeExisting: false });
    blitDitheredRegionWithOverlay({
      ctx,
      ditherCanvas,
      rawCanvas,
      strokeBounds,
      region,
      isPixelDitherNoBg,
      withAlphaLock,
      applyStrokeRisographOverlay,
      bgOff: true,
      clearBgOffOnTarget: false,
      isDitherStrokeBrush,
      warnIfDitherStrokePath,
      warnContext: 'finalize-bg-off',
      includeRawFallbackForOverlay: true,
    });
    return true;
  }

  let src: ImageData;
  try {
    src = rawCtx.getImageData(x, y, width, height);
  } catch {
    return false;
  }

  ditherCtx.clearRect(x, y, width, height);
  ditherCtx.putImageData(src, x, y);
  applyStrokeDither(ditherCtx, strokeBounds, rawCtx);

  blitDitheredRegionWithOverlay({
    ctx,
    ditherCanvas,
    rawCanvas,
    strokeBounds,
    region,
    isPixelDitherNoBg,
    withAlphaLock,
    applyStrokeRisographOverlay,
    bgOff: false,
    clearBgOffOnTarget: false,
    isDitherStrokeBrush,
    warnIfDitherStrokePath,
    warnContext: 'finalize-bg-on',
    includeRawFallbackForOverlay: true,
  });
  return true;
};
