import { createColorCycleFrameCoalescer } from '../colorCycleFrameCoalescer';

describe('createColorCycleFrameCoalescer', () => {
  let animationFrames: FrameRequestCallback[];

  beforeEach(() => {
    animationFrames = [];
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('merges layer publications and preserves every dirty rectangle in one frame', () => {
    const onFlush = jest.fn();
    const queue = createColorCycleFrameCoalescer(onFlush);

    queue.enqueueFrame('cc-a', [{
      layerId: 'static-a',
      version: 2,
      rects: [{ x: 0, y: 0, width: 2, height: 2 }],
    }]);
    queue.enqueueFrame('cc-b', [{
      layerId: 'static-a',
      version: 3,
      rects: [{ x: 8, y: 8, width: 1, height: 1 }],
    }]);
    queue.enqueueRedraw();

    expect(animationFrames).toHaveLength(1);
    animationFrames[0](0);

    expect(onFlush).toHaveBeenCalledWith({
      sourceLayerIds: ['cc-a', 'cc-b'],
      dirtyBatches: [{
        layerId: 'static-a',
        version: 3,
        rects: [
          { x: 0, y: 0, width: 2, height: 2 },
          { x: 8, y: 8, width: 1, height: 1 },
        ],
      }],
      redrawOnly: true,
    });
  });

  it('schedules publications produced during a flush for the next frame', () => {
    const onFlush = jest.fn(() => {
      if (onFlush.mock.calls.length === 1) {
        queue.enqueueFrame('cc-next');
      }
    });
    const queue = createColorCycleFrameCoalescer(onFlush);

    queue.enqueueFrame('cc-first');
    animationFrames.shift()?.(0);

    expect(animationFrames).toHaveLength(1);
    animationFrames.shift()?.(16);
    expect(onFlush).toHaveBeenNthCalledWith(2, {
      sourceLayerIds: ['cc-next'],
      dirtyBatches: [],
      redrawOnly: false,
    });
  });
});
