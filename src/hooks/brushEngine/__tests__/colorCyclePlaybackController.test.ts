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
  it('keeps playback armed until the first animated pixels arrive', () => {
    let hasAnimatedContent = false;
    const scheduledFrames: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = jest
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        scheduledFrames.push(callback);
        return scheduledFrames.length;
      });
    const animator = makeAnimator();
    const render = jest.fn();
    const controller = new ColorCyclePlaybackController({
      initialFps: 30,
      initialPlaybackSpeedScale: 1,
      hasAnimatedContent: () => hasAnimatedContent,
      getDocumentRead: () => undefined,
      shouldUpdateAnimator: () => true,
      render,
      flushScheduledRender: jest.fn(),
      stopAnimators: jest.fn(),
    });
    controller.setAnimator('cc-a', animator);

    try {
      controller.start();
      scheduledFrames.shift()?.(0);

      expect(controller.isPlaying()).toBe(true);
      expect(animator.updateFrame).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();

      hasAnimatedContent = true;
      scheduledFrames.shift()?.(16);
      scheduledFrames.shift()?.(50);

      expect(animator.updateFrame).toHaveBeenCalledTimes(1);
      expect(render).toHaveBeenCalledTimes(1);
    } finally {
      controller.stop();
      requestAnimationFrameSpy.mockRestore();
    }
  });

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
