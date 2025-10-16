import { FillParams, ShapeDefinition, ShapeFillId } from './types';

export type PreviewRenderer = (
  ctx: CanvasRenderingContext2D,
  shape: ShapeDefinition,
  param: keyof FillParams,
  value: number
) => void;

export const defaultPreviewRenderer: PreviewRenderer = (ctx, shape, param, value) => {
  ctx.save();
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.strokeStyle = '#999';
  ctx.setLineDash([4, 4]);

  switch (param) {
    case 'spacing':
      ctx.beginPath();
      ctx.arc(shape.centroid.x, shape.centroid.y, value, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'rotation': {
      const length = 80;
      const rad = (value * Math.PI) / 180;
      const { x, y } = shape.centroid;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(rad) * length, y + Math.sin(rad) * length);
      ctx.stroke();
      break;
    }
    default:
      break;
  }

  ctx.restore();
};

const previewRegistry = new Map<ShapeFillId, PreviewRenderer>();

export function registerPreviewRenderer(fillId: ShapeFillId, renderer: PreviewRenderer): void {
  previewRegistry.set(fillId, renderer);
}

export function getPreviewRenderer(fillId: ShapeFillId): PreviewRenderer {
  return previewRegistry.get(fillId) ?? defaultPreviewRenderer;
}

registerPreviewRenderer('hatch', defaultPreviewRenderer);

registerPreviewRenderer('contour', (ctx, shape, param, value) => {
  ctx.save();
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.strokeStyle = '#666';
  ctx.setLineDash([]);

  const centroid = shape.centroid;
  const maxRadius = shape.points.reduce((max, point) => {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    return Math.max(max, Math.hypot(dx, dy));
  }, 0);

  const spacing = Math.max(2, typeof value === 'number' ? value : 12);
  const rings = Math.min(6, Math.floor((maxRadius + spacing) / spacing));

  for (let i = 1; i <= rings; i += 1) {
    const radius = spacing * i;
    ctx.beginPath();
    ctx.arc(centroid.x, centroid.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
});

registerPreviewRenderer('stipple', (ctx, shape, param, value) => {
  ctx.save();
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#555';
  ctx.setLineDash([]);

  const spacing = Math.max(4, typeof value === 'number' ? value : 12);
  const bounds = shape.bounds;

  for (let x = bounds.minX; x <= bounds.maxX; x += spacing) {
    for (let y = bounds.minY; y <= bounds.maxY; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
});
