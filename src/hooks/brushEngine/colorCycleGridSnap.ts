import { BrushShape, type BrushSettings } from '@/types';
import { snapToGridPure } from './utilities';

export type ColorCycleGridSnapSettings = Pick<
  BrushSettings,
  'brushShape' | 'gridSnapEnabled' | 'gridSnapSize'
>;

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
  from: { x: number; y: number },
  to: { x: number; y: number }
): Array<{ x: number; y: number }> => {
  let cellX = Math.round(from.x);
  let cellY = Math.round(from.y);
  const targetCellX = Math.round(to.x);
  const targetCellY = Math.round(to.y);
  const deltaX = Math.abs(targetCellX - cellX);
  const deltaY = Math.abs(targetCellY - cellY);
  const stepX = cellX < targetCellX ? 1 : -1;
  const stepY = cellY < targetCellY ? 1 : -1;
  let error = deltaX - deltaY;
  const points: Array<{ x: number; y: number }> = [];

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
