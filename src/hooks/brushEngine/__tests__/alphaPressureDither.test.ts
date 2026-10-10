import {
  createAlphaPressureDitherRuntime,
  type AlphaPressureDitherArgs,
} from '../alphaPressureDither';
import { ditherRegionWithCurrentPressure } from '../strokeDitherRegion';
import type { Rect } from '../engineShared';
import { defaultBrushSettings } from '@/presets/brushPresets';
import { BrushShape, type BrushSettings } from '@/types';

// Canvas is the I/O boundary; diffusion, coarse-cell sampling and owned writes
// execute the production implementations against these exact RGBA buffers.
const createSurface = (width = 64, height = 64) => {
  let pixels = new Uint8ClampedArray(width * height * 4);
  const canvas = {
    width,
    height,
    getContext: () => ctx,
  };
  const ctx = {
    canvas,
    save: jest.fn(),
    restore: jest.fn(),
    setTransform: jest.fn(),
    clearRect: (x: number, y: number, w: number, h: number) => {
      if (pixels.length !== canvas.width * canvas.height * 4) {
        pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
      }
      for (let py = y; py < y + h; py += 1) {
        for (let px = x; px < x + w; px += 1) {
          pixels.fill(0, (py * canvas.width + px) * 4, (py * canvas.width + px) * 4 + 4);
        }
      }
    },
    getImageData: (x: number, y: number, w: number, h: number) => {
      const result = new ImageData(w, h);
      for (let py = 0; py < h; py += 1) {
        for (let px = 0; px < w; px += 1) {
          const src = ((py + y) * canvas.width + px + x) * 4;
          result.data.set(pixels.subarray(src, src + 4), (py * w + px) * 4);
        }
      }
      return result;
    },
    putImageData: (image: ImageData, x: number, y: number) => {
      for (let py = 0; py < image.height; py += 1) {
        for (let px = 0; px < image.width; px += 1) {
          const src = (py * image.width + px) * 4;
          pixels.set(image.data.subarray(src, src + 4), ((py + y) * canvas.width + px + x) * 4);
        }
      }
    },
  } as unknown as CanvasRenderingContext2D;
  return { canvas: canvas as unknown as HTMLCanvasElement, ctx };
};

const stamp = (ctx: CanvasRenderingContext2D, rect: Rect, alpha: number | ((x: number, y: number) => number)) => {
  const image = ctx.getImageData(rect.x, rect.y, rect.width, rect.height);
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const a = typeof alpha === 'number' ? alpha : alpha(rect.x + x, rect.y + y);
      if (a === 0) continue;
      const i = (y * rect.width + x) * 4;
      image.data.set([255, 255, 255, Math.round(a + image.data[i + 3] * (1 - a / 255))], i);
    }
  }
  ctx.putImageData(image, rect.x, rect.y);
};

