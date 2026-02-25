import type { Layer } from '@/types';
import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';

export type ShapeBeforeSnapshot =
  | { kind: 'full'; image: ImageData }
  | { kind: 'region'; image: ImageData; roi: CaptureRegion };

export const cloneImageData = (imageData: ImageData | null | undefined): ImageData | null => {
  if (!imageData) {
    return null;
  }
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
};

export const snapshotLayerImageData = (layer: Layer | null | undefined): ImageData | null => {
  if (!layer) {
    return null;
  }
  if (layer.imageData) {
    return cloneImageData(layer.imageData);
  }
  const framebuffer = layer.framebuffer;
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
    return fbCtx.getImageData(0, 0, framebuffer.width, framebuffer.height);
  } catch {
    return null;
  }
};

export const captureLayerRegionImageData = (
  layer: Layer | null | undefined,
  region: CaptureRegion | null | undefined
): ImageData | null => {
  if (!layer || !region) {
    return null;
  }
  const source = layer.imageData;
  const width = source?.width ?? layer.framebuffer?.width ?? 0;
  const height = source?.height ?? layer.framebuffer?.height ?? 0;
  if (width <= 0 || height <= 0) {
    return null;
  }
  const clampedX = Math.max(0, Math.min(Math.floor(region.x), width - 1));
  const clampedY = Math.max(0, Math.min(Math.floor(region.y), height - 1));
  const clampedWidth = Math.max(
    0,
    Math.min(Math.ceil(region.width), width - clampedX)
  );
  const clampedHeight = Math.max(
    0,
    Math.min(Math.ceil(region.height), height - clampedY)
  );
  if (clampedWidth <= 0 || clampedHeight <= 0) {
    return null;
  }

  if (source) {
    const target = new ImageData(clampedWidth, clampedHeight);
    const srcData = source.data;
    const targetData = target.data;
    const tgtStride = clampedWidth * 4;
    for (let row = 0; row < clampedHeight; row += 1) {
      const srcOffset = ((clampedY + row) * source.width + clampedX) * 4;
      const tgtOffset = row * tgtStride;
      const remaining = srcData.length - srcOffset;
      if (remaining <= 0) {
        break;
      }
      const copyLen = Math.min(tgtStride, remaining);
      targetData.set(srcData.subarray(srcOffset, srcOffset + copyLen), tgtOffset);
    }
    return target;
  }

  const framebuffer = layer.framebuffer;
  if (!framebuffer) {
    return null;
  }
  try {
    const ctx = framebuffer.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings
    ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx || !('getImageData' in ctx)) {
      return null;
    }
    return ctx.getImageData(clampedX, clampedY, clampedWidth, clampedHeight);
  } catch {
    return null;
  }
};

export const inflateShapeBeforeSnapshot = (
  layer: Layer | null | undefined,
  snapshot: ShapeBeforeSnapshot
): ImageData | null => {
  if (!snapshot) {
    return null;
  }
  const targetWidth = layer?.imageData?.width ?? layer?.framebuffer?.width ?? snapshot.image.width;
  const targetHeight = layer?.imageData?.height ?? layer?.framebuffer?.height ?? snapshot.image.height;
  if (!Number.isFinite(targetWidth) || !Number.isFinite(targetHeight) || targetWidth <= 0 || targetHeight <= 0) {
    return null;
  }

  if (snapshot.kind === 'full') {
    return cloneImageData(snapshot.image);
  }

  const roi = snapshot.roi;
  const source = snapshot.image.data;
  const base: ImageData = cloneImageData(layer?.imageData ?? null) ?? new ImageData(targetWidth, targetHeight);
  const baseData = base.data;
  const roiWidth = snapshot.image.width;
  const roiHeight = snapshot.image.height;
  const destX = Math.max(0, roi.x);
  const destY = Math.max(0, roi.y);
  const offsetX = destX - roi.x;
  const offsetY = destY - roi.y;
  const copyWidth = Math.min(roiWidth - offsetX, targetWidth - destX);
  const copyHeight = Math.min(roiHeight - offsetY, targetHeight - destY);
  if (copyWidth <= 0 || copyHeight <= 0) {
    return base;
  }
  for (let row = 0; row < copyHeight; row += 1) {
    const targetY = destY + row;
    const targetOffset = (targetY * targetWidth + destX) * 4;
    const srcOffset = ((row + offsetY) * roiWidth + offsetX) * 4;
    baseData.set(source.subarray(srcOffset, srcOffset + copyWidth * 4), targetOffset);
  }
  return base;
};

export const waitForNextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 16);
  });

export const ensureLayerSnapshotWithRetry = async (
  layer: Layer | null | undefined,
  existing: ImageData | null,
  maxAttempts: number = 3
): Promise<ImageData | null> => {
  if (existing) {
    return existing;
  }
  if (!layer) {
    return null;
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = snapshotLayerImageData(layer);
    if (snapshot) {
      return snapshot;
    }
    if (attempt < maxAttempts - 1) {
      await waitForNextFrame();
    }
  }
  return null;
};
