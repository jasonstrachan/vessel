import studioExtension from '@/extensions/studioExtension';
import type { StudioStrokePaintMask } from '@/extensions/studioExtensionTypes';
import { getAppStoreState } from '@/stores/appStoreAccess';

import { visitStrokeStampPixels } from './strokeDefClear';
import type { StampShape } from './colorCycleBrushContracts';

import type { CcPencilMask } from './ccPencilPressure';

export const createColorCycleStrokePaintMask = (
  layerId: string, width: number, height: number, paint: Uint8Array,
): StudioStrokePaintMask | null => {
  if (!studioExtension.createColorCycleStrokePaintMask) return null;
  const state = getAppStoreState();
  return studioExtension.createColorCycleStrokePaintMask({
    currentTool: state.tools.currentTool,
    presetId: state.currentBrushPreset?.id ?? null,
    brushSettings: state.tools.brushSettings,
    readSourceCoverage: () => {
      const data = Uint8Array.from(paint, (value) => value > 0 ? 1 : 0);
      const layer = state.layers.find((candidate) => candidate.id === layerId);
      const cc = layer?.colorCycleData;
      const erase = cc?.eraseMask?.getContext('2d')?.getImageData(0, 0, width, height)
        ?? cc?.eraseMaskImageData;
      const soft = cc?.softEdgeMaskEnabled
        ? cc.softEdgeMask?.getContext('2d')?.getImageData(0, 0, width, height) ?? cc.softEdgeMaskImageData
        : undefined;
      for (let i = 0; i < data.length; i += 1) {
        if (erase?.data[i * 4 + 3] === 255 || (soft && soft.data[i * 4 + 3] === 0)) data[i] = 0;
      }
      return { width, height, data };
    },
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

const footprints = new WeakMap<StudioStrokePaintMask, Uint8Array>();

export const prepareColorCycleStrokePaintMask = (
  mask: StudioStrokePaintMask, x: number, y: number, brushSize: number,
  shape: StampShape, width: number, height: number,
): void => {
  if (!mask.prepareStamp) return;
  const size = Math.ceil(Math.max(9, brushSize) + 12);
  let data = footprints.get(mask);
  if (!data || data.length < size * size) {
    data = new Uint8Array(size * size);
    footprints.set(mask, data);
  } else data.fill(0, 0, size * size);
  const originX = Math.floor(x - size / 2);
  const originY = Math.floor(y - size / 2);
  const tile = data;
  visitStrokeStampPixels({ width, height, x, y, brushSize, shape }, (px, py) => {
    tile[(py - originY) * size + px - originX] = 1;
  });
  mask.prepareStamp({ x, y, size: brushSize, footprint: { originX, originY, size, data } });
};
