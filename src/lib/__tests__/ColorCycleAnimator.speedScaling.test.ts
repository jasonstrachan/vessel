import { ColorCycleAnimator } from '../ColorCycleAnimator';
import { encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';
import { registerColorCyclePlaybackClock, type ColorCyclePlaybackClock } from '@/lib/colorCycle/playbackClock';

const readPixel = (animator: ColorCycleAnimator): [number, number, number, number] => {
  const data = animator.getImageData().data;
  return [data[0], data[1], data[2], data[3]];
};

describe('ColorCycleAnimator speed scaling', () => {
  it('renders shared-clock layers identically despite different native clocks and multipliers', () => {
    const clock: ColorCyclePlaybackClock = { timeSeconds: 0, speedScale: 2 };
    const unregister = registerColorCyclePlaybackClock({
      read: (id) => id === 'ordinary' ? undefined : clock,
      snapshotProject: (project) => project,
    });
    const animators = ['a', 'b', 'ordinary'].map((layerId) => {
      const animator = new ColorCycleAnimator({ width: 1, height: 1, layerId, forceCanvas2D: true,
        gradientStops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }],
      });
      animator.setStrokeSpeedByte(17);
      animator.setIndex(0, 0, 128);
      animator.forceRender();
      return animator;
    });
    try {
      const [a, b, ordinary] = animators;
      const resolved = readPixel(a);
      a.setLayerSpeedMultiplier(0.25); b.setLayerSpeedMultiplier(4);
      for (let i = 0; i < 120; i++) a.updateFrame();
      b.updateFrame();
      expect(readPixel(a)).toEqual(resolved);
      expect(readPixel(b)).toEqual(resolved);
      clock.timeCurve = { durationSeconds: 2, samples: [0, 1, 0] };
      clock.timeSeconds = 0.5;
      a.forceRender();
      const outward = readPixel(a);
      expect(outward).not.toEqual(resolved);
      clock.timeSeconds = 1.5;
      a.forceRender();
      expect(readPixel(a)).toEqual(outward);
      clock.timeSeconds = 2;
      a.forceRender();
      expect(readPixel(a)).toEqual(resolved);
      delete clock.timeCurve;
      clock.timeSeconds = 0;
      a.setPhase(0.5);
      expect(readPixel(a)).not.toEqual(resolved);
      a.forceRender();
      expect(readPixel(a)).toEqual(resolved);
      clock.timeSeconds = 1;
      a.forceRender(); b.forceRender();
      expect(readPixel(a)).toEqual(readPixel(b));
      expect(readPixel(a)).not.toEqual(resolved);
      expect(readPixel(ordinary)).toEqual(resolved);
      clock.timeSeconds = 0;
      a.forceRender(); b.forceRender();
      expect(readPixel(a)).toEqual(resolved);
      expect(readPixel(b)).toEqual(resolved);
    } finally { unregister(); animators.forEach((animator) => animator.cleanup()); }
  });

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

  it('applies the maximum layer and global multipliers without clock clamping', () => {
    const animator = new ColorCycleAnimator({
      width: 1,
      height: 1,
      gradientStops: [],
      speed: 3,
      forceCanvas2D: true,
    });

    animator.setLayerSpeedMultiplier(4);

    expect(animator.getEffectivePlaybackSpeed()).toBe(12);
    expect((animator as unknown as {
      animationController: { getSpeed(): number };
    }).animationController.getSpeed()).toBe(12);

    animator.setLayerSpeedMultiplier(8);
    animator.setSpeed(6);
    expect(animator.getEffectivePlaybackSpeed()).toBe(12);
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
