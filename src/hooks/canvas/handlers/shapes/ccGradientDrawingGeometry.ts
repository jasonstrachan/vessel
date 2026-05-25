import type { BrushSettings } from '@/types';
import {
  buildCcStrokeShapeGeometry,
  type CcStrokeSample,
} from '@/hooks/canvas/handlers/shapes/ccStrokeShapeGeometry';

export type CcGradientDrawingShape = NonNullable<BrushSettings['ccGradientDrawingShape']>;

export type Point = { x: number; y: number };

export type CcGradientDrawingGeometry = {
  shapePoints: Point[];
  sampleSourcePoints: Point[];
  direction?: Point;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

const MIN_DRAG_DISTANCE = 1e-3;
const MAX_ELLIPSE_POINTS = 48;
const MIN_ELLIPSE_POINTS = 12;

const clonePoint = (point: Point): Point => ({ x: point.x, y: point.y });

export const arePointsDistinct = (a: Point, b: Point): boolean =>
  Math.hypot(a.x - b.x, a.y - b.y) >= MIN_DRAG_DISTANCE;

const dedupeConsecutivePoints = (points: Point[]): Point[] => {
  const deduped: Point[] = [];
  for (const point of points) {
    const lastPoint = deduped[deduped.length - 1];
    if (!lastPoint || arePointsDistinct(lastPoint, point)) {
      deduped.push(point);
    }
  }
  return deduped;
};

const computeBounds = (points: Point[]): CcGradientDrawingGeometry['bounds'] => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
};

const normalizeDirection = (start: Point, end: Point): Point | undefined => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < MIN_DRAG_DISTANCE) {
    return undefined;
  }
  return { x: dx / length, y: dy / length };
};

const constrainSquare = (start: Point, end: Point): Point => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + Math.sign(dx || 1) * side,
    y: start.y + Math.sign(dy || 1) * side,
  };
};

const resolveEnd = (start: Point, end: Point, constrainAspect: boolean): Point =>
  constrainAspect ? constrainSquare(start, end) : end;

const snapLineEndToAngle = (start: Point, end: Point): Point => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < MIN_DRAG_DISTANCE) {
    return end;
  }
  const snappedAngle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: start.x + Math.cos(snappedAngle) * length,
    y: start.y + Math.sin(snappedAngle) * length,
  };
};

const fromShapePoints = ({
  shapePoints,
  sampleSourcePoints,
  direction,
}: {
  shapePoints: Point[];
  sampleSourcePoints: Point[];
  direction?: Point;
}): CcGradientDrawingGeometry | null => {
  if (shapePoints.length < 3) {
    return null;
  }
  return {
    shapePoints: shapePoints.map(clonePoint),
    sampleSourcePoints: sampleSourcePoints.map(clonePoint),
    direction,
    bounds: computeBounds(shapePoints),
  };
};

export const buildRectangleGeometry = ({
  start,
  end,
  constrainAspect = false,
}: {
  start: Point;
  end: Point;
  constrainAspect?: boolean;
}): CcGradientDrawingGeometry | null => {
  const resolvedEnd = resolveEnd(start, end, constrainAspect);
  if (Math.hypot(resolvedEnd.x - start.x, resolvedEnd.y - start.y) < MIN_DRAG_DISTANCE) {
    return null;
  }

  const minX = Math.min(start.x, resolvedEnd.x);
  const maxX = Math.max(start.x, resolvedEnd.x);
  const minY = Math.min(start.y, resolvedEnd.y);
  const maxY = Math.max(start.y, resolvedEnd.y);
  const shapePoints = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];

  return fromShapePoints({
    shapePoints,
    sampleSourcePoints: [clonePoint(start), clonePoint(resolvedEnd)],
    direction: normalizeDirection(start, resolvedEnd),
  });
};

export const buildEllipseGeometry = ({
  start,
  end,
  constrainAspect = false,
}: {
  start: Point;
  end: Point;
  constrainAspect?: boolean;
}): CcGradientDrawingGeometry | null => {
  const resolvedEnd = resolveEnd(start, end, constrainAspect);
  const minX = Math.min(start.x, resolvedEnd.x);
  const maxX = Math.max(start.x, resolvedEnd.x);
  const minY = Math.min(start.y, resolvedEnd.y);
  const maxY = Math.max(start.y, resolvedEnd.y);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < MIN_DRAG_DISTANCE || height < MIN_DRAG_DISTANCE) {
    return null;
  }

  const radiusX = width / 2;
  const radiusY = height / 2;
  const centerX = minX + radiusX;
  const centerY = minY + radiusY;
  const circumferenceEstimate = Math.PI * (radiusX + radiusY);
  const pointCount = Math.max(
    MIN_ELLIPSE_POINTS,
    Math.min(MAX_ELLIPSE_POINTS, Math.ceil(circumferenceEstimate / 8))
  );
  const shapePoints = Array.from({ length: pointCount }, (_value, index) => {
    const angle = (Math.PI * 2 * index) / pointCount;
    return {
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    };
  });

  return fromShapePoints({
    shapePoints,
    sampleSourcePoints: [clonePoint(start), clonePoint(resolvedEnd)],
    direction: normalizeDirection(start, resolvedEnd),
  });
};

