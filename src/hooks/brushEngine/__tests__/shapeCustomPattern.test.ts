import { BrushShape, type BrushSettings } from '@/types';
import { BrushEngineFacade } from '../BrushEngineFacade';
import { createShapeDrawer } from '../shapes';
import { CustomPatternCache, drawCustomPatternShape } from '../shapeCustomPattern';

type CacheableImageData = ImageData & { __vesselCacheKey?: string };

const createPattern = (cacheKey = 'pattern-a'): ImageData => {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create canvas context');
  }
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 2, 2);
  const imageData = ctx.getImageData(0, 0, 2, 2) as CacheableImageData;
  imageData.__vesselCacheKey = cacheKey;
  return imageData;
};

const createTargetContext = (): CanvasRenderingContext2D => {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create target context');
  }
  return ctx;
};

describe('CustomPatternCache', () => {
  it('reuses source and scaled pattern canvases through an explicit cache', () => {
    const cache = new CustomPatternCache();
    const pattern = createPattern();
    const targetCtx = createTargetContext();

    drawCustomPatternShape({
      targetCtx,
      drawX: 8,
      drawY: 8,
      size: 8,
      pattern,
      rotation: 0,
      cache,
    });
    drawCustomPatternShape({
      targetCtx,
      drawX: 12,
      drawY: 12,
      size: 8,
      pattern,
      rotation: 0,
      cache,
    });

    expect(cache.sourceSize).toBe(1);
    expect(cache.scaledSize).toBe(1);
    expect(cache.tintedSize).toBe(0);
  });

  it('keeps tinted pattern canvases in the explicit cache', () => {
    const cache = new CustomPatternCache();
    const pattern = createPattern();
    const targetCtx = createTargetContext();
    targetCtx.fillStyle = '#ff0000';

    drawCustomPatternShape({
      targetCtx,
      drawX: 8,
      drawY: 8,
      size: 8,
      pattern,
      rotation: 0,
      centerAlignment: true,
      cache,
    });
    drawCustomPatternShape({
      targetCtx,
      drawX: 12,
      drawY: 12,
      size: 8,
      pattern,
      rotation: 0,
      centerAlignment: true,
      cache,
    });

    expect(cache.sourceSize).toBe(1);
    expect(cache.scaledSize).toBe(1);
    expect(cache.tintedSize).toBe(1);
  });

  it('clears observable cache state and advances cacheVersion', () => {
    const cache = new CustomPatternCache();
    const pattern = createPattern();
    const targetCtx = createTargetContext();

    drawCustomPatternShape({
      targetCtx,
      drawX: 8,
      drawY: 8,
      size: 8,
      pattern,
      rotation: 0,
      cache,
    });

    expect(cache.cacheVersion).toBe(0);
    cache.clear();

    expect(cache.cacheVersion).toBe(1);
    expect(cache.sourceSize).toBe(0);
    expect(cache.scaledSize).toBe(0);
    expect(cache.tintedSize).toBe(0);
  });
});


