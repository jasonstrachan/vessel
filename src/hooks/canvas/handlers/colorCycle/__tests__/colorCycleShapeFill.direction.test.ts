import { computeFallbackLinearDirection } from '@/hooks/canvas/handlers/colorCycle/colorCycleShapeFill';

const bruteForceDirection = (
  points: Array<{ x: number; y: number }>
): { x: number; y: number } => {
  let bestD2 = -1;
  let ax = points[0] ?? { x: 0, y: 0 };
  let bx = points[1] ?? points[0] ?? { x: 1, y: 0 };

  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dx = points[j].x - points[i].x;
      const dy = points[j].y - points[i].y;
      const d2 = dx * dx + dy * dy;
      if (d2 > bestD2) {
        bestD2 = d2;
        ax = points[i];
        bx = points[j];
      }
    }
  }

  const dx = bx.x - ax.x;
  const dy = bx.y - ax.y;
  const len = Math.hypot(dx, dy);
  return !Number.isFinite(len) || len < 1e-6
    ? { x: 1, y: 0 }
    : { x: dx / len, y: dy / len };
};

describe('computeFallbackLinearDirection', () => {
  it('matches brute-force farthest-pair direction for representative polygons', () => {
    const polygons = [
      [
        { x: 0, y: 0 },
        { x: 10, y: 2 },
        { x: 3, y: 9 },
        { x: -4, y: 4 },
        { x: 6, y: -5 },
      ],
      Array.from({ length: 96 }, (_, index) => {
        const t = index / 96;
        const angle = t * Math.PI * 2;
        const radius = 40 + Math.sin(index * 1.7) * 8;
        return {
          x: Math.cos(angle) * radius + Math.sin(index * 0.3) * 3,
          y: Math.sin(angle) * radius + Math.cos(index * 0.4) * 5,
        };
      }),
    ];

    for (const polygon of polygons) {
      const actual = computeFallbackLinearDirection(polygon);
      const expected = bruteForceDirection(polygon);

      expect(actual.x).toBeCloseTo(expected.x, 10);
      expect(actual.y).toBeCloseTo(expected.y, 10);
    }
  });

  it('handles large sampled drag polygons without quadratic pair scanning', () => {
    const points = Array.from({ length: 5000 }, (_, index) => {
      const angle = index * 0.17;
      const radius = 300 + (index % 37);
      return {
        x: Math.cos(angle) * radius + index * 0.01,
        y: Math.sin(angle) * radius,
      };
    });

    const direction = computeFallbackLinearDirection(points);
    const length = Math.hypot(direction.x, direction.y);

    expect(length).toBeCloseTo(1, 10);
  });
});
