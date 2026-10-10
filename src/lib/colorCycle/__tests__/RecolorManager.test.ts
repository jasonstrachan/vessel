/* eslint-disable @typescript-eslint/no-explicit-any */
import { RecolorManager } from '../RecolorManager';

// --- Mocks -----------------------------------------------------------------
const mockRegisterLayer = jest.fn();
const mockUpdateLayer = jest.fn();
const mockPlayAll = jest.fn();
const mockStop = jest.fn();
const mockSetFPS = jest.fn();
import type { Layer } from '@/types';

const mockGetLayers: jest.Mock<Layer[], []> = jest.fn(() => []);
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
    mockRegisterLayer.mockReturnValue(true);
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

  it('restores valid indexed state without quantization, gradient replacement or phase advance', async () => {
    const settings = {
      quantizationMode: 'oklab-median-cut' as const,
      ditherMode: 'bayer4' as const,
      cycleColors: 16,
      gradient: [{ position: 0, color: '#ff0044' }, { position: 1, color: '#44ffaa' }],
      animation: { speed: 0.1, fps: 30, ticksPerFrame: 0.2, isPlaying: false, currentTick: 7.25, flowDirection: 'reverse' as const },
      currentLOD: 'full' as const,
      indexBuffer: new Uint8Array([1, 2, 1, 2]),
      palette: new Uint32Array([0, 0xff334455, 0xff667788]),
    };
    const recolorLayer: Layer = { ...layer, layerType: 'color-cycle', colorCycleData: { mode: 'recolor', recolorSettings: settings } };
    expect(await RecolorManager.getInstance().restoreLayer(recolorLayer)).toBe(true);
    expect(mockProcessLayer).not.toHaveBeenCalled();
    expect(mockUpdateLayer).not.toHaveBeenCalled();
    expect(mockRegisterLayer).toHaveBeenCalledWith(recolorLayer);
    expect(mockRenderFrame).toHaveBeenCalledWith(recolorLayer, 7.25);
    expect(settings.animation.currentTick).toBe(7.25);
    expect(settings.gradient[0].color).toBe('#ff0044');
  });

  it('uses original source and saved options for cold indexed restoration', async () => {
    const originalImageData = new ImageData(2, 2);
    originalImageData.data[0] = 78;
    const settings = {
      quantizationMode: 'oklab-median-cut' as const,
      ditherMode: 'bayer8' as const,
      cycleColors: 32,
      gradient: [{ position: 0, color: '#abcdef' }],
      animation: { speed: 0.1, fps: 30, ticksPerFrame: 0.2, isPlaying: false, currentTick: 3.75, flowDirection: 'forward' as const },
      currentLOD: 'full' as const,
      originalImageData,
    };
    const recolorLayer: Layer = { ...layer, layerType: 'color-cycle', colorCycleData: { mode: 'recolor', recolorSettings: settings } };
    expect(await RecolorManager.getInstance().restoreLayer(recolorLayer)).toBe(true);
    expect(mockProcessLayer).toHaveBeenCalledWith(recolorLayer, {
      quantizationMode: 'oklab-median-cut', ditherMode: 'bayer8', cycleColors: 32, customGradient: settings.gradient,
    });
    expect(mockRenderFrame).toHaveBeenCalledWith(recolorLayer, 3.75);
    expect(mockUpdateLayer).not.toHaveBeenCalled();
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
    mockGetLayers.mockReturnValue([{ layer } as any]);
    const ok = manager.setLayerMappingMode(layer.id, 'banded');
    expect(ok).toBe(true);
    const ccLayer = { ...layer, layerType: 'color-cycle', colorCycleData: { mode: 'recolor' } } as any;
    const gradientOk = manager.updateGradient(ccLayer, [{ position: 0, color: '#000' }]);
    expect(gradientOk).toBe(true);
    expect(mockUpdateMappingMode).toHaveBeenCalled();
    expect(mockUpdateGradient).toHaveBeenCalled();
  });
});
