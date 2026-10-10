import { runPressureLinkedLiveDitherPass } from '../strokeLivePressurePass';
import { resolveCommittedPressurePixelSize } from '../strokePressureDither';

describe('resolveCommittedPressurePixelSize', () => {
  it('commits the first stroke resolution and keeps the shrink/grow stability policy', () => {
    const committedPixelSizeRef = { current: null as number | null };
    const pendingPixelSizeRef = { current: null as number | null };
    const pendingSinceRef = { current: 0 };
    const resolve = (desiredPixelSize: number, now: number) => resolveCommittedPressurePixelSize({
      desiredPixelSize,
      now,
      committedPixelSizeRef,
      pendingPixelSizeRef,
      pendingSinceRef,
    });

    expect(resolve(8, 100)).toBe(8);
    expect(committedPixelSizeRef.current).toBe(8);
    expect(pendingPixelSizeRef.current).toBeNull();

    expect(resolve(4, 110)).toBe(4);
    expect(committedPixelSizeRef.current).toBe(4);
    expect(resolve(8, 120)).toBe(4);
    expect(resolve(8, 189)).toBe(4);
    expect(resolve(8, 190)).toBe(8);
    expect(committedPixelSizeRef.current).toBe(8);
    expect(pendingPixelSizeRef.current).toBeNull();
  });

  it('requires a new growth target to remain stable after initialization', () => {
    const committedPixelSizeRef = { current: null as number | null };
    const pendingPixelSizeRef = { current: null as number | null };
    const pendingSinceRef = { current: 0 };
    const resolve = (desiredPixelSize: number, now: number) => resolveCommittedPressurePixelSize({
      desiredPixelSize,
      now,
      committedPixelSizeRef,
      pendingPixelSizeRef,
      pendingSinceRef,
    });

    expect(resolve(2, 100)).toBe(2);
    expect(resolve(4, 110)).toBe(2);
    expect(resolve(6, 170)).toBe(2);
    expect(resolve(6, 239)).toBe(2);
    expect(resolve(6, 240)).toBe(6);
  });
});

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
