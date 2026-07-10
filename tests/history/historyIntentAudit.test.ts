import { TextDecoder, TextEncoder } from 'util';

import {
  HISTORY_BLOB_DEFAULT_RESIDENT_BUDGET_BYTES,
  HISTORY_BLOB_DEFAULT_SPILL_THRESHOLD_BYTES,
  clearBlobStore,
  configureHistoryBlobStore,
} from '@/history/blobStore';
import type {
  HistoryActionId,
  HistoryDelta,
  HistoryDirection,
  HistoryEntry,
  PreparedHistoryDelta,
} from '@/history/actionTypes';
import { HistoryReplayApplyError } from '@/history/errors';
import { commitLayerHistory } from '@/history/helpers/layerHistory';
import { captureSelectionSnapshot, commitSelectionHistory } from '@/history/helpers/selectionHistory';
import historyManager from '@/history/historyService';
import { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import { recordResizeHistory } from '@/stores/helpers/resizeHistory';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
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

class LateFailureDelta implements HistoryDelta {
  readonly _tag = 'late-failure';

  apply(direction: HistoryDirection): void {
    void direction;
    throw new Error('Injected late replay failure');
  }

  prepare(direction: HistoryDirection): PreparedHistoryDelta {
    return {
      deltaTag: this._tag,
      apply: () => this.apply(direction),
      requiresCompensation: () => false,
      compensate: () => undefined,
    };
  }
}

const injectLateFailure = (entry: HistoryEntry): void => {
  entry.deltas.unshift(new LateFailureDelta());
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
  softEdgeMaskAlpha,
  softEdgeMaskVersion,
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
  softEdgeMaskAlpha?: number[];
  softEdgeMaskVersion?: number;
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
        ...(softEdgeMaskAlpha && typeof softEdgeMaskVersion === 'number'
          ? {
              softEdgeMaskSnapshot: {
                width,
                height,
                alpha: new Uint8ClampedArray(softEdgeMaskAlpha),
                enabled: true,
                version: softEdgeMaskVersion,
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

  it('compensates a real selection intent when a later delta fails', async () => {
    setLayers([createBitmapLayer('selection-atomic', makeImage(new Array(16).fill(0)))]);
    const before = captureSelectionSnapshot();
    useAppStore.getState().setSelectionBounds({ x: 0, y: 0 }, { x: 1, y: 1 });
    const preReplaySelectionLastAction = useAppStore.getState().selectionLastAction;
    commitSelectionHistory({ before, description: 'Selection atomicity' });
    const entry = historyManager.peekUndo();
    expect(entry).not.toBeNull();
    injectLateFailure(entry!);

    await expect(historyManager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    const state = useAppStore.getState();
    expect(state.selectionStart).toEqual({ x: 0, y: 0 });
    expect(state.selectionEnd).toEqual({ x: 1, y: 1 });
    expect(state.selectionLastAction).toBe(preReplaySelectionLastAction);
    expect(historyManager.entries()).toHaveLength(1);
    expect(historyManager.redoEntries()).toHaveLength(0);
  });

  it('compensates a real bitmap-and-selection composite entry when a later delta fails', async () => {
    const beforeImage = makeImage(new Array(16).fill(0));
    const afterImage = cloneImage(beforeImage);
    afterImage.data[3] = 255;
    const layer = createBitmapLayer('selection-paste-atomic', afterImage);
    setLayers([layer]);
    const selectionBefore = captureSelectionSnapshot();
    useAppStore.getState().setSelectionBounds({ x: 0, y: 0 }, { x: 1, y: 1 });
    await commitLayerHistory({
      layerId: layer.id,
      beforeImage,
      beforeColorState: null,
      actionType: 'brush',
      description: 'Selection paste atomicity',
      tool: 'floating-paste',
      selectionBefore,
    });
    const entry = historyManager.peekUndo();
    expect(entry?.deltas.map((delta) => delta._tag)).toEqual(['bitmap-tile', 'selection-bounds']);
    injectLateFailure(entry!);

    await expect(historyManager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    const state = useAppStore.getState();
    const restoredLayer = state.layers.find((candidate) => candidate.id === layer.id);
    expect(restoredLayer?.imageData?.data[3]).toBe(255);
    expect(state.selectionStart).toEqual({ x: 0, y: 0 });
    expect(state.selectionEnd).toEqual({ x: 1, y: 1 });
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

  it('compensates a real erase-mask intent when a later delta fails', async () => {
    const width = 2;
    const height = 2;
    const layer = createColorCycleLayer('mask-atomic', width, height);
    setLayers([layer], width, height);
    const beforeState = makeColorCycleState({
      layerId: layer.id, width, height, paint: [0, 0, 0, 0],
      eraseMaskAlpha: [0, 0, 0, 0], eraseMaskVersion: 1,
    });
    const afterState = makeColorCycleState({
      layerId: layer.id, width, height, paint: [0, 0, 0, 0],
      eraseMaskAlpha: [255, 0, 0, 0], eraseMaskVersion: 2,
    });
    const maskContext = layer.colorCycleData?.eraseMask?.getContext('2d');
    const afterMask = new ImageData(width, height);
    afterMask.data[3] = 255;
    maskContext?.putImageData(afterMask, 0, 0);

    await commitLayerHistory({
      layerId: layer.id,
      beforeImage: null,
      beforeColorState: beforeState,
      afterColorState: afterState,
      actionType: 'eraser',
      description: 'Atomic erase mask',
      tool: 'eraser',
      bitmapRoi: { x: 0, y: 0, width, height },
      skipBitmapDelta: true,
    });
    const entry = historyManager.peekUndo();
    expect(entry).not.toBeNull();
    injectLateFailure(entry!);

    await expect(historyManager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    const restored = layer.colorCycleData?.eraseMask?.getContext('2d')?.getImageData(0, 0, 1, 1);
    expect(restored?.data[3]).toBe(255);
    expect(historyManager.entries()).toHaveLength(1);
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

  it('compensates a real layer-structure intent when a later delta fails', async () => {
    const layers = [
      createBitmapLayer('atomic-layer-a', makeImage(new Array(16).fill(0)), 0),
      createBitmapLayer('atomic-layer-b', makeImage(new Array(16).fill(0)), 1),
    ];
    setLayers(layers);
    useAppStore.getState().reorderLayers(0, 1);
    const preReplayProject = useAppStore.getState().project;
    const entry = historyManager.peekUndo();
    expect(entry).not.toBeNull();
    injectLateFailure(entry!);

    await expect(historyManager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    expect(useAppStore.getState().layers.map((layer) => layer.id)).toEqual([
      'atomic-layer-b',
      'atomic-layer-a',
    ]);
    expect(useAppStore.getState().project).toEqual(preReplayProject);
    expect(useAppStore.getState().project?.updatedAt).toBe(preReplayProject?.updatedAt);
    expect(historyManager.entries()).toHaveLength(1);
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

  it('compensates a real project resize intent when a later delta fails', async () => {
    const beforeImage = makeImage(new Array(16).fill(0));
    const afterImage = new ImageData(new Uint8ClampedArray(4 * 3 * 4), 4, 3);
    afterImage.data[3] = 255;
    const layer = createBitmapLayer('resize-atomic', afterImage);
    setLayers([layer], 4, 3);
    await recordResizeHistory({
      beforeProject: { width: 2, height: 2 },
      afterProject: { width: 4, height: 3 },
      beforeLayers: new Map([[layer.id, { image: beforeImage, colorState: null }]]),
      afterLayers: [layer],
      description: 'Atomic resize',
    });
    const entry = historyManager.peekUndo();
    expect(entry).not.toBeNull();
    injectLateFailure(entry!);
    const beforeReplayVersion = useAppStore.getState().layers[0]?.version;
    const beforeReplayAutosave = useAppStore.getState().autosave;
    const beforeReplayNeedsRecomposition = useAppStore.getState().layersNeedRecomposition;

    await expect(historyManager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    const project = useAppStore.getState().project;
    expect(project?.width).toBe(4);
    expect(project?.height).toBe(3);
    expect(useAppStore.getState().layers[0]?.imageData?.width).toBe(4);
    expect(useAppStore.getState().layers[0]?.imageData?.data[3]).toBe(255);
    expect(useAppStore.getState().layers[0]?.version).toBe(beforeReplayVersion);
    expect(useAppStore.getState().layersNeedRecomposition).toBe(beforeReplayNeedsRecomposition);
    expect(useAppStore.getState().autosave).toEqual(expect.objectContaining({
      hasUnsavedChanges: beforeReplayAutosave.hasUnsavedChanges,
      dirtyRevision: beforeReplayAutosave.dirtyRevision,
      savedRevision: beforeReplayAutosave.savedRevision,
      lastDirtyReason: beforeReplayAutosave.lastDirtyReason,
      lastDirtyAt: beforeReplayAutosave.lastDirtyAt,
    }));
    expect(historyManager.entries()).toHaveLength(1);
  });

  it('marks a successful project resize replay dirty exactly once', async () => {
    const beforeImage = makeImage(new Array(16).fill(0));
    const afterImage = new ImageData(new Uint8ClampedArray(4 * 3 * 4), 4, 3);
    const layer = createBitmapLayer('resize-dirty-once', afterImage);
    setLayers([layer], 4, 3);
    await recordResizeHistory({
      beforeProject: { width: 2, height: 2 },
      afterProject: { width: 4, height: 3 },
      beforeLayers: new Map([[layer.id, { image: beforeImage, colorState: null }]]),
      afterLayers: [layer],
      description: 'Resize dirty tracking',
    });
    const beforeReplayRevision = useAppStore.getState().autosave.dirtyRevision;

    await useAppStore.getState().undo();

    expect(useAppStore.getState().autosave).toEqual(expect.objectContaining({
      hasUnsavedChanges: true,
      dirtyRevision: beforeReplayRevision + 1,
      lastDirtyReason: 'history-change',
    }));
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

  it('restores a real Color Cycle patch entry when a later delta fails', async () => {
    const width = 2;
    const height = 2;
    const layer = createColorCycleLayer('cc-runtime-atomic', width, height);
    setLayers([layer], width, height);
    const beforeState = makeColorCycleState({ layerId: layer.id, width, height, paint: [0, 0, 0, 0] });
    const afterState = makeColorCycleState({
      layerId: layer.id, width, height, paint: [1, 0, 0, 0],
      gradientId: [2, 0, 0, 0], gradientDefId: [3, 0, 0, 0],
      speed: [4, 0, 0, 0], flow: [5, 0, 0, 0], phase: [6, 0, 0, 0],
    });
    await commitLayerHistory({
      layerId: layer.id,
      beforeImage: null,
      beforeColorState: beforeState,
      afterColorState: afterState,
      actionType: 'brush',
      description: 'Atomic Color Cycle stroke',
      tool: 'color-cycle',
      bitmapRoi: { x: 0, y: 0, width, height },
      skipBitmapDelta: true,
    });
    const entry = historyManager.peekUndo();
    expect(entry?.deltas.map((delta) => delta._tag)).toEqual(['color-cycle-stroke-patch']);
    injectLateFailure(entry!);

    await expect(historyManager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    expect(historyManager.entries()).toHaveLength(1);
    expect(historyManager.redoEntries()).toHaveLength(0);
  });

  it('restores a real CC patch, erase-mask, and soft-edge entry when a later delta fails', async () => {
    const width = 2;
    const height = 2;
    const layer = createColorCycleLayer('cc-composite-atomic', width, height);
    setLayers([layer], width, height);
    const beforeState = makeColorCycleState({
      layerId: layer.id, width, height, paint: [0, 0, 0, 0],
      eraseMaskAlpha: [0, 0, 0, 0], eraseMaskVersion: 1,
    });
    const afterState = makeColorCycleState({
      layerId: layer.id, width, height, paint: [1, 0, 0, 0],
      gradientId: [2, 0, 0, 0], gradientDefId: [3, 0, 0, 0],
      speed: [4, 0, 0, 0], flow: [5, 0, 0, 0], phase: [6, 0, 0, 0],
      eraseMaskAlpha: [255, 0, 0, 0], eraseMaskVersion: 2,
      softEdgeMaskAlpha: [0, 255, 0, 0], softEdgeMaskVersion: 2,
    });
    const eraseImage = new ImageData(width, height);
    eraseImage.data[3] = 255;
    layer.colorCycleData?.eraseMask?.getContext('2d')?.putImageData(eraseImage, 0, 0);

    await commitLayerHistory({
      layerId: layer.id,
      beforeImage: null,
      beforeColorState: beforeState,
      afterColorState: afterState,
      actionType: 'brush',
      description: 'Atomic Color Cycle composite',
      tool: 'color-cycle',
      bitmapRoi: { x: 0, y: 0, width, height },
      skipBitmapDelta: true,
    });
    const entry = historyManager.peekUndo();
    expect(entry?.deltas.map((delta) => delta._tag)).toEqual([
      'color-cycle-stroke-patch',
      'color-cycle-erase-mask-patch',
      'color-cycle-soft-edge-mask',
    ]);
    // Materialize the live post-stroke runtime so this case exercises compensation
    // of an existing runtime; cold-runtime cleanup is covered separately.
    const preparedForwardPatch = await entry!.deltas[0]!.prepare('forward');
    await preparedForwardPatch.apply();
    injectLateFailure(entry!);

    await expect(historyManager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    const restoredLayer = useAppStore.getState().layers[0];
    const restoredDocument = getColorCycleBrushManager().getDocument(layer.id)?.read();
    const eraseAlpha = restoredLayer?.colorCycleData?.eraseMask
      ?.getContext('2d')?.getImageData(0, 0, 1, 1).data[3];
    expect(eraseAlpha).toBe(255);
    expect(restoredLayer?.colorCycleData?.softEdgeMaskImageData?.data[7]).toBe(255);
    expect(Array.from(new Uint8Array(restoredDocument?.snapshot.paintBuffer ?? new ArrayBuffer(0)))).toEqual([
      1, 0, 0, 0,
    ]);
    expect(historyManager.entries()).toHaveLength(1);
    expect(historyManager.redoEntries()).toHaveLength(0);
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
