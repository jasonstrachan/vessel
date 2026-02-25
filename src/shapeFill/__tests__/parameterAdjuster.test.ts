import { adjustParameterFromCursor } from '../parameterAdjuster';
import { getParameterDefault } from '../parameters';
import { ShapeDefinition } from '../types';

const shape: ShapeDefinition = {
  id: 'shape',
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ],
  centroid: { x: 50, y: 50 },
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
};

describe('adjustParameterFromCursor', () => {
  it('clamps spacing to defined range', () => {
    const cursor = { x: 500, y: 500 };
    const value = adjustParameterFromCursor(shape, cursor, 'spacing');

    expect(value).toBeLessThanOrEqual(200);
    expect(value).toBeGreaterThanOrEqual(1);
  });

  it('wraps rotation values', () => {
    const cursor = { x: 400, y: 50 };
    const base = getParameterDefault('rotation');
    const value = adjustParameterFromCursor(shape, cursor, 'rotation', {
      baseValue: base,
    });

    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(180);
  });
});
