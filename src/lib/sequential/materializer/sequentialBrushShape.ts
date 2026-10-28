export type SequentialStampShape = 'round' | 'square' | 'triangle' | 'diamond' | 'diamond5' | 'diamond7' | 'diamond9' | 'checkered';
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
export const isStampPixelCovered = ({
  shape,
  dx,
  dy,
  halfSize,
  radiusSq,
}: {
  shape: SequentialStampShape;
  dx: number;
  dy: number;
  halfSize: number;
  radiusSq: number;
}): boolean => {
  switch (shape) {
    case 'square':
      return Math.abs(dx) <= halfSize && Math.abs(dy) <= halfSize;
    case 'diamond':
      return Math.abs(dx) + Math.abs(dy) <= halfSize;
    case 'diamond5': {
      if (Math.abs(dx) > halfSize || Math.abs(dy) > halfSize) {
        return false;
      }
      const normalizedX = ((dx / Math.max(1e-6, halfSize)) + 1) * 0.5;
      const normalizedY = ((dy / Math.max(1e-6, halfSize)) + 1) * 0.5;
      const cellX = Math.max(0, Math.min(4, Math.floor(normalizedX * 5)));
      const cellY = Math.max(0, Math.min(4, Math.floor(normalizedY * 5)));
      return DIAMOND_5_MASK[cellY * 5 + cellX] === 1;
    }
    case 'diamond7': {
      if (Math.abs(dx) > halfSize || Math.abs(dy) > halfSize) {
        return false;
      }
      const normalizedX = ((dx / Math.max(1e-6, halfSize)) + 1) * 0.5;
      const normalizedY = ((dy / Math.max(1e-6, halfSize)) + 1) * 0.5;
      const cellX = Math.max(0, Math.min(6, Math.floor(normalizedX * 7)));
      const cellY = Math.max(0, Math.min(6, Math.floor(normalizedY * 7)));
      return DIAMOND_7_MASK[cellY * 7 + cellX] === 1;
    }
    case 'diamond9': {
      if (Math.abs(dx) > halfSize || Math.abs(dy) > halfSize) {
        return false;
      }
      const normalizedX = ((dx / Math.max(1e-6, halfSize)) + 1) * 0.5;
      const normalizedY = ((dy / Math.max(1e-6, halfSize)) + 1) * 0.5;
      const cellX = Math.max(0, Math.min(8, Math.floor(normalizedX * 9)));
      const cellY = Math.max(0, Math.min(8, Math.floor(normalizedY * 9)));
      return DIAMOND_9_MASK[cellY * 9 + cellX] === 1;
    }
    case 'checkered': {
      if (Math.abs(dx) > halfSize || Math.abs(dy) > halfSize) {
        return false;
      }
      const normalizedX = ((dx / Math.max(1e-6, halfSize)) + 1) * 0.5;
      const normalizedY = ((dy / Math.max(1e-6, halfSize)) + 1) * 0.5;
      const cellX = Math.max(0, Math.min(3, Math.floor(normalizedX * 4)));
      const cellY = Math.max(0, Math.min(3, Math.floor(normalizedY * 4)));
      return CHECKERED_4_MASK[cellY * 4 + cellX] === 1;
    }
    case 'triangle': {
      if (Math.abs(dx) > halfSize || Math.abs(dy) > halfSize) {
        return false;
      }
      const normalizedY = dy / halfSize;
      const maxAbsX = (normalizedY + 1) * 0.5;
      return Math.abs(dx / halfSize) <= maxAbsX;
    }
    case 'round':
    default:
      return dx * dx + dy * dy <= radiusSq;
  }
};
