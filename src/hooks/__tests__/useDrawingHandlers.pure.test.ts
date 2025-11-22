import { __TESTING__ } from '../useDrawingHandlers';

describe('useDrawingHandlers pure utilities', () => {
  const {
    computeStrokeCapturePadding,
    dedupePolylineForSampling,
    computePolylineLength,
    computeAutoSampleStopsFromPolyline,
    MIN_AUTO_SAMPLE_PREVIEW_DISTANCE,
    AUTO_SAMPLE_MAX_STOPS,
  } = __TESTING__;

  it('computes stroke padding for slider, custom brush and pressure', () => {
    const padding = computeStrokeCapturePadding(
      {
        size: 80,
        brushShape: 'round',
        pressureEnabled: true,
        maxPressure: 160,
        antialiasing: true,
      } as any,
      { width: 40, height: 20, isResampler: false } as any
    );

    // radius (max of brush size & maxPressure) / 2 + antialias/soft padding
    expect(padding).toBeGreaterThan(80);
    expect(padding).toBeCloseTo(82, 0);
  });

  it('dedupes polyline and measures length', () => {
    const pts = dedupePolylineForSampling([
      { x: 0, y: 0 },
      { x: 0.1, y: 0.1 },
      { x: 3, y: 4 },
    ], 0.2);

    expect(pts).toHaveLength(2);
    expect(computePolylineLength(pts)).toBeCloseTo(5, 5); // 3-4-5 triangle
  });

  it('builds auto sample stops with sampler fallback', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0, y: MIN_AUTO_SAMPLE_PREVIEW_DISTANCE + 10 },
    ];

    const sampleColor = jest.fn((x, y) => `${x},${y}`);
    const sampler = jest.fn(() => [{ x: 0, y: 0 }, { x: 0, y: 20 }]);

    const stops = computeAutoSampleStopsFromPolyline(pts, sampleColor, sampler, {
      maxStops: AUTO_SAMPLE_MAX_STOPS,
    });

    expect(stops).not.toBeNull();
    expect(stops).toHaveLength(2);
    expect(stops?.[1].position).toBe(1);
    expect(sampleColor).toHaveBeenCalled();
  });

  it('returns null for tiny polylines without allowTiny', () => {
    const result = computeAutoSampleStopsFromPolyline(
      [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      () => '#fff',
      () => [],
      { allowTiny: false }
    );

    expect(result).toBeNull();
  });
});
