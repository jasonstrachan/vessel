import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';

jest.mock('@/stores/colorCycleBrushManager', () => ({
  getColorCycleBrushManager: jest.fn(),
}));

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: {
    getState: jest.fn(),
  },
}));

describe('captureColorCycleBrushState', () => {
  it('reuses cached erase mask snapshots when version is unchanged', () => {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 4;
    maskCanvas.height = 4;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    expect(maskCtx).toBeTruthy();
    if (!maskCtx) {
      return;
    }
    maskCtx.fillStyle = 'rgba(0,0,0,1)';
    maskCtx.fillRect(0, 0, 4, 4);
    const getImageDataSpy = jest.spyOn(maskCtx, 'getImageData');

    let maskVersion = 1;
    (useAppStore.getState as jest.Mock).mockImplementation(() => ({
      layers: [
        {
          id: 'layer-1',
          layerType: 'color-cycle',
          colorCycleData: {
            eraseMask: maskCanvas,
            eraseMaskVersion: maskVersion,
          },
        },
      ],
    }));

    (getColorCycleBrushManager as jest.Mock).mockReturnValue({
      getBrush: () => ({
        serialize: () => ({
          layers: [{ layerId: 'layer-1' }],
        }),
      }),
    });

    captureColorCycleBrushState('layer-1');
    captureColorCycleBrushState('layer-1');
    expect(getImageDataSpy).toHaveBeenCalledTimes(1);

    maskVersion = 2;
    captureColorCycleBrushState('layer-1');
    expect(getImageDataSpy).toHaveBeenCalledTimes(2);
  });
});
