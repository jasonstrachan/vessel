import {
  buildStrokeFinalizeContext,
  finalizeStrokeAfterEngine,
  finalizeStrokeEngineBuffers,
} from './strokeFinalizeController';

import type { BrushSettings } from '@/types';
import type { Rect } from './engineShared';

type MutableRef<T> = { current: T };

export const finalizeStrokeOrchestrated = ({
  ctx,
  strokeBoundsRef,
  liveStrokeBoundsRef,
  liveStrokeRawRef,
  liveStrokeDitherRef,
  liveStrokeBaseRef,
  clearLiveStrokeBuffers,
  clearCoverageMaps,
  finalizeStroke,
  withAlphaLock,
  shouldApplyStrokeDither,
  lostEdge,
  ditherBackgroundFill,
  pressureLinkedFillResolution,
  applyLostEdgeMaskInRegion,
  committedPixelSizeRef,
  lastPressureDitherPixelSizeRef,
  getStrokeDitherPixelSize,
  ditherRegionWithCurrentPressure,
  applyStrokeDither,
  applyStrokeRisographOverlay,
  isDitherStrokeBrush,
  warnIfDitherStrokePath,
}: {
  ctx: CanvasRenderingContext2D;
  strokeBoundsRef: MutableRef<Rect | null>;
  liveStrokeBoundsRef: MutableRef<Rect | null>;
  liveStrokeRawRef: MutableRef<HTMLCanvasElement | OffscreenCanvas | null>;
  liveStrokeDitherRef: MutableRef<HTMLCanvasElement | OffscreenCanvas | null>;
  liveStrokeBaseRef: MutableRef<HTMLCanvasElement | OffscreenCanvas | null>;
  clearLiveStrokeBuffers: () => void;
  clearCoverageMaps: () => void;
  finalizeStroke: (ctx: CanvasRenderingContext2D) => void;
  withAlphaLock: (
    dstCtx: CanvasRenderingContext2D,
    paint: (targetCtx: CanvasRenderingContext2D) => void,
    bounds?: Rect
  ) => void;
  shouldApplyStrokeDither: boolean;
  lostEdge: number | undefined;
  ditherBackgroundFill: boolean | undefined;
  pressureLinkedFillResolution: boolean | undefined;
  applyLostEdgeMaskInRegion: (
    ctx: CanvasRenderingContext2D,
    region: Rect | null,
    lostEdgePercent?: number
  ) => void;
  committedPixelSizeRef: MutableRef<number | null>;
  lastPressureDitherPixelSizeRef: MutableRef<number | null>;
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
  applyStrokeRisographOverlay: (
    ctx: CanvasRenderingContext2D,
    bounds: Rect | null,
    source?: HTMLCanvasElement | null
  ) => void;
  isDitherStrokeBrush: boolean;
  warnIfDitherStrokePath: (context: string) => void;
}): Rect | null => {
  const {
    strokeBounds,
    region,
    rawCanvas,
    ditherCanvas,
    baseCanvas,
    rawCtx,
    ditherCtx,
  } = buildStrokeFinalizeContext({
    ctx,
    strokeBoundsRef,
    liveStrokeBoundsRef,
    liveStrokeRawRef,
    liveStrokeDitherRef,
    liveStrokeBaseRef,
  });

  const finalizeAndReset = (clearCoverage: boolean) => {
    clearLiveStrokeBuffers();
    if (clearCoverage) {
      clearCoverageMaps();
    }
    strokeBoundsRef.current = null;
    return strokeBounds ? { ...strokeBounds } : null;
  };

  finalizeStrokeEngineBuffers({ ctx, strokeBounds, rawCtx, finalizeStroke, withAlphaLock });

  return finalizeStrokeAfterEngine({
    ctx,
    strokeBounds,
    region,
    rawCanvas: rawCanvas ?? null,
    baseCanvas,
    ditherCanvas: ditherCanvas ?? null,
    rawCtx,
    ditherCtx,
    shouldApplyStrokeDither,
    settings: {
      lostEdge,
      ditherBackgroundFill,
      pressureLinkedFillResolution,
    },
    applyLostEdgeMaskInRegion,
    withAlphaLock,
    committedPixelSizeRef,
    lastPressureDitherPixelSizeRef,
    getStrokeDitherPixelSize,
    ditherRegionWithCurrentPressure,
    applyStrokeDither,
    applyStrokeRisographOverlay,
    isDitherStrokeBrush,
    warnIfDitherStrokePath,
    finalizeAndReset,
  });
};
