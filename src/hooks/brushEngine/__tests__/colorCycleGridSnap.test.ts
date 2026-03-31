import { BrushShape } from '@/types';
import {
  dedupeSequentialPoints,
  getColorCycleGridSnapSpacing,
  isColorCycleGradientShapePreset,
  rasterizeGridLinePoints,
  snapPointToColorCycleGrid,
  snapVerticesToColorCycleGrid,
} from '../colorCycleGridSnap';

describe('colorCycleGridSnap', () => {
  it('identifies the cc gradient shape preset correctly', () => {
    expect(isColorCycleGradientShapePreset('color-cycle-gradient', BrushShape.COLOR_CYCLE_SHAPE)).toBe(true);
    expect(isColorCycleGradientShapePreset('color-cycle-stroke', BrushShape.COLOR_CYCLE_SHAPE)).toBe(false);
    expect(isColorCycleGradientShapePreset('color-cycle-gradient', BrushShape.COLOR_CYCLE)).toBe(false);
  });

  it('normalizes snap spacing to a positive integer', () => {
    expect(getColorCycleGridSnapSpacing(8)).toBe(8);
    expect(getColorCycleGridSnapSpacing(0)).toBe(1);
    expect(getColorCycleGridSnapSpacing(undefined)).toBe(16);
  });

  it('snaps individual points to the configured color-cycle grid', () => {
    expect(snapPointToColorCycleGrid({ x: 9, y: 23 }, 8)).toEqual({ x: 8, y: 24 });
  });

  it('snaps cc gradient shape vertices and leaves other shapes unchanged', () => {
    const vertices = [{ x: 3, y: 5 }, { x: 14, y: 18 }];
    expect(snapVerticesToColorCycleGrid(vertices, {
      brushShape: BrushShape.COLOR_CYCLE_SHAPE,
      gridSnapEnabled: true,
      gridSnapSize: 8,
    })).toEqual([{ x: 0, y: 8 }, { x: 16, y: 16 }]);

    expect(snapVerticesToColorCycleGrid(vertices, {
      brushShape: BrushShape.COLOR_CYCLE,
      gridSnapEnabled: true,
      gridSnapSize: 8,
    })).toEqual(vertices);
  });

  it('rasterizes a continuous line between snapped endpoints', () => {
    expect(rasterizeGridLinePoints({ x: 0, y: 0 }, { x: 4, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it('dedupes sequential duplicate points', () => {
    expect(dedupeSequentialPoints([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ])).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });
});
