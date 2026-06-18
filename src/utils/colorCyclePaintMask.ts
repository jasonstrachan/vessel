import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';

export type ColorCyclePaintSnapshot = {
  paintBuffer: ArrayBuffer;
  gradientIdBuffer?: ArrayBuffer;
  gradientDefIdBuffer?: ArrayBuffer;
  speedBuffer?: ArrayBuffer;
  flowBuffer?: ArrayBuffer;
  phaseBuffer?: ArrayBuffer;
};

export type ColorCyclePaintMask = {
  data: Uint8Array;
  width: number;
  height: number;
  bounds: CaptureRegion;
};

const clampMaskRoi = (
  roi: CaptureRegion | undefined,
  width: number,
  height: number
): CaptureRegion | null => {
  const maxWidth = Math.max(0, Math.floor(width));
  const maxHeight = Math.max(0, Math.floor(height));
  if (maxWidth <= 0 || maxHeight <= 0) {
    return null;
  }
  const source = roi ?? { x: 0, y: 0, width: maxWidth, height: maxHeight };
  const x = Math.max(0, Math.floor(source.x));
  const y = Math.max(0, Math.floor(source.y));
  const right = Math.min(maxWidth, Math.ceil(source.x + source.width));
  const bottom = Math.min(maxHeight, Math.ceil(source.y + source.height));
  if (right <= x || bottom <= y) {
    return null;
  }
  return { x, y, width: right - x, height: bottom - y };
};

const getU8 = (buffer: ArrayBuffer | undefined, index: number): number => {
  if (!buffer || index < 0 || index >= buffer.byteLength) {
    return 0;
  }
  return new Uint8Array(buffer)[index] ?? 0;
};

const getU16 = (buffer: ArrayBuffer | undefined, index: number): number => {
  if (!buffer || index < 0 || index >= buffer.byteLength / 2) {
    return 0;
  }
  return new Uint16Array(buffer)[index] ?? 0;
};

export const buildColorCyclePaintDeltaMask = ({
  before,
  after,
  roi,
  width,
  height,
}: {
  before: ColorCyclePaintSnapshot | null | undefined;
  after: ColorCyclePaintSnapshot | null | undefined;
  roi?: CaptureRegion;
  width: number;
  height: number;
}): ColorCyclePaintMask | null => {
  if (!after?.paintBuffer) {
    return null;
  }
  const bounds = clampMaskRoi(roi, width, height);
  if (!bounds) {
    return null;
  }
  const afterPaint = new Uint8Array(after.paintBuffer);
  const mask = new Uint8Array(bounds.width * bounds.height);
  let changedPixels = 0;
  for (let row = 0; row < bounds.height; row += 1) {
    const y = bounds.y + row;
    const fullRowOffset = y * width;
    const maskRowOffset = row * bounds.width;
    for (let col = 0; col < bounds.width; col += 1) {
      const x = bounds.x + col;
      const index = fullRowOffset + x;
      if (index < 0 || index >= afterPaint.length || afterPaint[index] === 0) {
        continue;
      }
      const changed =
        getU8(before?.paintBuffer, index) !== getU8(after.paintBuffer, index) ||
        getU8(before?.gradientIdBuffer, index) !== getU8(after.gradientIdBuffer, index) ||
        getU8(before?.speedBuffer, index) !== getU8(after.speedBuffer, index) ||
        getU8(before?.flowBuffer, index) !== getU8(after.flowBuffer, index) ||
        getU8(before?.phaseBuffer, index) !== getU8(after.phaseBuffer, index) ||
        getU16(before?.gradientDefIdBuffer, index) !== getU16(after.gradientDefIdBuffer, index);
      if (!changed) {
        continue;
      }
      mask[maskRowOffset + col] = 255;
      changedPixels += 1;
    }
  }
  if (changedPixels === 0) {
    return null;
  }
  return {
    data: mask,
    width: bounds.width,
    height: bounds.height,
    bounds,
  };
};
