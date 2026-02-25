import { buildRotatedStampCacheKey } from '../shapes';

describe('buildRotatedStampCacheKey', () => {
  it('includes fill style so rotated pixel stamps do not bleed colors', () => {
    const rotation = Math.PI / 4;
    const keyA = buildRotatedStampCacheKey('pixel_circle_8', rotation, 'rgba(255, 0, 0, 1)');
    const keyB = buildRotatedStampCacheKey('pixel_circle_8', rotation, 'rgba(0, 255, 0, 1)');

    expect(keyA).not.toBe(keyB);
  });

  it('returns the same key for the same base/rotation/color inputs', () => {
    const rotation = Math.PI / 6;
    const fillStyle = 'rgba(34, 17, 200, 1)';
    const keyA = buildRotatedStampCacheKey('pixel_square_5', rotation, fillStyle);
    const keyB = buildRotatedStampCacheKey('pixel_square_5', rotation, fillStyle);

    expect(keyA).toBe(keyB);
  });

  it('separates cache entries by rotation bucket even with same color', () => {
    const fillStyle = 'rgba(34, 17, 200, 1)';
    const keyA = buildRotatedStampCacheKey('pixel_circle_8', Math.PI / 8, fillStyle);
    const keyB = buildRotatedStampCacheKey('pixel_circle_8', Math.PI / 3, fillStyle);

    expect(keyA).not.toBe(keyB);
  });

  it('separates cache entries by brush base key even with same color/rotation', () => {
    const rotation = Math.PI / 4;
    const fillStyle = 'rgba(10, 20, 30, 1)';
    const keyA = buildRotatedStampCacheKey('pixel_circle_8', rotation, fillStyle);
    const keyB = buildRotatedStampCacheKey('pixel_square_8', rotation, fillStyle);

    expect(keyA).not.toBe(keyB);
  });

  it('keeps legacy format when fill style is not provided', () => {
    const key = buildRotatedStampCacheKey('pixel_circle_8', 0);

    expect(key).toBe('pixel_circle_8_rot0');
  });
});
