import { BrushShape, type BrushSettings } from '@/types';
import { isCcGradientPreset } from '@/presets/brushPresets';
import { snapToGridPure } from './utilities';

export {
  buildColorCycleGridPreviewPath,
  buildOrthogonalVertexPath,
  buildRoundedGridStrokePath,
  constrainPointToOrthogonalGridPreview,
  dedupeSequentialPoints,
  rasterizeGridLinePoints,
  rasterizeOrthogonalGridPath,
  rasterizeRectangularGridLinePoints,
  rasterizeRoundedOrthogonalGridPath,
  type GridSnapPoint,
  type OrthogonalAxis,
} from './colorCycleGridPath';

export type ColorCycleGridSnapSettings = Pick<
  BrushSettings,
  'brushShape' | 'gridSnapEnabled' | 'gridSnapSize' | 'roundedCornersEnabled' | 'cornerRadiusPx'
>;

export const isColorCycleGradientShapePreset = (
  presetId: string | null | undefined,
  brushShape: BrushSettings['brushShape'] | undefined,
): boolean => (
  isCcGradientPreset(presetId) &&
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
  gridSnapSize?: number,
): { x: number; y: number } => snapToGridPure(
  point.x,
  point.y,
  getColorCycleGridSnapSpacing(gridSnapSize),
);

export const snapPointToRectangularColorCycleGrid = (
  point: { x: number; y: number },
  gridWidth: number,
  gridHeight: number,
): { x: number; y: number } => ({
  x: snapToGridPure(point.x, point.y, Math.max(1, gridWidth)).x,
  y: snapToGridPure(point.x, point.y, Math.max(1, gridHeight)).y,
});

export const snapVerticesToColorCycleGrid = (
  vertices: Array<{ x: number; y: number }>,
  settings: ColorCycleGridSnapSettings,
): Array<{ x: number; y: number }> => {
  if (
    settings.brushShape !== BrushShape.COLOR_CYCLE_SHAPE ||
    settings.gridSnapEnabled !== true
  ) {
    return vertices;
  }

  return vertices.map((vertex) => snapPointToColorCycleGrid(vertex, settings.gridSnapSize));
};
