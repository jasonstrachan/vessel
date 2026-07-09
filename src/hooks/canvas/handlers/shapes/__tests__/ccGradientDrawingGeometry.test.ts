import {
  buildClickLineGeometry,
  buildCcGradientDrawingGeometry,
  buildEllipseGeometry,
  buildLineGeometry,
  buildRectangleGeometry,
  buildTriangleGeometry,
} from '@/hooks/canvas/handlers/shapes/ccGradientDrawingGeometry';
import type { BrushSettings } from '@/types';

const brushSettings = (overrides: Partial<BrushSettings> = {}) =>
  ({
    size: 10,
    pressureEnabled: false,
    minPressure: 50,
    maxPressure: 100,
    ...overrides,
  }) as BrushSettings;

describe('ccGradientDrawingGeometry', () => {
  it('builds rectangle points with stable bounds and diagonal sample source', () => {
    const geometry = buildRectangleGeometry({
      start: { x: 30, y: 40 },
      end: { x: 10, y: 20 },
    });

    expect(geometry?.shapePoints).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 20 },
      { x: 30, y: 40 },
      { x: 10, y: 40 },
    ]);
    expect(geometry?.sampleSourcePoints).toEqual([
      { x: 30, y: 40 },
      { x: 10, y: 20 },
    ]);
    expect(geometry?.bounds).toEqual({ minX: 10, minY: 20, maxX: 30, maxY: 40 });
  });

  it('constrains rectangle drags to a square', () => {
    const geometry = buildRectangleGeometry({
      start: { x: 0, y: 0 },
      end: { x: 10, y: 4 },
      constrainAspect: true,
    });

    expect(geometry?.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('pixel-aligns constrained rectangle drags so raster bounds stay square', () => {
    const geometry = buildRectangleGeometry({
      start: { x: 0.2, y: 0.7 },
      end: { x: 40.6, y: 18.1 },
      constrainAspect: true,
    });

    expect(geometry?.bounds).toEqual({ minX: 0, minY: 1, maxX: 40, maxY: 41 });
    expect(geometry!.bounds.maxX - geometry!.bounds.minX).toBe(
      geometry!.bounds.maxY - geometry!.bounds.minY
    );
    expect(geometry?.direction?.x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(geometry?.direction?.y).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('keeps constrained rectangle sides on the existing grid when endpoints are grid-snapped', () => {
    const geometry = buildRectangleGeometry({
      start: { x: 8, y: 24 },
      end: { x: 48, y: 40 },
      constrainAspect: true,
    });

    expect(geometry?.bounds).toEqual({ minX: 8, minY: 24, maxX: 48, maxY: 64 });
    expect(geometry?.shapePoints.every((point) => point.x % 8 === 0 && point.y % 8 === 0)).toBe(true);
    expect(geometry?.direction?.x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(geometry?.direction?.y).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it.each([
    ['rectangle', buildRectangleGeometry],
    ['ellipse', buildEllipseGeometry],
    ['triangle', buildTriangleGeometry],
  ] as const)('keeps constrained zero-length and sub-pixel %s drags empty', (_shape, buildGeometry) => {
    expect(
      buildGeometry({
        start: { x: 8, y: 24 },
        end: { x: 8, y: 24 },
        constrainAspect: true,
      })
    ).toBeNull();

    expect(
      buildGeometry({
        start: { x: 8.2, y: 24.2 },
        end: { x: 8.6, y: 24.4 },
        constrainAspect: true,
      })
    ).toBeNull();
  });

  it('builds deterministic ellipse polygons with capped point count', () => {
    const geometry = buildEllipseGeometry({
      start: { x: 0, y: 0 },
      end: { x: 200, y: 100 },
    });

    expect(geometry).not.toBeNull();
    expect(geometry!.shapePoints.length).toBeLessThanOrEqual(48);
    expect(geometry!.shapePoints.length).toBeGreaterThanOrEqual(12);
    expect(geometry!.bounds.minX).toBeCloseTo(0, 5);
    expect(geometry!.bounds.maxX).toBeCloseTo(200, 5);
  });

  it('builds line geometry through swept-stroke width rules', () => {
    const geometry = buildLineGeometry({
      start: { x: 10, y: 20 },
      end: { x: 30, y: 20 },
      brushSettings: brushSettings({ size: 12 }),
      pressure: 0.5,
    });

    expect(geometry?.shapePoints).toEqual([
      { x: 4, y: 26 },
      { x: 36, y: 26 },
      { x: 36, y: 14 },
      { x: 4, y: 14 },
    ]);
    expect(geometry?.sampleSourcePoints).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 20 },
    ]);
    expect(geometry?.direction).toEqual({ x: 1, y: 0 });
  });

  it('snaps line geometry to 45 degree increments when constrained', () => {
    const geometry = buildLineGeometry({
      start: { x: 10, y: 20 },
      end: { x: 30, y: 28 },
      brushSettings: brushSettings({ size: 4 }),
      pressure: 0.5,
      constrainAspect: true,
    });

    expect(geometry?.sampleSourcePoints[0]).toEqual({ x: 10, y: 20 });
    expect(geometry?.sampleSourcePoints[1].x).toBeCloseTo(31.54, 2);
    expect(geometry?.sampleSourcePoints[1].y).toBeCloseTo(20, 5);
    expect(geometry?.direction?.x).toBeCloseTo(1, 5);
    expect(geometry?.direction?.y).toBeCloseTo(0, 5);
  });

  it('builds triangle geometry from drag bounds', () => {
    const geometry = buildTriangleGeometry({
      start: { x: 0, y: 0 },
      end: { x: 10, y: 20 },
    });

    expect(geometry?.shapePoints).toEqual([
      { x: 5, y: 0 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ]);
    expect(geometry?.sampleSourcePoints).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
    ]);
  });

  it('keeps polygon sample points identical to authored vertices', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 10, y: 10 },
    ];
    const geometry = buildCcGradientDrawingGeometry({
      drawingShape: 'polygon',
      points,
      brushSettings: brushSettings(),
    });

    expect(geometry?.shapePoints).toEqual(points);
    expect(geometry?.sampleSourcePoints).toEqual(points);
  });

  it('builds click-line geometry from committed boundary points', () => {
    const points = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
    ];
    const geometry = buildClickLineGeometry({
      points,
    });

    expect(geometry).not.toBeNull();
    expect(geometry!.shapePoints).toEqual(points);
    expect(geometry!.sampleSourcePoints).toEqual(points);
    expect(geometry!.bounds).toEqual({ minX: 10, minY: 10, maxX: 30, maxY: 30 });
  });

  it('rejects click-line geometry with fewer than three boundary points', () => {
    expect(
      buildClickLineGeometry({
        points: [{ x: 10, y: 10 }],
      })
    ).toBeNull();

    expect(
      buildClickLineGeometry({
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
        ],
      })
    ).toBeNull();
  });

  it('rejects duplicate final click-line points as boundary points', () => {
    expect(
      buildClickLineGeometry({
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
          { x: 30, y: 10 },
        ],
      })
    ).toBeNull();
  });

  it('includes preview point only in click-line preview geometry', () => {
    const committed = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ];
    const preview = buildClickLineGeometry({
      points: committed,
      previewPoint: { x: 20, y: 20 },
    });
    const final = buildClickLineGeometry({
      points: committed,
    });

    expect(preview?.sampleSourcePoints).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ]);
    expect(final).toBeNull();
  });
});
