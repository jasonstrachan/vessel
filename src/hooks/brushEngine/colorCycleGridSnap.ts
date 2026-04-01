import { BrushShape, type BrushSettings } from '@/types';
import { snapToGridPure } from './utilities';

export type ColorCycleGridSnapSettings = Pick<
  BrushSettings,
  'brushShape' | 'gridSnapEnabled' | 'gridSnapSize' | 'roundedCornersEnabled' | 'cornerRadiusPx'
>;

export type GridSnapPoint = { x: number; y: number };
export type OrthogonalAxis = 'horizontal' | 'vertical';

type OrthogonalPathResult = {
  pathPoints: GridSnapPoint[];
  finalAxis: OrthogonalAxis | null;
};

export const isColorCycleGradientShapePreset = (
  presetId: string | null | undefined,
  brushShape: BrushSettings['brushShape'] | undefined
): boolean => (
  presetId === 'color-cycle-gradient' &&
  brushShape === BrushShape.COLOR_CYCLE_SHAPE
);

export const getColorCycleGridSnapSpacing = (gridSnapSize?: number): number => {
  const normalized = typeof gridSnapSize === 'number' && Number.isFinite(gridSnapSize)
    ? Math.round(gridSnapSize)
    : 16;
  return Math.max(1, normalized);
};

export const snapPointToColorCycleGrid = (
  point: { x: number; y: number },
  gridSnapSize?: number
): { x: number; y: number } => snapToGridPure(
  point.x,
  point.y,
  getColorCycleGridSnapSpacing(gridSnapSize),
);

export const snapVerticesToColorCycleGrid = (
  vertices: Array<{ x: number; y: number }>,
  settings: ColorCycleGridSnapSettings
): Array<{ x: number; y: number }> => {
  if (
    settings.brushShape !== BrushShape.COLOR_CYCLE_SHAPE ||
    settings.gridSnapEnabled !== true
  ) {
    return vertices;
  }

  return vertices.map((vertex) => snapPointToColorCycleGrid(vertex, settings.gridSnapSize));
};

export const rasterizeGridLinePoints = (
  from: GridSnapPoint,
  to: GridSnapPoint
): GridSnapPoint[] => {
  let cellX = Math.round(from.x);
  let cellY = Math.round(from.y);
  const targetCellX = Math.round(to.x);
  const targetCellY = Math.round(to.y);
  const deltaX = Math.abs(targetCellX - cellX);
  const deltaY = Math.abs(targetCellY - cellY);
  const stepX = cellX < targetCellX ? 1 : -1;
  const stepY = cellY < targetCellY ? 1 : -1;
  let error = deltaX - deltaY;
  const points: GridSnapPoint[] = [];

  while (true) {
    points.push({ x: cellX, y: cellY });
    if (cellX === targetCellX && cellY === targetCellY) {
      break;
    }
    const doubleError = error * 2;
    if (doubleError > -deltaY) {
      error -= deltaY;
      cellX += stepX;
    }
    if (doubleError < deltaX) {
      error += deltaX;
      cellY += stepY;
    }
  }

  return points;
};

const resolveSegmentAxis = (
  from: GridSnapPoint,
  to: GridSnapPoint
): OrthogonalAxis | null => {
  if (from.x === to.x && from.y !== to.y) {
    return 'vertical';
  }
  if (from.y === to.y && from.x !== to.x) {
    return 'horizontal';
  }
  return null;
};

const chooseOrthogonalAxes = (
  from: GridSnapPoint,
  to: GridSnapPoint,
  preferredAxis: OrthogonalAxis | null = null
): { firstAxis: OrthogonalAxis; secondAxis: OrthogonalAxis } => {
  if (preferredAxis) {
    return preferredAxis === 'horizontal'
      ? { firstAxis: 'horizontal', secondAxis: 'vertical' }
      : { firstAxis: 'vertical', secondAxis: 'horizontal' };
  }

  const deltaX = Math.abs(to.x - from.x);
  const deltaY = Math.abs(to.y - from.y);
  return deltaX >= deltaY
    ? { firstAxis: 'horizontal', secondAxis: 'vertical' }
    : { firstAxis: 'vertical', secondAxis: 'horizontal' };
};

export const rasterizeOrthogonalGridPath = (
  from: GridSnapPoint,
  to: GridSnapPoint,
  preferredAxis: OrthogonalAxis | null = null
): OrthogonalPathResult => {
  const directAxis = resolveSegmentAxis(from, to);
  if (directAxis) {
    return {
      pathPoints: rasterizeGridLinePoints(from, to),
      finalAxis: directAxis,
    };
  }

  const { firstAxis, secondAxis } = chooseOrthogonalAxes(from, to, preferredAxis);
  const elbow = firstAxis === 'horizontal'
    ? { x: to.x, y: from.y }
    : { x: from.x, y: to.y };
  const firstLeg = rasterizeGridLinePoints(from, elbow);
  const secondLeg = rasterizeGridLinePoints(elbow, to).slice(1);

  return {
    pathPoints: dedupeSequentialPoints([...firstLeg, ...secondLeg]),
    finalAxis: secondAxis,
  };
};

