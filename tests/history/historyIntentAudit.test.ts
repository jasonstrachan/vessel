import { TextDecoder, TextEncoder } from 'util';

import {
  HISTORY_BLOB_DEFAULT_RESIDENT_BUDGET_BYTES,
  HISTORY_BLOB_DEFAULT_SPILL_THRESHOLD_BYTES,
  clearBlobStore,
  configureHistoryBlobStore,
} from '@/history/blobStore';
import type { HistoryActionId, HistoryEntry } from '@/history/actionTypes';
import { commitLayerHistory } from '@/history/helpers/layerHistory';
import { captureSelectionSnapshot, commitSelectionHistory } from '@/history/helpers/selectionHistory';
import historyManager from '@/history/historyService';
import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import { recordResizeHistory } from '@/stores/helpers/resizeHistory';
import { useAppStore } from '@/stores/useAppStore';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

(global as unknown as { TextEncoder?: typeof TextEncoder }).TextEncoder = TextEncoder;
(global as unknown as { TextDecoder?: typeof TextDecoder }).TextDecoder = TextDecoder;

const makeImage = (pixels: number[]): ImageData =>
  new ImageData(new Uint8ClampedArray(pixels), 2, 2);

const cloneImage = (imageData: ImageData): ImageData =>
  new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);

const createBitmapLayer = (id: string, imageData: ImageData, order = 0): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = imageData.width;
  framebuffer.height = imageData.height;
  framebuffer.getContext('2d')?.putImageData(imageData, 0, 0);

  return {
    id,
    name: id,
    order,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    layerType: 'normal',
    imageData,
    framebuffer,
    alignment: createDefaultLayerAlignment(),
  };
};

const createColorCycleLayer = (id: string, width: number, height: number): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const framebuffer = document.createElement('canvas');
  framebuffer.width = width;
  framebuffer.height = height;
  const eraseMask = document.createElement('canvas');
  eraseMask.width = width;
  eraseMask.height = height;

  return {
    id,
    name: id,
    order: 0,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    layerType: 'color-cycle',
    imageData: null,
    framebuffer,
    alignment: createDefaultLayerAlignment(),
    colorCycleData: {
      canvas,
      gradient: [],
      mode: 'brush',
      hasContent: true,
      eraseMask,
      eraseMaskVersion: 0,
      gradientDefs: [],
      gradientDefStore: [],
      slotPalettes: [],
      paintSlot: 0,
    },
    version: 1,
  };
};

const setLayers = (layers: Layer[], width = 2, height = 2): void => {
  useAppStore.setState((state) => ({
    layers,
    activeLayerId: layers[0]?.id ?? null,
    selectedLayerIds: [],
    referenceLayerId: null,
    layerGroups: [],
    layersNeedRecomposition: false,
    pendingCompositeDirtyBatches: [],
    selectionStart: null,
    selectionEnd: null,
    selectionMask: null,
    selectionMaskBounds: null,
    selectionMaskLayerId: null,
    selectionLastAction: null,
    floatingPaste: null,
    floatingPasteHistoryContext: null,
    project: state.project
      ? {
          ...state.project,
          width,
          height,
          layers,
        }
      : state.project,
    history: {
      ...state.history,
      undoStack: [],
      redoStack: [],
    },
  }));
};

const resetAuditState = (): void => {
  historyManager.clear();
  clearBlobStore();
  configureHistoryBlobStore({
    residentBudgetBytes: HISTORY_BLOB_DEFAULT_RESIDENT_BUDGET_BYTES,
    spillThresholdBytes: HISTORY_BLOB_DEFAULT_SPILL_THRESHOLD_BYTES,
  });
  setLayers([]);
};

const expectOneHistoryEntry = ({
  beforeCount,
  action,
  deltaTags,
}: {
  beforeCount: number;
  action: HistoryActionId;
  deltaTags: string[];
}): HistoryEntry => {
  const entries = historyManager.entries();
  expect(entries).toHaveLength(beforeCount + 1);
  const entry = entries[beforeCount];
  expect(entry).toBeDefined();
  expect(entry?.action).toBe(action);
  expect(entry?.deltas.map((delta) => delta._tag)).toEqual(deltaTags);
  return entry!;
};

