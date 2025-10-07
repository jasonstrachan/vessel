import { describe, expect, it } from '@jest/globals';
import { __contourPolygonTestUtils } from '../contourPolygon';
import type { BrushSettings } from '@/types';

const snap = (value: number) => Math.round(value * 10) / 10;

describe('contour polygon helpers', () => {
  it('serializes vertices into path input', () => {
    const vertices = [
      { x: 0, y: 0 },
      { x: 10.2, y: 0 },
      { x: 10.2, y: 5.4 },
    ];

    const path = __contourPolygonTestUtils.toPathInput(vertices, snap);

    expect(path.commands).toEqual(['moveTo', 'lineTo', 'lineTo', 'closePath']);
    const points = Array.from(path.points);
    expect(points).toHaveLength(6);
    expect(points[0]).toBeCloseTo(0, 4);
    expect(points[1]).toBeCloseTo(0, 4);
    expect(points[2]).toBeCloseTo(10.2, 4);
    expect(points[3]).toBeCloseTo(0, 4);
    expect(points[4]).toBeCloseTo(10.2, 4);
    expect(points[5]).toBeCloseTo(5.4, 4);
  });

  it('creates contour fill with spacing override and color', () => {
    const brushSettings = {
      opacity: 0.75,
      contourSpacing: 6,
      contourSmoothness: 0.7,
      shapeFillLineWidth: 3,
      color: '#336699',
    } as Partial<BrushSettings> as BrushSettings;

    const fill = __contourPolygonTestUtils.createContourFill(brushSettings, '#ff00ff', 8);

    expect(fill.type).toBe('contour');
    expect(fill.spacing).toBe(8);
    expect(fill.join).toBe('round');
    expect(fill.base.type).toBe('solid');
    const base = fill.base;
    if (base.type !== 'solid') {
      throw new Error('expected solid fill base');
    }
    const rounded = base.rgba.map(value => Number(value.toFixed(3)));
    expect(rounded).toEqual([1, 0, 1, 0.75]);
  });
});
