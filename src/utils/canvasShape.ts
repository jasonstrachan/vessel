import type { CanvasShape, CanvasShapeTool, Rectangle, ShapePoint } from '@/types';

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

export const createDefaultCanvasShape = (width: number, height: number): CanvasShape => ({
  kind: 'rectangle',
  bounds: {
    x: 0,
    y: 0,
    width: Math.max(1, width),
    height: Math.max(1, height),
  },
});

const clampPointToBounds = (point: ShapePoint, bounds: Rectangle): ShapePoint => ({
  x: clamp(point.x, bounds.x, bounds.x + bounds.width),
  y: clamp(point.y, bounds.y, bounds.y + bounds.height),
});

const computeBoundsFromPoints = (points: ShapePoint[], bounds: Rectangle): Rectangle => {
  if (points.length === 0) {
    return { ...bounds };
  }

  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const x = clamp(minX, bounds.x, bounds.x + bounds.width);
  const y = clamp(minY, bounds.y, bounds.y + bounds.height);
  const maxClampedX = clamp(maxX, bounds.x, bounds.x + bounds.width);
  const maxClampedY = clamp(maxY, bounds.y, bounds.y + bounds.height);

  return {
    x,
    y,
    width: Math.max(1, maxClampedX - x),
    height: Math.max(1, maxClampedY - y),
  };
};

export const buildRectangleShape = (
  start: ShapePoint,
  end: ShapePoint,
  bounds: Rectangle
): CanvasShape => {
  const startClamped = clampPointToBounds(start, bounds);
  const endClamped = clampPointToBounds(end, bounds);

  const x = Math.min(startClamped.x, endClamped.x);
  const y = Math.min(startClamped.y, endClamped.y);
  const width = Math.max(1, Math.abs(endClamped.x - startClamped.x));
  const height = Math.max(1, Math.abs(endClamped.y - startClamped.y));

  return {
    kind: 'rectangle',
    bounds: {
      x,
      y,
      width,
      height,
    },
  };
};

export const buildCircleShape = (
  start: ShapePoint,
  end: ShapePoint,
  bounds: Rectangle
): CanvasShape => {
  const startClamped = clampPointToBounds(start, bounds);
  const endClamped = clampPointToBounds(end, bounds);

  const minX = Math.min(startClamped.x, endClamped.x);
  const minY = Math.min(startClamped.y, endClamped.y);
  const width = Math.abs(endClamped.x - startClamped.x);
  const height = Math.abs(endClamped.y - startClamped.y);
  const radius = Math.max(1, Math.min(width, height) / 2);
  const center = {
    x: minX + width / 2,
    y: minY + height / 2,
  };

  const clampedCenter = {
    x: clamp(center.x, bounds.x, bounds.x + bounds.width),
    y: clamp(center.y, bounds.y, bounds.y + bounds.height),
  };

  const maxRadius = Math.min(
    clampedCenter.x - bounds.x,
    clampedCenter.y - bounds.y,
    bounds.x + bounds.width - clampedCenter.x,
    bounds.y + bounds.height - clampedCenter.y
  );
  const clampedRadius = Math.max(1, Math.min(radius, maxRadius));

  return {
    kind: 'circle',
    center: clampedCenter,
    radius: clampedRadius,
    bounds: {
      x: clampedCenter.x - clampedRadius,
      y: clampedCenter.y - clampedRadius,
      width: clampedRadius * 2,
      height: clampedRadius * 2,
    },
  };
};

export const buildFreehandShape = (
  points: ShapePoint[],
  bounds: Rectangle
): CanvasShape => {
  const clamped = points.map((point) => clampPointToBounds(point, bounds));
  const safePoints = clamped.length > 0 ? clamped : [{ x: bounds.x, y: bounds.y }];
  const closedPoints = safePoints.length > 1
    ? [...safePoints, safePoints[0]]
    : safePoints;

  return {
    kind: 'freehand',
    points: closedPoints,
    bounds: computeBoundsFromPoints(closedPoints, bounds),
  };
};

