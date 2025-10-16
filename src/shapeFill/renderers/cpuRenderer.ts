import { FillResult } from '../types';

export function renderFill(ctx: CanvasRenderingContext2D, result: FillResult): void {
  ctx.save();
  const previousSmoothing = typeof ctx.imageSmoothingEnabled === 'boolean' ? ctx.imageSmoothingEnabled : undefined;
  if (typeof ctx.imageSmoothingEnabled === 'boolean') {
    ctx.imageSmoothingEnabled = false;
  }
  ctx.lineWidth = result.lineWidth ?? 1;

  const hasStrokeSegments = Array.isArray(result.strokeSegments) && result.strokeSegments.length > 0;
  const hasDotInstances = Array.isArray(result.dotInstances) && result.dotInstances.length > 0;
  const baseFillStyle = ctx.fillStyle;
  const baseFillString = typeof baseFillStyle === 'string' ? baseFillStyle : null;

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

  if (hasStrokeSegments) {
    result.strokeSegments?.forEach(segment => {
      if (!segment || segment.points.length === 0) {
        return;
      }
      ctx.save();
      ctx.lineWidth = segment.lineWidth ?? ctx.lineWidth;
      ctx.globalAlpha = segment.alpha ?? 1;
      const [first, ...rest] = segment.points;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      rest.forEach(point => {
        ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
      ctx.restore();
    });
  } else {
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
  }

  if (hasDotInstances) {
    result.dotInstances?.forEach(instance => {
      if (!instance) {
        return;
      }
      ctx.save();
      const shade = instance.shade;
      if (instance.color) {
        ctx.fillStyle = instance.color;
      } else if (shade !== undefined) {
        ctx.fillStyle = shade >= 0 ? '#ffffff' : '#000000';
      } else if (baseFillString) {
        ctx.fillStyle = baseFillString;
      }
      ctx.globalAlpha = instance.alpha ?? 1;
      if (instance.shape === 'square') {
        const size = instance.size ?? instance.radius * 2;
        const half = size / 2;
        ctx.fillRect(instance.center.x - half, instance.center.y - half, size, size);
      } else {
        ctx.beginPath();
        ctx.arc(instance.center.x, instance.center.y, instance.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  } else {
    const dotRadius = result.dotRadius ?? 1;
    result.dots?.forEach(dot => {
      const radius = dotRadius;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

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

  if (previousSmoothing !== undefined) {
    ctx.imageSmoothingEnabled = previousSmoothing;
  }

  ctx.restore();
}
