import { sampleShapeFootprintGradient } from '@/utils/colorCycle/ccShapeFootprintSamplingCore';

const rectangle = (width: number, height: number): Float32Array => new Float32Array([
  0, 0,
  width, 0,
  width, height,
  0, height,
]);

const makePixels = (
  width: number,
  height: number,
  colorAt: (x: number, y: number) => [number, number, number, number],
): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels.set(colorAt(x, y), (y * width + x) * 4);
    }
  }
  return pixels;
};

const sample = (options: {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  vertices?: Float32Array;
  referencePixels?: Uint8ClampedArray;
  maxColors?: number;
  mode?: 'linear' | 'concentric';
  directionX?: number;
  directionY?: number;
}) => sampleShapeFootprintGradient({
  width: options.width,
  height: options.height,
  originX: 0,
  originY: 0,
  sampleScaleX: 1,
  sampleScaleY: 1,
  vertices: options.vertices ?? rectangle(options.width, options.height),
  compositePixels: options.pixels,
  referencePixels: options.referencePixels,
  maxColors: options.maxColors ?? 3,
  mode: options.mode ?? 'linear',
  directionX: options.directionX ?? 1,
  directionY: options.directionY ?? 0,
});

describe('sampleShapeFootprintGradient', () => {
  it('represents distinct colors across the complete shape footprint', () => {
    const width = 12;
    const height = 8;
    const pixels = makePixels(width, height, (x, y) => {
      if (x >= 5 && x <= 6 && y >= 1 && y <= 6) {
        return [0, 255, 0, 255];
      }
      return x < width / 2
        ? [255, 0, 0, 255]
        : [0, 0, 255, 255];
    });

    const result = sample({ width, height, pixels });

    expect(result?.stops.map((stop) => stop.color)).toEqual([
      '#ff0000',
      '#00ff00',
      '#0000ff',
    ]);
    expect(result?.stats.sampledPixels).toBe(width * height);
    expect(result?.stats.outputColors).toBe(3);
  });

  it('excludes pixels outside the polygon rather than sampling the whole bounding box', () => {
    const width = 4;
    const height = 4;
    const pixels = makePixels(width, height, (x, y) => (
      x + y < 4
        ? [255, 128, 0, 255]
        : [255, 0, 255, 255]
    ));
    const triangle = new Float32Array([0, 0, 4, 0, 0, 4]);

    const result = sample({ width, height, pixels, vertices: triangle, maxColors: 2 });

    expect(result?.stops.map((stop) => stop.color)).toEqual(['#ff8000', '#ff8000']);
    expect(result?.stats.outputColors).toBe(1);
  });

  it('matches the non-zero winding rule used by the final shape mask', () => {
    const width = 4;
    const height = 4;
    const pixels = makePixels(width, height, () => [255, 128, 0, 255]);
    const twiceWoundRectangle = new Float32Array([
      0, 0, 4, 0, 4, 4, 0, 4,
      0, 0, 4, 0, 4, 4, 0, 4,
    ]);

    const result = sample({ width, height, pixels, vertices: twiceWoundRectangle });

    expect(result?.stats.sampledPixels).toBe(width * height);
    expect(result?.stops.map((stop) => stop.color)).toEqual(['#ff8000', '#ff8000']);
  });

  it('uses opaque reference pixels and falls back to the composite where reference pixels are transparent', () => {
    const width = 4;
    const height = 1;
    const pixels = makePixels(width, height, () => [255, 0, 0, 255]);
    const referencePixels = makePixels(width, height, (x) => (
      x < 2
        ? [0, 255, 0, 255]
        : [0, 0, 0, 0]
    ));

    const result = sample({ width, height, pixels, referencePixels, maxColors: 2 });

    expect(result?.stops.map((stop) => stop.color)).toEqual(['#00ff00', '#ff0000']);
  });

  it('orders concentric colors from the edge inward like the final fill', () => {
    const width = 7;
    const height = 7;
    const pixels = makePixels(width, height, (x, y) => {
      const distance = Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2);
      return distance < 2
        ? [255, 255, 0, 255]
        : [0, 128, 255, 255];
    });

    const result = sample({ width, height, pixels, maxColors: 2, mode: 'concentric' });

    expect(result?.stops.map((stop) => stop.color)).toEqual(['#0080ff', '#ffff00']);
  });

  it('returns one whole-footprint representative as a valid two-endpoint gradient', () => {
    const width = 2;
    const height = 1;
    const pixels = makePixels(width, height, (x) => (
      x === 0
        ? [255, 0, 0, 255]
        : [0, 0, 255, 255]
    ));

    const result = sample({ width, height, pixels, maxColors: 1 });

    expect(result?.stops).toHaveLength(2);
    expect(result?.stops[0].color).toBe(result?.stops[1].color);
    expect(result?.stops[0].color).not.toBe('#ff0000');
    expect(result?.stops[0].color).not.toBe('#0000ff');
    expect(result?.stats.outputColors).toBe(1);
  });

  it('alpha-weights partial pixels and ignores fully transparent pixels', () => {
    const width = 3;
    const height = 1;
    const pixels = makePixels(width, height, (x) => {
      if (x === 0) return [255, 0, 0, 255];
      if (x === 1) return [0, 0, 255, 128];
      return [0, 255, 0, 0];
    });

    const result = sample({ width, height, pixels, maxColors: 1 });

    expect(result?.stats.sampledPixels).toBe(2);
    expect(result?.stats.alphaWeight).toBeCloseTo(1 + 128 / 255);
  });
});
