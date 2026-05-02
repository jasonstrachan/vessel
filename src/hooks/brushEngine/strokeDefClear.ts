import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import type { StampDitherShape } from './strokeStampDither';

type StrokeDefBuffers = {
  paint: Uint8Array;
  gid: Uint8Array;
  def: Uint16Array;
};

export type ClearStrokeDefIdsForStampArgs = {
  buffers: StrokeDefBuffers;
  width: number;
  height: number;
  x: number;
  y: number;
  brushSize: number;
  flowSlot: number;
  shape: StampDitherShape;
};

const DIAMOND_5_MASK: ReadonlyArray<number> = [
  0, 0, 1, 0, 0,
  0, 1, 1, 1, 0,
  1, 1, 1, 1, 1,
  0, 1, 1, 1, 0,
  0, 0, 1, 0, 0,
];

const DIAMOND_7_MASK: ReadonlyArray<number> = [
  0, 0, 0, 1, 0, 0, 0,
  0, 0, 1, 1, 1, 0, 0,
  0, 1, 1, 1, 1, 1, 0,
  1, 1, 1, 1, 1, 1, 1,
  0, 1, 1, 1, 1, 1, 0,
  0, 0, 1, 1, 1, 0, 0,
  0, 0, 0, 1, 0, 0, 0,
];

const DIAMOND_9_MASK: ReadonlyArray<number> = [
  0, 0, 0, 0, 1, 0, 0, 0, 0,
  0, 0, 0, 1, 1, 1, 0, 0, 0,
  0, 0, 1, 1, 1, 1, 1, 0, 0,
  0, 1, 1, 1, 1, 1, 1, 1, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1,
  0, 1, 1, 1, 1, 1, 1, 1, 0,
  0, 0, 1, 1, 1, 1, 1, 0, 0,
  0, 0, 0, 1, 1, 1, 0, 0, 0,
  0, 0, 0, 0, 1, 0, 0, 0, 0,
];

const CHECKERED_4_MASK: ReadonlyArray<number> = [
  1, 0, 1, 0,
  0, 1, 0, 1,
  1, 0, 1, 0,
  0, 1, 0, 1,
];

export const clearStrokeDefIdsForStamp = ({
  buffers,
  width,
  height,
  x,
  y,
  brushSize,
  flowSlot,
  shape,
}: ClearStrokeDefIdsForStampArgs): void => {
  const { paint, gid, def } = buffers;
  if (!def || def.length === 0) {
    return;
  }

  const slotMasked = flowSlot & FLOW_SLOT_MASK;
  const clearAt = (px: number, py: number) => {
    if (px < 0 || px >= width || py < 0 || py >= height) {
      return;
    }
    const idx = py * width + px;
    if (paint[idx] !== 0 && (gid[idx] & FLOW_SLOT_MASK) === slotMasked) {
      def[idx] = 0;
    }
  };

  const clearPixelMask = (gridSize: number, pixelScale: number, mask: ReadonlyArray<number>) => {
    const scale = Math.max(1, Math.round(pixelScale));
    const stampSize = gridSize * scale;
    const originX = Math.floor(x - stampSize / 2);
    const originY = Math.floor(y - stampSize / 2);
    const minX = Math.max(0, originX);
    const maxX = Math.min(width - 1, originX + stampSize - 1);
    const minY = Math.max(0, originY);
    const maxY = Math.min(height - 1, originY + stampSize - 1);
    for (let py = minY; py <= maxY; py += 1) {
      const localY = py - originY;
      const cellY = Math.max(0, Math.min(gridSize - 1, Math.floor(localY / scale)));
      for (let px = minX; px <= maxX; px += 1) {
        const localX = px - originX;
        const cellX = Math.max(0, Math.min(gridSize - 1, Math.floor(localX / scale)));
        if (mask[cellY * gridSize + cellX] !== 0) {
          clearAt(px, py);
        }
      }
    }
  };

  if (shape === 'triangle') {
    const halfSize = brushSize / 2;
    const topX = x;
    const topY = y - halfSize;
    const leftX = x - halfSize;
    const leftY = y + halfSize;
    const rightX = x + halfSize;
    const rightY = y + halfSize;
    const minX = Math.max(0, Math.floor(Math.min(leftX, rightX, topX)));
    const maxX = Math.min(width - 1, Math.floor(Math.max(leftX, rightX, topX)));
    const minY = Math.max(0, Math.floor(Math.min(topY, leftY, rightY)));
    const maxY = Math.min(height - 1, Math.floor(Math.max(topY, leftY, rightY)));
    const sign = (px: number, py: number, ax: number, ay: number, bx: number, by: number) =>
      (px - bx) * (ay - by) - (ax - bx) * (py - by);
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const sampleX = px + 0.5;
        const sampleY = py + 0.5;
        const b1 = sign(sampleX, sampleY, topX, topY, leftX, leftY) <= 0;
        const b2 = sign(sampleX, sampleY, leftX, leftY, rightX, rightY) <= 0;
        const b3 = sign(sampleX, sampleY, rightX, rightY, topX, topY) <= 0;
        if (b1 === b2 && b2 === b3) {
          clearAt(px, py);
        }
      }
    }
    return;
  }

  if (shape === 'round') {
    const radius = brushSize / 2;
    const radiusSq = radius * radius;
    const centerX = Math.floor(x);
    const centerY = Math.floor(y);
    const minX = Math.max(0, Math.floor(centerX - radius));
    const maxX = Math.min(width - 1, Math.ceil(centerX + radius));
    const minY = Math.max(0, Math.floor(centerY - radius));
    const maxY = Math.min(height - 1, Math.ceil(centerY + radius));
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const dx = px + 0.5 - x;
        const dy = py + 0.5 - y;
        if (dx * dx + dy * dy <= radiusSq) {
          clearAt(px, py);
        }
      }
    }
    return;
  }

  if (shape === 'diamond') {
    const radius = brushSize / 2;
    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(width - 1, Math.floor(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(height - 1, Math.floor(y + radius));
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const dx = Math.abs(px + 0.5 - x);
        const dy = Math.abs(py + 0.5 - y);
        if (dx + dy <= radius) {
          clearAt(px, py);
        }
      }
    }
    return;
  }

  if (shape === 'diamond5') {
    clearPixelMask(5, Math.max(1, Math.round(brushSize / 5)), DIAMOND_5_MASK);
    return;
  }

  if (shape === 'diamond7') {
    clearPixelMask(7, Math.max(1, Math.round(brushSize / 7)), DIAMOND_7_MASK);
    return;
  }

  if (shape === 'diamond9') {
    clearPixelMask(9, Math.max(1, Math.round(brushSize / 9)), DIAMOND_9_MASK);
    return;
  }

  if (shape === 'checkered') {
    clearPixelMask(4, Math.max(1, Math.round(brushSize / 4)), CHECKERED_4_MASK);
    return;
  }

  const halfSize = brushSize / 2;
  const minX = Math.max(0, Math.ceil(x - halfSize));
  const maxX = Math.min(width - 1, Math.ceil(x + halfSize) - 1);
  const minY = Math.max(0, Math.ceil(y - halfSize));
  const maxY = Math.min(height - 1, Math.ceil(y + halfSize) - 1);
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      clearAt(px, py);
    }
  }
};
