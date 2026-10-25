/* eslint-disable @typescript-eslint/no-explicit-any */
import { RecolorManager } from '../RecolorManager';

// --- Mocks -----------------------------------------------------------------
const mockRegisterLayer = jest.fn();
const mockUpdateLayer = jest.fn();
const mockPlayAll = jest.fn();
const mockStop = jest.fn();
const mockSetFPS = jest.fn();
const mockGetConfiguredFPS = jest.fn(() => 30);
const mockIsAnimating = jest.fn(() => false);
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
      getConfiguredFPS = mockGetConfiguredFPS;
      setLayerSpeed = mockSetLayerSpeed;
      getLayers = mockGetLayers;
      getStats = () => ({ fps: 60 });
      isAnimating = mockIsAnimating;
      cleanup = jest.fn();
      unregisterLayer = jest.fn();
    },
  };
});

const mockProcessLayer = jest.fn((layer: Layer) => Boolean(layer));
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

  it('reads configured target FPS rather than measured renderer statistics', () => {
    const manager = RecolorManager.getInstance();
    expect(manager.getConfiguredFPS()).toBe(30);
    expect(mockGetConfiguredFPS).toHaveBeenCalled();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRegisterLayer.mockReturnValue(true);
    mockIsAnimating.mockReturnValue(false);
  });

  it('processes a layer and registers it', async () => {
    const manager = RecolorManager.getInstance();
    const ok = await manager.processLayer(layer, { gradientPreset: 'rainbow' });
    expect(ok).toBe(true);
    expect(mockProcessLayer).toHaveBeenCalled();
    expect(mockRegisterLayer).toHaveBeenCalledWith(layer);
    expect(mockUpdateLayer).toHaveBeenCalledWith(layer);
  });

  const sparseSource = () => {
    const image = new ImageData(256, 256);
    for (let y = 62; y < 70; y++) {
      for (let x = 62; x < 70; x++) image.data.set([255, 0, 0, 255], (y * 256 + x) * 4);
    }
    return image;
  };

  const framebufferWith = (image: ImageData) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Test framebuffer context unavailable');
    jest.spyOn(context, 'getImageData').mockReturnValue(image);
    return canvas;
  };

  it.each(['canonical', 'framebuffer'] as const)('preserves off-grid sparse RGBA admitted from %s', async (authority) => {
    const source = sparseSource();
    const original = source.data.slice();
    const sparseLayer: Layer = {
      ...layer,
      layerType: 'normal',
      colorCycleData: undefined,
      imageData: authority === 'canonical' ? source : new ImageData(256, 256),
      framebuffer: framebufferWith(authority === 'framebuffer' ? source : new ImageData(256, 256)),
    };
    let admitted: Uint8ClampedArray | undefined;
    mockProcessLayer.mockImplementationOnce((candidate) => {
      admitted = candidate.imageData?.data.slice();
      return true;
    });
    expect(await RecolorManager.getInstance().processLayer(sparseLayer)).toBe(true);
    expect(admitted).toEqual(original);
    expect(sparseLayer.imageData).toBe(source);
    expect(source.data).toEqual(original);
    expect(mockRegisterLayer).toHaveBeenCalledWith(sparseLayer);
  });

  it('keeps blank framebuffer dimensions valid for conversion', async () => {
    const blankLayer: Layer = { ...layer, imageData: null, framebuffer: framebufferWith(new ImageData(19, 23)) };
    let admitted: ImageData | undefined;
    mockProcessLayer.mockImplementationOnce((candidate) => { admitted = candidate.imageData ?? undefined; return true; });
    expect(await RecolorManager.getInstance().processLayer(blankLayer)).toBe(true);
    expect(admitted?.width).toBe(19);
    expect(admitted?.height).toBe(23);
    expect(admitted?.data.every(value => value === 0)).toBe(true);
  });

  it.each([['false', false], ['throw', false], ['false', true], ['throw', true]] as const)('publishes no normal conversion fields or callbacks on engine %s with prior metadata %s', async (failure, priorMetadata) => {
    const source = sparseSource();
    const captured = sparseSource();
    const framebuffer = framebufferWith(captured);
    const rejectedLayer: Layer = {
      ...layer, layerType: 'normal', imageData: source, framebuffer,
      visible: false, locked: true, opacity: 0.4, blendMode: 'multiply',
    };
    if (priorMetadata) {
      rejectedLayer.colorCycleData = { mode: 'recolor', activeGradientId: 'stale-gradient' };
      Reflect.deleteProperty(rejectedLayer, 'imageData');
    } else {
      delete rejectedLayer.colorCycleData;
    }
    const originalMetadata = rejectedLayer.colorCycleData;
    // Exercise candidate source admission as well as metadata changes.
    source.data.fill(0);
    const before = { ...rejectedLayer };
    const sourceBefore = source.data.slice();
    const capturedBefore = captured.data.slice();
    const callback = jest.fn();
    const manager = RecolorManager.getInstance();
    manager.onLayerUpdate(callback);
    mockProcessLayer.mockImplementationOnce((candidate) => {
      expect(candidate.imageData).toBe(captured);
      expect(candidate.layerType).toBe('color-cycle');
      expect(candidate.colorCycleData?.mode).toBe('recolor');
      candidate.colorCycleData = { ...candidate.colorCycleData, activeGradientId: 'rejected-gradient' };
      candidate.imageData = new ImageData(7, 9);
      if (failure === 'throw') throw new Error('Rejected indexing I/O');
      return false;
    });
    try {
      expect(await manager.processLayer(rejectedLayer)).toBe(false);
      expect(rejectedLayer).toEqual(before);
      expect(Object.hasOwn(rejectedLayer, 'colorCycleData')).toBe(priorMetadata);
      expect(Object.hasOwn(rejectedLayer, 'imageData')).toBe(!priorMetadata);
      expect(rejectedLayer.imageData).toBe(priorMetadata ? undefined : source);
      expect(rejectedLayer.colorCycleData).toBe(originalMetadata);
      expect(rejectedLayer.framebuffer).toBe(framebuffer);
      expect(source.data).toEqual(sourceBefore);
      expect(captured.data).toEqual(capturedBefore);
      expect(callback).not.toHaveBeenCalled();
      expect(mockRegisterLayer).not.toHaveBeenCalled();
      expect(mockUpdateLayer).not.toHaveBeenCalled();
    } finally { manager.offLayerUpdate(callback); }
  });

  it('publishes fresh normal conversion fields on the actual caller before registration and callback', async () => {
    const source = sparseSource();
    const framebuffer = framebufferWith(source);
    const stale = { mode: 'recolor' as const, activeGradientId: 'stale-gradient' };
    const actual: Layer = { ...layer, layerType: 'normal', imageData: source, framebuffer, colorCycleData: stale };
    const converted = { mode: 'recolor' as const, activeGradientId: 'converted-gradient' };
    const manager = RecolorManager.getInstance();
    const callback = jest.fn((published: Layer) => {
      expect(published).toBe(actual);
      expect(published.layerType).toBe('color-cycle');
      expect(published.colorCycleData).toBe(converted);
    });
    manager.onLayerUpdate(callback);
    mockProcessLayer.mockImplementationOnce((candidate) => {
      expect(candidate).not.toBe(actual);
      expect(actual.layerType).toBe('normal');
      expect(actual.colorCycleData).toBe(stale);
      expect(candidate.colorCycleData).toEqual({ mode: 'recolor' });
      expect(candidate.colorCycleData?.recolorSettings).toBeUndefined();
      expect(candidate.imageData).toBe(source);
      candidate.colorCycleData = converted;
      return true;
    });
    mockRegisterLayer.mockImplementationOnce((registered: Layer) => {
      expect(registered).toBe(actual);
      expect(registered.colorCycleData).toBe(converted);
      return true;
    });
    try {
      expect(await manager.processLayer(actual)).toBe(true);
      expect(actual.imageData).toBe(source);
      expect(actual.framebuffer).toBe(framebuffer);
      expect(stale).toEqual({ mode: 'recolor', activeGradientId: 'stale-gradient' });
      expect(mockUpdateLayer).toHaveBeenCalledWith(actual);
      expect(callback).toHaveBeenCalledTimes(1);
    } finally { manager.offLayerUpdate(callback); }
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

  it.each([false, true])('reconciles replayed playback metadata to actual controller state %s', async (playing) => {
    mockIsAnimating.mockReturnValue(playing);
    const settings = {
      quantizationMode: 'rgb332' as const, ditherMode: 'off' as const,
      cycleColors: 16, gradient: [{ position: 0, color: '#ff0044' }],
      animation: { speed: 0.1, fps: 30, ticksPerFrame: 0.2, isPlaying: !playing, currentTick: 7.25, flowDirection: 'reverse' as const },
      currentLOD: 'full' as const, indexBuffer: new Uint8Array([1, 2, 1, 2]),
      palette: new Uint32Array([0, 0xff334455, 0xff667788]),
    };
    const before = { ...settings.animation };
    const recolorLayer: Layer = { ...layer, layerType: 'color-cycle', colorCycleData: { mode: 'recolor', recolorSettings: settings } };
    const manager = RecolorManager.getInstance();
    const published = jest.fn((entry: Layer) => entry.colorCycleData?.recolorSettings?.animation.isPlaying);
    manager.onLayerUpdate(published);
    try {
      expect(await manager.restoreLayer(recolorLayer)).toBe(true);
      expect(settings.animation).toEqual({ ...before, isPlaying: playing });
      expect(mockRenderFrame).toHaveBeenCalledWith(recolorLayer, 7.25);
      expect(mockUpdateLayer).not.toHaveBeenCalled();
      expect(mockPlayAll).not.toHaveBeenCalled();
      expect(published).toHaveBeenCalledWith(recolorLayer);
      expect(published.mock.results[0].value).toBe(playing);
    } finally { manager.offLayerUpdate(published); }
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
