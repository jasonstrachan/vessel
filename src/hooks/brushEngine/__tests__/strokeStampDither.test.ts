import { createCcBristleWriter } from '../ccBristles';
import { encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';
import { BAYER_4x4_MATRIX } from '@/utils/ditherAlgorithms';
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
  it('uses a repeating 4×4 matrix for stamp and replay masks', () => {
    const runtime = createStampDitherRuntime(0);
    const tile = getStampDitherTile(runtime, 32, 1, 64, 'bayer-4x4', 'dots');
    const legacy = getStampDitherTile(runtime, 32, 1, 64, 'bayer', 'dots');
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        expect(tile[y * 64 + x]).toBe(Math.round(BAYER_4x4_MATRIX[y % 4][x % 4] * 255));
      }
    }
    expect(tile).not.toEqual(legacy);
  });

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

  it.each([
    { algorithm: 'bayer-4x4', bgFill: true, pixelSize: 1, diversity: 0 },
    { algorithm: 'bayer-4x4', bgFill: false, pixelSize: 1, diversity: 0 },
    { algorithm: 'bayer-4x4', bgFill: true, pixelSize: 2, diversity: 1 },
    { algorithm: 'bayer-4x4', bgFill: false, pixelSize: 2, diversity: 1 },
    { algorithm: 'bayer', bgFill: true, pixelSize: 1, diversity: 1 },
    { algorithm: 'blue-noise', bgFill: true, pixelSize: 1, diversity: 1 },
    { algorithm: 'void-and-cluster', bgFill: true, pixelSize: 1, diversity: 1 },
  ] as const)('keeps $algorithm unchanged through recompose and release ($bgFill, $pixelSize)', (settings) => {
    const animator = buildAnimator(32, 32);
    const state: stampDither.StampDitherStrokeData = { paint: animator.handle.data };
    const runtime = stampDither.createStampDitherRuntime(0);
    const config: stampDither.StampDitherConfig = { ...settings, pressureLinked: false, seed: 17 };
    const brushAnimator = animator as unknown as Parameters<typeof stampDither.applyStampDitherStamp>[0]['animator'];
    stampDither.applyStampDitherStamp({
      animator: brushAnimator, state, config, runtime,
      stampShape: 'square', x: 16, y: 16, pressure: 1, pressureSize: 24,
      primaryIndex: 200, flowSlot: 1, cycleSpeed: 1, width: 32, height: 32, isAnimating: false,
    });
    const live = animator.handle.data.slice();
    expect(live.some((value) => value === 200)).toBe(true);
    stampDither.recomposeStampDitherOverlay({
      animator: brushAnimator, state, config, runtime,
      flowSlot: 1, cycleSpeed: 1, tileScale: config.pixelSize,
    });
    expect(animator.handle.data).toEqual(live);
    expect(stampDither.finalizeStampDither({
      animator: brushAnimator, state, config, runtime,
      width: 32, height: 32, flowSlot: 1, cycleSpeed: 1, ditherStrength: 1,
    })).toBe(true);
    expect(animator.handle.data).toEqual(live);
  });

  it('changes the secondary ink without changing stamp coverage or dither placement', () => {
    const draw = (inkOffset: number) => {
      const animator = buildAnimator(32, 32);
      const state = {
        paint: animator.handle.data,
        stampDitherInkOffset: inkOffset,
      };
      stampDither.applyStampDitherStamp({
        animator: animator as unknown as Parameters<typeof stampDither.applyStampDitherStamp>[0]['animator'],
        state,
        config: { algorithm: 'sierra-lite', pixelSize: 1, bgFill: true, pressureLinked: false, seed: 0, diversity: 0 },
        runtime: stampDither.createStampDitherRuntime(0),
        stampShape: 'round', x: 16, y: 16, pressure: 1, pressureSize: 20,
        primaryIndex: 200, flowSlot: 1, cycleSpeed: 1, width: 32, height: 32, isAnimating: true,
      });
      const beforeRecompose = animator.handle.data.slice();
      stampDither.recomposeStampDitherOverlay({
        animator: animator as unknown as Parameters<typeof stampDither.recomposeStampDitherOverlay>[0]['animator'],
        state,
        config: { algorithm: 'sierra-lite', pixelSize: 1, bgFill: true, pressureLinked: false, seed: 0, diversity: 0 },
        runtime: stampDither.createStampDitherRuntime(0),
        flowSlot: 1, cycleSpeed: 1, tileScale: 1,
      });
      expect(animator.handle.data).toEqual(beforeRecompose);
      expect(stampDither.finalizeStampDither({
        animator: animator as unknown as Parameters<typeof stampDither.finalizeStampDither>[0]['animator'],
        state,
        config: { algorithm: 'sierra-lite', pixelSize: 1, bgFill: true, pressureLinked: false, seed: 0, diversity: 0 },
        runtime: stampDither.createStampDitherRuntime(0),
        width: 32, height: 32, flowSlot: 1, cycleSpeed: 1, ditherStrength: 1,
      })).toBe(true);
      expect(animator.handle.data).toEqual(beforeRecompose);
      return animator.handle.data;
    };
    const narrow = draw(1);
    const wide = draw(127);
    expect(new Set(narrow)).toEqual(new Set([0, 200, 201]));
    expect(new Set(wide)).toEqual(new Set([0, 200, 72]));
    expect(narrow.map((ink) => ink === 200 ? 1 : 0)).toEqual(wide.map((ink) => ink === 200 ? 1 : 0));
    expect(narrow.map((ink) => ink > 0 ? 1 : 0)).toEqual(wide.map((ink) => ink > 0 ? 1 : 0));
  });

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

    state.stampSourceDistances = [0, 0, 100, 200, 300];
    state.stampSourcePoints = [{ x: 2, y: 2 }, { x: 99, y: 99 }];
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

    expect(state.stampSourceDistances).toEqual([0, 0]);
    expect(state.stampSourcePoints).toEqual([{ x: 6, y: 6 }]);
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

  it('preserves durable gradient bindings when restoring dither base pixels', () => {
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
      expect(state.gradientDefIdBuffer[index]).toBe(7);
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

describe('direct stamp metadata ownership', () => {
  const width = 32;
  const height = 32;
  const count = width * height;
  const ranks = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const tip = (x: number, y: number) => x >= 8 && x < 24 && y >= 8 && y < 24 && x < 22
    && (Math.floor((x - 8) / 4) + Math.floor((y - 8) / 4)) % 2 === 0;
  const primary = (x: number, y: number, scale: number) =>
    ranks[(Math.floor(y / scale) % 4) * 4 + Math.floor(x / scale) % 4] <= 8;
  type PhaseAtPixel = Parameters<typeof stampDither.applyStampDitherStamp>[0]['phaseAtPixel'];

  const fixture = (bgFill: boolean, oldFlow = 2) => {
    const handle = {
      data: new Uint8Array(count).fill(11),
      gradientId: new Uint8Array(count).fill(7),
      defIdData: new Uint16Array(count).fill(91),
      speedData: new Uint8Array(count).fill(33),
      phaseData: Uint8Array.from({ length: count }, (_, i) => 200 + i % 55),
      flowData: new Uint8Array(count).fill(oldFlow),
      width,
      height,
    };
    const animator = {
      beginDirectFill: () => handle,
      endDirectFill: jest.fn(),
      markDirtyBounds: jest.fn(),
      hasWebGL: () => false,
      getFlowMode: () => 'forward' as const,
    } as unknown as Parameters<typeof stampDither.applyStampDitherStamp>[0]['animator'];
    const state: stampDither.StampDitherStrokeData = {
      paint: handle.data,
      gradientIdBuffer: handle.gradientId,
      gradientDefIdBuffer: handle.defIdData,
      speedBuffer: handle.speedData,
      phaseBuffer: handle.phaseData,
      flowBuffer: handle.flowData,
      stampDitherStrokeEpoch: 1,
      stampDitherStampSeq: 0,
    };
    const config: stampDither.StampDitherConfig = {
      algorithm: 'bayer-4x4', pixelSize: 1, bgFill, pressureLinked: false, seed: 0, diversity: 0,
    };
    const runtime = stampDither.createStampDitherRuntime(0);
    const stamp = (phaseAtPixel?: PhaseAtPixel, scale = 1) => stampDither.applyStampDitherStamp({
      animator, state, config: { ...config, pixelSize: scale }, runtime, stampShape: 'checkered', x: 16, y: 16,
      pressure: 1, pressureSize: 16, primaryIndex: 11, flowSlot: 3, cycleSpeed: .5,
      width, height, isAnimating: false, acceptsPixel: x => x < 22, phaseAtPixel,
    });
    const replay = (scale: number) => stampDither.recomposeStampDitherOverlay({
      animator, state, config: { ...config, pixelSize: scale }, runtime,
      flowSlot: 3, cycleSpeed: .5, tileScale: scale,
    });
    const finalize = (scale: number) => stampDither.finalizeStampDither({
      animator, state, config: { ...config, pixelSize: scale }, runtime,
      width, height, flowSlot: 3, cycleSpeed: .5, ditherStrength: 1,
    });
    return { handle, state, stamp, replay, finalize };
  };

  const channels = (handle: ReturnType<typeof fixture>['handle'], index: number) => [
    handle.data[index], handle.gradientId[index], handle.defIdData[index],
    handle.speedData[index], handle.flowData[index], handle.phaseData[index],
  ];
  const installBristles = (f: ReturnType<typeof fixture>): PhaseAtPixel => {
    const intent = new Uint8Array(count);
    f.state.stampDitherPhaseIntent = intent;
    const write = createCcBristleWriter(intent, { x: 16, y: 16 }, null, 2, 50);
    return (index, x, y) => { write(index, x, y); return intent[index]; };
  };

  it.each([true, false])('ordinary BG=%s replaces phase only on admitted material', bg => {
    const f = fixture(bg);
    const original = f.handle.phaseData.slice();
    f.stamp();
    const differences: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const x = i % width, y = Math.floor(i / width);
      const admitted = tip(x, y) && (bg || primary(x, y, 1));
      const expected = admitted ? 0 : original[i];
      if (f.handle.phaseData[i] !== expected) differences.push({ x, y, admitted, expected, phase: f.handle.phaseData[i] });
    }
    expect(differences).toEqual([]);
  });

  it('restores old speed when BG-off membership changes from accepted to rejected', () => {
    const f = fixture(false);
    f.stamp();
    const becameHole: number[] = [], becameInk: number[] = [];
    for (let i = 0; i < count; i++) {
      const x = i % width, y = Math.floor(i / width);
      if (!tip(x, y)) continue;
      if (primary(x, y, 1) && !primary(x, y, 2)) becameHole.push(i);
      if (!primary(x, y, 1) && primary(x, y, 2)) becameInk.push(i);
    }
    expect(becameHole.length).toBeGreaterThan(0);
    expect(becameInk.length).toBeGreaterThan(0);
    becameHole.forEach(i => expect(f.handle.speedData[i]).toBe(encodeColorCycleSpeedByte(.5)));
    f.replay(2);
    expect(becameHole.map(i => f.handle.speedData[i])).toEqual(becameHole.map(() => 33));
  });

  it.each([false, true])('replays overlapping BG-off strokes and changed membership across all six planes (Bristles=%s)', bristles => {
    const f = fixture(false);
    const original = Array.from({ length: count }, (_, i) => channels(f.handle, i));
    const phaseAtPixel = bristles ? installBristles(f) : undefined;
    f.stamp(phaseAtPixel);
    f.stamp(phaseAtPixel);
    const intendedPhase = f.state.stampDitherPhaseIntent?.slice();
    let acceptedToHole = 0, holeToAccepted = 0;
    for (let i = 0; i < count; i++) {
      const x = i % width, y = Math.floor(i / width);
      if (!tip(x, y)) continue;
      acceptedToHole += Number(primary(x, y, 1) && !primary(x, y, 2));
      holeToAccepted += Number(!primary(x, y, 1) && primary(x, y, 2));
    }
    expect(acceptedToHole).toBeGreaterThan(0);
    expect(holeToAccepted).toBeGreaterThan(0);
    for (const scale of [2, 1]) {
      f.stamp(phaseAtPixel, scale);
      f.replay(scale);
      expect(f.finalize(scale)).toBe(true);
      const differences: unknown[] = [];
      for (let i = 0; i < count; i++) {
        const x = i % width, y = Math.floor(i / width);
        const admitted = tip(x, y) && primary(x, y, scale);
        const expected = admitted ? [11, 3, 0, encodeColorCycleSpeedByte(.5), 1, intendedPhase?.[i] ?? 0] : original[i];
        const actual = channels(f.handle, i);
        if (actual.some((value, j) => value !== expected[j])) differences.push({ x, y, scale, admitted, actual, expected });
      }
      expect(differences).toEqual([]);
    }
  });

  it('preserves complete direct-fill originals when optional state aliases are absent', () => {
    const f = fixture(false);
    const original = Array.from({ length: count }, (_, i) => channels(f.handle, i));
    delete f.state.gradientIdBuffer;
    delete f.state.gradientDefIdBuffer;
    delete f.state.speedBuffer;
    delete f.state.flowBuffer;
    delete f.state.phaseBuffer;
    f.stamp();
    for (const scale of [1, 2, 1]) {
      if (scale !== 1) f.stamp(undefined, scale);
      f.replay(scale);
      const differences: unknown[] = [];
      for (let i = 0; i < count; i++) {
        const x = i % width, y = Math.floor(i / width);
        const admitted = tip(x, y) && primary(x, y, scale);
        const expected = admitted ? [11, 3, 0, encodeColorCycleSpeedByte(.5), 1, 0] : original[i];
        const actual = channels(f.handle, i);
        if (actual.some((value, j) => value !== expected[j])) differences.push({ x, y, scale, admitted, actual, expected });
      }
      expect(differences).toEqual([]);
    }
  });

  it('reauthors legacy flow4 to current forward flow1 only on accepted material', () => {
    const f = fixture(false, 4);
    f.stamp();
    const differences: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const x = i % width, y = Math.floor(i / width);
      const admitted = tip(x, y) && primary(x, y, 1), expected = admitted ? 1 : 4;
      if (f.handle.flowData[i] !== expected) differences.push({ x, y, admitted, expected, flow: f.handle.flowData[i] });
    }
    expect(differences).toEqual([]);
  });

  it.each([true, false])('preserves explicit current Bristles through unchanged final replay (BG=%s)', bgFill => {
    const f = fixture(bgFill);
    f.stamp(installBristles(f));
    const held = f.handle.phaseData.slice();
    const strandPhases = held.filter((_, i) => tip(i % width, Math.floor(i / width)) && (bgFill || primary(i % width, Math.floor(i / width), 1)));
    expect(new Set(strandPhases).size).toBeGreaterThan(1);
    expect(f.finalize(1)).toBe(true);
    expect(f.handle.phaseData).toEqual(held);
  });
});
