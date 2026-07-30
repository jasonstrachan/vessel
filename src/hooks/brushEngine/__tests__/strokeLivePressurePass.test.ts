import { runPressureLinkedLiveDitherPass } from '../strokeLivePressurePass';

describe('runPressureLinkedLiveDitherPass', () => {
  it.each([
    {
      pressureDitherSmoosh: true,
      expectedRegion: { x: 0, y: 0, width: 100, height: 100 },
    },
    {
      pressureDitherSmoosh: false,
      expectedRegion: { x: 20, y: 20, width: 10, height: 10 },
    },
  ])(
    'uses $expectedRegion when Smoosh is $pressureDitherSmoosh and pressure resolution changes',
    ({ pressureDitherSmoosh, expectedRegion }) => {
      const ditherRegionWithCurrentPressure = jest.fn();
      const ditherCtx = {
        canvas: { width: 200, height: 200 },
        clearRect: jest.fn(),
      } as unknown as CanvasRenderingContext2D;
      const rawCtx = {} as CanvasRenderingContext2D;

      runPressureLinkedLiveDitherPass({
        ditherCtx,
        rawCtx,
        fullBounds: { x: 0, y: 0, width: 100, height: 100 },
        segmentBounds: { x: 20, y: 20, width: 10, height: 10 },
        bgOff: false,
        getStrokeDitherPixelSize: () => 4,
        committedPixelSizeRef: { current: 8 },
        pendingPixelSizeRef: { current: null },
        pendingSinceRef: { current: 0 },
        lastPressureDitherTimeRef: { current: 0 },
        lastPressureDitherPixelSizeRef: { current: 8 },
        pressureDitherMinIntervalMs: 0,
        pressureDitherMinDeltaRes: 0,
        ditherRegionWithCurrentPressure,
        liveStrokeBoundsRef: { current: null },
        liveDirtyRectRef: {
          current: { x: 20, y: 20, width: 10, height: 10 },
        },
        enableLargeRegionFallback: false,
        pressureDitherSmoosh,
      });

      expect(ditherRegionWithCurrentPressure).toHaveBeenCalledWith(
        ditherCtx,
        expectedRegion,
        rawCtx,
        expect.objectContaining({ overridePixelSize: 4 }),
      );
    },
  );
});
