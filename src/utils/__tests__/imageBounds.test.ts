import { findContentBoundsInPixels, computeContentBoundsFromImageData } from '../imageBounds';

describe('findContentBoundsInPixels', () => {
  test('returns null when pixel buffer is empty', () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    pixels.fill(0);
    const bounds = findContentBoundsInPixels(pixels, 4, 4);
    expect(bounds).toBeNull();
  });

  test('captures tight bounds around opaque pixels', () => {
    const width = 5;
    const height = 4;
    const pixels = new Uint8ClampedArray(width * height * 4);
    const setPixel = (x: number, y: number, alpha: number) => {
      const index = (y * width + x) * 4;
      pixels[index] = 255;
      pixels[index + 1] = 0;
      pixels[index + 2] = 0;
      pixels[index + 3] = alpha;
    };

    setPixel(1, 1, 255);
    setPixel(3, 2, 200);

    const bounds = findContentBoundsInPixels(pixels, width, height);
    expect(bounds).not.toBeNull();
    expect(bounds).toEqual({ x: 1, y: 1, width: 3, height: 2 });
  });

  test('respects alpha threshold', () => {
    const width = 3;
    const height = 3;
    const pixels = new Uint8ClampedArray(width * height * 4);
    const setPixel = (x: number, y: number, alpha: number) => {
      const index = (y * width + x) * 4;
      pixels[index + 3] = alpha;
    };

    setPixel(0, 0, 10);
    setPixel(2, 2, 200);

    const boundsLowThreshold = findContentBoundsInPixels(pixels, width, height, 0);
    expect(boundsLowThreshold).toEqual({ x: 0, y: 0, width: 3, height: 3 });

    const boundsHighThreshold = findContentBoundsInPixels(pixels, width, height, 100);
    expect(boundsHighThreshold).toEqual({ x: 2, y: 2, width: 1, height: 1 });
  });
});

describe('computeContentBoundsFromImageData', () => {
  test('delegates to pixel scanning', () => {
    const width = 4;
    const height = 4;
    const data = new Uint8ClampedArray(width * height * 4);
    data[(1 * width + 2) * 4 + 3] = 255;
    const mockImageData = {
      data,
      width,
      height
    } as unknown as ImageData;

    const bounds = computeContentBoundsFromImageData(mockImageData);
    expect(bounds).toEqual({ x: 2, y: 1, width: 1, height: 1 });
  });
});
