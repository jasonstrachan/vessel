/* eslint-disable @typescript-eslint/no-explicit-any */
import { __TESTING__ } from '../useDrawingHandlers';

describe('useDrawingHandlers pure utilities', () => {
  const {
    computeStrokeCapturePadding,
    dedupePolylineForSampling,
    computePolylineLength,
    computeAutoSampleStopsFromPolyline,
    computeDitherGradSampleStopsFromPolyline,
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

  it('samples dither gradient stops anchored to start/end', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];

    const sampleColor = jest.fn((x, y) => `${x},${y}`);
    const sampler = jest.fn(() => [
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 15, y: 0 },
      { x: 25, y: 0 },
    ]);

    const stops = computeDitherGradSampleStopsFromPolyline(pts, sampleColor, sampler, 4);

    expect(stops).toEqual(['0,0', '10,0', '15,0', '20,0']);
    expect(sampler).toHaveBeenCalledWith(expect.any(Array), 4);
  });

  it('repeats the first sample when only one point is available', () => {
    const sampleColor = jest.fn((x, y) => `${x},${y}`);
    const sampler = jest.fn(() => []);
    const stops = computeDitherGradSampleStopsFromPolyline([{ x: 1, y: 2 }], sampleColor, sampler, 3);

    expect(stops).toEqual(['1,2', '1,2', '1,2']);
  });
});
