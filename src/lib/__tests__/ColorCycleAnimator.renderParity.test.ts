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
});
