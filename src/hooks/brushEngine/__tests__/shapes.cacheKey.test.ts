import { buildRotatedStampCacheKey } from '../shapes';

describe('buildRotatedStampCacheKey', () => {
  it('includes fill style so rotated pixel stamps do not bleed colors', () => {
    const rotation = Math.PI / 4;
    const keyA = buildRotatedStampCacheKey('pixel_circle_8', rotation, 'rgba(255, 0, 0, 1)');
    const keyB = buildRotatedStampCacheKey('pixel_circle_8', rotation, 'rgba(0, 255, 0, 1)');

    expect(keyA).not.toBe(keyB);
  });

  it('keeps legacy format when fill style is not provided', () => {
    const key = buildRotatedStampCacheKey('pixel_circle_8', 0);

    expect(key).toBe('pixel_circle_8_rot0');
  });
});
