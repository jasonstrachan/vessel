import { BrushShape, type BrushSettings, type Layer, type SequentialLayerData, type SequentialStrokeEvent } from '@/types';

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
};

export const findOpaqueMaskBounds = (imageData: ImageData): { x: number; y: number; width: number; height: number } | null => {
  const { width, height, data } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (data[rowOffset + x * 4 + 3] === 0) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
};

export const cropImageDataToBounds = (
  imageData: ImageData,
  bounds: { x: number; y: number; width: number; height: number }
): ImageData => {
  const cropped = new ImageData(bounds.width, bounds.height);

  for (let y = 0; y < bounds.height; y += 1) {
    const sourceStart = ((bounds.y + y) * imageData.width + bounds.x) * 4;
    const sourceEnd = sourceStart + bounds.width * 4;
    cropped.data.set(
      imageData.data.subarray(sourceStart, sourceEnd),
      y * bounds.width * 4
    );
  }

  return cropped;
};

export const createSequentialSelectionMask = ({
  bounds,
  selectionMask,
  selectionMaskBounds,
}: {
  bounds: { x: number; y: number; width: number; height: number };
  selectionMask: ImageData | null;
  selectionMaskBounds: { x: number; y: number; width: number; height: number } | null;
}): ImageData | null => {
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  const mask = new ImageData(width, height);

  if (!selectionMask || !selectionMaskBounds) {
    for (let i = 0; i < mask.data.length; i += 4) {
      mask.data[i] = 255;
      mask.data[i + 1] = 255;
      mask.data[i + 2] = 255;
      mask.data[i + 3] = 255;
    }
    return mask;
  }

  for (let y = 0; y < height; y += 1) {
    const globalY = bounds.y + y;
    const localMaskY = globalY - selectionMaskBounds.y;
    if (localMaskY < 0 || localMaskY >= selectionMask.height) {
      continue;
    }
    for (let x = 0; x < width; x += 1) {
      const globalX = bounds.x + x;
      const localMaskX = globalX - selectionMaskBounds.x;
      if (localMaskX < 0 || localMaskX >= selectionMask.width) {
        continue;
      }
      const sourceAlpha = selectionMask.data[(localMaskY * selectionMask.width + localMaskX) * 4 + 3];
      if (sourceAlpha === 0) {
        continue;
      }
      const destIndex = (y * width + x) * 4;
      mask.data[destIndex] = 255;
      mask.data[destIndex + 1] = 255;
      mask.data[destIndex + 2] = 255;
      mask.data[destIndex + 3] = sourceAlpha;
    }
  }

  return findOpaqueMaskBounds(mask) ? mask : null;
};

export const createSequentialEraseMaskFromDiff = ({
  beforeImage,
  afterImage,
  bounds,
}: {
  beforeImage: ImageData;
  afterImage: ImageData;
  bounds: { x: number; y: number; width: number; height: number };
}): ImageData | null => {
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  const mask = new ImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    const beforeRow = (y * beforeImage.width) * 4;
    const afterRow = (y * afterImage.width) * 4;
    for (let x = 0; x < width; x += 1) {
      const beforeIndex = beforeRow + x * 4;
      const afterIndex = afterRow + x * 4;
      const beforeAlpha = beforeImage.data[beforeIndex + 3];
      const afterAlpha = afterImage.data[afterIndex + 3];
      if (beforeAlpha <= 0 || afterAlpha >= beforeAlpha) {
        continue;
      }

      const eraseAlpha = Math.round(255 * (1 - afterAlpha / beforeAlpha));
      if (eraseAlpha <= 0) {
        continue;
      }

      const destIndex = (y * width + x) * 4;
      mask.data[destIndex] = 255;
      mask.data[destIndex + 1] = 255;
      mask.data[destIndex + 2] = 255;
      mask.data[destIndex + 3] = eraseAlpha;
    }
  }

  return findOpaqueMaskBounds(mask) ? mask : null;
};

export const buildSequentialDestinationOutEvent = ({
  layer,
  frameIndex,
  maskImageData,
  maskBounds,
  eraserSettings,
  timestampMs,
  id,
  strokeId,
}: {
  layer: Layer;
  frameIndex: number;
  maskImageData: ImageData;
  maskBounds: { x: number; y: number; width: number; height: number };
  eraserSettings: BrushSettings;
  timestampMs: number;
  id: string;
  strokeId: string;
}): SequentialStrokeEvent => {
  const sanitizedOpacity = clamp01(eraserSettings.opacity ?? 1);
  const stamps = [];

  for (let y = 0; y < maskImageData.height; y += 1) {
    const rowOffset = y * maskImageData.width * 4;
    for (let x = 0; x < maskImageData.width; x += 1) {
      const alpha = maskImageData.data[rowOffset + x * 4 + 3];
      if (alpha <= 0) {
        continue;
      }
      stamps.push({
        x: maskBounds.x + x + 0.5,
        y: maskBounds.y + y + 0.5,
        pressure: 1,
        rotation: 0,
        size: 1,
        alpha: clamp01((alpha / 255) * sanitizedOpacity),
      });
    }
  }

  return {
    id,
    layerId: layer.id,
    strokeId,
    timestampMs,
    frameIndex,
    brush: {
      tool: 'eraser',
      brushShape: BrushShape.SQUARE,
      size: 1,
      opacity: sanitizedOpacity,
      blendMode: 'destination-out',
      rotation: 0,
      spacing: 1,
      color: eraserSettings.color ?? '#ffffff',
    },
    stamps,
  };
};

export const appendSequentialEvent = (
  data: SequentialLayerData,
  event: SequentialStrokeEvent
): SequentialLayerData => ({
  ...data,
  events: [...data.events, event],
});
