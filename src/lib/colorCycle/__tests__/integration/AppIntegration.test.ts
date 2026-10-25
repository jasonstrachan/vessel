import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

let mockHighResolutionTimer = true;
let mockMemoryAPI = true;
let mockState: { layers: Layer[] };
const mockSetFPS = jest.fn();
const mockRuntime = { getConfiguredFPS: () => 15, setFPS: mockSetFPS };

jest.mock('@/stores/useAppStore', () => ({ useAppStore: { getState: () => mockState } }));
jest.mock('@/lib/colorCycle/RecolorManager', () => ({ RecolorManager: { getInstance: () => mockRuntime } }));
jest.mock('@/lib/colorCycle/monitoring/PerformanceProfiler', () => ({ PerformanceProfiler: { getInstance: () => ({}) } }));
jest.mock('@/lib/colorCycle/compatibility/BrowserCompat', () => ({
  BrowserCompat: { getInstance: () => ({
    getConfig: () => ({}),
    getRecommendedSettings: () => ({ maxConcurrentLayers: 4 }),
    isFeatureSupported: (feature: string) => feature === 'high-res-timer'
      ? mockHighResolutionTimer
      : feature === 'memory-api' ? mockMemoryAPI : true,
  }) },
}));

const makeLayer = (fps: number): Layer => ({
  id: `recolor-${fps}`, name: 'Recolor', layerType: 'color-cycle', visible: true, locked: false,
  opacity: 1, blendMode: 'source-over', order: 0, framebuffer: document.createElement('canvas'),
  imageData: new ImageData(new Uint8ClampedArray([32, 64, 192, 255]), 1, 1),
  alignment: createDefaultLayerAlignment(), colorCycleData: { mode: 'recolor', recolorSettings: {
    originalImageData: new ImageData(new Uint8ClampedArray([32, 64, 192, 255]), 1, 1),
    indexBuffer: new Uint8Array([43]), palette: new Uint32Array([0, 0xff2060a0]),
    gradient: [{ position: 0, color: '#2060a0' }, { position: 1, color: '#2060a0' }],
    quantizationMode: 'rgb332', ditherMode: 'off', cycleColors: 16, currentLOD: 'full',
    animation: { speed: 0.1, fps, ticksPerFrame: 0.1 / fps * 16, currentTick: 7.25, isPlaying: false, flowDirection: 'reverse' },
  } },
});

describe('AppIntegration background performance observation', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['monitoring high headroom', true, true, 16, 1],
    ['monitoring low headroom', true, true, 2400, 1],
    ['automatic high headroom', false, false, 16, 1],
    ['automatic low headroom', false, false, 2400, 1],
    ['both configured monitor routes', true, false, 16, 2],
  ] as const)('preserves authored FPS, runtime timing and source under %s', async (_name, highTimer, memoryAPI, frameMs, loops) => {
    jest.resetModules();
    mockSetFPS.mockClear();
    mockHighResolutionTimer = highTimer;
    mockMemoryAPI = memoryAPI;
    mockState = { layers: [makeLayer(15), makeLayer(30), makeLayer(60)] };
    const before = mockState.layers.map(layer => ({
      layer, image: layer.imageData, imageBytes: [...layer.imageData!.data],
      settings: layer.colorCycleData!.recolorSettings!,
      animation: { ...layer.colorCycleData!.recolorSettings!.animation },
      original: layer.colorCycleData!.recolorSettings!.originalImageData,
      originalBytes: [...layer.colorCycleData!.recolorSettings!.originalImageData!.data],
      indexBuffer: layer.colorCycleData!.recolorSettings!.indexBuffer,
      paletteBuffer: layer.colorCycleData!.recolorSettings!.palette,
      gradient: layer.colorCycleData!.recolorSettings!.gradient.map(stop => ({ ...stop })),
      indices: [...layer.colorCycleData!.recolorSettings!.indexBuffer!],
      palette: [...layer.colorCycleData!.recolorSettings!.palette!],
    }));
    let time = 0;
    const queue: FrameRequestCallback[] = [];
    jest.spyOn(performance, 'now').mockImplementation(() => time);
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { queue.push(callback); return queue.length; });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { AppIntegration } = await import('../../integration/AppIntegration');
    await AppIntegration.getInstance().initialize();
    expect(queue).toHaveLength(loops);
    // Drive only the public initialization's real queued monitor callbacks at the RAF I/O boundary.
    for (let frame = 0; frame < loops * 120; frame += 1) {
      time += frameMs;
      queue.shift()!(time);
    }
    expect(queue).toHaveLength(loops);
    expect(mockRuntime.getConfiguredFPS()).toBe(15);
    expect(mockSetFPS).not.toHaveBeenCalled();
    mockState.layers.forEach((layer, index) => {
      const original = before[index], settings = layer.colorCycleData!.recolorSettings!;
      expect(layer).toBe(original.layer);
      expect(settings).toBe(original.settings);
      expect(settings.animation).toEqual(original.animation);
      expect(layer.imageData).toBe(original.image);
      expect([...layer.imageData!.data]).toEqual(original.imageBytes);
      expect(settings.originalImageData).toBe(original.original);
      expect([...settings.originalImageData!.data]).toEqual(original.originalBytes);
      expect(settings.indexBuffer).toBe(original.indexBuffer);
      expect(settings.palette).toBe(original.paletteBuffer);
      expect(settings.gradient).toEqual(original.gradient);
      expect([...settings.indexBuffer!]).toEqual(original.indices);
      expect([...settings.palette!]).toEqual(original.palette);
    });
  });
});
