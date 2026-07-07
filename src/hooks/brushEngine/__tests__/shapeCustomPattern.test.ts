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
