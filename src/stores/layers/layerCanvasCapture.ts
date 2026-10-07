import type { SelectionRasterScopeInput } from '@/stores/helpers/selectionRoi';
import type { CaptureROI } from '@/stores/useAppStore';

export type CompositeMode = 'alpha' | 'replace';

export const normalizeCaptureROI = (
  roi: CaptureROI | undefined,
  maxWidth: number,
  maxHeight: number
): CaptureROI | undefined => {
  if (!roi) {
    return undefined;
  }
  if (
    !Number.isFinite(roi.x) ||
    !Number.isFinite(roi.y) ||
    !Number.isFinite(roi.width) ||
    !Number.isFinite(roi.height)
  ) {
    return undefined;
  }
  if (roi.width <= 0 || roi.height <= 0) {
    return undefined;
  }
  const x = Math.max(0, Math.floor(roi.x));
  const y = Math.max(0, Math.floor(roi.y));
  const width = Math.max(1, Math.min(maxWidth - x, Math.ceil(roi.width)));
  const height = Math.max(1, Math.min(maxHeight - y, Math.ceil(roi.height)));
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
};

export const alphaCompositeImageDataRegion = (
  base: ImageData | null,
  region: ImageData,
  offsetX: number,
  offsetY: number,
  fullWidth: number,
  fullHeight: number,
  mode: CompositeMode = 'alpha',
  selection?: SelectionRasterScopeInput,
): ImageData => {
  const targetWidth = Math.max(1, fullWidth);
  const targetHeight = Math.max(1, fullHeight);
  const outData = new Uint8ClampedArray(targetWidth * targetHeight * 4);

  if (base) {
    const src = base.data;
    const copyWidth = Math.min(base.width, targetWidth);
    const copyHeight = Math.min(base.height, targetHeight);
    const srcStride = base.width * 4;
    const dstStride = targetWidth * 4;

    for (let row = 0; row < copyHeight; row += 1) {
      const srcRowStart = row * srcStride;
      const dstRowStart = row * dstStride;
      const rowLength = copyWidth * 4;
      outData.set(src.subarray(srcRowStart, srcRowStart + rowLength), dstRowStart);
    }
  }

  const src = region.data;
  const srcStride = region.width * 4;
  const mask = selection?.selectionMask;
  const maskBounds = selection?.selectionMaskBounds;
  const selectionRect = selection?.selectionStart && selection.selectionEnd
    ? {
        minX: Math.min(selection.selectionStart.x, selection.selectionEnd.x),
        maxX: Math.max(selection.selectionStart.x, selection.selectionEnd.x),
        minY: Math.min(selection.selectionStart.y, selection.selectionEnd.y),
        maxY: Math.max(selection.selectionStart.y, selection.selectionEnd.y),
      }
    : null;

  for (let row = 0; row < region.height; row += 1) {
    const dstRow = offsetY + row;
    if (dstRow < 0 || dstRow >= targetHeight) {
      continue;
    }

    for (let col = 0; col < region.width; col += 1) {
      const dstCol = offsetX + col;
      if (dstCol < 0 || dstCol >= targetWidth) {
        continue;
      }

      if (mask && maskBounds) {
        const maskX = Math.floor(dstCol - maskBounds.x);
        const maskY = Math.floor(dstRow - maskBounds.y);
        if (maskX < 0 || maskY < 0 || maskX >= mask.width || maskY >= mask.height ||
            mask.data[(maskY * mask.width + maskX) * 4 + 3] === 0) {
          continue;
        }
      } else if (selectionRect) {
        if (dstCol < selectionRect.minX || dstCol >= selectionRect.maxX ||
            dstRow < selectionRect.minY || dstRow >= selectionRect.maxY) {
          continue;
        }
      }

      const srcIndex = row * srcStride + col * 4;
      const srcAlpha8 = src[srcIndex + 3];

      const dstIndex = (dstRow * targetWidth + dstCol) * 4;

      if (mode === 'replace') {
        outData[dstIndex] = src[srcIndex];
        outData[dstIndex + 1] = src[srcIndex + 1];
        outData[dstIndex + 2] = src[srcIndex + 2];
        outData[dstIndex + 3] = srcAlpha8;
        continue;
      }

      if (srcAlpha8 === 0) {
        continue;
      }

      const srcAlpha = srcAlpha8 / 255;
      const invSrcAlpha = 1 - srcAlpha;

      const dstAlpha = outData[dstIndex + 3] / 255;
      const outAlpha = srcAlpha + dstAlpha * invSrcAlpha;

      const dstR = outData[dstIndex];
      const dstG = outData[dstIndex + 1];
      const dstB = outData[dstIndex + 2];

      const srcR = src[srcIndex];
      const srcG = src[srcIndex + 1];
      const srcB = src[srcIndex + 2];

      const outR = srcR * srcAlpha + dstR * invSrcAlpha;
      const outG = srcG * srcAlpha + dstG * invSrcAlpha;
      const outB = srcB * srcAlpha + dstB * invSrcAlpha;

      outData[dstIndex] = Math.round(outR);
      outData[dstIndex + 1] = Math.round(outG);
      outData[dstIndex + 2] = Math.round(outB);
      outData[dstIndex + 3] = Math.round(outAlpha * 255);
    }
  }
  return new ImageData(outData, targetWidth, targetHeight);
};
