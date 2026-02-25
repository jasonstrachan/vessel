import { BrushShape, type BrushSettings } from '@/types';

export type RasterAnchorMode = 'pixel-edge' | 'pixel-center';

type PixelAlignSettings = Pick<BrushSettings, 'brushShape' | 'antialiasing'>;
type ColorCycleRasterSettings = Pick<BrushSettings, 'brushShape' | 'colorCycleStampShape'>;

export const isColorCycleStrokeShape = (
  shape: BrushSettings['brushShape'] | undefined
): boolean => shape === BrushShape.COLOR_CYCLE || shape === BrushShape.COLOR_CYCLE_TRIANGLE;

export const shouldPixelAlignBrush = (
  settings: PixelAlignSettings | null | undefined
): boolean => {
  if (!settings) {
    return false;
  }
  if (settings.brushShape === BrushShape.PIXEL_ROUND || settings.brushShape === BrushShape.PIXEL_DITHER) {
    return true;
  }
  if (settings.brushShape === BrushShape.SQUARE && settings.antialiasing === false) {
    return true;
  }
  return isColorCycleStrokeShape(settings.brushShape);
};

export const alignPointToPixel = <T extends { x: number; y: number }>(
  point: T,
  shouldAlign: boolean
): T => {
  if (!shouldAlign) {
    return point;
  }
  const alignedX = Math.round(point.x);
  const alignedY = Math.round(point.y);
  if (alignedX === point.x && alignedY === point.y) {
    return point;
  }
  return { ...point, x: alignedX, y: alignedY };
};

export const resolveColorCycleRasterAnchor = (
  settings: ColorCycleRasterSettings
): RasterAnchorMode => {
  if (settings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE) {
    return 'pixel-center';
  }
  if (settings.brushShape === BrushShape.COLOR_CYCLE) {
    const stampShape = settings.colorCycleStampShape ?? 'square';
    if (stampShape === 'square') {
      return 'pixel-edge';
    }
    return 'pixel-center';
  }
  return 'pixel-edge';
};

export const quantizeToRasterPoint = (
  x: number,
  y: number,
  scaleX: number,
  scaleY: number,
  anchor: RasterAnchorMode
): { x: number; y: number } => {
  const scaledX = x * scaleX;
  const scaledY = y * scaleY;
  if (anchor === 'pixel-center') {
    return {
      x: Math.floor(scaledX) + 0.5,
      y: Math.floor(scaledY) + 0.5,
    };
  }
  return {
    x: Math.floor(scaledX),
    y: Math.floor(scaledY),
  };
};
