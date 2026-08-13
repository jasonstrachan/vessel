import type { Rectangle } from '@/types';

export interface SelectionRasterScopeInput {
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
  selectionMask: ImageData | null;
  selectionMaskBounds: Rectangle | null;
}

export interface SelectionRasterScope {
  bounds: Rectangle | null;
  selectionMask: ImageData | null;
  selectionMaskBounds: Rectangle | null;
}

interface SelectionFillColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const hasVisibleSelectionMask = (selectionMask: ImageData | null): boolean => {
  if (!selectionMask) {
    return false;
  }

  for (let index = 3; index < selectionMask.data.length; index += 4) {
    if ((selectionMask.data[index] ?? 0) > 0) {
      return true;
    }
  }

  return false;
};

export interface AdjustedSelectionMask {
  mask: ImageData;
  bounds: Rectangle;
}

export const adjustSelectionMaskByPixels = (
  selectionMask: ImageData,
  selectionMaskBounds: Rectangle,
  delta: number,
  imageWidth: number,
  imageHeight: number,
): AdjustedSelectionMask | null => {
  if (
    !Number.isFinite(delta) ||
    delta === 0 ||
    selectionMask.width <= 0 ||
    selectionMask.height <= 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return null;
  }

  const amount = Math.floor(Math.abs(delta));
  if (amount === 0) {
    return null;
  }

  const sourceWidth = selectionMask.width;
  const sourceHeight = selectionMask.height;
  const integralStride = sourceWidth + 1;
  const selectedIntegral = new Uint32Array((sourceWidth + 1) * (sourceHeight + 1));

  for (let y = 1; y <= sourceHeight; y += 1) {
    let selectedInRow = 0;
    for (let x = 1; x <= sourceWidth; x += 1) {
      const alphaIndex = ((y - 1) * sourceWidth + (x - 1)) * 4 + 3;
      if ((selectionMask.data[alphaIndex] ?? 0) > 0) {
        selectedInRow += 1;
      }
      selectedIntegral[y * integralStride + x] =
        selectedIntegral[(y - 1) * integralStride + x] + selectedInRow;
    }
  }

  const selectedCountInRect = (left: number, top: number, right: number, bottom: number): number =>
    selectedIntegral[bottom * integralStride + right] -
    selectedIntegral[top * integralStride + right] -
    selectedIntegral[bottom * integralStride + left] +
    selectedIntegral[top * integralStride + left];

  const sourceX = Math.floor(selectionMaskBounds.x);
  const sourceY = Math.floor(selectionMaskBounds.y);
  const isExpand = delta > 0;
  const candidateLeft = Math.max(0, sourceX - (isExpand ? amount : 0));
  const candidateTop = Math.max(0, sourceY - (isExpand ? amount : 0));
  const candidateRight = Math.min(imageWidth, sourceX + sourceWidth + (isExpand ? amount : 0));
  const candidateBottom = Math.min(imageHeight, sourceY + sourceHeight + (isExpand ? amount : 0));
  const candidateWidth = candidateRight - candidateLeft;
  const candidateHeight = candidateBottom - candidateTop;

  if (candidateWidth <= 0 || candidateHeight <= 0) {
    return null;
  }

  const candidateMask = new ImageData(candidateWidth, candidateHeight);
  let selectedMinX = candidateWidth;
  let selectedMinY = candidateHeight;
  let selectedMaxX = -1;
  let selectedMaxY = -1;
  const requiredInsetCount = (amount * 2 + 1) ** 2;

  for (let y = 0; y < candidateHeight; y += 1) {
    const sourceCenterY = candidateTop + y - sourceY;
    for (let x = 0; x < candidateWidth; x += 1) {
      const sourceCenterX = candidateLeft + x - sourceX;
      const queryLeft = sourceCenterX - amount;
      const queryTop = sourceCenterY - amount;
      const queryRight = sourceCenterX + amount + 1;
      const queryBottom = sourceCenterY + amount + 1;
      const clippedLeft = Math.max(0, queryLeft);
      const clippedTop = Math.max(0, queryTop);
      const clippedRight = Math.min(sourceWidth, queryRight);
      const clippedBottom = Math.min(sourceHeight, queryBottom);

      let isSelected = false;
      if (clippedLeft < clippedRight && clippedTop < clippedBottom) {
        const selectedCount = selectedCountInRect(
          clippedLeft,
          clippedTop,
          clippedRight,
          clippedBottom,
        );
        isSelected = isExpand
          ? selectedCount > 0
          : queryLeft >= 0 &&
            queryTop >= 0 &&
            queryRight <= sourceWidth &&
            queryBottom <= sourceHeight &&
            selectedCount === requiredInsetCount;
      }

      if (!isSelected) {
        continue;
      }

      const targetIndex = (y * candidateWidth + x) * 4;
      candidateMask.data[targetIndex] = 255;
      candidateMask.data[targetIndex + 1] = 255;
      candidateMask.data[targetIndex + 2] = 255;
      candidateMask.data[targetIndex + 3] = 255;
      if (x < selectedMinX) selectedMinX = x;
      if (y < selectedMinY) selectedMinY = y;
      if (x > selectedMaxX) selectedMaxX = x;
      if (y > selectedMaxY) selectedMaxY = y;
    }
  }

  if (selectedMaxX < selectedMinX || selectedMaxY < selectedMinY) {
    return null;
  }

  const width = selectedMaxX - selectedMinX + 1;
  const height = selectedMaxY - selectedMinY + 1;
  const mask = new ImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((selectedMinY + y) * candidateWidth + selectedMinX) * 4;
    const sourceEnd = sourceStart + width * 4;
    mask.data.set(candidateMask.data.subarray(sourceStart, sourceEnd), y * width * 4);
  }

  return {
    mask,
    bounds: {
      x: candidateLeft + selectedMinX,
      y: candidateTop + selectedMinY,
      width,
      height,
    },
  };
};