export const buildTriangleGeometry = ({
  start,
  end,
  constrainAspect = false,
}: {
  start: Point;
  end: Point;
  constrainAspect?: boolean;
}): CcGradientDrawingGeometry | null => {
  const resolvedEnd = resolveEnd(start, end, constrainAspect);
  if (Math.hypot(resolvedEnd.x - start.x, resolvedEnd.y - start.y) < MIN_DRAG_DISTANCE) {
    return null;
  }

  const minX = Math.min(start.x, resolvedEnd.x);
  const maxX = Math.max(start.x, resolvedEnd.x);
  const minY = Math.min(start.y, resolvedEnd.y);
  const maxY = Math.max(start.y, resolvedEnd.y);
  const points =
    resolvedEnd.y >= start.y
      ? [
          { x: (minX + maxX) / 2, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY },
        ]
      : [
          { x: (minX + maxX) / 2, y: maxY },
          { x: minX, y: minY },
          { x: maxX, y: minY },
        ];

  return fromShapePoints({
    shapePoints: points,
    sampleSourcePoints: [clonePoint(start), clonePoint(resolvedEnd)],
    direction: normalizeDirection(start, resolvedEnd),
  });
};

export const buildLineGeometry = ({
  start,
  end,
  brushSettings,
  pressure,
  constrainAspect = false,
}: {
  start: Point;
  end: Point;
  brushSettings: Pick<BrushSettings, 'size' | 'pressureEnabled' | 'minPressure' | 'maxPressure' | 'brushShape'>;
  pressure?: number;
  constrainAspect?: boolean;
}): CcGradientDrawingGeometry | null => {
  const resolvedEnd = constrainAspect ? snapLineEndToAngle(start, end) : end;
  const samples: CcStrokeSample[] = [
    { x: start.x, y: start.y, pressure },
    { x: resolvedEnd.x, y: resolvedEnd.y, pressure },
  ];
  const geometry = buildCcStrokeShapeGeometry({ samples, brushSettings });
  if (!geometry) {
    return null;
  }

  return {
    shapePoints: geometry.shapePoints.map(clonePoint),
    sampleSourcePoints: geometry.centerline.map(({ x, y }) => ({ x, y })),
    direction: geometry.direction,
    bounds: geometry.bounds,
  };
};

export const buildClickLineGeometry = ({
  points,
  previewPoint,
}: {
  points: Point[];
  previewPoint?: Point | null;
}): CcGradientDrawingGeometry | null => {
  const shapePoints = [
    ...points.map(clonePoint),
    ...(previewPoint ? [clonePoint(previewPoint)] : []),
  ];
  const distinctShapePoints = dedupeConsecutivePoints(shapePoints);
  return fromShapePoints({
    shapePoints: distinctShapePoints,
    sampleSourcePoints: distinctShapePoints,
    direction: distinctShapePoints.length >= 2
      ? normalizeDirection(distinctShapePoints[0], distinctShapePoints[distinctShapePoints.length - 1])
      : undefined,
  });
};

export const buildPolygonGeometry = (points: Point[]): CcGradientDrawingGeometry | null =>
  fromShapePoints({
    shapePoints: points,
    sampleSourcePoints: points,
    direction: points.length >= 2 ? normalizeDirection(points[0], points[points.length - 1]) : undefined,
  });

export const buildCcGradientDrawingGeometry = ({
  drawingShape,
  start,
  end,
  points,
  previewPoint,
  brushSettings,
  pressure,
  constrainAspect = false,
}: {
  drawingShape: CcGradientDrawingShape;
  start?: Point | null;
  end?: Point | null;
  points?: Point[];
  previewPoint?: Point | null;
  brushSettings: Pick<BrushSettings, 'size' | 'pressureEnabled' | 'minPressure' | 'maxPressure' | 'brushShape'>;
  pressure?: number;
  constrainAspect?: boolean;
}): CcGradientDrawingGeometry | null => {
  if (drawingShape === 'polygon') {
    return buildPolygonGeometry(points ?? []);
  }
  if (drawingShape === 'click-line') {
    return buildClickLineGeometry({ points: points ?? [], previewPoint });
  }
  if (!start || !end) {
    return null;
  }
  switch (drawingShape) {
    case 'rectangle':
      return buildRectangleGeometry({ start, end, constrainAspect });
    case 'ellipse':
      return buildEllipseGeometry({ start, end, constrainAspect });
    case 'line':
      return buildLineGeometry({ start, end, brushSettings, pressure, constrainAspect });
    case 'triangle':
      return buildTriangleGeometry({ start, end, constrainAspect });
    default:
      return null;
  }
};

export const isDragDefinedCcGradientShape = (
  drawingShape: BrushSettings['ccGradientDrawingShape']
): drawingShape is 'rectangle' | 'ellipse' | 'line' | 'triangle' =>
  drawingShape === 'rectangle' ||
  drawingShape === 'ellipse' ||
  drawingShape === 'line' ||
  drawingShape === 'triangle';

export const isPolygonCcGradientShape = (
  drawingShape: BrushSettings['ccGradientDrawingShape']
): drawingShape is 'polygon' => drawingShape === 'polygon';

export const isClickLineCcGradientShape = (
  drawingShape: BrushSettings['ccGradientDrawingShape']
): drawingShape is 'click-line' => drawingShape === 'click-line';
