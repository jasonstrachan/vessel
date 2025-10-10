import { FillResult } from '../types';

export function renderFill(ctx: CanvasRenderingContext2D, result: FillResult): void {
  ctx.save();
  ctx.lineWidth = result.lineWidth ?? 1;
  ctx.strokeStyle = '#000';

  if (result.clipPath && result.clipPath.length >= 3) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(result.clipPath[0].x, result.clipPath[0].y);
    for (let i = 1; i < result.clipPath.length; i += 1) {
      ctx.lineTo(result.clipPath[i].x, result.clipPath[i].y);
    }
    ctx.closePath();
    ctx.clip();
  }

  result.lines?.forEach(line => {
    if (line.length === 0) {
      return;
    }
    ctx.beginPath();
    ctx.moveTo(line[0].x, line[0].y);
    for (let i = 1; i < line.length; i += 1) {
      ctx.lineTo(line[i].x, line[i].y);
    }
    ctx.stroke();
  });

  const dotRadius = result.dotRadius ?? 1;
  result.dots?.forEach(dot => {
    const radius = dotRadius;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
    ctx.fill();
  });

  result.polygons?.forEach(polygon => {
    if (polygon.length === 0) {
      return;
    }
    ctx.beginPath();
    ctx.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i += 1) {
      ctx.lineTo(polygon[i].x, polygon[i].y);
    }
    ctx.closePath();
    ctx.fill();
  });

  if (result.clipPath && result.clipPath.length >= 3) {
    ctx.restore();
  }

  ctx.restore();
}
