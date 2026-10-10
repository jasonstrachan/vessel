import historyManager from '@/history/historyService';
import * as bitmapHistory from '@/history/deltas/bitmapDelta';
import { commitLayerHistoryBatch, type LayerHistoryBatchChange } from '@/history/helpers/layerHistory';
import { cloneSequentialLayerData } from '@/history/deltas/sequentialFrameDelta';
import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import { FinalizeQueue } from '@/lib/canvas/FinalizeQueue';
import { HISTORY_FINALIZE_LANE, registerFinalizeQueue } from '@/stores/pendingColorCycleSaves';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, type Layer, type SequentialLayerData } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const image = (alpha: number): ImageData => new ImageData(new Uint8ClampedArray([255, 0, 0, alpha]), 1, 1);
const layer = (id: string, alpha: number): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = framebuffer.height = 1;
  framebuffer.getContext('2d')?.putImageData(image(alpha), 0, 0);
  return { id, name: id, order: 0, visible: true, opacity: 1, blendMode: 'source-over', locked: false,
    layerType: 'normal', imageData: image(alpha), framebuffer, alignment: createDefaultLayerAlignment() };
};
const sequence = (ids: string[]): SequentialLayerData => ({
  frameCount: 2, fps: 2, durationMs: 1000, eventChunks: [],
  events: ids.map((id, index) => ({ id, layerId: 'sequence', strokeId: id, timestampMs: index, frameIndex: index % 2,
    brush: { tool: 'eraser', brushShape: BrushShape.ROUND, size: 1, opacity: 1, blendMode: 'destination-out',
      rotation: 0, spacing: 1, color: '#000000', customStampId: null },
    stamps: [{ x: 0, y: 0, pressure: 1, rotation: 0, size: 1, alpha: 1 }],
  })),
});
const change = (layerId: string, before: ImageData): LayerHistoryBatchChange => ({
  kind: 'layer', payload: { layerId, beforeImage: before, beforeColorState: null,
    actionType: 'paste', description: 'Move', tool: 'paste' },
});
const commit = (changes: LayerHistoryBatchChange[]) => commitLayerHistoryBatch({
  changes, actionType: 'paste', description: 'Move between layers', tool: 'paste',
  selectionBefore: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
});
const alpha = (id: string): number | undefined =>
  useAppStore.getState().layers.find((entry) => entry.id === id)?.imageData?.data[3];
const install = (layers: Layer[]): void => useAppStore.setState((state) => ({
  layers, activeLayerId: layers[0].id, selectionStart: null, selectionEnd: null,
  selectionMask: null, selectionMaskBounds: null, selectionMaskLayerId: null, selectionVectorPath: null,
  project: state.project ? { ...state.project, width: 1, height: 1, layers } : state.project,
  pendingCompositeDirtyBatches: [], layersNeedRecomposition: false,
}));