describe('custom pattern rotation through the shared dispatcher', () => {
  const asymmetricPattern = () => {
    const pixels = new Uint8ClampedArray(4 * 2 * 4);
    pixels.set([255, 0, 0, 255], 0);
    pixels.set([0, 0, 255, 128], 3 * 4);
    pixels.set([0, 255, 0, 255], 4 * 4);
    return new ImageData(pixels, 4, 2);
  };

  const observeImageIo = (ctx: CanvasRenderingContext2D) => {
    let angle = 0;
    const stack: number[] = [];
    const draws: Array<{ angle: number; x: number; y: number; pixels: Uint8ClampedArray; width: number; height: number }> = [];
    const save = ctx.save.bind(ctx), restore = ctx.restore.bind(ctx), rotate = ctx.rotate.bind(ctx);
    const draw = ctx.drawImage.bind(ctx);
    jest.spyOn(ctx, 'save').mockImplementation(() => { stack.push(angle); save(); });
    jest.spyOn(ctx, 'restore').mockImplementation(() => { angle = stack.pop() ?? 0; restore(); });
    jest.spyOn(ctx, 'rotate').mockImplementation(value => { angle += value; rotate(value); });
    jest.spyOn(ctx, 'drawImage').mockImplementation((source, x, y) => {
      if (!(source instanceof HTMLCanvasElement)) throw new Error('Expected real scaled custom source canvas');
      const sourceCtx = source.getContext('2d');
      if (!sourceCtx) throw new Error('Expected scaled source context');
      draws.push({ angle, x, y, width: source.width, height: source.height, pixels: sourceCtx.getImageData(0, 0, source.width, source.height).data.slice() });
      draw(source, x, y);
    });
    return draws;
  };

  const withRasterIo = (run: () => void) => {
    const raster = globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean };
    const previous = raster.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    raster.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true;
    try { run(); } finally { raster.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = previous; }
  };

  it.each([0, Math.PI / 2, -Math.PI / 2])('applies requested rotation %s exactly once to asymmetric pattern source', rotation => {
    withRasterIo(() => {
      const ctx = createTargetContext(), pattern = asymmetricPattern(), draws = observeImageIo(ctx);
      createShapeDrawer({}, {})(ctx, 16, 16, 4, BrushShape.CUSTOM, true, rotation, 0, pattern, false);
      expect(draws).toHaveLength(1);
      expect(draws[0]).toMatchObject({ angle: rotation, x: 14, y: 15, width: 4, height: 2 });
      expect(draws[0].pixels).toEqual(pattern.data);
      // The red source pixel's projected center distinguishes quarter-turn from doubled half-turn.
      expect(16 + Math.cos(draws[0].angle) * -1.5 - Math.sin(draws[0].angle) * -0.5)
        .toBeCloseTo(16 + Math.cos(rotation) * -1.5 - Math.sin(rotation) * -0.5, 10);
      expect(ctx.rotate).toHaveBeenCalledTimes(rotation === 0 ? 0 : 1);
    });
  });

  it('preserves the standalone custom helper rotation contract', () => {
    withRasterIo(() => {
      const ctx = createTargetContext(), pattern = asymmetricPattern(), draws = observeImageIo(ctx);
      drawCustomPatternShape({ targetCtx: ctx, drawX: 16, drawY: 16, size: 4, pattern, rotation: Math.PI / 2 });
      expect(draws).toHaveLength(1);
      expect(draws[0].angle).toBe(Math.PI / 2);
      expect(draws[0].pixels).toEqual(pattern.data);
      expect(ctx.rotate).toHaveBeenCalledTimes(1);
    });
  });

  it.each([false, true])('keeps single rotation on actual custom/resampler-pattern facade route (resampler: %s)', isResampler => {
    withRasterIo(() => {
      const settings: BrushSettings = {
        size: 4, opacity: 1, color: '#000000', blendMode: 'source-over', spacing: 40,
        pressure: 1, rotation: 0, antialiasing: true, pressureEnabled: false,
        minPressure: 100, maxPressure: 100, rotationEnabled: true,
        rotationConfig: { enabled: false, mode: 'direction', smoothing: 0.5, offset: 0, jitter: 0 },
        dashedEnabled: false, dashLength: 3, dashGap: 2, gridSnapEnabled: false,
        gridSnapSize: 16, shapeEnabled: false, useSwatchColor: false,
        colorJitter: 0, risographIntensity: 0, risographOutline: false, ditherEnabled: false,
        brushShape: isResampler ? BrushShape.RESAMPLER : BrushShape.CUSTOM,
      };
      const engine = new BrushEngineFacade({ brushSettings: settings });
      const ctx = createTargetContext(), pattern = asymmetricPattern(), draws = observeImageIo(ctx);
      engine.renderBrushStroke(ctx, {
        from: { x: 16, y: 16 }, to: { x: 16, y: 24 }, pressure: 1, velocity: 1, timestamp: 1,
        customBrushData: { imageData: pattern, width: 4, height: 2, isColorizable: false, isResampler },
      });
      expect(draws).toHaveLength(1);
      expect(draws[0].angle).toBe(Math.PI / 2);
      expect(draws[0].pixels).toEqual(pattern.data);
      expect(ctx.rotate).toHaveBeenCalledTimes(1);
    });
  });

  it('retains ordinary antialiased square rotation in the shared dispatcher', () => {
    const ctx = createTargetContext();
    const rotate = jest.spyOn(ctx, 'rotate');
    createShapeDrawer({}, {})(ctx, 16, 16, 4, BrushShape.SQUARE, true, Math.PI / 2);
    expect(rotate).toHaveBeenCalledTimes(1);
    expect(rotate).toHaveBeenCalledWith(Math.PI / 2);
  });
});