const makeHarness = (smoosh = false, fillBackground = false) => {
  const raw = createSurface();
  const dither = createSurface();
  const support = createSurface();
  const runtime = createAlphaPressureDitherRuntime({ createCanvas: () => support.canvas });
  const settings: BrushSettings = {
    ...defaultBrushSettings,
    brushShape: BrushShape.SQUARE,
    color: '#ffffff',
    ditherEnabled: true,
    ditherAlgorithm: 'sierra-lite',
    ditherBackgroundFill: fillBackground,
    fillResolution: 8,
    ditherPaletteSpread: 0,
  };
  const ditherRegion = jest.fn<ReturnType<AlphaPressureDitherArgs['ditherRegionWithCurrentPressure']>, Parameters<AlphaPressureDitherArgs['ditherRegionWithCurrentPressure']>>((ctx, region, sampleCtx, options) => {
    ditherRegionWithCurrentPressure({
      ctx,
      region,
      sampleCtx,
      options,
      signal: 'alpha',
      toolsBrushSettings: settings,
      strokeDitherPalette: ['#000000', '#ffffff'],
      transparentInk: [0, 0, 0],
      computeStrokeDitherPaletteForSettings: () => ['#000000', '#ffffff'],
      pickTransparentInk: () => [0, 0, 0],
      computePressureScaledResolution: () => 8,
      getStrokeDitherPixelSize: () => 8,
      applyLostEdgeToStrokeAlpha: jest.fn(),
      ensureBgOffTemp: jest.fn(),
      ensureBgOffHole: jest.fn(),
      bgOffMaskImageRef: { current: null },
      strokePhaseOriginRef: { current: { x: 0, y: 0 } },
      DD: jest.fn(),
    });
  });
  const args: AlphaPressureDitherArgs = {
    rawCtx: raw.ctx,
    ditherCtx: dither.ctx,
    fullBounds: { x: 0, y: 0, width: 64, height: 64 },
    desiredPixelSize: 8,
    now: 100,
    bgOff: !fillBackground,
    pressureDitherSmoosh: smoosh,
    committedPixelSizeRef: { current: null },
    pendingPixelSizeRef: { current: null },
    pendingSinceRef: { current: 0 },
    lastPressureDitherTimeRef: { current: 0 },
    lastPressureDitherPixelSizeRef: { current: null },
    pressureDitherMinIntervalMs: 55,
    pressureDitherMinDeltaRes: 1.25,
    ditherRegionWithCurrentPressure: ditherRegion,
    liveStrokeBoundsRef: { current: null },
    liveDirtyRectRef: { current: null },
  };
  const draw = (rect: Rect, alpha: number | ((x: number, y: number) => number), desired: number, now: number) => {
    args.desiredPixelSize = desired;
    args.now = now;
    const supportCtx = runtime.beforeRender(args);
    stamp(raw.ctx, rect, alpha);
    stamp(supportCtx, rect, alpha);
    runtime.afterRender(args);
  };
  const image = (rect = args.fullBounds) => dither.ctx.getImageData(rect.x, rect.y, rect.width, rect.height).data;
  return { args, runtime, raw, support, ditherRegion, draw, image };
};