describe('atomic multi-layer history', () => {
  let queue: FinalizeQueue;
  let release: (() => void) | undefined;
  beforeEach(() => {
    historyManager.clear();
    queue = new FinalizeQueue();
    registerFinalizeQueue(queue);
    install([layer('source', 0), layer('destination', 255)]);
  });
  afterEach(async () => {
    release?.();
    release = undefined;
    await queue.whenIdle();
    registerFinalizeQueue(null);
    jest.restoreAllMocks();
    historyManager.clear();
  });

  it('restores both raster owners and selection with one undo and one redo', async () => {
    const dirty = jest.spyOn(useAppStore.getState(), 'markAutosaveDirty');
    await commit([change('source', image(255)), change('destination', image(0))]);
    expect(historyManager.peekUndo()?.deltas).toHaveLength(3);
    expect(dirty).toHaveBeenCalledTimes(1);
    await historyManager.undo();
    expect([alpha('source'), alpha('destination')]).toEqual([255, 0]);
    expect(useAppStore.getState().selectionStart).toEqual({ x: 0, y: 0 });
    expect(historyManager.peekUndo()).toBeNull();
    await historyManager.redo();
    expect([alpha('source'), alpha('destination')]).toEqual([0, 255]);
    expect(useAppStore.getState().selectionStart).toBeNull();
  });

  it('lets commit observers attribute a cross-layer move to both changed owners', async () => {
    const beforeAlphas = new Map([['source', 255], ['destination', 0]]);
    const attributed: string[][] = [];
    const unsubscribe = historyManager.subscribe((event) => {
      if (event.kind !== 'commit') return;
      const changed = useAppStore.getState().layers.filter((entry) =>
        entry.imageData?.data[3] !== beforeAlphas.get(entry.id)).map((entry) => entry.id);
      // Generic observers use a singular owner when supplied, otherwise compare the scene.
      attributed.push(typeof event.entry.meta?.layerId === 'string'
        ? [event.entry.meta.layerId] : changed);
    });
    try {
      await commit([change('source', image(255)), change('destination', image(0))]);
      expect(attributed).toEqual([['source', 'destination']]);
      expect(historyManager.peekUndo()?.meta?.layerIds).toEqual(['source', 'destination']);
    } finally {
      unsubscribe();
    }
  });

  it('combines canonical Sequence history with raster history without moving the cursor', async () => {
    const before = sequence(['original']);
    const after = sequence(['original', 'paste']);
    const sequentialLayer = { ...layer('sequence', 0), layerType: 'sequential' as const,
      sequentialData: cloneSequentialLayerData(after) };
    install([layer('source', 0), sequentialLayer]);
    const cursor = useAppStore.getState().sequentialRecord.currentFrame;
    await commit([change('source', image(255)), {
      kind: 'sequential', layerId: 'sequence', beforeSequentialData: before, afterSequentialData: after,
    }]);
    await historyManager.undo();
    expect(alpha('source')).toBe(255);
    expect(useAppStore.getState().layers[1].sequentialData).toEqual(before);
    await historyManager.redo();
    expect(alpha('source')).toBe(0);
    expect(useAppStore.getState().layers[1].sequentialData).toEqual(after);
    expect(useAppStore.getState().sequentialRecord.currentFrame).toBe(cursor);
  });

  it('combines CC erase and soft-edge masks with raster history in the same entry', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const eraseMask = document.createElement('canvas');
    eraseMask.width = eraseMask.height = 1;
    eraseMask.getContext('2d')?.putImageData(image(64), 0, 0);
    const softEdgeMask = document.createElement('canvas');
    softEdgeMask.width = softEdgeMask.height = 1;
    softEdgeMask.getContext('2d')?.putImageData(image(128), 0, 0);
    install([layer('source', 0), {
      ...layer('cc', 0), layerType: 'color-cycle', colorCycleData: {
        canvas, eraseMask, eraseMaskVersion: 2, softEdgeMask, softEdgeMaskVersion: 2, softEdgeMaskEnabled: true,
      },
    }]);
    const animator = new ColorCycleAnimator({ width: 1, height: 1, fps: 30, speed: 1,
      autoStart: false, forceCanvas2D: true });
    const snapshot = (erase: number, soft: number, version: number): ColorCycleSerializedState => ({
      cycleSpeed: 1, fps: 30, brushSize: 1, layers: [{
        layerId: 'cc', data: animator.serialize(),
        strokeData: { paintBuffer: new Uint8Array(1).buffer, hasContent: false, strokeCounter: 0 },
        eraseMaskSnapshot: { width: 1, height: 1, alpha: new Uint8ClampedArray([erase]), version },
        softEdgeMaskSnapshot: { width: 1, height: 1, alpha: new Uint8ClampedArray([soft]), version, enabled: true },
      }],
    });
    const maskAlphas = () => {
      const data = useAppStore.getState().layers[1].colorCycleData!;
      return [data.eraseMask, data.softEdgeMask].map((mask) => mask?.getContext('2d')?.getImageData(0, 0, 1, 1).data[3]);
    };
    await commit([change('source', image(255)), {
      kind: 'layer', payload: { layerId: 'cc', beforeImage: null,
        beforeColorState: snapshot(255, 255, 1), afterColorState: snapshot(64, 128, 2),
        actionType: 'paste', description: 'Move', tool: 'paste' },
    }]);
    expect(historyManager.peekUndo()?.deltas.map((delta) => delta._tag))
      .toEqual(expect.arrayContaining(['color-cycle-erase-mask-patch', 'color-cycle-soft-edge-mask']));
    await historyManager.undo();
    expect(alpha('source')).toBe(255);
    expect(maskAlphas()).toEqual([255, 255]);
    await historyManager.redo();
    expect(alpha('source')).toBe(0);
    expect(maskAlphas()).toEqual([64, 128]);
  });

  it('freezes both owners and selection before waiting in the shared finalization lane', async () => {
    const held = new Promise<void>((resolve) => { release = resolve; });
    const older = queue.enqueue(() => held, HISTORY_FINALIZE_LANE);
    const sourceBefore = image(255);
    const sourceChange = change('source', sourceBefore);
    const sourceAfter = image(0);
    if (sourceChange.kind === 'layer') sourceChange.payload.afterImage = sourceAfter;
    const pending = commit([sourceChange, change('destination', image(0))]);
    sourceBefore.data[3] = 123;
    sourceAfter.data[3] = 77;
    useAppStore.setState({ selectionStart: { x: 4, y: 4 }, selectionEnd: { x: 5, y: 5 } });
    expect(historyManager.peekUndo()).toBeNull();
    release?.();
    await older;
    await pending;
    await historyManager.undo();
    expect(alpha('source')).toBe(255);
    await historyManager.redo();
    expect(useAppStore.getState().selectionStart).toBeNull();
  });

  it('opens no transaction until all async preparation completes and permits retry after failure', async () => {
    const begin = jest.spyOn(historyManager, 'begin');
    const original = bitmapHistory.createBitmapTileDelta;
    let count = 0;
    jest.spyOn(bitmapHistory, 'createBitmapTileDelta').mockImplementation(async (options) => {
      expect(begin).not.toHaveBeenCalled();
      if (++count === 2) throw new Error('Blob write failed');
      return original(options);
    });
    await expect(commit([change('source', image(255)), change('destination', image(0))]))
      .rejects.toThrow('Blob write failed');
    expect(begin).not.toHaveBeenCalled();
    expect(historyManager.peekUndo()).toBeNull();
    jest.restoreAllMocks();
    await commit([change('source', image(255)), change('destination', image(0))]);
    await historyManager.undo();
    expect([alpha('source'), alpha('destination')]).toEqual([255, 0]);
  });

  it('keeps both owners unchanged when replay validation fails, then allows retry', async () => {
    await commit([change('source', image(255)), change('destination', image(0))]);
    useAppStore.setState((state) => ({ layers: state.layers.map((entry) => entry.id === 'destination'
      ? { ...entry, imageData: image(128) } : entry) }));
    await expect(historyManager.undo()).rejects.toThrow();
    expect([alpha('source'), alpha('destination')]).toEqual([0, 128]);
    expect(historyManager.peekUndo()).not.toBeNull();
    useAppStore.setState((state) => ({ layers: state.layers.map((entry) => entry.id === 'destination'
      ? { ...entry, imageData: image(255) } : entry) }));
    await historyManager.undo();
    expect([alpha('source'), alpha('destination')]).toEqual([255, 0]);
  });

  it('rejects missing or duplicate owners before publishing partial history', async () => {
    await expect(commit([change('source', image(255)), change('missing', image(0))]))
      .rejects.toThrow('Missing layer');
    await expect(commit([change('source', image(255)), change('source', image(0))]))
      .rejects.toThrow('Duplicate layer');
    expect(historyManager.peekUndo()).toBeNull();
  });
});
