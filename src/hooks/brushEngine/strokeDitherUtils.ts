import { debugWarn } from '@/utils/debug';
import { BrushShape, type BrushSettings } from '@/types';
import { applySierraLiteLostEdgeMask } from '@/utils/ditherAlgorithms';
import { isColorCycleBrush } from '@/utils/colorCycleGradients';

import type { Rect } from './engineShared';

export const shouldApplyStrokeDitherForSettings = (settings: BrushSettings): boolean => {
  const shape = settings.brushShape;
  if (shape === BrushShape.CUSTOM) {
    return false;
  }
  if (isColorCycleBrush(shape)) {
    return false;
  }
  if (
    shape === BrushShape.RECTANGLE_GRADIENT ||
    shape === BrushShape.POLYGON_GRADIENT ||
    shape === BrushShape.SHAPE_FILL
  ) {
    return false;
  }
  return Boolean(settings.ditherEnabled);
};

export const applyLostEdgeToStrokeAlphaData = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  lostEdgePercent?: number
): void => {
  const percent = lostEdgePercent ?? 0;
  if (!percent || percent <= 0) return;

  const clamped = Math.max(0, Math.min(100, percent));
  const totalPixels = width * height;
  if (!totalPixels) return;

  const coverage = new Uint8Array(totalPixels);
  for (let i = 3, idx = 0; i < data.length; i += 4, idx++) {
    coverage[idx] = data[i];
  }

  let mask: Uint8ClampedArray;
  try {
    mask = applySierraLiteLostEdgeMask(coverage, width, height, clamped);
  } catch (error) {
    debugWarn('raw-console', '[Dither] Lost-edge mask failed (pre-dither):', error);
    return;
  }

  for (let i = 3, idx = 0; i < data.length; i += 4, idx++) {
    const value = mask[idx];
    data[i] = Math.round(data[i] * (value / 255));
  }
};

export const applyLostEdgeMaskInRegion = (
  ctx: CanvasRenderingContext2D,
  region: Rect | null,
  lostEdgePercent: number | undefined,
  applyLostEdgeToStrokeAlpha: (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    lostEdgePercent?: number
  ) => void
): void => {
  const percent = lostEdgePercent ?? 0;
  if (!ctx || !region || percent <= 0) return;

  const canvasWidth = ctx.canvas?.width ?? 0;
  const canvasHeight = ctx.canvas?.height ?? 0;
  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const width = Math.max(1, Math.min(canvasWidth - x, Math.ceil(region.width)));
  const height = Math.max(1, Math.min(canvasHeight - y, Math.ceil(region.height)));
  if (width <= 0 || height <= 0) return;

  let image: ImageData;
  try {
    image = ctx.getImageData(x, y, width, height);
  } catch {
    return;
  }

  applyLostEdgeToStrokeAlpha(image.data, width, height, percent);

  try {
    ctx.putImageData(image, x, y);
  } catch {
    // best effort; ignore failures to keep stroke alive
  }
};
