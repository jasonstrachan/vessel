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

  it('caps pressure-linked tile scale to standardized max resolution', () => {
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
      pixelSize: 32,
      patternStyle: 'dots' as const,
      bgFill: true,
      pressureLinked: true,
      seed: 7,
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
      pressure: 1,
      pressureSize: 4,
      primaryIndex: 5,
      flowSlot: 1,
      cycleSpeed: 1,
      width,
      height,
      isAnimating: false,
    });

    expect(state.stampDitherStrokeScale).toBeLessThanOrEqual(64);
  });

  it('finalize uses the selected ordered or pattern algorithm on mouse-up', () => {
    const width = 16;
    const height = 16;
    const stateFactory = () => {
      const size = width * height;
      const tag = new Uint32Array(size);
      for (let i = 0; i < size; i += 1) {
        tag[i] = (1 << 16) | 1;
      }
      return {
        paintBuffer: new Uint8Array(size),
        gradientIdBuffer: new Uint8Array(size),
        speedBuffer: new Uint8Array(size),
        stampDitherPrimaryBuffer: new Uint8Array(size).fill(11),
        stampDitherTag: tag,
        stampDitherBounds: { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 },
        stampDitherStrokeEpoch: 1,
        stampDitherStampSeq: 1,
        stampDitherStrokeScale: 1,
        stampDitherLockedBucket: Math.floor(stampDither.STAMP_DITHER_BUCKETS / 2),
      };
    };

    const runFinalize = (algorithm: 'bayer' | 'blue-noise' | 'void-and-cluster' | 'pattern') => {
      const animator = buildAnimator(width, height);
      const state = stateFactory();
      const didFinalize = stampDither.finalizeStampDither({
        animator: animator as unknown as Parameters<typeof stampDither.finalizeStampDither>[0]['animator'],
        state,
        config: {
          algorithm,
          pixelSize: 1,
          patternStyle: algorithm === 'pattern' ? 'crosshatch' : 'dots',
          bgFill: true,
          pressureLinked: false,
          seed: 17,
        },
        width,
        height,
        flowSlot: 3,
        cycleSpeed: 1,
        ditherStrength: 1,
      });

      expect(didFinalize).toBe(true);
      expect(animator.handle.data.some((value) => value === 11)).toBe(true);
      expect(animator.handle.data.some((value) => value === stampDither.resolveStampDitherSecondaryIndex(11))).toBe(true);

      return Array.from(animator.handle.data);
    };

    const bayer = runFinalize('bayer');
    const blueNoise = runFinalize('blue-noise');
    const voidAndCluster = runFinalize('void-and-cluster');
    const pattern = runFinalize('pattern');

    expect(bayer).not.toEqual(blueNoise);
    expect(bayer).not.toEqual(voidAndCluster);
    expect(bayer).not.toEqual(pattern);
  });

  it('uses the selected ASCII pattern style for stamp dither pattern finalization', () => {
    const width = 16;
    const height = 16;
    const size = width * height;
    const tag = new Uint32Array(size);
    for (let i = 0; i < size; i += 1) {
      tag[i] = (1 << 16) | 1;
    }
    const animator = buildAnimator(width, height);
    const state = {
      paintBuffer: new Uint8Array(size),
      gradientIdBuffer: new Uint8Array(size),
      speedBuffer: new Uint8Array(size),
      stampDitherPrimaryBuffer: new Uint8Array(size).fill(11),
      stampDitherTag: tag,
      stampDitherBounds: { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 },
      stampDitherStrokeEpoch: 1,
      stampDitherStampSeq: 1,
      stampDitherStrokeScale: 1,
      stampDitherLockedBucket: Math.floor(stampDither.STAMP_DITHER_BUCKETS / 2),
    };

    const didFinalize = stampDither.finalizeStampDither({
      animator: animator as unknown as Parameters<typeof stampDither.finalizeStampDither>[0]['animator'],
      state,
      config: {
        algorithm: 'pattern',
        pixelSize: 1,
        patternStyle: 'ascii',
        bgFill: true,
        pressureLinked: false,
        seed: 17,
      },
      width,
      height,
      flowSlot: 3,
      cycleSpeed: 1,
      ditherStrength: 1,
    });

    expect(didFinalize).toBe(true);
    expect(animator.handle.data.some((value) => value === 11)).toBe(true);
    expect(animator.handle.data.some((value) => value === stampDither.resolveStampDitherSecondaryIndex(11))).toBe(true);
  });

  it('uses every selected pattern style for stamp dither pattern finalization', () => {
    const width = 32;
    const height = 32;
    const size = width * height;
    const patternStyles = [
      'dots',
      'lines',
      'vertical-lines',
      'horizontal-lines',
      'crosshatch',
      'diagonal',
      'ascii',
      'tone-adaptive',
    ] as const;

    const buildState = () => {
      const tag = new Uint32Array(size);
      for (let i = 0; i < size; i += 1) {
        tag[i] = (1 << 16) | 1;
      }
      return {
        paintBuffer: new Uint8Array(size),
        gradientIdBuffer: new Uint8Array(size),
        speedBuffer: new Uint8Array(size),
        stampDitherPrimaryBuffer: new Uint8Array(size).fill(11),
        stampDitherTag: tag,
        stampDitherBounds: { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 },
        stampDitherStrokeEpoch: 1,
        stampDitherStampSeq: 1,
        stampDitherLockedBucket: Math.floor(stampDither.STAMP_DITHER_BUCKETS / 2),
      };
    };

    const rendered = patternStyles.map((patternStyle) => {
      const animator = buildAnimator(width, height);
      const didFinalize = stampDither.finalizeStampDither({
        animator: animator as unknown as Parameters<typeof stampDither.finalizeStampDither>[0]['animator'],
        state: buildState(),
        config: {
          algorithm: 'pattern',
          pixelSize: 1,
          patternStyle,
          bgFill: true,
          pressureLinked: false,
          seed: 17,
        },
        width,
        height,
        flowSlot: 3,
        cycleSpeed: 1,
        ditherStrength: 1,
      });

      expect(didFinalize).toBe(true);
      expect(animator.handle.data.some((value) => value === 11)).toBe(true);
      expect(animator.handle.data.some((value) => value === stampDither.resolveStampDitherSecondaryIndex(11))).toBe(true);
      return [patternStyle, Array.from(animator.handle.data).join(',')] as const;
    });

    const uniqueOutputs = new Set(rendered.map(([, output]) => output));
    expect(uniqueOutputs.size).toBeGreaterThan(1);
    for (const [, output] of rendered) {
      expect(output).not.toHaveLength(0);
    }
  });

  it('uses the current resolution slider value when no per-stamp scale metadata exists', () => {
    const width = 32;
    const height = 32;
    const size = width * height;
    const buildState = () => {
      const tag = new Uint32Array(size);
      for (let i = 0; i < size; i += 1) {
        tag[i] = (1 << 16) | 1;
      }
      return {
        paintBuffer: new Uint8Array(size),
        gradientIdBuffer: new Uint8Array(size),
        speedBuffer: new Uint8Array(size),
        stampDitherPrimaryBuffer: new Uint8Array(size).fill(11),
        stampDitherTag: tag,
        stampDitherBounds: { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 },
        stampDitherStrokeEpoch: 1,
        stampDitherStampSeq: 1,
        stampDitherStrokeScale: 1,
        stampDitherLockedBucket: Math.floor(stampDither.STAMP_DITHER_BUCKETS / 2),
      };
    };
    const runFinalize = (pixelSize: number) => {
      const animator = buildAnimator(width, height);
      const didFinalize = stampDither.finalizeStampDither({
        animator: animator as unknown as Parameters<typeof stampDither.finalizeStampDither>[0]['animator'],
        state: buildState(),
        config: {
          algorithm: 'pattern',
          pixelSize,
          patternStyle: 'diagonal',
          bgFill: true,
          pressureLinked: false,
          seed: 17,
        },
        width,
        height,
        flowSlot: 3,
        cycleSpeed: 1,
        ditherStrength: 1,
      });

      expect(didFinalize).toBe(true);
      return Array.from(animator.handle.data);
    };

    expect(runFinalize(1)).not.toEqual(runFinalize(8));
  });

  it('uses selected pattern styles and resolution during live stamp application', () => {
    const width = 32;
    const height = 32;
    const size = width * height;
    const runtime = stampDither.createStampDitherRuntime();
    const patternStyles = [
      'dots',
      'lines',
      'vertical-lines',
      'horizontal-lines',
      'crosshatch',
      'diagonal',
      'ascii',
      'tone-adaptive',
    ] as const;

    const runApply = (patternStyle: (typeof patternStyles)[number], pixelSize: number) => {
      const animator = buildAnimator(width, height);
      const state = {
        paintBuffer: new Uint8Array(size),
        gradientIdBuffer: new Uint8Array(size),
        speedBuffer: new Uint8Array(size),
        stampDitherStrokeEpoch: 1,
        stampDitherStampSeq: 0,
      };
      const result = stampDither.applyStampDitherStamp({
        animator: animator as unknown as Parameters<typeof stampDither.applyStampDitherStamp>[0]['animator'],
        state,
        config: {
          algorithm: 'pattern',
          pixelSize,
          patternStyle,
          bgFill: true,
          pressureLinked: false,
          seed: 17,
        },
        runtime,
        stampShape: 'square',
        x: 16,
        y: 16,
        pressure: 1,
        pressureSize: 24,
        primaryIndex: 11,
        flowSlot: 3,
        cycleSpeed: 1,
        width,
        height,
        isAnimating: false,
      });

      expect(result.didApply).toBe(true);
      expect(animator.handle.data.some((value) => value === 11)).toBe(true);
      expect(animator.handle.data.some((value) => value === stampDither.resolveStampDitherSecondaryIndex(11))).toBe(true);
      return Array.from(animator.handle.data);
    };

    for (const style of patternStyles) {
      runApply(style, 1);
    }
    expect(runApply('diagonal', 1)).not.toEqual(runApply('diagonal', 8));
  });

  it('scales the checkered stamp cells with brush size', () => {
    const width = 20;
    const height = 20;
    const animator = buildAnimator(width, height);
    const runtime = stampDither.createStampDitherRuntime();
    const config = {
      algorithm: 'sierra-lite' as const,
      pixelSize: 2,
      patternStyle: 'dots' as const,
      bgFill: true,
      pressureLinked: false,
      seed: 7,
    };

    const buildState = (): StampDitherState & {
      paintBuffer: Uint8Array;
      gradientIdBuffer: Uint8Array;
      speedBuffer: Uint8Array;
    } => ({
      paintBuffer: new Uint8Array(width * height),
      gradientIdBuffer: new Uint8Array(width * height),
      speedBuffer: new Uint8Array(width * height),
      stampDitherStrokeEpoch: 1,
      stampDitherStampSeq: 0,
    });

    const smallState = buildState();
    stampDither.applyStampDitherStamp({
      animator: animator as unknown as Parameters<typeof stampDither.applyStampDitherStamp>[0]['animator'],
      state: smallState,
      config,
      runtime,
      stampShape: 'checkered',
      x: 10,
      y: 10,
      pressure: 1,
      pressureSize: 4,
      primaryIndex: 5,
      flowSlot: 1,
      cycleSpeed: 1,
      width,
      height,
      isAnimating: false,
    });
    const smallCoverage = Array.from(smallState.stampDitherPrimaryBuffer ?? []).filter((value) => value === 5).length;

    const largeState = buildState();
    stampDither.applyStampDitherStamp({
      animator: animator as unknown as Parameters<typeof stampDither.applyStampDitherStamp>[0]['animator'],
      state: largeState,
      config,
      runtime,
      stampShape: 'checkered',
      x: 10,
      y: 10,
      pressure: 1,
      pressureSize: 8,
      primaryIndex: 5,
      flowSlot: 1,
      cycleSpeed: 1,
      width,
      height,
      isAnimating: false,
    });
    const largeCoverage = Array.from(largeState.stampDitherPrimaryBuffer ?? []).filter((value) => value === 5).length;

    expect(smallCoverage).toBe(8);
    expect(largeCoverage).toBe(32);
  });
});
