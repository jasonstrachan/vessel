import { ColorCycleAnimator } from '../ColorCycleAnimator';
import { encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';

const readPixel = (animator: ColorCycleAnimator): [number, number, number, number] => {
  const data = animator.getImageData().data;
  return [data[0], data[1], data[2], data[3]];
};

describe('ColorCycleAnimator speed scaling', () => {
  it('composes global playback and layer speed without changing either authority', () => {
    const animator = new ColorCycleAnimator({
      width: 1,
      height: 1,
      gradientStops: [],
      speed: 2,
      forceCanvas2D: true,
    });

    animator.setLayerSpeedMultiplier(0.25);
    expect(animator.getEffectivePlaybackSpeed()).toBe(0.5);

    animator.setSpeed(3);
    expect(animator.getEffectivePlaybackSpeed()).toBe(0.75);

    animator.setLayerSpeedMultiplier(0);
    expect(animator.getEffectivePlaybackSpeed()).toBe(0);
  });

  it('refreshes the layer multiplier from a canonical document rebuild', () => {
    const animator = new ColorCycleAnimator({
      width: 1,
      height: 1,
      gradientStops: [],
      speed: 2,
      forceCanvas2D: true,
    });

    animator.rebuild({
      layerId: 'layer-1',
      width: 1,
      height: 1,
      paintBuffer: new Uint8Array([1]).buffer,
      speedBuffer: new Uint8Array([encodeColorCycleSpeedByte(0.4)]).buffer,
      layerBaseSpeedCps: 0.5,
      hasContent: true,
      sources: {
        brushStateSnapshot: false,
        topLevelBuffers: false,
        legacyStateRefs: false,
      },
    }, 1);

    expect(animator.getEffectivePlaybackSpeed()).toBe(1);
  });

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
