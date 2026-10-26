import historyManager from '@/history/historyService';
import * as colorHistory from '@/history/helpers/colorCycle';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import { registerColorCycleBrushSerializedStateRuntime, type ColorCycleBrushLayerSnapshot } from '@/lib/colorCycle/document';
import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import { useAppStore } from '@/stores/useAppStore';
import { captureResizeHistoryBaseline, recordResizeHistory } from '@/stores/helpers/resizeHistory';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const mockRehydrate = jest.fn<Promise<void>, unknown[]>(async () => undefined);
const mockBrush = { setTargetCanvas: jest.fn(), updateColorCycleTexture: jest.fn(), commitToLayer: jest.fn() };

jest.mock('@/history/historyService', () => {
  const Manager = jest.requireActual('@/history/historyManager').default;
  return { __esModule: true, setActiveHistoryDocument: jest.fn(), default: new Manager({ runtimeRehydration: {
    createTargets: () => ({ layerIds: new Set(), colorCycleLayerIds: new Set(), sequentialLayerIds: new Set(), workerScopes: new Set() }),
    rehydrate: (...args: unknown[]) => mockRehydrate(...args),
  } }) };
});
jest.mock('@/stores/colorCycleBrushManager', () => ({
  getColorCycleBrushManager: () => ({ getHistoryBrush: () => mockBrush, getPlaybackBrush: () => null, getDocument: () => undefined }),
  getColorCycleStoreState: () => null,
  setColorCycleStoreStateGetter: jest.fn(),
  setLayerIdGetter: jest.fn(),
}));

const id = 'resize-mask';
let runtime: NonNullable<ColorCycleSerializedState>;
const state = (width: number, height: number, soft: boolean, erase: boolean): NonNullable<ColorCycleSerializedState> => {
  const length = width * height;
  const alpha = Array.from({ length }, (_, i) => [0, 31, 127, 255][i % 4]);
  return { cycleSpeed: 1, fps: 30, brushSize: 8, layers: [{ layerId: id, data: new ColorCycleAnimator({ width, height, autoStart: false, forceCanvas2D: true }).serialize(),
    strokeData: {
      paintBuffer: new Uint8Array(length).fill(1).buffer,
      gradientIdBuffer: new Uint8Array(length).fill(2).buffer,
      gradientDefIdBuffer: new Uint16Array(length).fill(513).buffer,
      speedBuffer: new Uint8Array(length).fill(47).buffer,
      flowBuffer: new Uint8Array(length).fill(1).buffer,
      phaseBuffer: new Uint8Array(length).fill(19).buffer,
      hasContent: true, strokeCounter: 0,
    },
    ...(soft ? { softEdgeMaskSnapshot: { width, height, alpha: new Uint8ClampedArray(alpha), enabled: width === 4, version: width === 4 ? 7 : 8 } } : {}),
    ...(erase ? { eraseMaskSnapshot: { width, height, alpha: new Uint8ClampedArray(alpha.map(v => 255 - v)), version: width === 4 ? 11 : 12 } } : {}),
  }] };
};
const image = (width: number, height: number) => new ImageData(new Uint8ClampedArray(width * height * 4).fill(255), width, height);
const maskImage = (mask: { width: number; height: number; alpha: Uint8ClampedArray }) => {
  const result = new ImageData(mask.width, mask.height);
  mask.alpha.forEach((v, i) => { result.data[i * 4 + 3] = v; });
  return result;
};
const install = (serialized: NonNullable<ColorCycleSerializedState>, width: number, height: number) => {
  const data = serialized!.layers[0];
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const layer: Layer = { id, name: 'Masked CC', order: 0, layerType: 'color-cycle', visible: true, locked: false,
    transparencyLocked: false, opacity: 1, blendMode: 'source-over', alignment: createDefaultLayerAlignment(),
    imageData: image(width, height), framebuffer: canvas, colorCycleData: { canvas, gradient: [], mode: 'brush', hasContent: true,
      ...(data.softEdgeMaskSnapshot ? { softEdgeMaskImageData: maskImage(data.softEdgeMaskSnapshot), softEdgeMaskEnabled: data.softEdgeMaskSnapshot.enabled, softEdgeMaskVersion: data.softEdgeMaskSnapshot.version } : {}),
      ...(data.eraseMaskSnapshot ? { eraseMaskImageData: maskImage(data.eraseMaskSnapshot), eraseMaskVersion: data.eraseMaskSnapshot.version } : {}),
    } };
  useAppStore.setState({ layers: [layer], activeLayerId: id, selectedLayerIds: [id], layersNeedRecomposition: false,
    pendingCompositeDirtyBatches: [], compositeSegments: [], project: { id: 'resize-project', name: 'Resize', width, height, layers: [layer],
      backgroundColor: 'transparent', createdAt: new Date(0), updatedAt: new Date(0), customBrushes: [] } });
  runtime = serialized;
};
const assertMasks = (serialized: ColorCycleSerializedState) => {
  const expected = serialized!.layers[0], actual = useAppStore.getState().layers[0].colorCycleData!;
  for (const [kind, snapshot] of [['softEdge', expected.softEdgeMaskSnapshot], ['erase', expected.eraseMaskSnapshot]] as const) {
    const img = kind === 'softEdge' ? actual.softEdgeMaskImageData : actual.eraseMaskImageData;
    if (!snapshot) { expect(img).toBeUndefined(); continue; }
    expect([img?.width, img?.height]).toEqual([snapshot.width, snapshot.height]);
    expect(Array.from(img!.data).filter((_, i) => i % 4 === 3)).toEqual(Array.from(snapshot.alpha));
    const canvas = kind === 'softEdge' ? actual.softEdgeMask : actual.eraseMask;
    expect([canvas?.width, canvas?.height]).toEqual([snapshot.width, snapshot.height]);
    const pixels = canvas!.getContext('2d')!.getImageData(0, 0, snapshot.width, snapshot.height).data;
    expect(Array.from(pixels).filter((_, i) => i % 4 === 3)).toEqual(Array.from(snapshot.alpha));
    expect(kind === 'softEdge' ? actual.softEdgeMaskVersion : actual.eraseMaskVersion).toBe(snapshot.version);
    if (kind === 'softEdge') expect(actual.softEdgeMaskEnabled).toBe(snapshot.enabled);
  }
};

