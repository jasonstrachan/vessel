import { finalizeStrokeOrchestrated } from './strokeFinalizeOrchestrator';

import type { Rect } from './engineShared';

export const finalizeStrokeCurrent = ({
  ctx,
  strokeBoundsRef,
  liveStrokeBoundsRef,
  liveStrokeRawRef,
  liveStrokeDitherRef,
  clearLiveStrokeBuffers,
  clearCoverageMaps,
  brushEngine,
  withAlphaLock,
  shouldApplyStrokeDither,
  finalizeStrokeSettings,
  applyLostEdgeMaskInRegion,
  committedPixelSizeRef,
  lastPressureDitherPixelSizeRef,
  getStrokeDitherPixelSize,
  ditherRegionWithCurrentPressure,
  applyStrokeDither,
  isPixelDitherNoBg,
  applyStrokeRisographOverlay,
  isDitherStrokeBrush,
  warnIfDitherStrokePath,
}: {
  ctx: CanvasRenderingContext2D;
  strokeBoundsRef: { current: Rect | null };
  liveStrokeBoundsRef: { current: Rect | null };
  liveStrokeRawRef: { current: HTMLCanvasElement | OffscreenCanvas | null };
  liveStrokeDitherRef: { current: HTMLCanvasElement | OffscreenCanvas | null };
  clearLiveStrokeBuffers: () => void;
  clearCoverageMaps: () => void;
  brushEngine: { finalizeStroke: (ctx: CanvasRenderingContext2D) => void };
  withAlphaLock: (
    dstCtx: CanvasRenderingContext2D,
    paint: (targetCtx: CanvasRenderingContext2D) => void,
    bounds?: Rect
  ) => void;
  shouldApplyStrokeDither: boolean;
  finalizeStrokeSettings: {
    lostEdge: number | undefined;
    ditherBackgroundFill: boolean | undefined;
    pressureLinkedFillResolution: boolean | undefined;
  };
  applyLostEdgeMaskInRegion: (
    ctx: CanvasRenderingContext2D,
    region: Rect | null,
    lostEdgePercent?: number
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
}): Rect | null => {
  return finalizeStrokeOrchestrated({
    ctx,
    strokeBoundsRef,
    liveStrokeBoundsRef,
    liveStrokeRawRef,
    liveStrokeDitherRef,
    clearLiveStrokeBuffers,
    clearCoverageMaps,
    brushEngine,
    withAlphaLock,
    shouldApplyStrokeDither,
    lostEdge: finalizeStrokeSettings.lostEdge,
    ditherBackgroundFill: finalizeStrokeSettings.ditherBackgroundFill,
    pressureLinkedFillResolution: finalizeStrokeSettings.pressureLinkedFillResolution,
    applyLostEdgeMaskInRegion,
    committedPixelSizeRef,
    lastPressureDitherPixelSizeRef,
    getStrokeDitherPixelSize,
    ditherRegionWithCurrentPressure,
    applyStrokeDither,
    isPixelDitherNoBg,
    applyStrokeRisographOverlay,
    isDitherStrokeBrush,
    warnIfDitherStrokePath,
  });
};
