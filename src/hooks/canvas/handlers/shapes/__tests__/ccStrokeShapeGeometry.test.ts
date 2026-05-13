import { buildCcStrokeShapeGeometry } from '@/hooks/canvas/handlers/shapes/ccStrokeShapeGeometry';
import type { BrushSettings } from '@/types';

const settings = (overrides: Partial<BrushSettings> = {}) =>
  ({
    size: 10,
    pressureEnabled: false,
    minPressure: 50,
    maxPressure: 100,
    ...overrides,
  }) as BrushSettings;

describe('buildCcStrokeShapeGeometry', () => {
  it('creates a square-capped rectangle for a straight horizontal stroke', () => {
    const geometry = buildCcStrokeShapeGeometry({
      samples: [
        { x: 10, y: 20, pressure: 0.5 },
        { x: 30, y: 20, pressure: 0.5 },
      ],
      brushSettings: settings(),
    });

    expect(geometry).not.toBeNull();
    expect(geometry?.shapePoints).toEqual([
      { x: 5, y: 25 },
      { x: 35, y: 25 },
      { x: 35, y: 15 },
      { x: 5, y: 15 },
    ]);
    expect(geometry?.direction).toEqual({ x: 1, y: 0 });
  });

  it('creates a stable perpendicular width for diagonal strokes', () => {
    const geometry = buildCcStrokeShapeGeometry({
      samples: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 10, y: 10, pressure: 0.5 },
      ],
      brushSettings: settings({ size: 10 }),
    });

    expect(geometry).not.toBeNull();
    const firstLeft = geometry!.shapePoints[0];
    const firstRight = geometry!.shapePoints[3];
    expect(Math.hypot(firstLeft.x - firstRight.x, firstLeft.y - firstRight.y)).toBeCloseTo(10, 5);
    expect(geometry!.direction.x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(geometry!.direction.y).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('ignores duplicate samples instead of creating invalid geometry', () => {
    const geometry = buildCcStrokeShapeGeometry({
      samples: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 0.05, y: 0.05, pressure: 0.9 },
        { x: 20, y: 0, pressure: 0.5 },
      ],
      brushSettings: settings(),
    });

    expect(geometry?.centerline).toHaveLength(2);
    expect(geometry?.shapePoints).toHaveLength(4);
  });

  it('preserves closed-loop strokes by deriving direction from a non-zero segment', () => {
    const geometry = buildCcStrokeShapeGeometry({
      samples: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 20, y: 0, pressure: 0.5 },
        { x: 20, y: 20, pressure: 0.5 },
        { x: 0, y: 20, pressure: 0.5 },
        { x: 0, y: 0, pressure: 0.5 },
      ],
      brushSettings: settings(),
    });

    expect(geometry).not.toBeNull();
    expect(geometry?.centerline).toHaveLength(5);
    expect(geometry?.shapePoints).toHaveLength(10);
    expect(geometry?.direction).toEqual({ x: 1, y: 0 });
  });

  it('increases width for later samples when pressure is enabled', () => {
    const geometry = buildCcStrokeShapeGeometry({
      samples: [
        { x: 0, y: 0, pressure: 0 },
        { x: 20, y: 0, pressure: 1 },
      ],
      brushSettings: settings({ pressureEnabled: true, minPressure: 50, maxPressure: 100 }),
    });

    expect(geometry).not.toBeNull();
    const startWidth = Math.hypot(
      geometry!.shapePoints[0].x - geometry!.shapePoints[3].x,
      geometry!.shapePoints[0].y - geometry!.shapePoints[3].y
    );
    const endWidth = Math.hypot(
      geometry!.shapePoints[1].x - geometry!.shapePoints[2].x,
      geometry!.shapePoints[1].y - geometry!.shapePoints[2].y
    );
    expect(endWidth).toBeGreaterThan(startWidth);
  });

  it('ignores sample pressure when pressure is disabled', () => {
    const geometry = buildCcStrokeShapeGeometry({
      samples: [
        { x: 0, y: 0, pressure: 0 },
        { x: 20, y: 0, pressure: 1 },
      ],
      brushSettings: settings({ pressureEnabled: false }),
    });

    expect(geometry).not.toBeNull();
    const startWidth = Math.hypot(
      geometry!.shapePoints[0].x - geometry!.shapePoints[3].x,
      geometry!.shapePoints[0].y - geometry!.shapePoints[3].y
    );
    const endWidth = Math.hypot(
      geometry!.shapePoints[1].x - geometry!.shapePoints[2].x,
      geometry!.shapePoints[1].y - geometry!.shapePoints[2].y
    );
    expect(startWidth).toBeCloseTo(10, 5);
    expect(endWidth).toBeCloseTo(10, 5);
  });
});
