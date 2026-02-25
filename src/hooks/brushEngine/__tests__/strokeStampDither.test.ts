import * as stampDither from '../strokeStampDither';
import type { StampDitherState } from '../strokeStampDither';

describe('strokeStampDither', () => {
  const buildAnimator = (width: number, height: number) => {
    const handle = {
      data: new Uint8Array(width * height),
      gradientId: new Uint8Array(width * height),
      speedData: new Uint8Array(width * height),
      width,
      height,
    };
    return {
      beginDirectFill: () => handle,
      endDirectFill: jest.fn(),
      markDirtyBounds: jest.fn(),
      hasWebGL: jest.fn(() => false),
      handle,
    };
  };

  it('no cross-stroke leakage when stampSeq repeats', () => {
    const width = 8;
    const height = 8;
    const animator = buildAnimator(width, height);
    const state: StampDitherState & {
      paintBuffer: Uint8Array;
      gradientIdBuffer: Uint8Array;
      speedBuffer: Uint8Array;
    } = {
      paintBuffer: new Uint8Array(width * height),
      gradientIdBuffer: new Uint8Array(width * height),
      speedBuffer: new Uint8Array(width * height),
      stampDitherStrokeEpoch: 1,
      stampDitherStampSeq: 0,
    };
    const runtime = stampDither.createStampDitherRuntime();
    const config = {
      algorithm: 'sierra-lite' as const,
      pixelSize: 2,
      patternStyle: 'dots' as const,
      bgFill: true,
      pressureLinked: false,
      seed: 1,
    };

    stampDither.applyStampDitherStamp({
      animator: animator as unknown as Parameters<typeof stampDither.applyStampDitherStamp>[0]['animator'],
      state,
      config,
      runtime,
      stampShape: 'round',
      x: 2,
      y: 2,
      pressure: 1,
      pressureSize: 4,
      primaryIndex: 5,
      flowSlot: 1,
      cycleSpeed: 1,
      width,
      height,
      isAnimating: false,
    });

    const before = animator.handle.data.slice();

    state.stampDitherStrokeEpoch = 2;
    state.stampDitherStampSeq = 0;
    stampDither.applyStampDitherStamp({
      animator: animator as unknown as Parameters<typeof stampDither.applyStampDitherStamp>[0]['animator'],
      state,
      config,
      runtime,
      stampShape: 'round',
      x: 6,
      y: 6,
      pressure: 1,
      pressureSize: 4,
      primaryIndex: 5,
      flowSlot: 1,
      cycleSpeed: 1,
      width,
      height,
      isAnimating: false,
    });

    const minX = 4;
    const minY = 4;
    const maxX = 7;
    const maxY = 7;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          continue;
        }
        const idx = y * width + x;
        expect(animator.handle.data[idx]).toBe(before[idx]);
      }
    }
  });

  it('apply uses tile index without calling resolver', () => {
    const width = 8;
    const height = 8;
    const animator = buildAnimator(width, height);
    const state: StampDitherState & {
      paintBuffer: Uint8Array;
      gradientIdBuffer: Uint8Array;
      speedBuffer: Uint8Array;
    } = {
      paintBuffer: new Uint8Array(width * height),
      gradientIdBuffer: new Uint8Array(width * height),
      speedBuffer: new Uint8Array(width * height),
      stampDitherStrokeEpoch: 1,
      stampDitherStampSeq: 0,
    };
    const runtime = stampDither.createStampDitherRuntime();
    const config = {
      algorithm: 'sierra-lite' as const,
      pixelSize: 2,
      patternStyle: 'dots' as const,
      bgFill: true,
      pressureLinked: false,
      seed: 123,
    };
    const spy = jest.spyOn(stampDither, 'resolveStampDitherTileSample');

    stampDither.applyStampDitherStamp({
      animator: animator as unknown as Parameters<typeof stampDither.applyStampDitherStamp>[0]['animator'],
      state,
      config,
      runtime,
      stampShape: 'round',
      x: 4,
      y: 4,
      pressure: 1,
      pressureSize: 4,
      primaryIndex: 5,
      flowSlot: 1,
      cycleSpeed: 1,
      width,
      height,
      isAnimating: false,
    });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('base capture is per-stroke without clears', () => {
    const width = 16;
    const height = 16;
    const animator = buildAnimator(width, height);
    const state: StampDitherState & {
      paintBuffer: Uint8Array;
      gradientIdBuffer: Uint8Array;
      speedBuffer: Uint8Array;
    } = {
      paintBuffer: new Uint8Array(width * height),
      gradientIdBuffer: new Uint8Array(width * height),
      speedBuffer: new Uint8Array(width * height),
      stampDitherStrokeEpoch: 1,
      stampDitherStampSeq: 0,
    };
    const config = {
      algorithm: 'sierra-lite' as const,
      pixelSize: 2,
      patternStyle: 'dots' as const,
      bgFill: false,
      pressureLinked: false,
      seed: 42,
    };
    const runtime = stampDither.createStampDitherRuntime();

    state.paintBuffer.fill(7);
    stampDither.applyStampDitherStamp({
      animator: animator as unknown as Parameters<typeof stampDither.applyStampDitherStamp>[0]['animator'],
      state,
      config,
      runtime,
      stampShape: 'round',
      x: 6,
      y: 6,
      pressure: 1,
      pressureSize: 4,
      primaryIndex: 5,
      flowSlot: 1,
      cycleSpeed: 1,
      width,
      height,
      isAnimating: false,
    });
    const baseIdx1 = state.stampDitherBaseIdx;
    const baseTag1 = state.stampDitherBaseTag;
    expect(baseIdx1).toBeDefined();
    expect(baseTag1).toBeDefined();

    state.paintBuffer.fill(9);
    state.stampDitherStrokeEpoch = 2;
    state.stampDitherStampSeq = 0;
    stampDither.applyStampDitherStamp({
      animator: animator as unknown as Parameters<typeof stampDither.applyStampDitherStamp>[0]['animator'],
      state,
      config,
      runtime,
      stampShape: 'round',
      x: 6,
      y: 6,
      pressure: 1,
      pressureSize: 4,
      primaryIndex: 5,
      flowSlot: 1,
      cycleSpeed: 1,
      width,
      height,
      isAnimating: false,
    });
    const idx = 6 * width + 6;
    expect(state.stampDitherBaseTag?.[idx]).toBe(2);
    expect(state.stampDitherBaseIdx?.[idx]).toBe(9);
  });

  it('updates pressure-linked tile scale with pressure changes', () => {
    const width = 16;
    const height = 16;
    const animator = buildAnimator(width, height);
    const state = {
      paintBuffer: new Uint8Array(width * height),
      gradientIdBuffer: new Uint8Array(width * height),
      speedBuffer: new Uint8Array(width * height),
      stampDitherStrokeScale: 1,
    };
    const config = {
      algorithm: 'sierra-lite' as const,
      pixelSize: 2,
      patternStyle: 'dots' as const,
      bgFill: true,
      pressureLinked: true,
      seed: 42,
    };
    const runtime = stampDither.createStampDitherRuntime();

    stampDither.applyStampDitherStamp({
      animator: animator as unknown as Parameters<typeof stampDither.applyStampDitherStamp>[0]['animator'],
      state,
      config,
      runtime,
      stampShape: 'round',
      x: 6,
      y: 6,
      pressure: 0.2,
      pressureSize: 4,
      primaryIndex: 5,
      flowSlot: 1,
      cycleSpeed: 1,
      width,
      height,
      isAnimating: false,
    });
    const firstScale = state.stampDitherStrokeScale ?? 0;

    stampDither.applyStampDitherStamp({
      animator: animator as unknown as Parameters<typeof stampDither.applyStampDitherStamp>[0]['animator'],
      state,
      config,
      runtime,
      stampShape: 'round',
      x: 8,
      y: 8,
      pressure: 1.0,
      pressureSize: 4,
      primaryIndex: 5,
      flowSlot: 1,
      cycleSpeed: 1,
      width,
      height,
      isAnimating: false,
    });

    expect(state.stampDitherStrokeScale).toBeGreaterThanOrEqual(firstScale);
  });
});
