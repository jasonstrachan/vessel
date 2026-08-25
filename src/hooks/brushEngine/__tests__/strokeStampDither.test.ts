import { resolveSierraLiteBinaryField } from '@/lib/colorCycle/gobletPlaybackMath';
import { createCumulativeThresholdResolver } from '@/utils/ditherPatterns/cumulativeThresholdPattern';
import { PRESSURE_RESOLUTION_MAX_PX } from '@/utils/pressureResolution';

import * as stampDither from '../strokeStampDither';
import {
  clearStampDitherRuntime,
  createStampDitherRuntime,
  getImageTileResolverCacheKey,
} from '../strokeStampDither/runtime';
import { getStampDitherTile } from '../strokeStampDither/tile';
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

  it('uses the shared registered Sierra interruption at zero Variety and canonical Sierra above zero', () => {
    const runtime = createStampDitherRuntime(0);
    const tileSize = 64;
    const build = (diversity: number) => getStampDitherTile(
      runtime,
      32,
      1,
      tileSize,
      'sierra-lite',
      'dots',
      undefined,
      diversity,
    );
    const zero = build(0);
    const full = build(1);
    expect(full).toEqual(build(1));
    expect(Array.from(full)).not.toEqual(Array.from(zero));
    const expected = resolveSierraLiteBinaryField({
      width: tileSize,
      height: tileSize,
      mix: 0.5,
      diversity: 0,
    });
    expect(zero).toEqual(Uint8Array.from(expected, (bit) => bit === 1 ? 0 : 255));
  });

  it('keeps zero-Variety CC stroke masks flat across seeds, colours, and stamp shapes', () => {
    const width = 32;
    const height = 32;
    type StampShape = Parameters<typeof stampDither.applyStampDitherStamp>[0]['stampShape'];

    const run = (seed: number, primaryIndex: number, stampShape: StampShape) => {
      const animator = buildAnimator(width, height);
      const state: StampDitherState & {
        paint: Uint8Array;
        gradientIdBuffer: Uint8Array;
        speedBuffer: Uint8Array;
      } = {
        paint: new Uint8Array(width * height),
        gradientIdBuffer: new Uint8Array(width * height),
        speedBuffer: new Uint8Array(width * height),
        stampDitherStrokeEpoch: 1,
        stampDitherStampSeq: 0,
      };
      const config = {
        algorithm: 'sierra-lite' as const,
        pixelSize: 1,
        patternStyle: 'dots' as const,
        bgFill: true,
        pressureLinked: false,
        seed,
        diversity: 0,
      };
      const runtime = stampDither.createStampDitherRuntime(0);
      const secondaryIndex = stampDither.resolveStampDitherSecondaryIndex(primaryIndex);

      stampDither.applyStampDitherStamp({
        animator: animator as unknown as Parameters<typeof stampDither.applyStampDitherStamp>[0]['animator'],
        state,
        config,
        runtime,
        stampShape,
        x: 16,
        y: 16,
        pressure: 1,
        pressureSize: 20,
        primaryIndex,
        flowSlot: 1,
        cycleSpeed: 1,
        width,
        height,
        isAnimating: true,
      });

      expect(state.stampDitherLockedBucket).toBe(stampDither.STAMP_DITHER_FLAT_BUCKET);
      expect(state.stampDitherOrigin).toEqual({ x: 0, y: 0 });

      const readActiveMask = (data: Uint8Array) => {
        let activeCount = 0;
        const mask = new Uint8Array(width * height);
        state.stampDitherTag?.forEach((tag, index) => {
          if ((tag >>> 16) !== 1 || (tag & 0xffff) === 0) return;
          activeCount += 1;
          expect([primaryIndex, secondaryIndex]).toContain(data[index]);
          mask[index] = data[index] === primaryIndex ? 1 : 0;
        });
        expect(activeCount).toBeGreaterThan(0);
        return mask;
      };

      const liveMask = readActiveMask(animator.handle.data);
      expect(stampDither.finalizeStampDither({
        animator: animator as unknown as Parameters<typeof stampDither.finalizeStampDither>[0]['animator'],
        state,
        config,
        runtime,
        width,
        height,
        flowSlot: 1,
        cycleSpeed: 1,
        ditherStrength: 1,
      })).toBe(true);
      expect(readActiveMask(animator.handle.data)).toEqual(liveMask);

      return {
        active: Array.from(state.stampDitherTag ?? [], (tag) => (
          (tag >>> 16) === 1 && (tag & 0xffff) > 0
        )),
        choice: Array.from(state.stampDitherChoice ?? []),
      };
    };

    const square = run(1, 5, 'square');
    expect(square).toEqual(run(0xfedcba98, 180, 'square'));
    const round = run(7, 40, 'round');
    const triangle = run(99, 220, 'triangle');

    for (const other of [round, triangle]) {
      let overlap = 0;
      square.active.forEach((isSquareActive, index) => {
        if (!isSquareActive || !other.active[index]) return;
        overlap += 1;
        expect(other.choice[index]).toBe(square.choice[index]);
      });
      expect(overlap).toBeGreaterThan(0);
    }
  });

  it('keeps image-tile resolver cache identity runtime-local', () => {
    const resolver = () => 0.5;
    const firstRuntime = createStampDitherRuntime(0);
    const secondRuntime = createStampDitherRuntime(0);

    expect(getImageTileResolverCacheKey(firstRuntime, resolver)).toBe('1');
    expect(getImageTileResolverCacheKey(firstRuntime, resolver)).toBe('1');
    expect(getImageTileResolverCacheKey(secondRuntime, resolver)).toBe('1');
  });

  it('clears runtime-local resolver ids with the derived tile cache version', () => {
    const resolver = () => 0.5;
    const runtime = createStampDitherRuntime(1);

    expect(getImageTileResolverCacheKey(runtime, resolver)).toBe('1');
    clearStampDitherRuntime(runtime, 2);

    expect(runtime.builtFromVersion).toBe(2);
    expect(getImageTileResolverCacheKey(runtime, resolver)).toBe('1');
  });

  it('keeps a 1px dithered square stamp to one pixel', () => {
    const width = 8;
    const height = 8;
    const animator = buildAnimator(width, height);
    const state = {
      paint: new Uint8Array(width * height),
      gradientIdBuffer: new Uint8Array(width * height),
      speedBuffer: new Uint8Array(width * height),
      stampDitherStrokeEpoch: 1,
      stampDitherStampSeq: 0,
    };

    const result = stampDither.applyStampDitherStamp({
      animator: animator as unknown as Parameters<typeof stampDither.applyStampDitherStamp>[0]['animator'],
      state,
      config: {
        algorithm: 'sierra-lite',
        pixelSize: 1,
        patternStyle: 'dots',
        bgFill: true,
        pressureLinked: false,
        seed: 1,
      },
      runtime: stampDither.createStampDitherRuntime(),
      stampShape: 'square',
      x: 4,
      y: 4,
      pressure: 1,
      pressureSize: 1,
      primaryIndex: 5,
      flowSlot: 1,
      cycleSpeed: 1,
      width,
      height,
      isAnimating: false,
    });

    expect(result.bounds).toEqual({ minX: 4, minY: 4, maxX: 4, maxY: 4 });
    expect(animator.handle.data.filter((value) => value !== 0)).toHaveLength(1);
  });

  it('no cross-stroke leakage when stampSeq repeats', () => {
    const width = 8;
    const height = 8;
    const animator = buildAnimator(width, height);
    const state: StampDitherState & {
      paint: Uint8Array;
      gradientIdBuffer: Uint8Array;
      speedBuffer: Uint8Array;
    } = {
      paint: new Uint8Array(width * height),
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
      paint: Uint8Array;
      gradientIdBuffer: Uint8Array;
      speedBuffer: Uint8Array;
    } = {
      paint: new Uint8Array(width * height),
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
      paint: Uint8Array;
      gradientIdBuffer: Uint8Array;
      speedBuffer: Uint8Array;
    } = {
      paint: new Uint8Array(width * height),
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

    state.paint.fill(7);
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

    state.paint.fill(9);
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

  it('does not preserve shape gradient def bindings when restoring dither base pixels', () => {
    const width = 16;
    const height = 16;
    const animator = buildAnimator(width, height);
    const state: StampDitherState & {
      paint: Uint8Array;
      gradientIdBuffer: Uint8Array;
      gradientDefIdBuffer: Uint16Array;
      speedBuffer: Uint8Array;
    } = {
      paint: new Uint8Array(width * height),
      gradientIdBuffer: new Uint8Array(width * height),
      gradientDefIdBuffer: new Uint16Array(width * height),
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

    state.paint.fill(11);
    state.gradientIdBuffer.fill(3);
    state.gradientDefIdBuffer.fill(7);

    stampDither.applyStampDitherStamp({
      animator: animator as unknown as Parameters<typeof stampDither.applyStampDitherStamp>[0]['animator'],
      state,
      config,
      runtime,
      stampShape: 'round',
      x: 8,
      y: 8,
      pressure: 1,
      pressureSize: 8,
      primaryIndex: 5,
      flowSlot: 1,
      cycleSpeed: 1,
      width,
      height,
      isAnimating: false,
    });

    const restoredBasePixels: number[] = [];
    state.stampDitherTag?.forEach((tag, index) => {
      const isCurrentStrokePixel = (tag >>> 16) === 1 && (tag & 0xffff) > 0;
      if (isCurrentStrokePixel && animator.handle.data[index] === 11) {
        restoredBasePixels.push(index);
      }
    });

    expect(restoredBasePixels.length).toBeGreaterThan(0);
    restoredBasePixels.forEach((index) => {
      expect(animator.handle.gradientId[index]).toBe(3);
      expect(state.gradientDefIdBuffer[index]).toBe(0);
    });
  });

  it.each([
    'square',
    'checkered',
    'round',
    'diamond',
    'diamond5',
    'diamond7',
    'diamond9',
    'triangle',
  ] as const)('updates pressure-linked tile scale for the %s stamp', (stampShape) => {
    const width = 48;
    const height = 48;
    const config = {
      algorithm: 'sierra-lite' as const,
      pixelSize: 12,
      patternStyle: 'dots' as const,
      bgFill: true,
      pressureLinked: true,
      seed: 42,
    };
    const resolveScale = (pressure: number) => {
      const animator = buildAnimator(width, height);
      const state = {
        paint: new Uint8Array(width * height),
        gradientIdBuffer: new Uint8Array(width * height),
        speedBuffer: new Uint8Array(width * height),
        stampDitherStrokeScale: 1,
      };
      stampDither.applyStampDitherStamp({
        animator: animator as unknown as Parameters<typeof stampDither.applyStampDitherStamp>[0]['animator'],
        state,
        config,
        runtime: stampDither.createStampDitherRuntime(),
        stampShape,
        x: 24,
        y: 24,
        pressure,
        pressureSize: 20,
        primaryIndex: 5,
        flowSlot: 1,
        cycleSpeed: 1,
        width,
        height,
        isAnimating: false,
      });
      return state.stampDitherStrokeScale ?? 0;
    };

    expect(resolveScale(0)).toBe(1);
    expect(resolveScale(1)).toBe(PRESSURE_RESOLUTION_MAX_PX);
  });

  it('caps pressure-linked tile scale to standardized max resolution', () => {
    const width = 16;
    const height = 16;
    const animator = buildAnimator(width, height);
    const state = {
      paint: new Uint8Array(width * height),
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
        paint: new Uint8Array(size),
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
        runtime: stampDither.createStampDitherRuntime(0),
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
      paint: new Uint8Array(size),
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
      runtime: stampDither.createStampDitherRuntime(0),
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
        paint: new Uint8Array(size),
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
        runtime: stampDither.createStampDitherRuntime(0),
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
        paint: new Uint8Array(size),
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
        runtime: stampDither.createStampDitherRuntime(0),
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
        paint: new Uint8Array(size),
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

  it('uses descriptor coverage policy for generic cumulative stroke stages', () => {
    const lockedBucket = Math.floor(stampDither.STAMP_DITHER_BUCKETS / 2);
    const makeResolver = (coveragePolicy: 'fixed' | 'local-tone' | 'mark-tone-map') =>
      createCumulativeThresholdResolver({
        definition: {
          id: `synthetic-${coveragePolicy}`,
          name: 'Synthetic',
          kind: 'cumulative-threshold',
          width: 2,
          height: 1,
          coveragePolicy,
          payloadHash: `sha256:${coveragePolicy === 'fixed' ? '1' : coveragePolicy === 'local-tone' ? '2' : '3'}`.padEnd(71, '0'),
          storageScope: 'local-library',
          ...(coveragePolicy === 'fixed' ? { fixedTone: 0.25 } : {}),
          ...(coveragePolicy === 'mark-tone-map'
            ? {
                toneMap: [
                  { maxInput: 0.5, tone: 0.2 },
                  { maxInput: 1, tone: 0.9 },
                ],
              }
            : {}),
        },
        thresholds: new Uint8Array([32, 192]),
      });
    const localToneResolver = makeResolver('local-tone');
    const markToneResolver = makeResolver('mark-tone-map');
    const fixedResolver = makeResolver('fixed');

    const lowLocal = stampDither.resolveStampDitherPatternBucket(
      lockedBucket,
      'image-tile',
      40,
      localToneResolver,
    );
    const highLocal = stampDither.resolveStampDitherPatternBucket(
      lockedBucket,
      'image-tile',
      230,
      localToneResolver,
    );
    expect(lowLocal).toBeLessThan(highLocal);
    expect(stampDither.resolveStampDitherPatternBucket(
      lockedBucket,
      'image-tile',
      230,
      markToneResolver,
    )).toBe(lockedBucket);
    expect(stampDither.resolveStampDitherPatternBucket(
      lockedBucket,
      'image-tile',
      230,
      markToneResolver,
      true,
    )).toBeGreaterThan(lockedBucket);
    expect(stampDither.resolveStampDitherPatternBucket(
      lockedBucket,
      'image-tile',
      230,
      fixedResolver,
    )).toBeLessThan(lockedBucket);
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
      paint: Uint8Array;
      gradientIdBuffer: Uint8Array;
      speedBuffer: Uint8Array;
    } => ({
      paint: new Uint8Array(width * height),
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
