import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const mockStoreState = {
  layers: [] as Layer[],
  project: { width: 2, height: 2 },
  getLayerColorCycleBrush: jest.fn(),
  updateLayer: jest.fn(),
  setLayersNeedRecomposition: jest.fn(),
};

const mockBrushManager = {
  validateColorCycleBrush: jest.fn(),
  initColorCycleForLayer: jest.fn(),
  getBrush: jest.fn(),
};

jest.mock('@/stores/useAppStore', () => ({
  __esModule: true,
  useAppStore: {
    getState: () => mockStoreState,
  },
}));

jest.mock('@/stores/colorCycleBrushManager', () => ({
  __esModule: true,
  getColorCycleBrushManager: () => mockBrushManager,
}));

const { rehydrateEntryResources, createRehydrationTargets } = jest.requireActual('@/history/runtimeRehydration') as typeof import('@/history/runtimeRehydration');

const makeLayer = (canvas: HTMLCanvasElement, canvasImageData: ImageData): Layer => ({
  id: 'cc-layer',
  name: 'CC Layer',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  transparencyLocked: false,
  order: 0,
  imageData: null,
  framebuffer: canvas,
  alignment: createDefaultLayerAlignment(),
  layerType: 'color-cycle',
  colorCycleData: {
    canvas,
    canvasImageData,
    canvasWidth: 2,
    canvasHeight: 2,
    mode: 'brush',
    brushState: {
      layers: [{
        layerId: 'cc-layer',
        strokeData: {
          paintBuffer: new Uint8Array([1, 2, 3, 4]).buffer,
          gradientIdBuffer: new Uint8Array([4, 3, 2, 1]).buffer,
          hasContent: true,
          strokeCounter: 3,
        },
      }],
    },
  },
});

describe('runtimeRehydration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreState.layers = [];
  });

  it('does not overwrite a restored color-cycle brush surface with compatibility pixels', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d')!;
    const putImageDataSpy = jest.spyOn(ctx, 'putImageData');
    const compatibilityImageData = new ImageData(2, 2);
    const layer = makeLayer(canvas, compatibilityImageData);
    const brush = {
      applyLayerSnapshot: jest.fn(),
      setTargetCanvas: jest.fn(),
      updateColorCycleTexture: jest.fn(),
      renderDirectToCanvas: jest.fn(),
    };
    mockStoreState.layers = [layer];
    mockStoreState.getLayerColorCycleBrush.mockReturnValue(brush);
    mockBrushManager.validateColorCycleBrush.mockReturnValue(true);
    mockBrushManager.getBrush.mockReturnValue(brush);

    const targets = createRehydrationTargets();
    targets.colorCycleLayerIds.add(layer.id);
    await rehydrateEntryResources(
      { id: 'entry', action: 'layer-structure', label: 'test', ts: 1, docId: 'doc', deltas: [] },
      'backward',
      targets,
    );

    expect(brush.applyLayerSnapshot).toHaveBeenCalledWith(layer.id, expect.objectContaining({
      paintBuffer: expect.any(ArrayBuffer),
      hasContent: true,
      strokeCounter: 3,
    }));
    expect(brush.renderDirectToCanvas).toHaveBeenCalledWith(canvas, layer.id);
    expect(mockStoreState.updateLayer).toHaveBeenCalledWith(
      layer.id,
      expect.objectContaining({
        colorCycleData: expect.objectContaining({
          colorCycleBrush: brush,
          hasContent: true,
        }),
      }),
      { skipColorCycleSync: true },
    );
    expect(putImageDataSpy).not.toHaveBeenCalled();
  });
});
