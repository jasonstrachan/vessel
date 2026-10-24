import { floodFill, type FloodFillColor } from '@/utils/floodFill';

type Pixel = readonly [number, number, number, number];

const SEED: Pixel = [10, 20, 30, 255];
const NEAR: FloodFillColor = { r: 11, g: 20, b: 30, a: 255 };
const FAR: FloodFillColor = { r: 0, g: 200, b: 80, a: 255 };
const BARRIER: Pixel = [200, 100, 50, 255];

const image = (width: number, height: number, pixels: readonly Pixel[]): ImageData => {
  expect(pixels).toHaveLength(width * height);
  return new ImageData(new Uint8ClampedArray(pixels.flat()), width, height);
};

const replaced = (source: ImageData, indices: readonly number[], color: FloodFillColor): Uint8ClampedArray => {
  const expected = source.data.slice();
  for (const index of indices) expected.set([color.r, color.g, color.b, color.a], index * 4);
  return expected;
};

describe('raster flood fill membership', () => {
  it.each([1, 2])('visits a 2x2 component once when replacement remains within threshold %s', (threshold) => {
    const source = image(2, 2, [SEED, SEED, SEED, SEED]);
    const expected = replaced(source, [0, 1, 2, 3], NEAR);

    const result = floodFill(source, 0, 0, NEAR, { threshold, contiguous: true });

    expect(result.imageData).toBe(source);
    expect(result.imageData.data).toEqual(expected);
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 2, height: 2 });
  });

  it('crosses already-equal replacement pixels but excludes disconnected and diagonal matches', () => {
    const near: Pixel = [NEAR.r, NEAR.g, NEAR.b, NEAR.a];
    const source = image(4, 3, [
      SEED, BARRIER, BARRIER, SEED,
      SEED, near, SEED, BARRIER,
      BARRIER, BARRIER, BARRIER, SEED,
    ]);
    const expected = replaced(source, [0, 4, 5, 6], NEAR);

    const result = floodFill(source, 0, 0, NEAR, { threshold: 1, contiguous: true });

    expect(source.data).toEqual(expected);
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 3, height: 2 });
  });

  it('keeps global matching across disconnected islands without revisiting writes', () => {
    const near: Pixel = [NEAR.r, NEAR.g, NEAR.b, NEAR.a];
    const source = image(4, 3, [
      SEED, BARRIER, BARRIER, SEED,
      SEED, near, SEED, BARRIER,
      BARRIER, BARRIER, BARRIER, SEED,
    ]);
    const expected = replaced(source, [0, 3, 4, 5, 6, 11], NEAR);

    const result = floodFill(source, 0, 0, NEAR, { threshold: 1, contiguous: false });

    expect(source.data).toEqual(expected);
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 4, height: 3 });
  });

  it.each([true, false])('preserves exact RGBA matching at threshold zero with contiguous=%s', (contiguous) => {
    const source = image(3, 2, [
      SEED, [11, 20, 30, 255], SEED,
      SEED, BARRIER, SEED,
    ]);
    const expected = replaced(source, contiguous ? [0, 3] : [0, 2, 3, 5], FAR);

    const result = floodFill(source, 0, 0, FAR, { threshold: 0, contiguous });

    expect(source.data).toEqual(expected);
    expect(result.bounds).toEqual({ x: 0, y: 0, width: contiguous ? 1 : 3, height: 2 });
  });

  it.each([0, 1, 2])('keeps identical replacement a complete no-op at threshold %s', (threshold) => {
    const source = image(2, 2, [SEED, [11, 20, 30, 255], SEED, BARRIER]);
    const before = source.data.slice();
    const result = floodFill(source, 0, 0, { r: 10, g: 20, b: 30, a: 255 }, { threshold, contiguous: true });

    expect(result.bounds).toBeNull();
    expect(result.imageData).toBe(source);
    expect(source.data).toEqual(before);
  });

  it.each([0, 1])('uses alpha in the inclusive Euclidean threshold %s', (threshold) => {
    const source = image(3, 2, [
      [0, 255, 0, 128], [0, 255, 0, 129], [0, 0, 0, 0],
      BARRIER, BARRIER, [0, 255, 0, 128],
    ]);
    const expected = replaced(source, threshold === 0 ? [0] : [0, 1], FAR);

    const result = floodFill(source, 0, 0, FAR, { threshold, contiguous: true });

    expect(source.data).toEqual(expected);
    expect(result.bounds).toEqual({ x: 0, y: 0, width: threshold + 1, height: 1 });
  });

  it('preserves transparent-to-opaque replacement and exact compact offset bounds', () => {
    const source = image(4, 3, [
      BARRIER, BARRIER, BARRIER, BARRIER,
      BARRIER, [0, 0, 0, 0], [0, 0, 0, 0], BARRIER,
      BARRIER, [0, 0, 0, 0], [0, 0, 0, 0], BARRIER,
    ]);
    const expected = replaced(source, [5, 6, 9, 10], FAR);

    const result = floodFill(source, 2, 2, FAR, { threshold: 0, contiguous: true });

    expect(source.data).toEqual(expected);
    expect(result.bounds).toEqual({ x: 1, y: 1, width: 2, height: 2 });
  });

  it('terminates along a one-column document at both borders for a near replacement', () => {
    const source = image(1, 4, [SEED, SEED, SEED, SEED]);
    const expected = replaced(source, [0, 1, 2, 3], NEAR);

    const result = floodFill(source, 0, 2, NEAR, { threshold: 1, contiguous: true });

    expect(source.data).toEqual(expected);
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 1, height: 4 });
  });
});
