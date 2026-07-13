import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';

import { ColorCyclePlaybackController } from '../colorCyclePlaybackController';

const makeAnimator = (builtFromVersion = 1): ColorCycleAnimator => ({
  builtFromVersion,
  rebuild: jest.fn(),
  setFPS: jest.fn(),
  setSpeed: jest.fn(),
  updateFrame: jest.fn(),
} as unknown as ColorCycleAnimator);

describe('ColorCyclePlaybackController', () => {
  it('advances each eligible animator once and renders once per playback tick', () => {
    const render = jest.fn();
    const controller = new ColorCyclePlaybackController({
      initialFps: 30,
      initialPlaybackSpeedScale: 1,
      hasAnimatedContent: () => true,
      getDocumentRead: () => undefined,
      shouldUpdateAnimator: (layerId) => layerId === 'cc-a',
      render,
      flushScheduledRender: jest.fn(),
      stopAnimators: jest.fn(),
    });
    const first = makeAnimator();
    const second = makeAnimator();
    controller.setAnimator('cc-a', first);
    controller.setAnimator('cc-b', second);

    controller.updateAnimation();

    expect(first.updateFrame).toHaveBeenCalledTimes(1);
    expect(second.updateFrame).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('rebuilds stale state before advancing without adding another render step', () => {
    const animator = makeAnimator(1);
    const render = jest.fn();
    const snapshot = {} as Parameters<ColorCycleAnimator['rebuild']>[0];
    const controller = new ColorCyclePlaybackController({
      initialFps: 30,
      initialPlaybackSpeedScale: 1,
      hasAnimatedContent: () => true,
      getDocumentRead: () => ({ version: 2, pixelVersion: 2, snapshot }),
      shouldUpdateAnimator: () => true,
      render,
      flushScheduledRender: jest.fn(),
      stopAnimators: jest.fn(),
    });
    controller.setAnimator('cc-a', animator);

    controller.updateAnimation();

    expect(animator.rebuild).toHaveBeenCalledWith(snapshot, 2);
    expect(animator.updateFrame).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