export const clampMarqueeDragRectToBounds = (
  start: { x: number; y: number } | null,
  end: { x: number; y: number } | null,
  imageWidth: number,
  imageHeight: number
): Rectangle | null => {
  if (!start || !end) {
    return null;
  }

  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  const x = Math.max(0, Math.min(imageWidth, minX));
  const y = Math.max(0, Math.min(imageHeight, minY));
  const right = Math.max(0, Math.min(imageWidth, maxX));
  const bottom = Math.max(0, Math.min(imageHeight, maxY));
  const width = right - x;
  const height = bottom - y;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
};

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

export const resolveSelectionRasterScope = (
  selection: SelectionRasterScopeInput,
  imageWidth: number,
  imageHeight: number
): SelectionRasterScope => {
  if (selection.selectionMask && selection.selectionMaskBounds) {
    return {
      bounds: clampSelectionBounds(selection.selectionMaskBounds, imageWidth, imageHeight),
      selectionMask: selection.selectionMask,
      selectionMaskBounds: selection.selectionMaskBounds,
    };
  }

  const rectBounds =
    selection.selectionStart && selection.selectionEnd
      ? {
          x: Math.min(selection.selectionStart.x, selection.selectionEnd.x),
          y: Math.min(selection.selectionStart.y, selection.selectionEnd.y),
          width: Math.abs(selection.selectionEnd.x - selection.selectionStart.x),
          height: Math.abs(selection.selectionEnd.y - selection.selectionStart.y),
        }
      : null;

  return {
    bounds: clampSelectionBounds(rectBounds, imageWidth, imageHeight),
    selectionMask: null,
    selectionMaskBounds: null,
  };
};

const isMaskPixelSelected = (
  x: number,
  y: number,
  selectionMask: ImageData | null,
  selectionMaskBounds: Rectangle | null
): boolean => {
  if (!selectionMask || !selectionMaskBounds) {
    return true;
  }

  const localX = x - Math.floor(selectionMaskBounds.x);
  const localY = y - Math.floor(selectionMaskBounds.y);
  if (
    localX < 0 ||
    localY < 0 ||
    localX >= selectionMask.width ||
    localY >= selectionMask.height
  ) {
    return false;
  }

  const alphaIndex = (Math.floor(localY) * selectionMask.width + Math.floor(localX)) * 4 + 3;
  return (selectionMask.data[alphaIndex] ?? 0) > 0;
};

export const fillRasterWithinSelection = (
  target: ImageData,
  bounds: Rectangle,
  fillColor: SelectionFillColor,
  selectionMask: ImageData | null,
  selectionMaskBounds: Rectangle | null
): Rectangle | null => {
  const startX = Math.max(0, Math.floor(bounds.x));
  const startY = Math.max(0, Math.floor(bounds.y));
  const endX = Math.min(target.width, Math.ceil(bounds.x + bounds.width));
  const endY = Math.min(target.height, Math.ceil(bounds.y + bounds.height));
  let minX = target.width;
  let minY = target.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      if (!isMaskPixelSelected(x, y, selectionMask, selectionMaskBounds)) {
        continue;
      }

      const index = (y * target.width + x) * 4;
      if (
        target.data[index] === fillColor.r &&
        target.data[index + 1] === fillColor.g &&
        target.data[index + 2] === fillColor.b &&
        target.data[index + 3] === fillColor.a
      ) {
        continue;
      }

      target.data[index] = fillColor.r;
      target.data[index + 1] = fillColor.g;
      target.data[index + 2] = fillColor.b;
      target.data[index + 3] = fillColor.a;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  return maxX >= minX && maxY >= minY
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : null;
};

export const copyRectWithinSelection = (
  source: ImageData,
  target: ImageData,
  bounds: Rectangle,
  selectionMask: ImageData | null,
  selectionMaskBounds: Rectangle | null
): void => {
  const startX = Math.max(0, Math.floor(bounds.x));
  const startY = Math.max(0, Math.floor(bounds.y));
  const endX = Math.min(source.width, target.width, Math.ceil(bounds.x + bounds.width));
  const endY = Math.min(source.height, target.height, Math.ceil(bounds.y + bounds.height));

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      if (!isMaskPixelSelected(x, y, selectionMask, selectionMaskBounds)) {
        continue;
      }

      const index = (y * source.width + x) * 4;
      target.data[index] = source.data[index];
      target.data[index + 1] = source.data[index + 1];
      target.data[index + 2] = source.data[index + 2];
      target.data[index + 3] = source.data[index + 3];
    }
  }
};

export const blitImageDataWithinSelection = (
  source: ImageData,
  target: ImageData,
  destX: number,
  destY: number,
  selectionMask: ImageData | null,
  selectionMaskBounds: Rectangle | null
): void => {
  for (let y = 0; y < source.height; y += 1) {
    const targetY = destY + y;
    if (targetY < 0 || targetY >= target.height) {
      continue;
    }

    for (let x = 0; x < source.width; x += 1) {
      const targetX = destX + x;
      if (targetX < 0 || targetX >= target.width) {
        continue;
      }
      if (!isMaskPixelSelected(targetX, targetY, selectionMask, selectionMaskBounds)) {
        continue;
      }

      const sourceIndex = (y * source.width + x) * 4;
      const targetIndex = (targetY * target.width + targetX) * 4;
      target.data[targetIndex] = source.data[sourceIndex];
      target.data[targetIndex + 1] = source.data[sourceIndex + 1];
      target.data[targetIndex + 2] = source.data[sourceIndex + 2];
      target.data[targetIndex + 3] = source.data[sourceIndex + 3];
    }
  }
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
