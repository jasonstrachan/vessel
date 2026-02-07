import { runLivePressureDitherForCurrentStroke } from '../livePressureDitherController';

describe('livePressureDitherController', () => {
  it('returns early when dither context is unavailable', () => {
    const runPressureLinkedLiveDitherPass = jest.fn();

    runLivePressureDitherForCurrentStroke({
      rawCtx: {} as CanvasRenderingContext2D,
      segmentBounds: { x: 0, y: 0, width: 10, height: 10 },
      enableLargeRegionFallback: false,
      liveStrokeDitherRef: { current: null },
      strokeBoundsRef: { current: null },
      ditherBackgroundFill: false,
      pick2D: jest.fn(() => null),
      runPressureLinkedLiveDitherPass,
      getStrokeDitherPixelSize: jest.fn(() => 2),
      committedPixelSizeRef: { current: null },
      pendingPixelSizeRef: { current: null },
      pendingSinceRef: { current: 0 },
      lastPressureDitherTimeRef: { current: 0 },
      lastPressureDitherPixelSizeRef: { current: null },
      pressureDitherMinIntervalMs: 30,
      pressureDitherMinDeltaRes: 0.75,
      ditherRegionWithCurrentPressure: jest.fn(),
      liveStrokeBoundsRef: { current: null },
      liveDirtyRectRef: { current: null },
    });

    expect(runPressureLinkedLiveDitherPass).not.toHaveBeenCalled();
  });

  it('forwards assembled payload to pressure-linked dither pass', () => {
    const ditherCtx = {} as CanvasRenderingContext2D;
    const rawCtx = {} as CanvasRenderingContext2D;
    const runPressureLinkedLiveDitherPass = jest.fn();

    runLivePressureDitherForCurrentStroke({
      rawCtx,
      segmentBounds: { x: 5, y: 6, width: 20, height: 24 },
      enableLargeRegionFallback: true,
      liveStrokeDitherRef: { current: document.createElement('canvas') },
      strokeBoundsRef: { current: { x: 1, y: 2, width: 50, height: 60 } },
      ditherBackgroundFill: false,
      pick2D: jest.fn(() => ditherCtx),
      runPressureLinkedLiveDitherPass,
      getStrokeDitherPixelSize: jest.fn(() => 3),
      committedPixelSizeRef: { current: 3 },
      pendingPixelSizeRef: { current: null },
      pendingSinceRef: { current: 0 },
      lastPressureDitherTimeRef: { current: 10 },
      lastPressureDitherPixelSizeRef: { current: 3 },
      pressureDitherMinIntervalMs: 30,
      pressureDitherMinDeltaRes: 0.75,
      ditherRegionWithCurrentPressure: jest.fn(),
      liveStrokeBoundsRef: { current: null },
      liveDirtyRectRef: { current: null },
    });

    expect(runPressureLinkedLiveDitherPass).toHaveBeenCalledWith(expect.objectContaining({
      ditherCtx,
      rawCtx,
      fullBounds: { x: 1, y: 2, width: 50, height: 60 },
      segmentBounds: { x: 5, y: 6, width: 20, height: 24 },
      bgOff: true,
      enableLargeRegionFallback: true,
    }));
  });
});

