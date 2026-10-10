import { isFeatureFlagEnabled, setFeatureFlag } from '@/config/featureFlags';
import historyManager from '@/history/historyService';
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
    floatingPaste: null, floatingPasteHistoryContext: null, currentCompositeBitmap: null,
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

it.each((['normal', 'sequential'] as const).flatMap((sourceKind) =>
  (['normal', 'sequential'] as const).map((destinationKind) => ({ sourceKind, destinationKind }))),
)('moves $sourceKind to $destinationKind with one atomic two-layer history entry', async ({ sourceKind, destinationKind }) => {
  const layers = install(sourceKind, destinationKind);
  const before = layers.map((layer) => pixels(layer.id));
  const beforeEvents = layers.map((layer) => JSON.parse(JSON.stringify(layer.sequentialData ?? null)));
  expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(true);
  useAppStore.getState().updateFloatingPastePosition({ x: 9, y: 8 });
  useAppStore.getState().setActiveLayer(layers[1].id);
  await useAppStore.getState().commitFloatingPaste();
  await waitForPendingHistoryCommits();
  const expected = before.map((plane) => plane.slice());
  for (let y = 2; y < 6; y += 1) for (let x = 2; x < 6; x += 1) {
    const i = (y * SIZE + x) * 4;
    expected[0].fill(0, i, i + 4);
    expected[1].set(before[0].subarray(i, i + 4), ((y + 6) * SIZE + x + 7) * 4);
  }
  expect(layers.map((layer) => pixels(layer.id))).toEqual(expected);
  expect(useAppStore.getState().floatingPaste).toBeNull();
  expect(historyManager.entries()).toHaveLength(1);
  const afterEvents = layers.map((layer) => JSON.parse(JSON.stringify(layerById(layer.id).sequentialData ?? null)));

  await historyManager.undo();
  expect(layers.map((layer) => pixels(layer.id))).toEqual(before);
  expect(layers.map((layer) => JSON.parse(JSON.stringify(layerById(layer.id).sequentialData ?? null)))).toEqual(beforeEvents);
  expect(useAppStore.getState().selectionStart).toEqual({ x: 2, y: 2 });
  expect(useAppStore.getState().selectionEnd).toEqual({ x: 6, y: 6 });
  expect(useAppStore.getState().sequentialRecord.currentFrame).toBe(0);
  await historyManager.redo();
  expect(layers.map((layer) => pixels(layer.id))).toEqual(expected);
  expect(layers.map((layer) => JSON.parse(JSON.stringify(layerById(layer.id).sequentialData ?? null)))).toEqual(afterEvents);
  expect(historyManager.entries()).toHaveLength(1);
});

it('keeps a failed cross-layer paste cancellable without destination residue or duplicated retry alpha', async () => {
  const layers = install('normal', 'normal');
  const source = layerById(layers[0].id);
  const image = new ImageData(source.imageData!.data.slice(), SIZE, SIZE);
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 128;
  source.framebuffer!.getContext('2d')!.putImageData(image, 0, 0);
  useAppStore.getState().updateLayer(source.id, { imageData: image });
  const before = layers.map((layer) => pixels(layer.id));
  expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(true);
  const extracted = pixels(source.id);
  useAppStore.getState().updateFloatingPastePosition({ x: 9, y: 8 });
  useAppStore.getState().setActiveLayer(layers[1].id);
  jest.spyOn(layerHistory, 'commitLayerHistoryBatch').mockRejectedValueOnce(new Error('injected history storage failure'));
  await useAppStore.getState().commitFloatingPaste();
  expect(useAppStore.getState().floatingPaste).not.toBeNull();
  expect(historyManager.entries()).toHaveLength(0);
  expect(pixels(source.id)).toEqual(extracted);
  expect(pixels(layers[1].id)).toEqual(before[1]);
  await useAppStore.getState().commitFloatingPaste();
  expect(useAppStore.getState().floatingPaste).toBeNull();
  expect(historyManager.entries()).toHaveLength(1);
  const pastedPixel = (8 * SIZE + 9) * 4;
  expect(Array.from(pixels(layers[1].id).slice(pastedPixel, pastedPixel + 4))).toEqual([128, 0, 127, 255]);
  await historyManager.undo();
  expect(layers.map((layer) => pixels(layer.id))).toEqual(before);
});
