import { BrushShape, type BrushSettings } from '@/types';

import type { Rect } from './engineShared';

type CustomBrushData = {
  width?: number;
  height?: number;
  isResampler?: boolean;
};

export const estimateStrokeBounds = ({
  from,
  to,
  pressure = 1,
  customBrushData,
  brushSettings,
  clamp,
  inflateRect,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  pressure?: number;
  customBrushData?: CustomBrushData;
  brushSettings: BrushSettings;
  clamp: (value: number, min: number, max: number) => number;
  inflateRect: (rect: Rect, padding: number) => Rect;
}): Rect => {
  const brushSize = Math.max(brushSettings.size || 1, 1);
  const pressureFactor = Number.isFinite(pressure) ? Math.max(pressure, 1) : 1;
  let effectiveSize = brushSize * pressureFactor;

  if (brushSettings.brushShape === BrushShape.MOSAIC) {
    const tilePx = clamp(Math.round(brushSettings.mosaicTilePx ?? 8), 1, 128);
    const blocksCount = clamp(Math.round(brushSettings.mosaicBlocksCount ?? 6), 1, 32);
    const rows = 1;
    const stampW = tilePx * blocksCount;
    const stampH = tilePx * rows;
    const mosaicExtent = Math.max(stampW, stampH) * pressureFactor;
    effectiveSize = Math.max(effectiveSize, mosaicExtent);
  }

  if (customBrushData) {
    const maxDimension = Math.max(customBrushData.width || 0, customBrushData.height || 0);
    if (maxDimension > 0) {
      const stampSize = customBrushData.isResampler
        ? brushSize * pressureFactor
        : Math.max(1, (brushSize / 100) * maxDimension * pressureFactor);
      effectiveSize = Math.max(effectiveSize, stampSize);
    }
  }

  if (
    brushSettings.brushShape === BrushShape.PIXEL_DITHER &&
    (brushSettings.ditherStrokeTipShape === 'diamond' ||
      brushSettings.ditherStrokeTipShape === 'diamond5' ||
      brushSettings.ditherStrokeTipShape === 'diamond7' ||
      brushSettings.ditherStrokeTipShape === 'diamond9')
  ) {
    effectiveSize *= Math.SQRT2;
  }

  const spacing = brushSettings.spacing || 0;
  const halfExtent = Math.max(1, effectiveSize * 0.5);
  const safetyMargin = Math.max(halfExtent, spacing * 0.5, 32);
  const padding = halfExtent + safetyMargin;

  const minX = Math.min(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);

  return inflateRect(
    {
      x: minX,
      y: minY,
      width,
      height,
    },
    padding
  );
};
