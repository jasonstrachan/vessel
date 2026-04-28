import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';

jest.mock('@/stores/colorCycleBrushManager', () => ({
  getColorCycleStoreState: () => null,
  getColorCycleBrushManager: jest.fn(),
}));

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: {
    getState: jest.fn(),
  },
}));

describe('captureColorCycleBrushState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
      project: { width: 4, height: 4 },
      layers: [
        {
          id: 'layer-1',
          layerType: 'color-cycle',
          colorCycleData: {
            canvasWidth: 4,
            canvasHeight: 4,
            eraseMask: maskCanvas,
            eraseMaskVersion: maskVersion,
          },
        },
      ],
    }));

    (getColorCycleBrushManager as jest.Mock).mockReturnValue({
      getBrush: () => ({
        serialize: () => ({
          canonicalPaint: true,
          schemaVersion: 1,
          layers: [{
            layerId: 'layer-1',
            canonicalPaint: true,
            schemaVersion: 1,
            dimensions: { width: 4, height: 4 },
            strokeData: {
              paintBuffer: new Uint8Array(16).fill(1).buffer,
              speedBuffer: new Uint8Array(16).fill(1).buffer,
              flowBuffer: new Uint8Array(16).buffer,
              phaseBuffer: new Uint8Array(16).buffer,
              hasContent: true,
            },
          }],
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

  it('preserves empty pre-stroke color-cycle history snapshots', () => {
    (useAppStore.getState as jest.Mock).mockReturnValue({
      project: { width: 4, height: 4 },
      layers: [
        {
          id: 'layer-empty',
          layerType: 'color-cycle',
          colorCycleData: {
            canvasWidth: 4,
            canvasHeight: 4,
          },
        },
      ],
    });

    (getColorCycleBrushManager as jest.Mock).mockReturnValue({
      getBrush: () => ({
        serialize: () => ({
          layers: [{
            layerId: 'layer-empty',
            strokeData: {
              hasContent: false,
            },
          }],
        }),
      }),
    });

    expect(captureColorCycleBrushState('layer-empty')).toEqual({
      layers: [{
        layerId: 'layer-empty',
        strokeData: {
          hasContent: false,
          paintBuffer: undefined,
          gradientIdBuffer: undefined,
          gradientDefIdBuffer: undefined,
          speedBuffer: undefined,
          flowBuffer: undefined,
          phaseBuffer: undefined,
        },
        eraseMaskSnapshot: undefined,
      }],
    });
  });

  it('rejects metadata-only painted color-cycle history snapshots', () => {
    (useAppStore.getState as jest.Mock).mockReturnValue({
      project: { width: 4, height: 4 },
      layers: [
        {
          id: 'layer-painted-metadata',
          layerType: 'color-cycle',
          colorCycleData: {
            canvasWidth: 4,
            canvasHeight: 4,
          },
        },
      ],
    });

    (getColorCycleBrushManager as jest.Mock).mockReturnValue({
      getBrush: () => ({
        serialize: () => ({
          layers: [{
            layerId: 'layer-painted-metadata',
            strokeData: {
              hasContent: true,
              strokeCounter: 1,
            },
          }],
        }),
      }),
    });

    expect(captureColorCycleBrushState('layer-painted-metadata')).toBeNull();
  });
});
