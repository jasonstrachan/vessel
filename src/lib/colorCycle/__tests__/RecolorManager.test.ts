import { RecolorManager } from '../RecolorManager';

// --- Mocks -----------------------------------------------------------------
const mockRegisterLayer = jest.fn();
const mockUpdateLayer = jest.fn();
const mockPlayAll = jest.fn();
const mockStop = jest.fn();
const mockSetFPS = jest.fn();
const mockGetLayers = jest.fn(() => []);
const mockSetLayerSpeed = jest.fn();
const mockOnFrame = jest.fn();

jest.mock('../RecolorAnimationController', () => {
  return {
    RecolorAnimationController: class {
      onFrame = mockOnFrame;
      registerLayer = mockRegisterLayer;
      updateLayer = mockUpdateLayer;
      playAll = mockPlayAll;
      stop = mockStop;
      setFPS = mockSetFPS;
      setLayerSpeed = mockSetLayerSpeed;
      getLayers = mockGetLayers;
      getStats = () => ({ fps: 60 });
      isAnimating = () => false;
      cleanup = jest.fn();
      unregisterLayer = jest.fn();
    },
  };
});

const mockProcessLayer = jest.fn(() => true);
const mockRenderFrame = jest.fn(() => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }));
const mockUpdateMappingMode = jest.fn(() => true);
const mockUpdateGradient = jest.fn(() => true);

jest.mock('../RecolorEngine', () => {
  return {
    RecolorEngine: class {
      processLayer = mockProcessLayer;
      renderFrame = mockRenderFrame;
      updateMappingMode = mockUpdateMappingMode;
      updateGradient = mockUpdateGradient;
    },
  };
});

jest.mock('../gradients/GradientBuilder', () => {
  return {
    GradientBuilder: class {
      updateOptions = jest.fn();
      buildGradient = jest.fn((colors: any[], stops: number) =>
        colors.slice(0, stops).map((c, idx) => ({ position: idx / (stops - 1 || 1), color: c.color }))
      );
      analyzeGradient = jest.fn(() => ({ smoothness: 1 }));
    },
  };
});

jest.mock('../colorSpace/OKLabConverter', () => ({
  OKLabConverter: {
    analyzeImageColors: jest.fn(() => ({ dominantColors: [{ r: 1, g: 2, b: 3 }] })),
    batchOKLabToRGB: jest.fn((colors) => colors.map((c: any) => ({ r: c.r || 0, g: c.g || 0, b: c.b || 0 }))),
    generatePalette: jest.fn((colors) => colors),
  },
  ColorAnalysis: class {},
}));

// --- Tests -----------------------------------------------------------------
describe('RecolorManager (mocked)', () => {
  const layer = {
    id: 'layer-1',
    width: 2,
    height: 2,
    imageData: new ImageData(2, 2),
    colorCycleData: {},
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('processes a layer and registers it', async () => {
    const manager = RecolorManager.getInstance();
    const ok = await manager.processLayer(layer, { gradientPreset: 'rainbow' });
    expect(ok).toBe(true);
    expect(mockProcessLayer).toHaveBeenCalled();
    expect(mockRegisterLayer).toHaveBeenCalledWith(layer);
    expect(mockUpdateLayer).toHaveBeenCalledWith(layer);
  });

  it('extracts colors via OKLab path', async () => {
    const manager = RecolorManager.getInstance();
    const result = await manager.extractColors(layer, {
      method: 'oklab',
      gradientStops: 4,
      buildMode: 'perceptual',
      sortBy: 'hue',
    });
    expect(result).not.toBeNull();
    expect(result?.length).toBeGreaterThan(0);
  });

  it('controls animation via play/stop/fps', () => {
    const manager = RecolorManager.getInstance();
    manager.playAll();
    manager.stop();
    manager.setFPS(24);
    expect(mockPlayAll).toHaveBeenCalled();
    expect(mockStop).toHaveBeenCalled();
    expect(mockSetFPS).toHaveBeenCalledWith(24);
  });

  it('updates mapping mode and gradient', async () => {
    const manager = RecolorManager.getInstance();
    mockGetLayers.mockReturnValue([{ layer }]);
    const ok = manager.setLayerMappingMode(layer.id, 'banded');
    expect(ok).toBe(true);
    const ccLayer = { ...layer, layerType: 'color-cycle', colorCycleData: { mode: 'recolor' } } as any;
    const gradientOk = manager.updateGradient(ccLayer, [{ position: 0, color: '#000' }]);
    expect(gradientOk).toBe(true);
    expect(mockUpdateMappingMode).toHaveBeenCalled();
    expect(mockUpdateGradient).toHaveBeenCalled();
  });
});
