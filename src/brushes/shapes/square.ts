import type { ShapeDrawFunction } from './types';

export const drawSquareShape: ShapeDrawFunction = (
  ctx,
  x,
  y,
  size,
  antialiasing = false
) => {
  if (antialiasing) {
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    return;
  }

  const halfSize = Math.floor(size / 2);
  const startX = Math.round(x) - halfSize;
  const startY = Math.round(y) - halfSize;
  ctx.fillRect(startX, startY, size, size);
};