describe('recordResizeHistory mask ownership', () => {
  beforeEach(() => {
    historyManager.clear(); mockRehydrate.mockReset(); mockRehydrate.mockResolvedValue(undefined);
    jest.spyOn(colorHistory, 'captureColorCycleBrushState').mockImplementation(() => runtime);
    registerColorCycleBrushSerializedStateRuntime(mockBrush, { read: () => runtime, restore: value => {
      const payload = value as { layerSnapshots: Array<ColorCycleBrushLayerSnapshot & { layerId: string }> };
      runtime = { ...runtime, layers: payload.layerSnapshots.map(snapshot => ({ layerId: snapshot.layerId, data: runtime!.layers[0].data, strokeData: { ...snapshot } })) };
    } });
  });
  afterEach(() => { historyManager.clear(); jest.restoreAllMocks(); });

  it.each([[true, false], [false, true], [true, true], [false, false]])('restores dimensional soft=%s erase=%s masks in one real resize command twice', async (soft, erase) => {
    const before = state(4, 4, soft, erase), after = state(2, 3, soft, erase);
    const beforeMask = soft ? before!.layers[0].softEdgeMaskSnapshot : before!.layers[0].eraseMaskSnapshot;
    const frozenBefore = beforeMask ? Array.from(beforeMask.alpha) : [];
    const assertPlanes = (expected: ColorCycleSerializedState) => {
      for (const key of ['paintBuffer', 'gradientIdBuffer', 'gradientDefIdBuffer', 'speedBuffer', 'flowBuffer', 'phaseBuffer'] as const) {
        expect(Array.from(new Uint8Array(runtime!.layers[0].strokeData![key]!))).toEqual(Array.from(new Uint8Array(expected!.layers[0].strokeData![key]!)));
      }
    };
    install(before, 4, 4); const baseline = captureResizeHistoryBaseline({ layers: useAppStore.getState().layers, project: useAppStore.getState().project });
    install(after, 2, 3);
    await recordResizeHistory({ beforeProject: baseline.projectSize, afterProject: { width: 2, height: 3 }, beforeLayers: baseline.layerSnapshots, afterLayers: useAppStore.getState().layers, description: 'Resize masked CC' });
    expect(historyManager.entries()).toHaveLength(1);
    for (let cycle = 0; cycle < 2; cycle++) {
      await historyManager.undo(); assertMasks(before);
      expect([useAppStore.getState().project?.width, useAppStore.getState().project?.height]).toEqual([4, 4]);
      assertPlanes(before);
      expect(Array.from(new Uint16Array(runtime!.layers[0].strokeData!.gradientDefIdBuffer!))).toEqual(new Array(16).fill(513));
      await historyManager.redo(); assertMasks(after);
      expect([useAppStore.getState().project?.width, useAppStore.getState().project?.height]).toEqual([2, 3]);
      assertPlanes(after);
      expect(new Uint16Array(runtime!.layers[0].strokeData!.gradientDefIdBuffer!)).toHaveLength(6);
    }
    expect(beforeMask ? Array.from(beforeMask.alpha) : []).toEqual(frozenBefore);
  });

  it('compensates masks and project size when runtime activation fails after real replay', async () => {
    const before = state(4, 4, true, true), after = state(2, 3, true, true);
    install(before, 4, 4); const baseline = captureResizeHistoryBaseline({ layers: useAppStore.getState().layers, project: useAppStore.getState().project });
    install(after, 2, 3);
    await recordResizeHistory({ beforeProject: baseline.projectSize, afterProject: { width: 2, height: 3 }, beforeLayers: baseline.layerSnapshots, afterLayers: useAppStore.getState().layers, description: 'Resize masked CC' });
    const commandId = historyManager.entries()[0].id;
    const accepted = useAppStore.getState(), soft = accepted.layers[0].colorCycleData!.softEdgeMaskImageData, erase = accepted.layers[0].colorCycleData!.eraseMaskImageData;
    mockRehydrate.mockRejectedValueOnce(new Error('Runtime activation failed')).mockResolvedValue(undefined);
    await expect(historyManager.undo()).rejects.toMatchObject({ compensationSucceeded: true });
    const restored = useAppStore.getState();
    expect([restored.project?.width, restored.project?.height]).toEqual([2, 3]);
    expect(restored.layers[0].colorCycleData!.softEdgeMaskImageData).toBe(soft);
    expect(restored.layers[0].colorCycleData!.eraseMaskImageData).toBe(erase);
    expect(Array.from(soft!.data).filter((_, i) => i % 4 === 3)).toEqual(Array.from(after!.layers[0].softEdgeMaskSnapshot!.alpha));
    expect(Array.from(erase!.data).filter((_, i) => i % 4 === 3)).toEqual(Array.from(after!.layers[0].eraseMaskSnapshot!.alpha));
    for (const key of ['paintBuffer', 'gradientIdBuffer', 'gradientDefIdBuffer', 'speedBuffer', 'flowBuffer', 'phaseBuffer'] as const) {
      expect(Array.from(new Uint8Array(runtime!.layers[0].strokeData![key]!))).toEqual(Array.from(new Uint8Array(after!.layers[0].strokeData![key]!)));
    }
    expect(restored.layers[0].colorCycleData!.softEdgeMaskEnabled).toBe(false);
    expect(restored.layers[0].colorCycleData!.softEdgeMaskVersion).toBe(8);
    expect(restored.layers[0].colorCycleData!.eraseMaskVersion).toBe(12);
    expect(restored.layers[0].imageData).toEqual(accepted.layers[0].imageData);
    expect(historyManager.entries()).toHaveLength(1);
    expect(historyManager.entries()[0].id).toBe(commandId);
  });

  it('does not create an entry for a source without changed pixels, masks, or dimensions', async () => {
    install(state(4, 4, false, false), 4, 4);
    await recordResizeHistory({ beforeProject: { width: 4, height: 4 }, afterProject: { width: 4, height: 4 }, beforeLayers: new Map(), afterLayers: [], description: 'No resize' });
    expect(historyManager.entries()).toHaveLength(0);
  });
});
