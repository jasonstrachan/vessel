import { BrushShape } from '@/types';
import {
  buildOrthogonalVertexPath,
  buildRoundedGridStrokePath,
  dedupeSequentialPoints,
  getColorCycleGridSnapSpacing,
  isColorCycleGradientShapePreset,
  rasterizeOrthogonalGridPath,
  rasterizeGridLinePoints,
  rasterizeRoundedOrthogonalGridPath,
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

  it('decomposes diagonal snapped moves into an orthogonal path', () => {
    expect(rasterizeOrthogonalGridPath(
      { x: 0, y: 0 },
      { x: 4, y: 4 },
      'horizontal',
    )).toEqual({
      pathPoints: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 1 },
        { x: 4, y: 2 },
        { x: 4, y: 3 },
        { x: 4, y: 4 },
      ],
      finalAxis: 'vertical',
    });
  });

  it('rounds orthogonal diagonal transitions with an arc path', () => {
    const result = rasterizeRoundedOrthogonalGridPath(
      { x: 0, y: 0 },
      { x: 8, y: 8 },
      2,
      'horizontal',
    );

    expect(result.finalAxis).toBe('vertical');
    expect(result.pathPoints[0]).toEqual({ x: 0, y: 0 });
    expect(result.pathPoints[result.pathPoints.length - 1]).toEqual({ x: 8, y: 8 });
    expect(result.pathPoints).not.toContainEqual({ x: 8, y: 0 });
    expect(result.pathPoints).toContainEqual({ x: 7, y: 1 });
  });

  it('builds orthogonal vertices from mixed anchor directions', () => {
    expect(buildOrthogonalVertexPath([
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
      { x: 0, y: 8 },
    ])).toEqual([
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
      { x: 0, y: 8 },
    ]);
  });

  it('rounds each interior corner of a multi-segment orthogonal path', () => {
    const path = buildRoundedGridStrokePath([
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
      { x: 0, y: 8 },
    ], 2);

    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[path.length - 1]).toEqual({ x: 0, y: 8 });
    expect(path).not.toContainEqual({ x: 8, y: 0 });
    expect(path).not.toContainEqual({ x: 8, y: 8 });
    expect(path).toContainEqual({ x: 7, y: 1 });
    expect(path).toContainEqual({ x: 7, y: 7 });
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
