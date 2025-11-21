import {
  ditherFloydSteinberg,
  ditherOrdered4x4,
  mapToIndexedWithDithering,
} from '@/utils/gifDither';

describe('gifDither helpers', () => {
  const transparentPalette = [
    [255, 0, 0, 255],
    [0, 0, 0, 0], // transparent entry
  ];

  it('maps transparent pixels to the transparent palette index', () => {
    const rgba = new Uint8ClampedArray([
      10, 10, 10, 0,
      20, 20, 20, 1,
      30, 30, 30, 2,
      40, 40, 40, 3,
    ]);
    const floyd = ditherFloydSteinberg(rgba, 2, 2, transparentPalette, { alphaThreshold: 4 });
    const ordered = ditherOrdered4x4(rgba, 2, 2, transparentPalette, { alphaThreshold: 4 });

    expect(Array.from(floyd)).toEqual([1, 1, 1, 1]);
    expect(Array.from(ordered)).toEqual([1, 1, 1, 1]);
  });

  it('clamps strength and still returns finite indices', () => {
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      128, 128, 128, 255,
      64, 64, 64, 255,
    ]);
    const palette = [
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ];

    const floyd = ditherFloydSteinberg(rgba, 2, 2, palette, { strength: 5 });
    const ordered = ditherOrdered4x4(rgba, 2, 2, palette, { strength: -1 });

    expect(floyd.length).toBe(4);
    expect(ordered.length).toBe(4);
    floyd.forEach((v) => expect(Number.isFinite(v)).toBe(true));
    ordered.forEach((v) => expect(Number.isFinite(v)).toBe(true));
  });

  it('uses alpha-aware nearest index when dithering is disabled', () => {
    const rgba = new Uint8ClampedArray([
      10, 0, 0, 0,
    ]);
    const palette = [
      [10, 0, 0, 255],
      [10, 0, 0, 0],
    ];

    const mapped = mapToIndexedWithDithering(rgba, 1, 1, palette, { method: 'none' });

    expect(Array.from(mapped)).toEqual([1]);
  });
});