const movePointAlongAxis = (
  point: GridSnapPoint,
  axis: OrthogonalAxis,
  distance: number
): GridSnapPoint => axis === 'horizontal'
  ? { x: point.x + distance, y: point.y }
  : { x: point.x, y: point.y + distance };

const rasterizeArcPoints = (
  center: GridSnapPoint,
  startPoint: GridSnapPoint,
  endPoint: GridSnapPoint,
  radius: number,
  clockwise: boolean
): GridSnapPoint[] => {
  const startAngle = Math.atan2(startPoint.y - center.y, startPoint.x - center.x);
  let endAngle = Math.atan2(endPoint.y - center.y, endPoint.x - center.x);
  const normalizedStart = startAngle;

  if (clockwise) {
    while (endAngle >= normalizedStart) {
      endAngle -= Math.PI * 2;
    }
  } else {
    while (endAngle <= normalizedStart) {
      endAngle += Math.PI * 2;
    }
  }

  const arcLength = Math.abs(endAngle - normalizedStart) * radius;
  const steps = Math.max(3, Math.ceil(arcLength));
  const points: GridSnapPoint[] = [];

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const angle = normalizedStart + (endAngle - normalizedStart) * t;
    points.push({
      x: Math.round(center.x + Math.cos(angle) * radius),
      y: Math.round(center.y + Math.sin(angle) * radius),
    });
  }

  return dedupeSequentialPoints(points);
};

export const rasterizeRoundedOrthogonalGridPath = (
  from: GridSnapPoint,
  to: GridSnapPoint,
  radiusPx: number,
  preferredAxis: OrthogonalAxis | null = null
): OrthogonalPathResult => {
  const directAxis = resolveSegmentAxis(from, to);
  if (directAxis) {
    return {
      pathPoints: rasterizeGridLinePoints(from, to),
      finalAxis: directAxis,
    };
  }

  const { firstAxis, secondAxis } = chooseOrthogonalAxes(from, to, preferredAxis);
  const elbow = firstAxis === 'horizontal'
    ? { x: to.x, y: from.y }
    : { x: from.x, y: to.y };
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const clampedRadius = Math.max(
    0,
    Math.min(
      Math.round(radiusPx),
      Math.abs(deltaX) / 2,
      Math.abs(deltaY) / 2,
    ),
  );

  if (clampedRadius < 1) {
    return rasterizeOrthogonalGridPath(from, to, preferredAxis);
  }

  const signX = Math.sign(deltaX) || 1;
  const signY = Math.sign(deltaY) || 1;
  const firstTrim = firstAxis === 'horizontal'
    ? { x: elbow.x - signX * clampedRadius, y: elbow.y }
    : { x: elbow.x, y: elbow.y - signY * clampedRadius };
  const secondTrim = firstAxis === 'horizontal'
    ? { x: elbow.x, y: elbow.y + signY * clampedRadius }
    : { x: elbow.x + signX * clampedRadius, y: elbow.y };
  const center = firstAxis === 'horizontal'
    ? { x: elbow.x - signX * clampedRadius, y: elbow.y + signY * clampedRadius }
    : { x: elbow.x + signX * clampedRadius, y: elbow.y - signY * clampedRadius };
  const firstLeg = rasterizeGridLinePoints(from, firstTrim);
  const turnDir = firstAxis === 'horizontal'
    ? { x: signX, y: 0 }
    : { x: 0, y: signY };
  const exitDir = firstAxis === 'horizontal'
    ? { x: 0, y: signY }
    : { x: signX, y: 0 };
  const clockwise = (turnDir.x * exitDir.y - turnDir.y * exitDir.x) < 0;
  const arc = rasterizeArcPoints(center, firstTrim, secondTrim, clampedRadius, clockwise).slice(1);
  const secondLeg = rasterizeGridLinePoints(secondTrim, to).slice(1);

  return {
    pathPoints: dedupeSequentialPoints([...firstLeg, ...arc, ...secondLeg]),
    finalAxis: secondAxis,
  };
};

export const buildOrthogonalVertexPath = (
  anchors: GridSnapPoint[]
): GridSnapPoint[] => {
  if (anchors.length <= 1) {
    return anchors.slice();
  }

  const vertices: GridSnapPoint[] = [anchors[0]];
  let preferredAxis: OrthogonalAxis | null = null;

  for (let index = 1; index < anchors.length; index += 1) {
    const from = vertices[vertices.length - 1];
    const to = anchors[index];
    const directAxis = resolveSegmentAxis(from, to);

    if (directAxis) {
      vertices.push(to);
      preferredAxis = directAxis;
      continue;
    }

    const { firstAxis, secondAxis } = chooseOrthogonalAxes(from, to, preferredAxis);
    const elbow = firstAxis === 'horizontal'
      ? { x: to.x, y: from.y }
      : { x: from.x, y: to.y };
    vertices.push(elbow, to);
    preferredAxis = secondAxis;
  }

  return dedupeSequentialPoints(vertices);
};

