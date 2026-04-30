import { ColorCycleAnimator } from '../ColorCycleAnimator';

const makeStops = (color: string) => [
  { position: 0, color },
  { position: 1, color },
];

const readPixel = (data: Uint8ClampedArray, x: number, y: number, width: number) => {
  const idx = (y * width + x) * 4;
  return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
};

describe('ColorCycleAnimator render parity', () => {
  it('renders deterministic pixels for a solid palette', () => {
    const animator = new ColorCycleAnimator({
      width: 2,
      height: 1,
      gradientStops: makeStops('#112233'),
      forceCanvas2D: true,
    });

    animator.setIndex(0, 0, 1);
    animator.setIndex(1, 0, 200);
    animator.setPhase(0);

    const image = animator.getImageData().data;
    expect(readPixel(image, 0, 0, 2)).toEqual([0x11, 0x22, 0x33, 0xff]);
    expect(readPixel(image, 1, 0, 2)).toEqual([0x11, 0x22, 0x33, 0xff]);
  });

  it('does not assert when restored def ids are missing palette metadata', () => {
    const assertSpy = jest.spyOn(console, 'assert').mockImplementation(() => undefined);
    const animator = new ColorCycleAnimator({
      width: 2,
      height: 1,
      gradientStops: makeStops('#445566'),
      forceCanvas2D: true,
    });

    animator.setIndexBufferFromArray(
      new Uint8Array([1, 2]),
      new Uint8Array([43, 43]),
      new Uint8Array([0, 0]),
      new Uint8Array([0, 0]),
    );
    animator.setDefIdData(new Uint16Array([44, 0]), { forceDirty: true });
    animator.setDefPaletteCache({
      palettesById: new Map(),
      rgbaById: new Map(),
      signaturesById: new Map(),
    });

    expect(() => animator.forceRender()).not.toThrow();
    expect(assertSpy).not.toHaveBeenCalled();

    assertSpy.mockRestore();
  });
});
