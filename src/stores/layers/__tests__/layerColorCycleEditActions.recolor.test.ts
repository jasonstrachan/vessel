import type { Layer } from '@/types';
import { useAppStore } from '@/stores/useAppStore';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { createLayerColorCycleEditActions } from '@/stores/layers/layerColorCycleEditActions';
import { captureLayerStructureSnapshot, commitLayerStructureHistory } from '@/stores/helpers/layerStructureHistory';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import historyManager from '@/history/historyService';
import { createRehydrationTargets } from '@/history/runtimeRehydration';

const mockRegistered = new Map<string, Layer>();
const mockRemove = jest.fn((id: string) => mockRegistered.delete(id));
const mockRestore = jest.fn(async (layer: Layer) => { mockRegistered.set(layer.id, layer); return true; });
jest.mock('@/lib/colorCycle/RecolorManager', () => ({ RecolorManager: { getInstance: () => ({
  removeLayer: mockRemove, restoreLayer: mockRestore, getConfiguredFPS: () => 15,
}) } }));

// Canvas is the external I/O boundary. The repository mock does not composite drawImage masks.
const rasterCanvas = (width = 2, height = 2) => {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!;
  jest.spyOn(context, 'drawImage').mockImplementation((source: CanvasImageSource) => {
    const surface = source as HTMLCanvasElement, input = surface.getContext('2d')!.getImageData(0, 0, width, height), pixels = context.getImageData(0, 0, width, height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (context.globalCompositeOperation === 'destination-out' || context.globalCompositeOperation === 'destination-in') {
        const coverage = context.globalCompositeOperation === 'destination-out' ? 255 - input.data[i + 3] : input.data[i + 3];
        pixels.data[i + 3] = Math.round(pixels.data[i + 3] * coverage / 255);
      } else pixels.data.set(input.data.slice(i, i + 4), i);
      if (pixels.data[i + 3] === 0) pixels.data.fill(0, i, i + 4);
    }
    context.putImageData(pixels, 0, 0);
  });
  return canvas;
};
const paint = (canvas: HTMLCanvasElement, pixels: number[]) => canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), 2, 2), 0, 0);
const currentPixels = [0, 0, 0, 0, 32, 96, 160, 128, 32, 96, 160, 255, 32, 96, 160, 255];
const originalPixels = [255, 0, 0, 0, 255, 0, 0, 128, 255, 0, 0, 255, 255, 0, 0, 255];
const makeLayer = (): Layer => {
  const canvas = rasterCanvas(), framebuffer = rasterCanvas(); paint(canvas, currentPixels); paint(framebuffer, originalPixels);
  return { id: 'recolor', name: 'Recolor', layerType: 'color-cycle', visible: true, locked: false, opacity: 1, blendMode: 'source-over', order: 0,
    alignment: createDefaultLayerAlignment(), imageData: new ImageData(new Uint8ClampedArray(originalPixels), 2, 2), framebuffer,
    colorCycleData: { mode: 'recolor', canvas, recolorSettings: {
      quantizationMode: 'rgb332', ditherMode: 'off', cycleColors: 16, currentLOD: 'full',
      originalImageData: new ImageData(new Uint8ClampedArray(originalPixels), 2, 2), indexBuffer: new Uint8Array([0, 224, 224, 224]), palette: new Uint32Array([0, 0xff0000ff]),
      gradient: [{ position: 0, color: '#2060a0' }, { position: 1, color: '#2060a0' }], mappingMode: 'continuous', flowMapping: 'palette',
      animation: { speed: 0.7, fps: 15, ticksPerFrame: 0.7 * 16 / 15, currentTick: 2.25, isPlaying: false, flowDirection: 'reverse' },
    } },
  };
};

