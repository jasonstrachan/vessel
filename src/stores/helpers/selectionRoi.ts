import type { Rectangle } from '@/types';

export const clampSelectionBounds = (
  bounds: Rectangle | null,
  imageWidth: number,
  imageHeight: number
): Rectangle | null => {
  if (!bounds) {
    return null;
  }

  const width = Math.ceil(bounds.width);
  const height = Math.ceil(bounds.height);
  if (width <= 0 || height <= 0) {
    return null;
  }

  const x = Math.max(0, Math.min(imageWidth - 1, Math.floor(bounds.x)));
  const y = Math.max(0, Math.min(imageHeight - 1, Math.floor(bounds.y)));
  const clampedWidth = Math.min(width, imageWidth - x);
  const clampedHeight = Math.min(height, imageHeight - y);

  if (clampedWidth <= 0 || clampedHeight <= 0) {
    return null;
  }

  return {
    x,
    y,
    width: clampedWidth,
    height: clampedHeight,
  };
};

export const copyRegionIntoTarget = (source: ImageData, target: ImageData, bounds: Rectangle): void => {
  const srcData = source.data;
  const tgtData = target.data;
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const targetWidth = target.width;
  const targetHeight = target.height;

  const startX = Math.max(0, Math.min(sourceWidth, Math.floor(bounds.x)));
  const startY = Math.max(0, Math.min(sourceHeight, Math.floor(bounds.y)));
  const endX = Math.min(sourceWidth, Math.ceil(bounds.x + bounds.width));
  const endY = Math.min(sourceHeight, Math.ceil(bounds.y + bounds.height));

  for (let y = startY; y < endY && y < targetHeight; y += 1) {
    for (let x = startX; x < endX && x < targetWidth; x += 1) {
      const srcIndex = (y * sourceWidth + x) * 4;
      const targetIndex = (y * targetWidth + x) * 4;

      tgtData[targetIndex] = srcData[srcIndex];
      tgtData[targetIndex + 1] = srcData[srcIndex + 1];
      tgtData[targetIndex + 2] = srcData[srcIndex + 2];
      tgtData[targetIndex + 3] = srcData[srcIndex + 3];
    }
  }
};
