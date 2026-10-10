import { isFeatureFlagEnabled, setFeatureFlag } from '@/config/featureFlags';
import historyManager from '@/history/historyService';
import { cloneSequentialLayerData } from '@/history/deltas/sequentialFrameDelta';
import * as layerHistory from '@/history/helpers/layerHistory';
import { waitForPendingHistoryCommits } from '@/history/pendingHistoryCommits';
import { clearSequentialLayerRendererAll, getSequentialLayerRenderCanvas } from '@/lib/sequential/SequentialLayerRenderer';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, type Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const SIZE = 16;
const layerById = (id: string) => useAppStore.getState().layers.find((layer) => layer.id === id)!;
const pixels = (id: string) => {
  const layer = layerById(id);
  if (layer.layerType === 'sequential') {
    const canvas = getSequentialLayerRenderCanvas({ layer, width: SIZE, height: SIZE, frameIndex: 0, holdPreviousOnEmptyFrames: false });
    return canvas!.getContext('2d')!.getImageData(0, 0, SIZE, SIZE).data.slice();
  }
  return layer.imageData!.data.slice();
};

const makeLayer = (id: string, kind: 'normal' | 'sequential', source: boolean): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = framebuffer.height = SIZE;
  const ctx = framebuffer.getContext('2d')!;
  ctx.fillStyle = source ? '#ff0000' : '#0000ff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  return {
    id, name: id, visible: true, locked: false, opacity: 1, order: source ? 0 : 1,
    blendMode: 'source-over', alignment: createDefaultLayerAlignment(), framebuffer,
    layerType: kind, imageData: kind === 'normal' ? ctx.getImageData(0, 0, SIZE, SIZE) : null,
    ...(kind === 'sequential' ? {
      sequentialData: {
        frameCount: 3, fps: 1, durationMs: 3000, eventChunks: [],
        events: [{
          id: `${id}-seed`, layerId: id, strokeId: `${id}-seed`, frameIndex: 0, timestampMs: 0,
          brush: { tool: 'brush' as const, brushShape: BrushShape.SQUARE, size: SIZE, opacity: 1, blendMode: 'source-over' as const, rotation: 0, spacing: 1, color: source ? '#ff0000' : '#0000ff' },
          stamps: [{ x: SIZE / 2, y: SIZE / 2, size: SIZE, alpha: 1, pressure: 1, rotation: 0 }],
        }],
      },
    } : {}),
  };
};

const install = (sourceKind: 'normal' | 'sequential', destinationKind: 'normal' | 'sequential') => {
  const layers = [makeLayer('move-source', sourceKind, true), makeLayer('move-destination', destinationKind, false)];
  useAppStore.setState({
    project: { id: 'cross-layer-move', name: 'cross-layer-move', width: SIZE, height: SIZE, layers: [], backgroundColor: '#fff', createdAt: new Date(0), updatedAt: new Date(0), customBrushes: [] },
    layers, activeLayerId: layers[0].id,
    selectionStart: { x: 2, y: 2 }, selectionEnd: { x: 6, y: 6 }, selectionMask: null,
    selectionMaskBounds: null, selectionMaskLayerId: null, selectionVectorPath: null,
    floatingPaste: null, floatingPasteHistoryContext: null, selectionClipboard: null, currentCompositeBitmap: null,
    layersNeedRecomposition: true, compositeSegments: [], pendingCompositeDirtyBatches: [],
    selectionLastAction: { action: 'set-bounds', source: 'selection-marquee-final', ownerKind: 'direct-marquee', t: 1, activeLayerId: layers[0].id },
  });
  useAppStore.getState().setSequentialRecordArmed(false);
  useAppStore.getState().pauseColorCycle('toolbar');
  useAppStore.getState().setSequentialFrame(0);
  return layers;
};

const canvasGlobal = globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean };
let previousRasterize: boolean | undefined;
let gpu: boolean;
let worker: boolean;

beforeEach(async () => {
  await waitForPendingHistoryCommits();
  historyManager.clear();
  clearSequentialLayerRendererAll();
  previousRasterize = canvasGlobal.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
  canvasGlobal.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true;
  gpu = isFeatureFlagEnabled('enableSequentialGpuAcceleration');
  worker = isFeatureFlagEnabled('enableSequentialWorkerMaterialization');
  setFeatureFlag('enableSequentialGpuAcceleration', false);
  setFeatureFlag('enableSequentialWorkerMaterialization', false);
});

afterEach(async () => {
  await waitForPendingHistoryCommits();
  historyManager.clear();
  jest.restoreAllMocks();
  clearSequentialLayerRendererAll();
  canvasGlobal.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = previousRasterize;
  setFeatureFlag('enableSequentialGpuAcceleration', gpu);
  setFeatureFlag('enableSequentialWorkerMaterialization', worker);
});


