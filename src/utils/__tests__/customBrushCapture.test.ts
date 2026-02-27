import { captureColorCycleDataFromLayer } from '@/utils/customBrushCapture';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const getLayerColorCycleBrush = jest.fn();

jest.mock('@/stores/colorCycleBrushManager', () => ({
  __esModule: true,
  getColorCycleBrushManager: () => ({
    getLayerColorCycleBrush: (...args: unknown[]) => getLayerColorCycleBrush(...args),
  }),
}));

const createLayer = (): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = 2;
  framebuffer.height = 2;

  return {
    id: 'cc-layer',
    name: 'Color Cycle',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData: null,
    framebuffer,
    alignment: createDefaultLayerAlignment(),
    layerType: 'color-cycle',
    colorCycleData: {
      canvasWidth: 2,
      canvasHeight: 2,
      gradientIdBuffer: new Uint8Array([9, 9, 9, 9]).buffer,
      gradient: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      brushSpeed: 0.2,
    },
  };
};

describe('captureColorCycleDataFromLayer', () => {
  beforeEach(() => {
    getLayerColorCycleBrush.mockReset();
  });

  it('uses runtime paintBuffer as captured phaseMap', () => {
    getLayerColorCycleBrush.mockReturnValue({
      getLayerSnapshot: () => ({
        paintBuffer: new Uint8Array([1, 2, 3, 4]).buffer,
      }),
    });

    const capture = captureColorCycleDataFromLayer({
      activeLayer: createLayer(),
      sampleAllLayers: false,
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      captureResult: {
        imageData: new ImageData(
          new Uint8ClampedArray([
            255, 255, 255, 255,
            255, 255, 255, 255,
            255, 255, 255, 255,
            255, 255, 255, 255,
          ]),
          2,
          2
        ),
        width: 2,
        height: 2,
        naturalWidth: 2,
        naturalHeight: 2,
        maxDimension: 2,
      },
    });

    expect(capture?.schemaVersion).toBe(2);
    expect(capture?.mode).toBe('captured-data');
    expect(Array.from(capture?.phaseMap ?? [])).toEqual([1, 2, 3, 4]);
    expect(capture?.indexMap).toBeUndefined();
  });

  it('captures gradient from active slot palette when defs are present', () => {
    getLayerColorCycleBrush.mockReturnValue({
      getLayerSnapshot: () => ({
        paintBuffer: new Uint8Array([1, 2, 3, 4]).buffer,
      }),
    });

    const layer = createLayer();
    if (!layer.colorCycleData) {
      throw new Error('Expected colorCycleData');
    }
    layer.colorCycleData.gradient = [{ position: 0, color: '#111111' }, { position: 1, color: '#222222' }];
    layer.colorCycleData.gradientDefs = [{ id: 'g-main', currentSlot: 7 }];
    layer.colorCycleData.activeGradientId = 'g-main';
    layer.colorCycleData.paintSlot = 7;
    layer.colorCycleData.slotPalettes = [
      {
        slot: 7,
        stops: [{ position: 0, color: '#00ff00' }, { position: 1, color: '#00ff00' }],
      },
    ];

    const capture = captureColorCycleDataFromLayer({
      activeLayer: layer,
      sampleAllLayers: false,
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      captureResult: {
        imageData: new ImageData(new Uint8ClampedArray(2 * 2 * 4), 2, 2),
        width: 2,
        height: 2,
        naturalWidth: 2,
        naturalHeight: 2,
        maxDimension: 2,
      },
    });

    expect(capture?.gradient).toEqual([
      { position: 0, color: '#00ff00' },
      { position: 1, color: '#00ff00' },
    ]);
  });
});
