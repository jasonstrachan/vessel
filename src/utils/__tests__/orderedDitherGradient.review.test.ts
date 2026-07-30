import {
  computeGradientAxisFromOpposingEnds,
  computeGradientAxisFromPolygon,
  renderDitherGradientToImageData,
  resolveDitherGradientLengthFactor,
} from '@/utils/orderedDitherGradient';

describe('Dither Gradient review fixes', () => {
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
