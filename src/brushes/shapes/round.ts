import type { ShapeDrawFunction } from './types';

export const drawRoundShape: ShapeDrawFunction = (ctx, x, y, size) => {
  ctx.beginPath();
  ctx.arc(x, y, size / 2, 0, Math.PI * 2);
  ctx.fill();
};
