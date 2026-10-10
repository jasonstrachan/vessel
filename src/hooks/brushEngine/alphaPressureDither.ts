import { mergeRectBounds, normalizeRectForCanvas, type Rect } from './engineShared';
import type { StrokeDitherRegionOptions } from './strokeDitherRegion';
import { beginPressureDitherPass, resolveCommittedPressurePixelSize } from './strokePressureDither';

type MutableRef<T> = { current: T };

export type AlphaPressureDitherArgs = {
  ditherCtx: CanvasRenderingContext2D;
  rawCtx: CanvasRenderingContext2D;
  fullBounds: Rect;
  bgOff: boolean;
  desiredPixelSize: number;
  now: number;
  pressureDitherSmoosh: boolean;
  committedPixelSizeRef: MutableRef<number | null>;
  pendingPixelSizeRef: MutableRef<number | null>;
  pendingSinceRef: MutableRef<number>;
  lastPressureDitherTimeRef: MutableRef<number>;
  lastPressureDitherPixelSizeRef: MutableRef<number | null>;
  pressureDitherMinIntervalMs: number;
  pressureDitherMinDeltaRes: number;
  ditherRegionWithCurrentPressure: (
    ctx: CanvasRenderingContext2D,
    region: Rect,
    sampleCtx?: CanvasRenderingContext2D,
    options?: StrokeDitherRegionOptions,
  ) => void;
  liveStrokeBoundsRef: MutableRef<Rect | null>;
  liveDirtyRectRef: MutableRef<Rect | null>;
};

type SupportCanvas = HTMLCanvasElement | OffscreenCanvas;

export const createAlphaPressureDitherRuntime = ({
  createCanvas = () => document.createElement('canvas'),
}: {
  createCanvas?: () => SupportCanvas;
} = {}) => {
  let supportCanvas: SupportCanvas | null = null;
  let supportCtx: CanvasRenderingContext2D | null = null;
  let currentRunPixelSize: number | null = null;
  let lastArgs: AlphaPressureDitherArgs | null = null;
  let hasPending = false;

  const clearSupport = (): void => {
    if (!supportCtx || !supportCanvas) {
      return;
    }
    supportCtx.save();
    supportCtx.setTransform(1, 0, 0, 1, 0, 0);
    supportCtx.clearRect(0, 0, supportCanvas.width, supportCanvas.height);
    supportCtx.restore();
  };

  const render = (args: AlphaPressureDitherArgs, pixelSize: number): void => {
    if (!supportCtx) {
      return;
    }
    const region = normalizeRectForCanvas(
      args.fullBounds,
      args.ditherCtx.canvas.width,
      args.ditherCtx.canvas.height,
    );
    if (region.width <= 0 || region.height <= 0) {
      return;
    }

    // The complete raw stroke determines diffusion and coarse-cell averages.
    // Positive authored support controls only which resulting pixels are written.
    args.ditherRegionWithCurrentPressure(args.ditherCtx, region, args.rawCtx, {
      overridePixelSize: pixelSize,
      bgOffMode: args.bgOff ? 'direct' : undefined,
      bgOffComposite: args.bgOff ? 'copy' : undefined,
      writeSupportMask: args.pressureDitherSmoosh
        ? undefined
        : supportCtx.getImageData(region.x, region.y, region.width, region.height),
    });
    args.liveStrokeBoundsRef.current = mergeRectBounds(args.liveStrokeBoundsRef.current, region);
    args.liveDirtyRectRef.current = mergeRectBounds(args.liveDirtyRectRef.current, region);
    hasPending = false;
  };

  const flush = (update?: Pick<AlphaPressureDitherArgs, 'fullBounds' | 'rawCtx' | 'ditherCtx'>): void => {
    if (!lastArgs || currentRunPixelSize === null) {
      return;
    }
    if (update) {
      lastArgs = { ...lastArgs, ...update, fullBounds: { ...update.fullBounds } };
    }
    // A buffered final stamp may have emitted support since afterRender. Force
    // this pass even if the most recent live pass consumed all pending work.
    render(lastArgs, currentRunPixelSize);
    lastArgs.lastPressureDitherTimeRef.current = lastArgs.now;
    lastArgs.lastPressureDitherPixelSizeRef.current = currentRunPixelSize;
  };

  const flushPending = (now: number): void => {
    if (!hasPending || !lastArgs || currentRunPixelSize === null) {
      return;
    }
    // A preview publishes all accepted input, including work deferred by the
    // synchronous throttle. Close it before showing this resolution run.
    render(lastArgs, currentRunPixelSize);
    lastArgs.lastPressureDitherTimeRef.current = now;
    lastArgs.lastPressureDitherPixelSizeRef.current = currentRunPixelSize;
  };

  const beforeRender = (args: AlphaPressureDitherArgs): CanvasRenderingContext2D => {
    if (!supportCanvas) {
      supportCanvas = createCanvas();
    }
    if (!supportCtx || supportCanvas.width !== args.rawCtx.canvas.width || supportCanvas.height !== args.rawCtx.canvas.height) {
      supportCanvas.width = args.rawCtx.canvas.width;
      supportCanvas.height = args.rawCtx.canvas.height;
      supportCtx = supportCanvas.getContext('2d') as CanvasRenderingContext2D | null;
      if (!supportCtx) {
        throw new Error('Cannot create alpha-pressure authored-support context');
      }
    }

    const pixelSize = resolveCommittedPressurePixelSize({
      desiredPixelSize: Math.max(1, Math.round(args.desiredPixelSize)),
      now: args.now,
      committedPixelSizeRef: args.committedPixelSizeRef,
      pendingPixelSizeRef: args.pendingPixelSizeRef,
      pendingSinceRef: args.pendingSinceRef,
    });
    if (currentRunPixelSize !== null && currentRunPixelSize !== pixelSize) {
      // Close the previous run before incoming geometry changes cumulative raw.
      if (hasPending && lastArgs) {
        render(lastArgs, currentRunPixelSize);
      }
      clearSupport();
    }
    currentRunPixelSize = pixelSize;
    return supportCtx;
  };

  const afterRender = (args: AlphaPressureDitherArgs): void => {
    if (currentRunPixelSize === null) {
      throw new Error('Alpha-pressure rendering must begin before its live pass');
    }
    lastArgs = { ...args, fullBounds: { ...args.fullBounds } };
    hasPending = true;
    const pass = beginPressureDitherPass({
      now: args.now,
      activePixelSize: currentRunPixelSize,
      bgOff: args.bgOff,
      minIntervalMs: args.pressureDitherMinIntervalMs,
      minDeltaRes: args.pressureDitherMinDeltaRes,
      lastPressureDitherTimeRef: args.lastPressureDitherTimeRef,
      lastPressureDitherPixelSizeRef: args.lastPressureDitherPixelSizeRef,
    });
    if (pass) {
      render(lastArgs, currentRunPixelSize);
    }
  };

  const reset = (): void => {
    clearSupport();
    currentRunPixelSize = null;
    lastArgs = null;
    hasPending = false;
  };

  return { beforeRender, afterRender, flush, flushPending, reset };
};
