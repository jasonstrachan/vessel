import { debugWarn } from '@/utils/debug';
import type { Rect } from './engineShared';

type CanvasPoolLike = {
  acquire: (width: number, height: number) => HTMLCanvasElement;
  release: (canvas: HTMLCanvasElement) => void;
};

type AlphaPresenceCacheRef = {
  current: {
    canvas: HTMLCanvasElement | OffscreenCanvas | null;
    hasAlpha: boolean;
    sampledAt: number;
  };
};

type AlphaLockWarningRef = { current: boolean };

type LayerSnapshot = {
  id: string;
  layerType?: string;
  colorCycleData?: unknown;
};

type AppStateSnapshot = {
  activeLayerId: string | null;
  layers: LayerSnapshot[];
};

type ApplyAlphaLockArgs = {
  dstCtx: CanvasRenderingContext2D;
  paint: (targetCtx: CanvasRenderingContext2D) => void;
  bounds?: Rect;
  activeLayerTransparencyLock: boolean;
  alphaLockEmptyMaskWarnedRef: AlphaLockWarningRef;
  getActiveLayerBitmapCanvas: () => HTMLCanvasElement | OffscreenCanvas | null;
  layerHasAnyAlpha: () => boolean;
  getAlphaLockDebugLevel: () => number;
  getStateSnapshot: () => AppStateSnapshot;
  normalizeRectForCanvas: (bounds: Rect | undefined, width: number, height: number) => Rect;
  sampleRGBA: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number
  ) => number[] | null;
  canvasPool: CanvasPoolLike;
  blendMode: GlobalCompositeOperation;
  alphaPresenceCacheRef: AlphaPresenceCacheRef;
  AL: (event: string, payload: Record<string, unknown>) => void;
};

