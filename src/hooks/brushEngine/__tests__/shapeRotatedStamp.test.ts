import { getRotatedPixelStamp, RotatedStampCache } from '../shapeRotatedStamp';

const createStamp = (size = 8): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
};

describe('RotatedStampCache', () => {
  it('reuses rotated stamps from an explicit cache', () => {
    const cache = new RotatedStampCache();
    const stamp = createStamp();

    const first = getRotatedPixelStamp(cache, stamp, Math.PI / 4, 'pixel_square_8', '#000000');
    const second = getRotatedPixelStamp(cache, stamp, Math.PI / 4, 'pixel_square_8', '#000000');

    expect(second).toBe(first);
    expect(cache.size).toBe(1);
  });

  it('does not share rotated stamps without an explicit cache', () => {
    const stamp = createStamp();

    const first = getRotatedPixelStamp(undefined, stamp, Math.PI / 4, 'pixel_square_8', '#000000');
    const second = getRotatedPixelStamp(undefined, stamp, Math.PI / 4, 'pixel_square_8', '#000000');

    expect(second).not.toBe(first);
  });

  it('returns the base stamp for near-zero rotation without caching', () => {
    const cache = new RotatedStampCache();
    const stamp = createStamp();

    const result = getRotatedPixelStamp(cache, stamp, 0, 'pixel_square_8', '#000000');

    expect(result).toBe(stamp);
    expect(cache.size).toBe(0);
  });

  it('clears rotated stamps and advances cacheVersion', () => {
    const cache = new RotatedStampCache();
    const stamp = createStamp();
    getRotatedPixelStamp(cache, stamp, Math.PI / 4, 'pixel_square_8', '#000000');

    expect(cache.cacheVersion).toBe(0);
    cache.clear();

    expect(cache.cacheVersion).toBe(1);
    expect(cache.size).toBe(0);
  });
});