describe('public layer-row Recolor current-frame conversion', () => {
  let source: Layer;
  const manager = getColorCycleBrushManager();
  const run = () => createLayerColorCycleEditActions({
    set: useAppStore.setState, get: useAppStore.getState, colorCycleBrushManager: manager,
    captureLayerStructureSnapshot, commitLayerStructureHistory, createLayerTransferCanvas: rasterCanvas,
    hasValidFramebuffer: (value): value is HTMLCanvasElement => value instanceof HTMLCanvasElement,
    scheduleSlotRebuild: jest.fn(),
  }).convertColorCycleLayerToNormal(source.id);
  beforeEach(() => {
    jest.clearAllMocks(); mockRegistered.clear(); historyManager.clear();
    useAppStore.getState().newProject(2, 2, 'Recolor conversion'); source = makeLayer();
    useAppStore.setState(state => ({ layers: [source], activeLayerId: source.id, selectedLayerIds: [source.id], layerGroups: [], project: { ...state.project!, layers: [source] } }));
    mockRegistered.set(source.id, source);
  });
  afterEach(() => { historyManager.clear(); jest.restoreAllMocks(); });

  it('bakes current2x2 RGBA and masks instead of original source, then replays real global Undo/Redo', async () => {
    const surface = jest.spyOn(manager, 'getSurfaceBrush').mockReturnValue(null);
    const erase = rasterCanvas(), soft = rasterCanvas();
    paint(erase, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0]);
    paint(soft, [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 128]);
    source.colorCycleData!.eraseMask = erase; source.colorCycleData!.softEdgeMask = soft; source.colorCycleData!.softEdgeMaskEnabled = true;
    const unrelatedPixels = [12, 34, 56, 255, 23, 45, 67, 128, 34, 56, 78, 255, 45, 67, 89, 255];
    const unrelated: Layer = { ...source, id: 'unrelated-cc', name: 'Untouched CC', imageData: new ImageData(new Uint8ClampedArray(unrelatedPixels), 2, 2), framebuffer: rasterCanvas(), colorCycleData: { mode: 'brush', hasContent: false, isAnimating: false, brushState: null, gradient: [{ position: 0, color: '#123456' }, { position: 1, color: '#abcdef' }], activeGradientId: 'untouched' } };
    paint(unrelated.framebuffer as HTMLCanvasElement, unrelatedPixels);
    useAppStore.setState({ layers: [source, unrelated] });
    const unrelatedMetadata = structuredClone(unrelated.colorCycleData);
    const originalSettings = source.colorCycleData!.recolorSettings!, expectedSettings = { ...originalSettings, animation: { ...originalSettings.animation }, gradient: originalSettings.gradient.map(stop => ({ ...stop })), indexBuffer: new Uint8Array([0, 224, 224, 224]), palette: new Uint32Array([0, 0xff0000ff]), originalImageData: new ImageData(new Uint8ClampedArray(originalPixels), 2, 2) };
    const expected = [0, 0, 0, 0, 32, 96, 160, 128, 0, 0, 0, 0, 32, 96, 160, 128];
    expect(run()).toBe(true);
    expect(surface).not.toHaveBeenCalled(); expect(mockRemove).toHaveBeenCalledWith(source.id); expect(mockRegistered.has(source.id)).toBe(false);
    const assertNormal = () => { const normal = useAppStore.getState().layers[0]; expect(normal.layerType).toBe('normal'); expect(normal.colorCycleData).toBeUndefined(); expect(Array.from(normal.imageData!.data)).toEqual(expected); expect(Array.from(normal.framebuffer.getContext('2d')!.getImageData(0, 0, 2, 2).data)).toEqual(expected); };
    assertNormal(); expect(historyManager.entries()).toHaveLength(1);
    const targets = createRehydrationTargets();
    historyManager.entries()[0].deltas[0].collectRehydrationTargets!(targets);
    expect([...targets.layerIds]).toEqual([source.id]); expect([...targets.colorCycleLayerIds]).toEqual([source.id]);
    const assertUnrelated = () => { const current = useAppStore.getState().layers.find(layer => layer.id === unrelated.id)!; expect(current.colorCycleData).toEqual(unrelatedMetadata); expect(Array.from(current.imageData!.data)).toEqual(unrelatedPixels); };
    assertUnrelated();
    for (let i = 0; i < 2; i++) {
      await useAppStore.getState().undo(); const restored = useAppStore.getState().layers[0];
      expect(restored.colorCycleData!.recolorSettings).toEqual(expectedSettings); expect(restored.colorCycleData!.recolorSettings!.animation.fps).toBe(15);
      expect(Array.from(restored.imageData!.data)).toEqual(originalPixels); expect(mockRegistered.get(source.id)).toBe(restored);
      assertUnrelated(); await useAppStore.getState().redo(); assertNormal(); assertUnrelated(); expect(mockRegistered.has(source.id)).toBe(false);
    }
    expect(originalSettings.animation).toEqual(expectedSettings.animation); expect(Array.from(originalSettings.originalImageData!.data)).toEqual(originalPixels);
  });

  it.each(['missing', 'wrong-size'] as const)('rejects %s current published Recolor surface before any brush authority or capture, without changing timing/source/history', (kind) => {
    source.colorCycleData!.canvas = kind === 'missing' ? undefined : rasterCanvas(1, 1);
    const surface = jest.spyOn(manager, 'getSurfaceBrush').mockReturnValue(null), historyBrush = jest.spyOn(manager, 'getHistoryBrush');
    const before = source.colorCycleData!.recolorSettings!, animation = { ...before.animation };
    expect(run()).toBe(false); expect(useAppStore.getState().layers[0]).toBe(source);
    expect(surface).not.toHaveBeenCalled(); expect(historyBrush).not.toHaveBeenCalled(); expect(mockRemove).not.toHaveBeenCalled();
    expect(source.colorCycleData!.recolorSettings).toBe(before); expect(before.animation).toEqual(animation); expect(before.animation.fps).toBe(15);
    expect(Array.from(source.imageData!.data)).toEqual(originalPixels); expect(historyManager.entries()).toHaveLength(0);
  });
});
