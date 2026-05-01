export const STAMP_MASK_ROTATION_TOLERANCE = Math.PI / 180;
export const STAMP_MASK_CACHE_LIMIT = 80;

export const quantizeStampMaskRotation = (rotation: number): number => {
  if (!Number.isFinite(rotation) || Math.abs(rotation) < STAMP_MASK_ROTATION_TOLERANCE * 0.5) {
    return 0;
  }
  return Math.round(rotation / STAMP_MASK_ROTATION_TOLERANCE);
};

export const buildStampMaskCacheKey = ({
  cacheKey,
  imageWidth,
  imageHeight,
  width,
  height,
  rotation,
}: {
  cacheKey?: string;
  imageWidth: number;
  imageHeight: number;
  width: number;
  height: number;
  rotation: number;
}): string => {
  const baseKey = cacheKey || `anon:${imageWidth}x${imageHeight}`;
  const rotationBucket = quantizeStampMaskRotation(rotation);
  return `${baseKey}:${width}x${height}:rot=${rotationBucket}`;
};

export const stampMaskHasVisiblePixels = (alpha: Uint8Array, threshold = 16): boolean =>
  alpha.some((value) => value >= threshold);
