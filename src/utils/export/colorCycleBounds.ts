import { toNum } from '@/utils/num';

export interface Size2D {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_DIMENSION = 1e-6;

const resolvePositiveDimension = (value: unknown, fallback = 1): number => {
  const numeric = toNum(value, fallback);
  return Math.max(1, Number.isFinite(numeric) ? numeric : fallback);
};

export const clampRectToDocument = (bounds: Rect, document: Size2D): Rect => {
  const docWidth = resolvePositiveDimension(document.width, 1);
  const docHeight = resolvePositiveDimension(document.height, 1);
  const x = Math.min(Math.max(toNum(bounds.x, 0), 0), docWidth);
  const y = Math.min(Math.max(toNum(bounds.y, 0), 0), docHeight);
  const availableWidth = Math.max(0, docWidth - x);
  const availableHeight = Math.max(0, docHeight - y);
  const desiredWidth = Math.max(toNum(bounds.width, MIN_DIMENSION), MIN_DIMENSION);
  const desiredHeight = Math.max(toNum(bounds.height, MIN_DIMENSION), MIN_DIMENSION);
  const width = Math.min(desiredWidth, availableWidth || desiredWidth);
  const height = Math.min(desiredHeight, availableHeight || desiredHeight);
  return {
    x,
    y,
    width,
    height
  };
};

export const scaleMaskBoundsToDocument = (maskBounds: Rect, maskSize: Size2D, document: Size2D): Rect => {
  const maskWidth = resolvePositiveDimension(maskSize.width, 1);
  const maskHeight = resolvePositiveDimension(maskSize.height, 1);
  const docWidth = resolvePositiveDimension(document.width, maskWidth);
  const docHeight = resolvePositiveDimension(document.height, maskHeight);
  const scaleX = docWidth / maskWidth;
  const scaleY = docHeight / maskHeight;

  const scaled: Rect = {
    x: toNum(maskBounds.x, 0) * scaleX,
    y: toNum(maskBounds.y, 0) * scaleY,
    width: toNum(maskBounds.width, maskWidth) * scaleX,
    height: toNum(maskBounds.height, maskHeight) * scaleY
  };

  return clampRectToDocument(scaled, document);
};

const isNonZero = (value: number | undefined): boolean => Number.isFinite(value) && value !== 0;

export const deriveCoverageFromIndexBuffer = (
  indexBuffer: ArrayLike<number> | null | undefined,
  width: number,
  height: number
): Rect | undefined => {
  if (!indexBuffer) {
    return undefined;
  }

  const normalizedWidth = Math.max(1, Math.floor(toNum(width, 0)));
  const normalizedHeight = Math.max(1, Math.floor(toNum(height, 0)));
  const total = normalizedWidth * normalizedHeight;
  const bufferLength = typeof indexBuffer.length === 'number' ? indexBuffer.length : 0;

  if (total === 0 || bufferLength === 0) {
    return undefined;
  }

  const limit = Math.min(bufferLength, total);
  let minX = normalizedWidth;
  let minY = normalizedHeight;
  let maxX = -1;
  let maxY = -1;

  for (let index = 0; index < limit; index += 1) {
    const value = Number((indexBuffer as ArrayLike<number>)[index]);
    if (!isNonZero(value)) {
      continue;
    }
    const y = Math.floor(index / normalizedWidth);
    const x = index - y * normalizedWidth;
    if (x < minX) {
      minX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y > maxY) {
      maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    return undefined;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
};