describe('alpha pressure authored-support runs', () => {
  it('creates and reuses support with the same CPU rasterization as raw strokes', () => {
    const h = makeHarness();
    const getContext = jest.spyOn(h.support.canvas, 'getContext');
    h.draw({ x: 8, y: 8, width: 1, height: 1 }, 16, 1, 100);
    h.draw({ x: 9, y: 8, width: 1, height: 1 }, 48, 1, 160);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
    expect(h.support.ctx.getImageData(8, 8, 1, 1).data[3]).toBe(16);
    expect(h.support.ctx.getImageData(9, 8, 1, 1).data[3]).toBe(48);
  });

  it.each([false, true])('protects an older island inside a disconnected U-shaped run (background=%s)', (fillBackground) => {
    const h = makeHarness(false, fillBackground);
    const island = { x: 24, y: 24, width: 16, height: 16 };
    h.draw(island, 128, 8, 100);
    const before = h.image(island);
    h.draw({ x: 48, y: 8, width: 8, height: 48 }, 128, 2, 110);
    h.draw({ x: 8, y: 48, width: 48, height: 8 }, 128, 2, 170);
    h.draw({ x: 8, y: 8, width: 8, height: 8 }, 128, 2, 230);
    h.runtime.flush();
    expect(h.image(island)).toEqual(before);
    expect(h.support.ctx.getImageData(24, 24, 16, 16).data.every((byte) => byte === 0)).toBe(true);
    expect(h.image().some((byte) => byte > 0)).toBe(true);
    for (const [, region, sampleCtx] of h.ditherRegion.mock.calls) {
      expect(region).toEqual(h.args.fullBounds);
      expect(sampleCtx).toBe(h.raw.ctx);
    }
  });

  it('owns a saturated overlap even when cumulative raw alpha does not change', () => {
    const h = makeHarness();
    h.draw({ x: 16, y: 16, width: 32, height: 32 }, (x, y) => x === 24 && y === 24 ? 255 : 1, 8, 100);
    const before = h.image();
    const rawBefore = h.raw.ctx.getImageData(24, 24, 1, 1).data;
    h.draw({ x: 24, y: 24, width: 1, height: 1 }, 32, 1, 110);
    expect(h.raw.ctx.getImageData(24, 24, 1, 1).data).toEqual(rawBefore);
    expect(h.support.ctx.getImageData(24, 24, 1, 1).data[3]).toBe(32);
    const after = h.image();
    expect(before[(24 * 64 + 24) * 4 + 3]).toBe(0);
    expect(after[(24 * 64 + 24) * 4 + 3]).toBe(255);
    after.set(before.subarray((24 * 64 + 24) * 4, (24 * 64 + 24) * 4 + 4), (24 * 64 + 24) * 4);
    expect(after).toEqual(before);
  });

  it('preserves old pixels in transparent holes and between disconnected dash marks', () => {
    const h = makeHarness();
    h.draw({ x: 8, y: 8, width: 48, height: 48 }, 128, 8, 100);
    const before = h.image();
    const owns = (x: number, y: number) => x % 12 < 4 && y % 12 < 4;
    h.draw({ x: 8, y: 8, width: 48, height: 48 }, (x, y) => owns(x, y) ? 64 : 0, 1, 110);
    h.runtime.flush();
    const after = h.image();
    let changedOwned = 0;
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const i = (y * 64 + x) * 4;
        const changed = after.slice(i, i + 4).some((byte, offset) => byte !== before[i + offset]);
        if (x >= 8 && x < 56 && y >= 8 && y < 56 && owns(x, y)) {
          if (changed) changedOwned += 1;
        } else {
          expect(changed).toBe(false);
        }
      }
    }
    expect(changedOwned).toBeGreaterThan(0);
  });

  it('keeps throttled support after preview dirty clearing and closes it before the next run', () => {
    const h = makeHarness();
    h.draw({ x: 8, y: 8, width: 8, height: 8 }, 128, 8, 100);
    h.args.liveDirtyRectRef.current = null;
    h.draw({ x: 24, y: 24, width: 8, height: 8 }, 255, 8, 110);
    expect(h.ditherRegion).toHaveBeenCalledTimes(1);
    expect(h.image({ x: 24, y: 24, width: 8, height: 8 }).every((byte) => byte === 0)).toBe(true);
    h.args.desiredPixelSize = 2;
    h.args.now = 120;
    const nextSupport = h.runtime.beforeRender(h.args);
    expect(h.ditherRegion).toHaveBeenCalledTimes(2);
    expect(h.ditherRegion.mock.calls[1][3]?.overridePixelSize).toBe(8);
    expect(h.image({ x: 24, y: 24, width: 8, height: 8 }).some((byte) => byte > 0)).toBe(true);
    expect(nextSupport.getImageData(0, 0, 64, 64).data.every((byte) => byte === 0)).toBe(true);
    const previous = h.image();
    stamp(h.raw.ctx, { x: 48, y: 48, width: 8, height: 8 }, 128);
    stamp(nextSupport, { x: 48, y: 48, width: 8, height: 8 }, 128);
    h.runtime.afterRender(h.args);
    expect(h.image({ x: 24, y: 24, width: 8, height: 8 })).toEqual(
      (() => {
        const data = new Uint8ClampedArray(8 * 8 * 4);
        for (let y = 0; y < 8; y += 1) data.set(previous.subarray(((y + 24) * 64 + 24) * 4, ((y + 24) * 64 + 32) * 4), y * 8 * 4);
        return data;
      })(),
    );
  });

  it('force-flushes a buffered tail at the last accepted size without re-reading desired pressure', () => {
    const h = makeHarness();
    h.draw({ x: 8, y: 8, width: 8, height: 8 }, 128, 8, 100);
    const tail = { x: 40, y: 40, width: 8, height: 8 };
    stamp(h.raw.ctx, tail, 255);
    stamp(h.support.ctx, tail, 255);
    h.args.desiredPixelSize = 1;
    h.args.committedPixelSizeRef.current = 1;
    h.runtime.flush();
    expect(h.ditherRegion).toHaveBeenCalledTimes(2);
    expect(h.ditherRegion.mock.calls[1][3]?.overridePixelSize).toBe(8);
    expect(h.image(tail).some((byte) => byte > 0)).toBe(true);
    const before = h.image();
    h.runtime.flush();
    expect(h.image()).toEqual(before);
  });

  it('publishes pending old-run input before preview so a later U run cannot change its frozen island', () => {
    const h = makeHarness();
    const island = { x: 24, y: 24, width: 16, height: 16 };
    h.draw(island, 128, 8, 100);
    const stalePreview = h.image(island);
    h.args.liveDirtyRectRef.current = null;
    h.draw(island, 128, 8, 110);
    expect(h.ditherRegion).toHaveBeenCalledTimes(1);
    expect(h.image(island)).toEqual(stalePreview);

    h.runtime.flushPending(120);
    const frozen = h.image(island);
    expect(frozen).not.toEqual(stalePreview);
    expect(h.ditherRegion).toHaveBeenCalledTimes(2);
    expect(h.ditherRegion.mock.calls[1][3]?.overridePixelSize).toBe(8);
    expect(h.args.lastPressureDitherTimeRef.current).toBe(120);
    h.args.liveDirtyRectRef.current = null;
    h.runtime.flushPending(125);
    expect(h.ditherRegion).toHaveBeenCalledTimes(2);

    h.draw({ x: 48, y: 8, width: 8, height: 48 }, 128, 2, 130);
    h.runtime.flushPending(140);
    h.draw({ x: 8, y: 48, width: 48, height: 8 }, 128, 2, 150);
    h.runtime.flushPending(160);
    h.draw({ x: 8, y: 8, width: 8, height: 8 }, 128, 2, 170);
    h.runtime.flushPending(180);
    expect(h.image(island)).toEqual(frozen);
    expect(h.support.ctx.getImageData(24, 24, 16, 16).data.every((byte) => byte === 0)).toBe(true);
  });

  it('lets Smoosh rewrite the full stroke at a changed resolution', () => {
    const off = makeHarness(false);
    const on = makeHarness(true);
    const island = { x: 16, y: 16, width: 16, height: 16 };
    for (const h of [off, on]) h.draw(island, 128, 8, 100);
    const before = off.image(island);
    for (const h of [off, on]) h.draw({ x: 48, y: 48, width: 8, height: 8 }, 128, 1, 110);
    expect(off.image(island)).toEqual(before);
    expect(on.image(island)).not.toEqual(before);
    expect(on.ditherRegion.mock.calls[1][3]?.writeSupportMask).toBeUndefined();
    expect(off.ditherRegion.mock.calls[1][3]?.writeSupportMask).toBeDefined();
  });

  it('retains growth stability and resets support between strokes', () => {
    const h = makeHarness();
    const rect = { x: 8, y: 8, width: 8, height: 8 };
    h.draw(rect, 128, 8, 100);
    h.draw(rect, 128, 2, 110);
    h.draw(rect, 128, 8, 120);
    expect(h.args.committedPixelSizeRef.current).toBe(2);
    h.draw(rect, 128, 8, 189);
    expect(h.args.committedPixelSizeRef.current).toBe(2);
    h.draw(rect, 128, 8, 190);
    expect(h.args.committedPixelSizeRef.current).toBe(8);
    h.runtime.reset();
    expect(h.support.ctx.getImageData(0, 0, 64, 64).data.every((byte) => byte === 0)).toBe(true);
    const callCount = h.ditherRegion.mock.calls.length;
    h.runtime.flush();
    expect(h.ditherRegion).toHaveBeenCalledTimes(callCount);
    h.args.committedPixelSizeRef.current = null;
    h.draw({ x: 48, y: 48, width: 8, height: 8 }, 128, 4, 300);
    expect(h.args.committedPixelSizeRef.current).toBe(4);
    expect(h.support.ctx.getImageData(8, 8, 8, 8).data.every((byte) => byte === 0)).toBe(true);
  });
});