export const normalizeCanvasShape = (
  shape: CanvasShape | null | undefined,
  width: number,
  height: number
): CanvasShape => {
  const bounds: Rectangle = {
    x: 0,
    y: 0,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };

  if (!shape) {
    return createDefaultCanvasShape(width, height);
  }

  if (shape.kind === 'rectangle') {
    return buildRectangleShape(
      { x: shape.bounds.x, y: shape.bounds.y },
      { x: shape.bounds.x + shape.bounds.width, y: shape.bounds.y + shape.bounds.height },
      bounds
    );
  }

  if (shape.kind === 'circle') {
    const end = {
      x: shape.center.x + shape.radius,
      y: shape.center.y + shape.radius,
    };
    const start = {
      x: shape.center.x - shape.radius,
      y: shape.center.y - shape.radius,
    };
    return buildCircleShape(start, end, bounds);
  }

  if (!Array.isArray(shape.points) || shape.points.length < 3) {
    return createDefaultCanvasShape(width, height);
  }

  return buildFreehandShape(shape.points, bounds);
};

export const drawCanvasShapePath = (ctx: CanvasRenderingContext2D, shape: CanvasShape): void => {
  ctx.beginPath();
  if (shape.kind === 'rectangle') {
    ctx.rect(shape.bounds.x, shape.bounds.y, shape.bounds.width, shape.bounds.height);
    return;
  }

  if (shape.kind === 'circle') {
    ctx.arc(shape.center.x, shape.center.y, shape.radius, 0, Math.PI * 2);
    return;
  }

  const points = shape.points;
  if (points.length === 0) {
    return;
  }

  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
};

export const applyCanvasShapeClip = (ctx: CanvasRenderingContext2D, shape: CanvasShape): void => {
  drawCanvasShapePath(ctx, shape);
  ctx.clip();
};

export const applyCanvasShapeMask = (ctx: CanvasRenderingContext2D, shape: CanvasShape): void => {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff';
  drawCanvasShapePath(ctx, shape);
  ctx.fill();
  ctx.restore();
};

export const strokeCanvasShapeOutline = (
  ctx: CanvasRenderingContext2D,
  shape: CanvasShape,
  options: { strokeStyle?: string; lineWidth?: number; dash?: number[] } = {}
): void => {
  ctx.save();
  if (options.dash) {
    ctx.setLineDash(options.dash);
  }
  if (options.strokeStyle) {
    ctx.strokeStyle = options.strokeStyle;
  }
  if (options.lineWidth != null) {
    ctx.lineWidth = options.lineWidth;
  }
  drawCanvasShapePath(ctx, shape);
  ctx.stroke();
  ctx.restore();
};

const isPointInPolygon = (point: ShapePoint, points: ShapePoint[]): boolean => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
};

export const isPointInCanvasShape = (shape: CanvasShape, point: ShapePoint): boolean => {
  if (
    point.x < shape.bounds.x ||
    point.y < shape.bounds.y ||
    point.x > shape.bounds.x + shape.bounds.width ||
    point.y > shape.bounds.y + shape.bounds.height
  ) {
    return false;
  }

  if (shape.kind === 'rectangle') {
    return true;
  }

  if (shape.kind === 'circle') {
    const dx = point.x - shape.center.x;
    const dy = point.y - shape.center.y;
    return dx * dx + dy * dy <= shape.radius * shape.radius;
  }

  if (shape.points.length < 3) {
    return false;
  }

  return isPointInPolygon(point, shape.points);
};

export const buildCanvasShapeFromTool = (
  tool: CanvasShapeTool,
  start: ShapePoint,
  end: ShapePoint,
  points: ShapePoint[],
  bounds: Rectangle
): CanvasShape => {
  if (tool === 'freehand') {
    return buildFreehandShape(points, bounds);
  }
  if (tool === 'circle') {
    return buildCircleShape(start, end, bounds);
  }
  return buildRectangleShape(start, end, bounds);
};

export const getCanvasBounds = (width: number, height: number): Rectangle => ({
  x: 0,
  y: 0,
  width: Math.max(1, width),
  height: Math.max(1, height),
});
