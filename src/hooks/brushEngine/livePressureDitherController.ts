import type { Rect } from './engineShared';
import type { StrokeDitherRegionOptions } from './strokeDitherRegion';

type MutableRef<T> = { current: T };

type RunLivePressureDitherForCurrentStrokeArgs = {
  rawCtx: CanvasRenderingContext2D;
  segmentBounds: Rect;
  enableLargeRegionFallback: boolean;
  liveStrokeDitherRef: MutableRef<HTMLCanvasElement | OffscreenCanvas | null>;
  strokeBoundsRef: MutableRef<Rect | null>;
  ditherBackgroundFill: boolean | undefined;
  pick2D: (canvas: HTMLCanvasElement | OffscreenCanvas | null) => unknown;
  runPressureLinkedLiveDitherPass: (args: {
    ditherCtx: CanvasRenderingContext2D;
    rawCtx: CanvasRenderingContext2D;
    fullBounds: Rect;
    segmentBounds: Rect;
    bgOff: boolean;
    getStrokeDitherPixelSize: () => number;
    committedPixelSizeRef: MutableRef<number | null>;
    pendingPixelSizeRef: MutableRef<number | null>;
    pendingSinceRef: MutableRef<number>;
    lastPressureDitherTimeRef: MutableRef<number>;
    lastPressureDitherPixelSizeRef: MutableRef<number | null>;
    pressureDitherMinIntervalMs: number;
    pressureDitherMinDeltaRes: number;
    ditherRegionWithCurrentPressure: (
      ctx: CanvasRenderingContext2D,
      region: { x: number; y: number; width: number; height: number },
      sampleCtx?: CanvasRenderingContext2D,
      options?: StrokeDitherRegionOptions
    ) => void;
    liveStrokeBoundsRef: MutableRef<Rect | null>;
    liveDirtyRectRef: MutableRef<Rect | null>;
    enableLargeRegionFallback: boolean;
  }) => void;
  getStrokeDitherPixelSize: () => number;
  committedPixelSizeRef: MutableRef<number | null>;
  pendingPixelSizeRef: MutableRef<number | null>;
  pendingSinceRef: MutableRef<number>;
  lastPressureDitherTimeRef: MutableRef<number>;
  lastPressureDitherPixelSizeRef: MutableRef<number | null>;
  pressureDitherMinIntervalMs: number;
  pressureDitherMinDeltaRes: number;
  ditherRegionWithCurrentPressure: (
    ctx: CanvasRenderingContext2D,
    region: { x: number; y: number; width: number; height: number },
    sampleCtx?: CanvasRenderingContext2D,
    options?: StrokeDitherRegionOptions
  ) => void;
  liveStrokeBoundsRef: MutableRef<Rect | null>;
  liveDirtyRectRef: MutableRef<Rect | null>;
};

export const runLivePressureDitherForCurrentStroke = ({
  rawCtx,
  segmentBounds,
  enableLargeRegionFallback,
  liveStrokeDitherRef,
  strokeBoundsRef,
  ditherBackgroundFill,
  pick2D,
  runPressureLinkedLiveDitherPass,
  getStrokeDitherPixelSize,
  committedPixelSizeRef,
  pendingPixelSizeRef,
  pendingSinceRef,
  lastPressureDitherTimeRef,
  lastPressureDitherPixelSizeRef,
  pressureDitherMinIntervalMs,
  pressureDitherMinDeltaRes,
  ditherRegionWithCurrentPressure,
  liveStrokeBoundsRef,
  liveDirtyRectRef,
}: RunLivePressureDitherForCurrentStrokeArgs): void => {
  const ditherCtx = pick2D(liveStrokeDitherRef.current) as CanvasRenderingContext2D | null;
  const fullBounds = strokeBoundsRef.current ?? segmentBounds;
  const bgOff = ditherBackgroundFill === false;
  if (!ditherCtx || !rawCtx || !fullBounds) {
    return;
  }

  runPressureLinkedLiveDitherPass({
    ditherCtx,
    rawCtx,
    fullBounds,
    segmentBounds,
    bgOff,
    getStrokeDitherPixelSize,
    committedPixelSizeRef,
    pendingPixelSizeRef,
    pendingSinceRef,
    lastPressureDitherTimeRef,
    lastPressureDitherPixelSizeRef,
    pressureDitherMinIntervalMs,
    pressureDitherMinDeltaRes,
    ditherRegionWithCurrentPressure,
    liveStrokeBoundsRef,
    liveDirtyRectRef,
    enableLargeRegionFallback,
  });
};