const makeColorCycleState = ({
  layerId,
  width,
  height,
  paint,
  gradientId = new Array(width * height).fill(0),
  gradientDefId = new Array(width * height).fill(0),
  speed = new Array(width * height).fill(0),
  flow = new Array(width * height).fill(0),
  phase = new Array(width * height).fill(0),
  eraseMaskAlpha,
  eraseMaskVersion,
}: {
  layerId: string;
  width: number;
  height: number;
  paint: number[];
  gradientId?: number[];
  gradientDefId?: number[];
  speed?: number[];
  flow?: number[];
  phase?: number[];
  eraseMaskAlpha?: number[];
  eraseMaskVersion?: number;
}): ColorCycleSerializedState => {
  const animatorState = new ColorCycleAnimator({
    width,
    height,
    fps: 30,
    speed: 1,
    autoStart: false,
    forceCanvas2D: true,
  }).serialize();

  return {
    cycleSpeed: 1,
    fps: 30,
    brushSize: 1,
    layers: [
      {
        layerId,
        data: animatorState,
        strokeData: {
          paintBuffer: new Uint8Array(paint).buffer,
          gradientIdBuffer: new Uint8Array(gradientId).buffer,
          gradientDefIdBuffer: new Uint16Array(gradientDefId).buffer,
          speedBuffer: new Uint8Array(speed).buffer,
          flowBuffer: new Uint8Array(flow).buffer,
          phaseBuffer: new Uint8Array(phase).buffer,
          hasContent: paint.some((value) => value !== 0),
          strokeCounter: paint.some((value) => value !== 0) ? 1 : 0,
        },
        ...(eraseMaskAlpha && typeof eraseMaskVersion === 'number'
          ? {
              eraseMaskSnapshot: {
                width,
                height,
                alpha: new Uint8ClampedArray(eraseMaskAlpha),
                version: eraseMaskVersion,
              },
            }
          : {}),
      },
    ],
  };
};

