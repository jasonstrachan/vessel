import type { Layer, Rectangle } from '@/types';
import { getMaskedColorCycleCanvas } from '@/utils/colorCycleCoverage';

/** Freeze visible pixels before clearing; indexed transfer keeps its separate masks. */
export const captureColorCycleSelectionBitmap = ({
  layer,
  sourceImageData,
  bounds,
  selectionMask,
  selectionMaskBounds,
}: {
  layer: Layer;
  sourceImageData: ImageData | null;
  bounds: Rectangle;
  selectionMask: ImageData | null;
  selectionMaskBounds: Rectangle | null;
}): ImageData | null => {
  let source = layer.colorCycleData?.canvas;
  if (!source) {
    if (!sourceImageData) return null;
    source = document.createElement('canvas');
    source.width = sourceImageData.width;
    source.height = sourceImageData.height;
    const ctx = source.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(sourceImageData, 0, 0);
  }
  // Use the canonical surface, never a transient Studio presentation override.
  const covered = getMaskedColorCycleCanvas(source, layer, 'abort');
  const ctx = covered?.getContext('2d', { willReadFrequently: true }) as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
  if (!ctx) return null;
  const image = ctx.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
  if (selectionMask && selectionMaskBounds) {
    for (let y = 0; y < bounds.height; y += 1) {
      for (let x = 0; x < bounds.width; x += 1) {
        const mx = bounds.x + x - selectionMaskBounds.x;
        const my = bounds.y + y - selectionMaskBounds.y;
        const alpha = mx >= 0 && my >= 0 && mx < selectionMask.width && my < selectionMask.height
          ? selectionMask.data[(my * selectionMask.width + mx) * 4 + 3] : 0;
        const offset = (y * bounds.width + x) * 4;
        if (!alpha) image.data.fill(0, offset, offset + 4);
        else image.data[offset + 3] = Math.round(image.data[offset + 3] * alpha / 255);
      }
    }
  }
  return image;
};

export interface ColorCycleSelectionMasks {
  membership: Uint8Array;
  eraseAlpha: Uint8Array | null;
  softEdgeAlpha: Uint8Array | null;
}

export const captureColorCycleSelectionMasks = (
  layer: Layer,
  bounds: Rectangle,
  selectionMask: ImageData | null,
  selectionMaskBounds: Rectangle | null,
): ColorCycleSelectionMasks => {
  const membership = new Uint8Array(bounds.width * bounds.height);
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const mx = bounds.x + x - (selectionMaskBounds?.x ?? 0);
      const my = bounds.y + y - (selectionMaskBounds?.y ?? 0);
      membership[y * bounds.width + x] = !selectionMask || !selectionMaskBounds ||
        (mx >= 0 && my >= 0 && mx < selectionMask.width && my < selectionMask.height &&
          selectionMask.data[(my * selectionMask.width + mx) * 4 + 3] > 0) ? 255 : 0;
    }
  }
  const readAlpha = (field: 'eraseMask' | 'softEdgeMask'): Uint8Array | null => {
    const mask = layer.colorCycleData?.[field];
    const ctx = mask?.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const rgba = ctx.getImageData(bounds.x, bounds.y, bounds.width, bounds.height).data;
    return Uint8Array.from(membership, (_, index) => rgba[index * 4 + 3]);
  };
  return { membership, eraseAlpha: readAlpha('eraseMask'), softEdgeAlpha: readAlpha('softEdgeMask') };
};

/** Membership is independent of visible alpha: fully erased indexed cells still move. */
export const writeColorCycleSelectionMasks = (
  layer: Layer,
  project: { width: number; height: number },
  bounds: Rectangle,
  masks: ColorCycleSelectionMasks,
  clear = false,
): Partial<NonNullable<Layer['colorCycleData']>> => {
  const patch: Partial<NonNullable<Layer['colorCycleData']>> = {};
  for (const field of ['eraseMask', 'softEdgeMask'] as const) {
    const versionField = field === 'eraseMask' ? 'eraseMaskVersion' : 'softEdgeMaskVersion';
    const alpha = field === 'eraseMask' ? masks.eraseAlpha : masks.softEdgeAlpha;
    const defaultAlpha = field === 'eraseMask' ? 0 : 255;
    let mask = layer.colorCycleData?.[field];
    if (!mask && (clear || !alpha)) continue;
    if (!mask) {
      mask = document.createElement('canvas');
      mask.width = project.width;
      mask.height = project.height;
      if (defaultAlpha) {
        const ctx = mask.getContext('2d');
        if (ctx) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, mask.width, mask.height); }
      }
    }
    const ctx = mask.getContext('2d', { willReadFrequently: true });
    if (!ctx) continue;
    const image = ctx.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
    let changed = false;
    for (let i = 0; i < masks.membership.length; i += 1) {
      if (!masks.membership[i]) continue;
      const next = clear ? 0 : alpha?.[i] ?? defaultAlpha;
      if (image.data[i * 4 + 3] === next) continue;
      image.data.set([next ? 255 : 0, next ? 255 : 0, next ? 255 : 0, next], i * 4);
      changed = true;
    }
    if (!changed) continue;
    ctx.putImageData(image, bounds.x, bounds.y);
    patch[field] = mask;
    patch[versionField] = (layer.colorCycleData?.[versionField] ?? 0) + 1;
  }
  return patch;
};
