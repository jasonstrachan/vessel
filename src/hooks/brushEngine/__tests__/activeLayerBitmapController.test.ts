import { getActiveLayerBitmapCanvas } from '../activeLayerBitmapController';

describe('activeLayerBitmapController', () => {
  it('returns framebuffer for bitmap layers', () => {
    const framebuffer = document.createElement('canvas');
    const canvas = getActiveLayerBitmapCanvas({
      getState: () => ({
        activeLayerId: 'layer-1',
        layers: [{ id: 'layer-1', layerType: 'bitmap', framebuffer }],
      }),
    });

    expect(canvas).toBe(framebuffer);
  });

  it('returns color-cycle canvas for color-cycle layers', () => {
    const ccCanvas = document.createElement('canvas');
    const canvas = getActiveLayerBitmapCanvas({
      getState: () => ({
        activeLayerId: 'layer-cc',
        layers: [{ id: 'layer-cc', layerType: 'color-cycle', colorCycleData: { canvas: ccCanvas } }],
      }),
    });

    expect(canvas).toBe(ccCanvas);
  });

  it('returns null when active layer is missing', () => {
    const canvas = getActiveLayerBitmapCanvas({
      getState: () => ({
        activeLayerId: 'missing',
        layers: [],
      }),
    });

    expect(canvas).toBeNull();
  });
});

