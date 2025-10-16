import type { ShapeDrawFunction } from './types';

export const drawTriangleShape: ShapeDrawFunction = (ctx, x, y, size) => {
  const radius = size / 2;
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x - radius * 0.866, y + radius * 0.5);
  ctx.lineTo(x + radius * 0.866, y + radius * 0.5);
  ctx.closePath();
  ctx.fill();
};
