import {
  computeGradientAxisFromOpposingEnds,
  computeGradientAxisFromPolygon,
  renderDitherGradientToImageData,
  resolveDitherGradientLengthFactor,
} from '@/utils/orderedDitherGradient';

describe('Dither Gradient review fixes', () => {
  it.each([1, 4])('preserves Sierra Lite gradient density at cell size %i', (pixelSize) => {
    const image = renderDitherGradientToImageData({
      width: 128,
      height: 64,
      axis: { start: { x: 0, y: 0 }, end: { x: 128, y: 0 }, dir: { x: 1, y: 0 }, length: 128 },
      paletteRGBA: [[255, 0, 0, 255], [0, 0, 0, 0]],
      algorithm: 'sierra-lite',
      pixelSize,
    });
    const meanAlpha = (startX: number) => {
      let sum = 0;
      for (let y = 0; y < 64; y += 1) {
        for (let x = startX; x < startX + 32; x += 1) {
          sum += image.data[(y * 128 + x) * 4 + 3];
        }
      }
      return sum / (32 * 64);
    };

    expect(meanAlpha(0)).toBeGreaterThan(180);
    expect(meanAlpha(96)).toBeLessThan(80);
  });

  it('computes an opposing-ends axis without an all-pairs scan', () => {
    const vertices = Array.from({ length: 5000 }, (_, index) => ({
      x: index,
      y: Math.sin(index / 10) * 20,
    }));
    const hypotSpy = jest.spyOn(Math, 'hypot');

    const axis = computeGradientAxisFromOpposingEnds(vertices);

    expect(axis.length).toBeGreaterThan(4900);
    expect(hypotSpy).toHaveBeenCalledTimes(1);
    hypotSpy.mockRestore();
  });

  it('treats 100 percent gradient length as the full resolved axis', () => {
    expect(resolveDitherGradientLengthFactor()).toBe(1);
    expect(resolveDitherGradientLengthFactor(100)).toBe(1);
    expect(resolveDitherGradientLengthFactor(20)).toBe(0.2);
    expect(resolveDitherGradientLengthFactor(200)).toBe(2);
  });

  it('uses a selected image-tile resolver for pattern gradients', () => {
    const resolver = jest.fn((x: number) => (x % 2 === 0 ? 0 : 1));
    const axis = computeGradientAxisFromPolygon([
      { x: 0, y: 0 },
      { x: 8, y: 0 },
    ]);

    renderDitherGradientToImageData({
      width: 8,
      height: 2,
      axis,
      paletteRGBA: [
        [255, 0, 0, 255],
        [0, 0, 255, 255],
      ],
      pixelSize: 1,
      algorithm: 'pattern',
      patternStyle: 'image-tile',
      imageTileThresholdResolver: resolver,
    });

    expect(resolver).toHaveBeenCalled();
  });
});