describe('history intent audit', () => {
  beforeEach(() => {
    resetAuditState();
  });

  afterEach(() => {
    resetAuditState();
  });

  it('records one entry for a bitmap brush stroke intent', async () => {
    const before = makeImage([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const after = makeImage([
      255, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const layer = createBitmapLayer('bitmap-stroke', after);
    setLayers([layer]);

    const beforeCount = historyManager.entries().length;
    await commitLayerHistory({
      layerId: layer.id,
      beforeImage: before,
      beforeColorState: null,
      actionType: 'brush',
      description: 'Brush stroke',
      tool: 'brush',
    });

    expectOneHistoryEntry({
      beforeCount,
      action: 'brush-stroke',
      deltaTags: ['bitmap-tile'],
    });
  });

  it('records one entry for a fill intent', async () => {
    const before = makeImage([
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
    ]);
    const after = makeImage([
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
    ]);
    const layer = createBitmapLayer('fill', after);
    setLayers([layer]);

    const beforeCount = historyManager.entries().length;
    await commitLayerHistory({
      layerId: layer.id,
      beforeImage: before,
      beforeColorState: null,
      actionType: 'fill',
      description: 'Flood fill',
      tool: 'fill',
    });

    expectOneHistoryEntry({
      beforeCount,
      action: 'fill',
      deltaTags: ['bitmap-tile'],
    });
  });

  it('records one entry for a rendered shape commit', async () => {
    const before = makeImage([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const after = makeImage([
      0, 128, 255, 255,
      0, 128, 255, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const layer = createBitmapLayer('shape', after);
    setLayers([layer]);

    const beforeCount = historyManager.entries().length;
    await commitLayerHistory({
      layerId: layer.id,
      beforeImage: before,
      beforeColorState: null,
      actionType: 'fill',
      description: 'Shape Fill: default',
      tool: 'shape-fill',
    });

    expectOneHistoryEntry({
      beforeCount,
      action: 'fill',
      deltaTags: ['bitmap-tile'],
    });
  });

  it('records one entry for a selection edit intent', () => {
    setLayers([createBitmapLayer('selection', makeImage(new Array(16).fill(0)))]);
    const before = captureSelectionSnapshot();

    const beforeCount = historyManager.entries().length;
    useAppStore.getState().setSelectionBounds({ x: 0, y: 0 }, { x: 1, y: 1 });
    commitSelectionHistory({
      before,
      description: 'Selection edit',
    });

    expectOneHistoryEntry({
      beforeCount,
      action: 'selection-change',
      deltaTags: ['selection-bounds'],
    });
  });

  it('records one entry for an erase-mask edit intent', async () => {
    const width = 2;
    const height = 2;
    const layer = createColorCycleLayer('mask', width, height);
    setLayers([layer], width, height);
    const beforeState = makeColorCycleState({
      layerId: layer.id,
      width,
      height,
      paint: [0, 0, 0, 0],
      eraseMaskAlpha: [0, 0, 0, 0],
      eraseMaskVersion: 1,
    });
    const afterState = makeColorCycleState({
      layerId: layer.id,
      width,
      height,
      paint: [0, 0, 0, 0],
      eraseMaskAlpha: [255, 0, 0, 0],
      eraseMaskVersion: 2,
    });

    const beforeCount = historyManager.entries().length;
    await commitLayerHistory({
      layerId: layer.id,
      beforeImage: null,
      beforeColorState: beforeState,
      afterColorState: afterState,
      actionType: 'eraser',
      description: 'Erase mask edit',
      tool: 'eraser',
      bitmapRoi: { x: 0, y: 0, width, height },
      skipBitmapDelta: true,
    });

    expectOneHistoryEntry({
      beforeCount,
      action: 'eraser-stroke',
      deltaTags: ['color-cycle-erase-mask-patch'],
    });
  });

  it('records one entry for a layer structure intent', () => {
    const layers = [
      createBitmapLayer('layer-a', makeImage(new Array(16).fill(0)), 0),
      createBitmapLayer('layer-b', makeImage(new Array(16).fill(0)), 1),
      createBitmapLayer('layer-c', makeImage(new Array(16).fill(0)), 2),
    ];
    setLayers(layers);

    const beforeCount = historyManager.entries().length;
    useAppStore.getState().reorderLayers(0, 2);

    expectOneHistoryEntry({
      beforeCount,
      action: 'layer-structure',
      deltaTags: ['layer-structure'],
    });
  });

  it('records one entry for a project transform intent', async () => {
    const beforeCount = historyManager.entries().length;
    await recordResizeHistory({
      beforeProject: { width: 2, height: 2 },
      afterProject: { width: 4, height: 3 },
      beforeLayers: new Map(),
      afterLayers: [],
      description: 'Resize canvas',
    });

    expectOneHistoryEntry({
      beforeCount,
      action: 'project-transform',
      deltaTags: ['project-dimensions'],
    });
  });

  it('records one entry for a color-cycle runtime mutation intent', async () => {
    const width = 2;
    const height = 2;
    const layer = createColorCycleLayer('cc-runtime', width, height);
    setLayers([layer], width, height);
    const beforeState = makeColorCycleState({
      layerId: layer.id,
      width,
      height,
      paint: [0, 0, 0, 0],
    });
    const afterState = makeColorCycleState({
      layerId: layer.id,
      width,
      height,
      paint: [1, 0, 0, 0],
      gradientId: [2, 0, 0, 0],
      gradientDefId: [3, 0, 0, 0],
      speed: [4, 0, 0, 0],
      flow: [5, 0, 0, 0],
      phase: [6, 0, 0, 0],
    });

    const beforeCount = historyManager.entries().length;
    await commitLayerHistory({
      layerId: layer.id,
      beforeImage: null,
      beforeColorState: beforeState,
      afterColorState: afterState,
      actionType: 'brush',
      description: 'Color-cycle stroke',
      tool: 'color-cycle',
      bitmapRoi: { x: 0, y: 0, width, height },
      skipBitmapDelta: true,
    });

    expectOneHistoryEntry({
      beforeCount,
      action: 'brush-stroke',
      deltaTags: ['color-cycle-stroke-patch'],
    });
  });

  it('does not batch separate bitmap stroke intents into one entry', async () => {
    const base = makeImage(new Array(16).fill(0));
    const first = cloneImage(base);
    first.data[3] = 255;
    const second = cloneImage(first);
    second.data[7] = 255;
    const layer = createBitmapLayer('separate-strokes', first);
    setLayers([layer]);

    await commitLayerHistory({
      layerId: layer.id,
      beforeImage: base,
      beforeColorState: null,
      actionType: 'brush',
      description: 'Brush stroke 1',
      tool: 'brush',
    });

    const updatedLayer = createBitmapLayer('separate-strokes', second);
    setLayers([updatedLayer]);
    await commitLayerHistory({
      layerId: updatedLayer.id,
      beforeImage: first,
      beforeColorState: null,
      actionType: 'brush',
      description: 'Brush stroke 2',
      tool: 'brush',
    });

    const entries = historyManager.entries();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.action)).toEqual(['brush-stroke', 'brush-stroke']);
  });
});