it.each(['normal', 'sequential', 'color-cycle'] as const)('refuses Cut on locked %s without changing clipboard or history', async kind => {
  const layers = install(kind === 'sequential' ? 'sequential' : 'normal', 'normal');
  useAppStore.getState().updateLayer(layers[0].id, { layerType: kind, locked: true });
  const before = layerById(layers[0].id);
  const selectionStart = useAppStore.getState().selectionStart;
  const oldClipboard = { imageData: new ImageData(1, 1), width: 1, height: 1, position: { x: 0, y: 0 }, mode: 'copy' as const };
  useAppStore.setState({ selectionClipboard: oldClipboard });
  await expect(useAppStore.getState().copySelectionToClipboard({ mode: 'cut' })).resolves.toBe(false);
  await waitForPendingHistoryCommits();
  expect(layerById(layers[0].id)).toBe(before);
  expect(useAppStore.getState().selectionClipboard).toBe(oldClipboard);
  expect(useAppStore.getState().selectionStart).toBe(selectionStart);
  expect(historyManager.entries()).toHaveLength(0);
});

it.each((['normal', 'sequential'] as const).flatMap(kind => [false, true].map(masked => ({ kind, masked }))))(
  'cuts $kind (masked $masked) in canonical data and framebuffer, with one exact Undo/Redo', async ({ kind, masked }) => {
    const [source] = install(kind, 'normal');
    if (masked) {
      const mask = new ImageData(4, 4);
      for (let i = 0; i < 16; i += 1) if (i !== 5) mask.data.set([255, 255, 255, 255], i * 4);
      useAppStore.setState({ selectionMask: mask, selectionMaskBounds: { x: 2, y: 2, width: 4, height: 4 }, selectionMaskLayerId: source.id });
    }
    const before = pixels(source.id);
    const beforeData = source.sequentialData ? cloneSequentialLayerData(source.sequentialData) : undefined;
    await expect(useAppStore.getState().copySelectionToClipboard({ mode: 'cut' })).resolves.toBe(true);
    await waitForPendingHistoryCommits();
    const expected = before.slice();
    for (let y = 2; y < 6; y += 1) for (let x = 2; x < 6; x += 1) {
      if (masked && x === 3 && y === 3) continue;
      expected.fill(0, (y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4);
    }
    expect(pixels(source.id)).toEqual(expected);
    if (kind === 'normal') expect(layerById(source.id).framebuffer!.getContext('2d')!.getImageData(0, 0, SIZE, SIZE).data).toEqual(expected);
    const afterData = layerById(source.id).sequentialData ? cloneSequentialLayerData(layerById(source.id).sequentialData!) : undefined;
    expect(useAppStore.getState().selectionClipboard?.mode).toBe('cut');
    expect(useAppStore.getState().floatingPaste).toBeNull();
    expect(useAppStore.getState().floatingPasteHistoryContext).toBeNull();
    expect(historyManager.entries()).toHaveLength(1);
    await historyManager.undo();
    expect(pixels(source.id)).toEqual(before);
    expect(layerById(source.id).sequentialData).toEqual(beforeData);
    expect(useAppStore.getState().selectionStart).toEqual({ x: 2, y: 2 });
    expect(useAppStore.getState().selectionMask?.data[23] ?? 0).toBe(0);
    await historyManager.redo();
    expect(pixels(source.id)).toEqual(expected);
    expect(layerById(source.id).sequentialData).toEqual(afterData);
  },
);

it('records Cut of an already extracted float and restores the source on Undo', async () => {
  const [source] = install('normal', 'normal');
  const before = pixels(source.id);
  expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(true);
  useAppStore.getState().updateFloatingPastePosition({ x: 9, y: 8 });
  const extracted = pixels(source.id);
  await expect(useAppStore.getState().copySelectionToClipboard({ mode: 'cut' })).resolves.toBe(true);
  await waitForPendingHistoryCommits();
  expect(pixels(source.id)).toEqual(extracted);
  expect(useAppStore.getState().selectionClipboard?.position).toEqual({ x: 9, y: 8 });
  expect(historyManager.entries()).toHaveLength(1);
  await historyManager.undo();
  expect(pixels(source.id)).toEqual(before);
});

it('retains recovery and the old clipboard when Cut history is rejected', async () => {
  const [source] = install('normal', 'normal');
  const before = pixels(source.id);
  const reject = jest.spyOn(layerHistory, 'commitLayerHistory').mockRejectedValueOnce(new Error('history unavailable'));
  await expect(useAppStore.getState().copySelectionToClipboard({ mode: 'cut' })).resolves.toBe(false);
  reject.mockRestore();
  expect(useAppStore.getState().selectionClipboard).toBeNull();
  expect(useAppStore.getState().floatingPasteHistoryContext?.sourceLayerId).toBe(source.id);
  useAppStore.getState().cancelFloatingPaste();
  expect(pixels(source.id)).toEqual(before);
  expect(historyManager.entries()).toHaveLength(0);
});

it('allows Copy of a held Sequence preview but refuses a destructive Cut in an unauthored frame', async () => {
  const [source] = install('sequential', 'normal');
  useAppStore.getState().setSequentialFrame(1);
  const data = JSON.stringify(layerById(source.id).sequentialData);
  await expect(useAppStore.getState().copySelectionToClipboard({ mode: 'copy' })).resolves.toBe(true);
  const clipboard = useAppStore.getState().selectionClipboard;
  expect(clipboard?.imageData.data.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
  await expect(useAppStore.getState().copySelectionToClipboard({ mode: 'cut' })).resolves.toBe(false);
  expect(JSON.stringify(layerById(source.id).sequentialData)).toBe(data);
  expect(useAppStore.getState().selectionClipboard).toBe(clipboard);
  expect(historyManager.entries()).toHaveLength(0);
});
