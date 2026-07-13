import { act, renderHook } from '@testing-library/react';

import { dispatchColorCycleFrameReady } from '@/hooks/brushEngine/colorCycleFrameEvents';
import { useDrawingCanvasRedrawEffects } from '../useDrawingCanvasRedrawEffects';

describe('useDrawingCanvasRedrawEffects', () => {
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

  const flushAnimationFrame = () => {
    const callback = animationFrames.shift();
    if (!callback) {
      throw new Error('Expected a queued animation frame');
    }
    callback(performance.now());
  };

  const baseOptions = () => ({
    layersNeedRecomposition: false,
    setNeedsRedraw: jest.fn(),
    selectionStart: null,
    selectionEnd: null,
    hadSelectionRef: { current: false },
    refreshColorCycleSegments: jest.fn(),
    rebuildStaticComposite: jest.fn(() => true),
  });

  it('passes frame dirty batches into color-cycle refresh and static composite rebuild', () => {
    const options = baseOptions();
    const dirtyBatches = [{
      layerId: 'static-layer',
      version: 3,
      rects: [{ x: 1, y: 2, width: 3, height: 4 }],
    }];
    options.refreshColorCycleSegments.mockReturnValue(true);

    const { unmount } = renderHook(() => useDrawingCanvasRedrawEffects(options));

    act(() => {
      dispatchColorCycleFrameReady('cc-layer', dirtyBatches);
      flushAnimationFrame();
    });

    expect(options.refreshColorCycleSegments).toHaveBeenCalledWith({
      dirtyBatches,
      sourceLayerIds: ['cc-layer'],
    });
    expect(options.rebuildStaticComposite).toHaveBeenCalledWith({ dirtyBatches });
    expect(options.setNeedsRedraw).toHaveBeenCalledWith(expect.any(Function));

    unmount();
  });

  it('does not rebuild the static composite for non-static dirty batches', () => {
    const options = baseOptions();
    const dirtyBatches = [{
      layerId: 'cc-layer',
      version: 5,
      rects: [{ x: 0, y: 0, width: 2, height: 2 }],
    }];
    options.refreshColorCycleSegments.mockReturnValue(false);

    const { unmount } = renderHook(() => useDrawingCanvasRedrawEffects(options));

    act(() => {
      dispatchColorCycleFrameReady('cc-layer', dirtyBatches);
      flushAnimationFrame();
    });

    expect(options.refreshColorCycleSegments).toHaveBeenCalledWith({
      dirtyBatches,
      sourceLayerIds: ['cc-layer'],
    });
    expect(options.rebuildStaticComposite).not.toHaveBeenCalled();
    expect(options.setNeedsRedraw).toHaveBeenCalledWith(expect.any(Function));

    unmount();
  });

  it('coalesces legacy and layer frame events into one main redraw', () => {
    const options = baseOptions();
    const { unmount } = renderHook(() => useDrawingCanvasRedrawEffects(options));
    options.setNeedsRedraw.mockClear();

    act(() => {
      dispatchColorCycleFrameReady('cc-layer', []);
      window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
    });

    expect(animationFrames).toHaveLength(1);

    act(() => {
      flushAnimationFrame();
    });

    expect(options.refreshColorCycleSegments).toHaveBeenCalledTimes(1);
    expect(options.setNeedsRedraw).toHaveBeenCalledTimes(1);

    unmount();
  });
});
