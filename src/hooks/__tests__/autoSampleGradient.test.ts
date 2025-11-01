import { __TESTING__ } from '../useDrawingHandlers';

const {
  computeAutoSampleStopsFromPolyline,
  dedupePolylineForSampling,
  computePolylineLength,
  MIN_AUTO_SAMPLE_PREVIEW_DISTANCE
} = __TESTING__;

type Point = { x: number; y: number };

const sampleColor = (x: number, y: number): string => {
  const value = Math.max(0, Math.min(255, Math.round((x + y) % 256)));
  const hex = value.toString(16).padStart(2, '0');
  return `#${hex}${hex}${hex}`;
};

const equidistantSampler = (points: Point[], count: number): Point[] => {
  const deduped = dedupePolylineForSampling(points);
  if (deduped.length === 0) {
    return [];
  }
  if (deduped.length === 1 || count <= 1) {
    return [deduped[0]];
  }

  const totalLen = computePolylineLength(deduped);
  if (totalLen === 0) {
    return [deduped[0]];
  }

  const result: Point[] = [];
  const targetCount = Math.max(2, count);
  for (let i = 0; i < targetCount; i += 1) {
    const targetDistance = (i / Math.max(1, targetCount - 1)) * totalLen;
    let accumulated = 0;

    for (let segIndex = 0; segIndex < deduped.length - 1; segIndex += 1) {
      const start = deduped[segIndex];
      const end = deduped[segIndex + 1];
      const segLen = Math.hypot(end.x - start.x, end.y - start.y);

      if (accumulated + segLen >= targetDistance || segIndex === deduped.length - 2) {
        const t = segLen === 0 ? 0 : (targetDistance - accumulated) / segLen;
        result.push({
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * t
        });
        break;
      }

      accumulated += segLen;
    }
  }

  return result;
};

describe('computeAutoSampleStopsFromPolyline', () => {
  it('returns at least two stops when stroke length exceeds preview threshold', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 64, y: 2 },
      { x: 128, y: 0 }
    ];

    const stops = computeAutoSampleStopsFromPolyline(
      points,
      sampleColor,
      equidistantSampler,
      { minDistance: MIN_AUTO_SAMPLE_PREVIEW_DISTANCE }
    );

    expect(stops).not.toBeNull();
    expect(stops!.length).toBeGreaterThanOrEqual(2);
    expect(new Set(stops!.map(stop => stop.color)).size).toBeGreaterThan(1);
  });

  it('defers sampling when below minimum distance without fallback', () => {
    const shortStroke: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 }
    ];

    const stops = computeAutoSampleStopsFromPolyline(
      shortStroke,
      sampleColor,
      equidistantSampler,
      { minDistance: MIN_AUTO_SAMPLE_PREVIEW_DISTANCE }
    );

    expect(stops).toBeNull();
  });

  it('produces at least two stops for tiny strokes when fallback is allowed', () => {
    const tinyStroke: Point[] = [
      { x: 10, y: 10 },
      { x: 16, y: 12 }
    ];

    const stops = computeAutoSampleStopsFromPolyline(
      tinyStroke,
      sampleColor,
      equidistantSampler,
      {
        minDistance: MIN_AUTO_SAMPLE_PREVIEW_DISTANCE,
        allowTiny: true
      }
    );

    expect(stops).not.toBeNull();
    expect(stops!.length).toBeGreaterThanOrEqual(2);
  });
});