export const applyAlphaLockToPaint = ({
  dstCtx,
  paint,
  bounds,
  activeLayerTransparencyLock,
  alphaLockEmptyMaskWarnedRef,
  getActiveLayerBitmapCanvas,
  layerHasAnyAlpha,
  getAlphaLockDebugLevel,
  getStateSnapshot,
  normalizeRectForCanvas,
  sampleRGBA,
  canvasPool,
  blendMode,
  alphaPresenceCacheRef,
  AL,
}: ApplyAlphaLockArgs): void => {
  const dstW = dstCtx.canvas.width | 0;
  const dstH = dstCtx.canvas.height | 0;
  const alphaLockDebugLevel = getAlphaLockDebugLevel();
  const sample = (typeof window !== 'undefined' && window.__AL_sample) || {
    x: dstW ? dstW / 2 : 0,
    y: dstH ? dstH / 2 : 0,
    tag: '(center)',
  };

  const lockOn = activeLayerTransparencyLock;
  AL('ENTER', { tag: sample.tag, lockOn, dst: `${dstW}x${dstH}` });

  if (!lockOn || !dstW || !dstH) {
    alphaLockEmptyMaskWarnedRef.current = false;
    paint(dstCtx);
    return;
  }

  const mask = getActiveLayerBitmapCanvas();
  const hasLayerAlpha = layerHasAnyAlpha();
  const maskWidth = (mask as { width?: number })?.width ?? 0;
  const maskHeight = (mask as { height?: number })?.height ?? 0;
  const stateSnapshot = getStateSnapshot();
  const currentLayerId = stateSnapshot.activeLayerId ?? null;
  const activeLayer = currentLayerId
    ? stateSnapshot.layers.find((candidate) => candidate.id === currentLayerId)
    : undefined;
  const isColorCycleLayer = Boolean(activeLayer?.layerType === 'color-cycle' || activeLayer?.colorCycleData);
  const shouldBlock = !mask || !maskWidth || !maskHeight || !hasLayerAlpha;

  if (typeof window !== 'undefined') {
    const probeWindow = window as typeof window & {
      __AL_probe?: { hits: number; blocks: number; bypasses: number };
    };
    probeWindow.__AL_probe ??= { hits: 0, blocks: 0, bypasses: 0 };
    probeWindow.__AL_probe.hits += 1;
    if (lockOn && shouldBlock) {
      const payload = {
        activeLayerId: currentLayerId,
        isColorCycleLayer,
        hasVisibleAlpha: hasLayerAlpha,
      };
      if (isColorCycleLayer) {
        probeWindow.__AL_probe.bypasses += 1;
        if (alphaLockDebugLevel > 0 && typeof console !== 'undefined') {
          debugWarn('raw-console', '[AL:bypass-cc]', payload);
        }
      } else {
        probeWindow.__AL_probe.blocks += 1;
        if (alphaLockDebugLevel > 0 && typeof console !== 'undefined') {
          debugWarn('raw-console', '[AL:block]', payload);
        }
      }
    }
  }

  if (shouldBlock && isColorCycleLayer) {
    alphaLockEmptyMaskWarnedRef.current = false;
    paint(dstCtx);
    return;
  }

  if (shouldBlock && !isColorCycleLayer) {
    if (!alphaLockEmptyMaskWarnedRef.current && alphaLockDebugLevel > 0 && typeof console !== 'undefined') {
      debugWarn('raw-console', '[AlphaLock] Active layer shows no visible alpha; lock prevents new pixels.');
      alphaLockEmptyMaskWarnedRef.current = true;
    }
    return;
  }
  alphaLockEmptyMaskWarnedRef.current = false;

  const region = normalizeRectForCanvas(bounds, dstW, dstH);
  const scratch = canvasPool.acquire(region.width, region.height);

  try {
    const sctx = scratch.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
    if (!sctx) {
      return;
    }

    sctx.clearRect(0, 0, region.width, region.height);
    sctx.save();
    sctx.translate(-region.x, -region.y);

    const originalGetImageData = sctx.getImageData.bind(sctx);
    sctx.getImageData = ((x: number, y: number, w: number, h: number) =>
      dstCtx.getImageData(x + region.x, y + region.y, w, h)
    ) as typeof sctx.getImageData;

    try {
      paint(sctx as unknown as CanvasRenderingContext2D);
    } finally {
      sctx.getImageData = originalGetImageData;
      sctx.restore();
    }

    const scratchSampleX = sample.x - region.x;
    const scratchSampleY = sample.y - region.y;
    const scratchPre = sampleRGBA(sctx as unknown as CanvasRenderingContext2D, scratchSampleX, scratchSampleY);

    const maskSrc = (typeof window !== 'undefined' && window.__AL_maskSrc) || 'unknown';
    const dstBefore = sampleRGBA(dstCtx, sample.x, sample.y);
    AL('SETUP', {
      maskSrc,
      maskSize: `${maskWidth}x${maskHeight}`,
      sampleXY: `${Math.round(sample.x)},${Math.round(sample.y)}`,
      dstBefore,
      region,
    });
    AL('PAINT', { scratchRGBA_preMask: scratchPre });

    const sx = (region.x * maskWidth) / dstW;
    const sy = (region.y * maskHeight) / dstH;
    const sw = (region.width * maskWidth) / dstW;
    const sh = (region.height * maskHeight) / dstH;

    sctx.globalCompositeOperation = 'destination-in';
    sctx.drawImage(
      mask as unknown as CanvasImageSource,
      sx,
      sy,
      sw,
      sh,
      0,
      0,
      region.width,
      region.height
    );
    sctx.globalCompositeOperation = 'source-over';

    const scratchPost = sampleRGBA(sctx as unknown as CanvasRenderingContext2D, scratchSampleX, scratchSampleY);
    AL('MASK', { scratchRGBA_afterMask: scratchPost, region });

    dstCtx.save();
    dstCtx.globalCompositeOperation = blendMode;
    dstCtx.drawImage(scratch, region.x, region.y);
    dstCtx.restore();

    const dstAfter = sampleRGBA(dstCtx, sample.x, sample.y);
    AL('COMPOSITE', { gco: blendMode, dstAfter });

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    alphaPresenceCacheRef.current = {
      canvas: mask as HTMLCanvasElement | OffscreenCanvas,
      hasAlpha: true,
      sampledAt: now,
    };
  } finally {
    canvasPool.release(scratch);
  }
};
