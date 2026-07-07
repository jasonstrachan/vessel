import { act, renderHook } from '@testing-library/react';

import { dispatchColorCycleFrameReady } from '@/hooks/brushEngine/colorCycleFrameEvents';
import { useDrawingCanvasRedrawEffects } from '../useDrawingCanvasRedrawEffects';

describe('useDrawingCanvasRedrawEffects', () => {
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
      dispatchColorCycleFrameReady(dirtyBatches);
    });

    expect(options.refreshColorCycleSegments).toHaveBeenCalledWith(dirtyBatches);
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
      dispatchColorCycleFrameReady(dirtyBatches);
    });

    expect(options.refreshColorCycleSegments).toHaveBeenCalledWith(dirtyBatches);
    expect(options.rebuildStaticComposite).not.toHaveBeenCalled();
    expect(options.setNeedsRedraw).toHaveBeenCalledWith(expect.any(Function));

    unmount();
  });
});
