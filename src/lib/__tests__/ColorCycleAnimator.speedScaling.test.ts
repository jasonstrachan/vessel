import { ColorCycleAnimator } from '../ColorCycleAnimator';
import { encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';

const readPixel = (animator: ColorCycleAnimator): [number, number, number, number] => {
  const data = animator.getImageData().data;
  return [data[0], data[1], data[2], data[3]];
};

describe('ColorCycleAnimator speed scaling', () => {
  it('keeps per-pixel animated colors static when playback speed is zero', () => {
    const animator = new ColorCycleAnimator({
      width: 1,
      height: 1,
      gradientStops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      forceCanvas2D: true,
    });

    animator.setStrokeSpeedByte(encodeColorCycleSpeedByte(2.64));
    animator.setIndex(0, 0, 128);
    animator.setPhase(0);

    const before = readPixel(animator);
    animator.setSpeed(0);
    for (let i = 0; i < 120; i += 1) {
      animator.updateFrame();
    }
    const after = readPixel(animator);

    expect(after).toEqual(before);
  });

  it('advances per-pixel animated colors when playback speed is non-zero', () => {
    const animator = new ColorCycleAnimator({
      width: 1,
      height: 1,
      gradientStops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      forceCanvas2D: true,
    });

    animator.setStrokeSpeedByte(encodeColorCycleSpeedByte(2.64));
    animator.setIndex(0, 0, 128);
    animator.setPhase(0);

    const before = readPixel(animator);
    animator.setSpeed(1);
    for (let i = 0; i < 60; i += 1) {
      animator.updateFrame();
    }
    const after = readPixel(animator);

    expect(after).not.toEqual(before);
  });
});
