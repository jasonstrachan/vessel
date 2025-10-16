import { dashesFill } from '../dashes';
import { FillParams, FillResult, ShapeDefinition, Vec2 } from '../../types';
import { computeBounds, computeCentroid } from '../../utils/geometry';

function createShape(points: Vec2[]): ShapeDefinition {
  return {
    id: 'test-shape',
    points,
    centroid: computeCentroid(points),
    bounds: computeBounds(points),
  };
}

describe('dashesFill', () => {
  it('responds to rotation parameter changes', () => {
    const squareSize = 50;
    const shape = createShape([
      { x: 0, y: 0 },
      { x: squareSize, y: 0 },
      { x: squareSize, y: squareSize },
      { x: 0, y: squareSize },
    ]);

    const baseParams: FillParams = {
      spacing: 6,
      rotation: 0,
      thickness: 2,
      variance: 0,
      seed: 1234,
      dashLength: 14,
      dashLengthJitter: 0,
      dashWeightJitter: 0,
      scatter: 0,
      nearFalloff: 1,
      farFalloff: 1,
      angleDrift: 0,
      angleScale: 420,
    };

    const result45 = dashesFill(shape, { ...baseParams, rotation: 45 });
    const result0 = dashesFill(shape, { ...baseParams, rotation: 0 });

    const orientation45 = averageOrientation(result45);
    const orientation0 = averageOrientation(result0);
    const difference = smallestOrientationDiff(orientation45, orientation0);

    expect(difference).toBeGreaterThan(10);
    expect(result45.strokeSegments && result45.strokeSegments.length).toBeTruthy();
    expect(result45.dotInstances?.length ?? 0).toBeGreaterThan(0);
  });

  it('applies weight jitter when enabled', () => {
    const shape = createShape([
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 60 },
      { x: 0, y: 60 },
    ]);

    const baseParams: FillParams = {
      spacing: 8,
      rotation: 0,
      thickness: 3,
      variance: 0,
      seed: 99,
      dashLength: 12,
      dashWeightJitter: 0,
    };

    const noJitter = dashesFill(shape, baseParams);
    const allWidths = collectWidths(noJitter);
    expect(allWidths.size).toBeLessThanOrEqual(1);

    const jittered = dashesFill(shape, { ...baseParams, dashWeightJitter: 0.6 });
    const jitteredWidths = collectWidths(jittered);
    expect(jitteredWidths.size).toBeGreaterThan(1);
  });
});

function collectWidths(result: FillResult): Set<number> {
  const widths = new Set<number>();
  result.strokeSegments?.forEach(segment => {
    widths.add(Number(segment.lineWidth.toFixed(3)));
  });
  return widths;
}

function averageOrientation(result: FillResult): number {
  let sumX = 0;
  let sumY = 0;
  result.strokeSegments?.forEach(segment => {
    const points = segment.points;
    if (points.length < 2) {
      return;
    }
    const start = points[0];
    const end = points[points.length - 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-3) {
      return;
    }
    const angle = Math.atan2(dy, dx);
    sumX += Math.cos(2 * angle) * length;
    sumY += Math.sin(2 * angle) * length;
  });

  if (sumX === 0 && sumY === 0) {
    return 0;
  }

  const avgAngle = 0.5 * Math.atan2(sumY, sumX);
  const deg = (avgAngle * 180) / Math.PI;
  return normalize180(deg);
}

function smallestOrientationDiff(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 180 - diff);
}

function normalize180(value: number): number {
  const wrapped = ((value % 180) + 180) % 180;
  return wrapped;
}