export const buildRoundedGridStrokePath = (
  anchors: GridSnapPoint[],
  radiusPx: number
): GridSnapPoint[] => {
  if (anchors.length === 0) {
    return [];
  }
  if (anchors.length === 1) {
    return [anchors[0]];
  }

  const vertices = buildOrthogonalVertexPath(anchors);
  const pathPoints: GridSnapPoint[] = [vertices[0]];

  for (let index = 1; index < vertices.length - 1; index += 1) {
    const previous = vertices[index - 1];
    const current = vertices[index];
    const next = vertices[index + 1];
    const prevAxis = resolveSegmentAxis(previous, current);
    const nextAxis = resolveSegmentAxis(current, next);

    if (!prevAxis || !nextAxis || prevAxis === nextAxis) {
      const leg = rasterizeGridLinePoints(pathPoints[pathPoints.length - 1], current).slice(1);
      pathPoints.push(...leg);
      continue;
    }

    const prevDistance = prevAxis === 'horizontal'
      ? current.x - previous.x
      : current.y - previous.y;
    const nextDistance = nextAxis === 'horizontal'
      ? next.x - current.x
      : next.y - current.y;
    const clampedRadius = Math.max(
      0,
      Math.min(
        Math.round(radiusPx),
        Math.abs(prevDistance) / 2,
        Math.abs(nextDistance) / 2,
      ),
    );

    if (clampedRadius < 1) {
      const leg = rasterizeGridLinePoints(pathPoints[pathPoints.length - 1], current).slice(1);
      pathPoints.push(...leg);
      continue;
    }

    const prevSign = Math.sign(prevDistance) || 1;
    const nextSign = Math.sign(nextDistance) || 1;
    const entry = movePointAlongAxis(current, prevAxis, -prevSign * clampedRadius);
    const exit = movePointAlongAxis(current, nextAxis, nextSign * clampedRadius);
    const center = {
      x: current.x + (nextAxis === 'horizontal' ? nextSign * clampedRadius : 0) + (prevAxis === 'horizontal' ? -prevSign * clampedRadius : 0),
      y: current.y + (nextAxis === 'vertical' ? nextSign * clampedRadius : 0) + (prevAxis === 'vertical' ? -prevSign * clampedRadius : 0),
    };
    const turnDir = prevAxis === 'horizontal'
      ? { x: prevSign, y: 0 }
      : { x: 0, y: prevSign };
    const exitDir = nextAxis === 'horizontal'
      ? { x: nextSign, y: 0 }
      : { x: 0, y: nextSign };
    const clockwise = (turnDir.x * exitDir.y - turnDir.y * exitDir.x) < 0;
    const inbound = rasterizeGridLinePoints(pathPoints[pathPoints.length - 1], entry).slice(1);
    const arc = rasterizeArcPoints(center, entry, exit, clampedRadius, clockwise).slice(1);
    pathPoints.push(...inbound, ...arc);
  }

  const tail = rasterizeGridLinePoints(pathPoints[pathPoints.length - 1], vertices[vertices.length - 1]).slice(1);
  pathPoints.push(...tail);

  return dedupeSequentialPoints(pathPoints);
};

export const constrainPointToOrthogonalGridPreview = (
  anchor: GridSnapPoint,
  point: GridSnapPoint
): GridSnapPoint => {
  const deltaX = Math.abs(point.x - anchor.x);
  const deltaY = Math.abs(point.y - anchor.y);

  if (deltaX >= deltaY) {
    return { x: point.x, y: anchor.y };
  }

  return { x: anchor.x, y: point.y };
};

const rasterizeOrthogonalVertexPath = (
  vertices: GridSnapPoint[]
): GridSnapPoint[] => {
  if (vertices.length === 0) {
    return [];
  }

  const pathPoints: GridSnapPoint[] = [vertices[0]];
  for (let index = 1; index < vertices.length; index += 1) {
    const leg = rasterizeGridLinePoints(pathPoints[pathPoints.length - 1], vertices[index]).slice(1);
    pathPoints.push(...leg);
  }

  return dedupeSequentialPoints(pathPoints);
};

export const buildColorCycleGridPreviewPath = ({
  anchors,
  point,
  rounded,
  radiusPx,
}: {
  anchors: GridSnapPoint[];
  point: GridSnapPoint;
  rounded: boolean;
  radiusPx: number;
}): GridSnapPoint[] => {
  if (anchors.length === 0) {
    return [point];
  }

  const lastAnchor = anchors[anchors.length - 1];
  const previewPoint = constrainPointToOrthogonalGridPreview(lastAnchor, point);
  const previewAnchors = (
    previewPoint.x === lastAnchor.x && previewPoint.y === lastAnchor.y
  )
    ? anchors
    : [...anchors, previewPoint];

  if (rounded) {
    return buildRoundedGridStrokePath(previewAnchors, radiusPx);
  }

  return rasterizeOrthogonalVertexPath(buildOrthogonalVertexPath(previewAnchors));
};

export const dedupeSequentialPoints = (
  points: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> => {
  const normalized: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    const previous = normalized[normalized.length - 1];
    if (!previous || previous.x !== point.x || previous.y !== point.y) {
      normalized.push(point);
    }
  }
  return normalized;
};
