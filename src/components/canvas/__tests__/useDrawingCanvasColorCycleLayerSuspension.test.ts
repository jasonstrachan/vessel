import { renderHook } from '@testing-library/react';
import { useDrawingCanvasColorCycleLayerSuspension } from '@/components/canvas/useDrawingCanvasColorCycleLayerSuspension';

describe('useDrawingCanvasColorCycleLayerSuspension', () => {
  it('does not keep playback suspended when a non-cc layer is active', () => {
    const suspendedForNonCCActiveLayerRef = { current: true };

    renderHook(() =>
      useDrawingCanvasColorCycleLayerSuspension({
        activeLayerId: 'layer-normal',
        layers: [
          {
            id: 'layer-normal',
            layerType: 'normal',
          } as never,
        ],
        suspendedForNonCCActiveLayerRef,
      })
    );

    expect(suspendedForNonCCActiveLayerRef.current).toBe(false);
  });
});
