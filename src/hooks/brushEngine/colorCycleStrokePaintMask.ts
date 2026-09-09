import studioExtension from '@/extensions/studioExtension';
import type { StudioStrokePaintMask } from '@/extensions/studioExtensionTypes';
import { getAppStoreState } from '@/stores/appStoreAccess';

import type { CcPencilMask } from './ccPencilPressure';

export const createColorCycleStrokePaintMask = (): StudioStrokePaintMask | null => {
  if (!studioExtension.createColorCycleStrokePaintMask) return null;
  const state = getAppStoreState();
  return studioExtension.createColorCycleStrokePaintMask({
    currentTool: state.tools.currentTool,
    presetId: state.currentBrushPreset?.id ?? null,
    brushSettings: state.tools.brushSettings,
  });
};

type StampMask = CcPencilMask & { originX: number; originY: number };
const tiles = new WeakMap<StudioStrokePaintMask, Uint8Array>();

/** Reuse the native tile-mask writer; the tile covers the entire stamp without wrapping. */
export const createColorCycleStampPaintMask = (
  mask: StudioStrokePaintMask,
  x: number,
  y: number,
  brushSize: number,
  pencil?: CcPencilMask,
): StampMask => {
  // Pixelated tips round to multiples of up to nine pixels, including at size one.
  const size = Math.ceil(Math.max(9, brushSize) + 12);
  let tile = tiles.get(mask);
  if (!tile || tile.length < size * size) {
    tile = new Uint8Array(size * size);
    tiles.set(mask, tile);
  }
  const originX = Math.floor(x - size / 2);
  const originY = Math.floor(y - size / 2);
  const accepts = pencil
    ? (px: number, py: number) => mask.acceptsPixel(px, py) && pencil.accepts(px, py)
    : mask.acceptsPixel;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      tile[py * size + px] = accepts(originX + px, originY + py) ? 1 : 0;
    }
  }
  return { tile, size, accepts, originX, originY };
};
