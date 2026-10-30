import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import { ColorCyclePlaybackController } from '@/hooks/brushEngine/colorCyclePlaybackController';
import { getSharedAnimationRuntime } from '@/hooks/canvas/handlers/animation/animationRuntime';
import { SimplifiedColorCycleManager } from '@/components/canvas/SimplifiedColorCycleManager';

describe('color-cycle shared scheduling', () => {
  let callbacks: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  const controllers: ColorCyclePlaybackController[] = [];

  const frame = (timestamp: number) => {
    const pending = Array.from(callbacks.values());
    callbacks.clear();
    pending.forEach((callback) => callback(timestamp));
  };

  const createController = (fps: number) => {
    const animator = {
      setFPS: jest.fn(), setSpeed: jest.fn(), updateFrame: jest.fn(),
    } as unknown as ColorCycleAnimator;
    const controller = new ColorCyclePlaybackController({
      initialFps: fps, initialPlaybackSpeedScale: 1,
      hasAnimatedContent: () => true, getDocumentRead: () => undefined,
      shouldUpdateAnimator: () => true, render: jest.fn(),
      flushScheduledRender: jest.fn(), stopAnimators: jest.fn(),
    });
    controller.setAnimator('layer', animator);
    controllers.push(controller);
    return { controller, animator };
  };

  beforeEach(() => {
    callbacks = new Map();
    nextFrameId = 0;
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.set(++nextFrameId, callback);
      return nextFrameId;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      callbacks.delete(id);
    });
  });

  afterEach(() => {
    controllers.splice(0).forEach((controller) => controller.stop());
    getSharedAnimationRuntime().stop();
    jest.restoreAllMocks();
  });

  it('keeps one RAF when the last consumer replaces itself during a frame', () => {
    const runtime = getSharedAnimationRuntime();
    let unregisterNext: (() => void) | undefined;
    const unregister = runtime.register(() => {
      unregister();
      unregisterNext = runtime.register(() => undefined);
      runtime.start();
    });
    runtime.start();
    try {
      frame(0);
      expect(callbacks.size).toBe(1);
      frame(50);
      expect(callbacks.size).toBe(1);
    } finally {
      unregisterNext?.();
    }
  });

  it('shares one RAF and advances delayed frames by elapsed time at different FPS', () => {
    const slow = createController(30);
    const fast = createController(60);
    slow.controller.start();
    fast.controller.start();
    expect(callbacks.size).toBe(1);

    frame(0);
    frame(100);

    expect(slow.animator.updateFrame).toHaveBeenCalledTimes(1);
    expect(fast.animator.updateFrame).toHaveBeenCalledTimes(1);
    expect(slow.animator.updateFrame).toHaveBeenCalledWith(0.1);
    expect(fast.animator.updateFrame).toHaveBeenCalledWith(0.1);
    expect(callbacks.size).toBe(1);
  });

  it('unregisters paused playback and excludes paused time after resume', () => {
    const { controller, animator } = createController(60);
    controller.start();
    frame(0);
    frame(100);
    controller.pause();
    expect(controller.hasScheduledFrame()).toBe(false);
    expect(callbacks.size).toBe(0);

    controller.resume();
    frame(10_000);
    frame(10_100);
    expect(animator.updateFrame).toHaveBeenCalledTimes(2);
    expect(animator.updateFrame).toHaveBeenLastCalledWith(0.1);
    controller.stop();
    expect(callbacks.size).toBe(0);
  });

  it('does not lose elapsed time when the presentation FPS changes', () => {
    const { controller, animator } = createController(30);
    controller.start();
    frame(0);
    frame(20);
    controller.setFps(60);
    frame(40);
    expect(animator.updateFrame).toHaveBeenCalledWith(0.04);
  });

  it('shares presentation and brush scheduling and stops presentation independently', () => {
    const { controller } = createController(60);
    const onFrame = jest.fn();
    const presentation = new SimplifiedColorCycleManager({ targetFPS: 24, onFrame });
    const now = jest.spyOn(performance, 'now').mockReturnValue(0);
    try {
      controller.start();
      presentation.start();
      expect(callbacks.size).toBe(1);
      frame(0);
      frame(50);
      expect(onFrame).toHaveBeenCalledTimes(1);
      presentation.stop();
      frame(100);
      expect(onFrame).toHaveBeenCalledTimes(1);
      expect(callbacks.size).toBe(1);
    } finally {
      presentation.destroy();
      now.mockRestore();
    }
  });
});
