import { ColorCycleAnimator } from '../ColorCycleAnimator';

const makeStops = (color: string) => [
  { position: 0, color },
  { position: 1, color },
];

describe('ColorCycleAnimator serialization', () => {
  it('preserves gradient stops and dimensions', () => {
    const stops = makeStops('#ff00ff');
    const animator = new ColorCycleAnimator({
      width: 3,
      height: 2,
      gradientStops: stops,
      forceCanvas2D: true,
    });

    const serialized = animator.serialize();

    expect(serialized.indexBuffer.width).toBe(3);
    expect(serialized.indexBuffer.height).toBe(2);
    expect(serialized.gradient.gradientStops).toEqual(stops);
  });
});
