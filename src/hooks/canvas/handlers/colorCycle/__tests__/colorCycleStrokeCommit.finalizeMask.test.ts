import type React from 'react';
import { clearColorCycleEraseMaskInRegion } from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeCommit';
import type { AppState } from '@/stores/useAppStore';

describe('colorCycleStrokeCommit finalize mask clear', () => {
  it('clears erase mask in ROI and bumps version without CC sync', () => {
    const clearRect = jest.fn();
    const getContext = jest.fn(() => ({ clearRect }));
    const updateLayer = jest.fn();
    const layerId = 'layer-1';
    const state = {
      layers: [
        {
          id: layerId,
          colorCycleData: {
            eraseMask: {
              width: 100,
              height: 80,
              getContext,
            } as unknown as HTMLCanvasElement,
            eraseMaskVersion: 4,
          },
        },
      ],
      updateLayer,
    };

    const storeRef = {
      current: state,
    } as unknown as React.MutableRefObject<AppState>;
    clearColorCycleEraseMaskInRegion(storeRef, layerId, {
      x: -10,
      y: 5,
      width: 120,
      height: 100,
    });

    expect(clearRect).toHaveBeenCalledWith(0, 5, 100, 75);
    expect(updateLayer).toHaveBeenCalledWith(
      layerId,
      { colorCycleData: { eraseMaskVersion: 5 } },
      { skipColorCycleSync: true }
    );
  });
});
