import {
  buildStampMaskCacheKey,
  quantizeStampMaskRotation,
  stampMaskHasVisiblePixels,
} from '@/hooks/brushEngine/colorCycleStampMask';

describe('colorCycleStampMask', () => {
  it('buckets tiny rotations to zero and 1-degree rotations to one bucket', () => {
    expect(quantizeStampMaskRotation(0)).toBe(0);
    expect(quantizeStampMaskRotation(Math.PI / 720)).toBe(0);
    expect(quantizeStampMaskRotation(Math.PI / 180)).toBe(1);
  });

  it('builds stable mask cache keys from explicit or anonymous stamp identity', () => {
    expect(buildStampMaskCacheKey({
      cacheKey: 'brush-a',
      imageWidth: 8,
      imageHeight: 9,
      width: 16,
      height: 17,
      rotation: Math.PI / 180,
    })).toBe('brush-a:16x17:rot=1');

    expect(buildStampMaskCacheKey({
      imageWidth: 8,
      imageHeight: 9,
      width: 16,
      height: 17,
      rotation: 0,
    })).toBe('anon:8x9:16x17:rot=0');
  });

  it('checks mask visibility with the paint threshold', () => {
    expect(stampMaskHasVisiblePixels(Uint8Array.from([0, 15]))).toBe(false);
    expect(stampMaskHasVisiblePixels(Uint8Array.from([0, 16]))).toBe(true);
  });
});
