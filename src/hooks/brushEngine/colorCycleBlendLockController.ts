type CanvasPoolLike = {
  acquire: (width: number, height: number) => HTMLCanvasElement;
  release: (canvas: HTMLCanvasElement) => void;
};

type AlphaPresenceCacheRef = {
  current: {
    canvas: HTMLCanvasElement | OffscreenCanvas | null;
    hasAlpha: boolean;
    sampledAt: number;
  } | null;
};

type RenderColorCycleWithBlendAndLockArgs = {
  targetCtx: CanvasRenderingContext2D;
  sourceCanvas: HTMLCanvasElement | OffscreenCanvas;
  blendMode: GlobalCompositeOperation;
  activeLayerTransparencyLock: boolean;
  transparencyLockMaskCanvas?: HTMLCanvasElement | OffscreenCanvas | null;
  getActiveLayerBitmapCanvas: () => HTMLCanvasElement | OffscreenCanvas | null;
  layerHasAnyAlpha: () => boolean;
  alphaPresenceCacheRef: AlphaPresenceCacheRef;
  AL: (event: string, payload: Record<string, unknown>) => void;
  sampleMaskA: (
    mask: HTMLCanvasElement | OffscreenCanvas | null,
    dstW: number,
    dstH: number,
    x: number,
    y: number
  ) => number | null;
  canvasPool: CanvasPoolLike;
};

export const renderColorCycleWithBlendAndLock = ({
  targetCtx,
  sourceCanvas,
  blendMode,
  activeLayerTransparencyLock,
  transparencyLockMaskCanvas,
  getActiveLayerBitmapCanvas,
  layerHasAnyAlpha,
  alphaPresenceCacheRef,
  AL,
  sampleMaskA,
  canvasPool,
}: RenderColorCycleWithBlendAndLockArgs): void => {
  const width = targetCtx.canvas.width;
  const height = targetCtx.canvas.height;
  if (!width || !height) {
    return;
  }

  const sampleDefault = { x: width / 2, y: height / 2, tag: 'cc(center)' };
  const sample = (typeof window !== 'undefined' && window.__AL_sample) || sampleDefault;
  AL('CC_ENTER', { lock: activeLayerTransparencyLock, dst: `${width}x${height}` });

  const mask = transparencyLockMaskCanvas ?? getActiveLayerBitmapCanvas();
  const maskWidth = (mask as { width?: number })?.width ?? 0;
  const maskHeight = (mask as { height?: number })?.height ?? 0;
  const hasMaskAlpha = transparencyLockMaskCanvas ? true : layerHasAnyAlpha();
  const maskSrc = (typeof window !== 'undefined' && window.__AL_maskSrc) || 'unknown';
  const maskA = sampleMaskA(mask, width, height, sample.x, sample.y);
  AL('CC_SETUP', {
    sampleTag: sample.tag,
    maskSrc,
    maskSize: `${maskWidth}x${maskHeight}`,
    maskA,
    hasMaskAlpha,
    lock: activeLayerTransparencyLock,
  });

  const tempCanvas = canvasPool.acquire(width, height);
  try {
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
    if (!tempCtx) {
      return;
    }

    tempCtx.clearRect(0, 0, width, height);
    tempCtx.drawImage(sourceCanvas as unknown as CanvasImageSource, 0, 0, width, height);

    if (activeLayerTransparencyLock && hasMaskAlpha) {
      if (mask && maskWidth && maskHeight) {
        tempCtx.globalCompositeOperation = 'destination-in';
        tempCtx.drawImage(
          mask as unknown as CanvasImageSource,
          0,
          0,
          maskWidth,
          maskHeight,
          0,
          0,
          width,
          height
        );
        tempCtx.globalCompositeOperation = 'source-over';

        try {
          const sx = Math.max(0, Math.min(width - 1, Math.floor(sample.x)));
          const sy = Math.max(0, Math.min(height - 1, Math.floor(sample.y)));
          const px = tempCtx.getImageData(sx, sy, 1, 1).data;
          AL('CC_MASK', { tempSampleRGBA_afterMask: px ? Array.from(px) : null });
        } catch {
          AL('CC_MASK', { tempSampleRGBA_afterMask: 'read-failed' });
        }
      } else {
        AL('CC_MASK_SKIP', { reason: 'missing-mask' });
      }
    }

    targetCtx.save();
    targetCtx.globalCompositeOperation = blendMode;
    targetCtx.drawImage(tempCanvas, 0, 0);
    targetCtx.restore();

    if (activeLayerTransparencyLock) {
      const layerMask = getActiveLayerBitmapCanvas();
      if (layerMask) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        alphaPresenceCacheRef.current = {
          canvas: layerMask as HTMLCanvasElement | OffscreenCanvas,
          hasAlpha: true,
          sampledAt: now,
        };
      }
    }
  } finally {
    canvasPool.release(tempCanvas);
  }
};

export const createColorCycleTransparencyLockMaskCanvas = ({
  paintMask,
  width,
  height,
}: {
  paintMask: Uint8Array | null | undefined;
  width: number;
  height: number;
}): HTMLCanvasElement | null => {
  if (
    typeof document === 'undefined' ||
    width <= 0 ||
    height <= 0 ||
    paintMask?.length !== width * height
  ) {
    return null;
  }

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!maskCtx) {
    return null;
  }

  const maskImage = maskCtx.createImageData(width, height);
  const maskPixels = new Uint32Array(maskImage.data.buffer);
  for (let sourceIndex = 0; sourceIndex < paintMask.length; sourceIndex += 1) {
    if (paintMask[sourceIndex] !== 0) {
      maskPixels[sourceIndex] = 0xff000000;
    }
  }
  maskCtx.putImageData(maskImage, 0, 0);
  return maskCanvas;
};
