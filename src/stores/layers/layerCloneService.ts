export const normalizeImageDataDimensions = (
  imageData: ImageData,
  width: number,
  height: number
): ImageData => {
  if (imageData.width === width && imageData.height === height) {
    return imageData;
  }

  const normalized = new ImageData(width, height);
  const target = normalized.data;
  const source = imageData.data;
  const copyWidth = Math.min(width, imageData.width);
  const copyHeight = Math.min(height, imageData.height);
  const sourceStride = imageData.width * 4;
  const targetStride = width * 4;

  for (let row = 0; row < copyHeight; row += 1) {
    const srcStart = row * sourceStride;
    const destStart = row * targetStride;
    target.set(source.subarray(srcStart, srcStart + copyWidth * 4), destStart);
  }

  return normalized;
};

export const snapshotFramebufferRegion = (
  framebuffer: HTMLCanvasElement | OffscreenCanvas | null | undefined,
  width: number,
  height: number
): ImageData | null => {
  if (!framebuffer) {
    return null;
  }
  try {
    const fbCtx = framebuffer.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings
    ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!fbCtx) {
      return null;
    }
    const targetWidth = Math.min(width, framebuffer.width);
    const targetHeight = Math.min(height, framebuffer.height);
    return fbCtx.getImageData(0, 0, targetWidth, targetHeight);
  } catch {
    return null;
  }
};

export const cloneImageData = (imageData: ImageData | null | undefined): ImageData | null => {
  if (!imageData) {
    return null;
  }
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
};

export const createCanvas = (
  width: number,
  height: number,
  { forceDom }: { forceDom?: boolean } = {}
): HTMLCanvasElement | OffscreenCanvas | null => {
  if (typeof document !== 'undefined') {
    if (forceDom || typeof OffscreenCanvas === 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
  }
  if (!forceDom && typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  return null;
};

export const cloneCanvasLike = <T extends HTMLCanvasElement | OffscreenCanvas | undefined | null>(
  source: T,
  fallbackImageData: ImageData | null,
  options?: { forceDom?: boolean }
): HTMLCanvasElement | OffscreenCanvas | T => {
  const width = source?.width ?? fallbackImageData?.width ?? 1;
  const height = source?.height ?? fallbackImageData?.height ?? 1;
  if (!source && !fallbackImageData) {
    return null as T;
  }
  const canvas = createCanvas(width, height, options ?? {});
  if (!canvas) {
    return source ?? (null as T);
  }
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (ctx && 'drawImage' in ctx && 'putImageData' in ctx) {
    if (source) {
      try {
        ctx.drawImage(source as CanvasImageSource, 0, 0);
      } catch {
        if (fallbackImageData) {
          ctx.putImageData(fallbackImageData, 0, 0);
        }
      }
    } else if (fallbackImageData) {
      ctx.putImageData(fallbackImageData, 0, 0);
    }
  }
  return canvas;
};
