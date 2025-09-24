export interface PixelContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clampAlphaThreshold = (threshold: number): number => {
  if (!Number.isFinite(threshold)) {
    return 0;
  }
  if (threshold <= 0) {
    return 0;
  }
  if (threshold >= 255) {
    return 255;
  }
  return Math.floor(threshold);
};

export const findContentBoundsInPixels = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 0
): PixelContentBounds | null => {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  if (w === 0 || h === 0) {
    return null;
  }
  if (pixels.length < w * h * 4) {
    return null;
  }

  const threshold = clampAlphaThreshold(alphaThreshold);

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  const stride = w * 4;

  for (let y = 0; y < h; y += 1) {
    const rowOffset = y * stride;
    for (let x = 0; x < w; x += 1) {
      const alpha = pixels[rowOffset + x * 4 + 3];
      if (alpha > threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
};

export const computeContentBoundsFromImageData = (
  imageData: ImageData,
  alphaThreshold = 0
): PixelContentBounds | null => {
  if (!imageData || typeof imageData.width !== 'number' || typeof imageData.height !== 'number') {
    return null;
  }
  return findContentBoundsInPixels(imageData.data, imageData.width, imageData.height, alphaThreshold);
};
