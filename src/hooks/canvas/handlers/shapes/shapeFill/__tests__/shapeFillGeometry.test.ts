import {
  computeShapeFillBoundingBox,
  getShapeFillPolygonForMode,
  hasVisibleShapeFillOverlayPixels,
  shapeFillBoundingBoxToRoi,
} from '../shapeFillGeometry';

describe('shapeFillGeometry', () => {
  it('computes padded ROI clamped to the project bounds', () => {
    const bbox = computeShapeFillBoundingBox([
      { x: 4.2, y: 6.8 },
      { x: 22.4, y: 18.1 },
      { x: -3.2, y: 12.5 },
    ]);

    expect(bbox).toEqual({ minX: -3.2, minY: 6.8, maxX: 22.4, maxY: 18.1 });
    expect(shapeFillBoundingBoxToRoi(bbox, { width: 30, height: 24 })).toEqual({
      x: 0,
      y: 0,
      width: 30,
      height: 24,
    });
  });

  it('snaps only pixel-perfect polygons', () => {
    const points = [
      { x: 0.2, y: 0.7 },
      { x: 9.6, y: 10.4 },
    ];

    expect(getShapeFillPolygonForMode(points, false)).toBe(points);
    expect(getShapeFillPolygonForMode(points, true)).toEqual([
      { x: 0, y: 1 },
      { x: 10, y: 10 },
    ]);
  });

  it('detects visible overlay pixels inside the commit ROI only', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    expect(hasVisibleShapeFillOverlayPixels(canvas, { x: 0, y: 0, width: 8, height: 8 })).toBe(false);

    ctx.fillStyle = '#ff0000';
    ctx.fillRect(6, 6, 1, 1);

    expect(hasVisibleShapeFillOverlayPixels(canvas, { x: 0, y: 0, width: 4, height: 4 })).toBe(false);
    expect(hasVisibleShapeFillOverlayPixels(canvas, { x: 4, y: 4, width: 4, height: 4 })).toBe(true);
  });
});
