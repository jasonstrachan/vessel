import { TextDecoder, TextEncoder } from 'util';

(global as unknown as { TextEncoder?: typeof TextEncoder }).TextEncoder = TextEncoder;
(global as unknown as { TextDecoder?: typeof TextDecoder }).TextDecoder = TextDecoder;

import { useAppStore } from '@/stores/useAppStore';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import historyManager from '@/history/historyService';
import * as historyBlobs from '@/history/blobStore';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import { applyColorCycleBrushLayerSnapshotToRuntime } from '@/lib/colorCycle/document';
import { createDefaultLayerAlignment, createDefaultExportLayout } from '@/utils/layoutDefaults';
import { createDefaultCanvasShape } from '@/utils/canvasShape';
import type { CanvasShape, Layer, Project, Rectangle, TxtShape, UiShape } from '@/types';
import { readTestColorCycleBrushLayerSnapshot } from '@/testing/colorCycleSnapshotTestUtils';
import { WINDOWS_31_UI_SHAPE_PALETTE } from '@/utils/uiShape';
import { selectionSnapshotFromState } from '@/history/selectionState';
import { ResizeLayerDelta } from '@/stores/helpers/resizeHistory';
import { cloneRecolorSettings } from '@/history/deltas/recolorDelta';
import { createCropGeometryDelta } from '@/history/deltas/cropGeometryDelta';


const createImageData = (width: number, height: number): ImageData => {
  const imageData = new ImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      imageData.data[index] = x; // Red encodes source x position
      imageData.data[index + 1] = y; // Green encodes source y position
      imageData.data[index + 2] = 0;
      imageData.data[index + 3] = 255;
    }
  }
  return imageData;
};

const snapshotProject = (): Project | null => {
  const project = useAppStore.getState().project;
  if (!project) {
    return null;
  }
  return {
    ...project,
    layers: [...project.layers],
    createdAt: new Date(project.createdAt),
    updatedAt: new Date(project.updatedAt)
  };
};

const snapshotCanvas = () => {
  const canvas = useAppStore.getState().canvas;
  return {
    ...canvas,
    selection: {
      ...canvas.selection,
      bounds: { ...canvas.selection.bounds }
    },
    cursor: { ...canvas.cursor }
  };
};

const initialProject = snapshotProject();
const initialCanvas = snapshotCanvas();

const resetStore = () => {
  useAppStore.setState({
    project: initialProject
      ? {
          ...initialProject,
          layers: [...initialProject.layers],
          createdAt: new Date(initialProject.createdAt),
          updatedAt: new Date(initialProject.updatedAt)
        }
      : null,
    layers: [],
    activeLayerId: null,
    layersNeedRecomposition: false,
    currentOffscreenCanvas: null,
    selectionStart: null,
    selectionEnd: null,
    selectionMask: null,
    selectionMaskBounds: null,
    selectionMaskLayerId: null,
    selectionVectorPath: null,
    selectionLastAction: null,
    floatingPaste: null,
    history: {
      undoStack: [],
      redoStack: [],
      maxHistorySize: 50,
      isCapturing: false
    },
    crop: {
      status: 'idle',
      marquee: null,
      activeHandle: null,
      commitInFlight: false
    },
    canvas: initialCanvas
      ? {
          ...initialCanvas,
          canvasWidth: initialCanvas.canvasWidth,
          canvasHeight: initialCanvas.canvasHeight,
          offsetX: initialCanvas.offsetX,
          offsetY: initialCanvas.offsetY,
          selection: {
            ...initialCanvas.selection,
            active: false,
            bounds: { x: 0, y: 0, width: 0, height: 0 }
          }
        }
      : initialCanvas
  });
};

beforeEach(() => {
  historyManager.clear();
  resetStore();
});

afterEach(() => {
  jest.restoreAllMocks();
  historyManager.clear();
  resetStore();
});

const createLayer = (width: number, height: number): Layer => {
  const imageData = createImageData(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx?.putImageData(imageData, 0, 0);

  return {
    id: 'layer-base',
    name: 'Base Layer',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'normal'
  };
};

const createColorCycleLayer = (width: number, height: number): Layer => {
  const baseLayer = createLayer(width, height);
  const ccCanvas = document.createElement('canvas');
  ccCanvas.width = width;
  ccCanvas.height = height;
  const ccCtx = ccCanvas.getContext('2d');
  ccCtx?.putImageData(baseLayer.imageData as ImageData, 0, 0);

  return {
    ...baseLayer,
    layerType: 'color-cycle',
    framebuffer: ccCanvas,
    colorCycleData: {
      mode: 'brush',
      gradient: [
        { position: 0, color: '#ff0000' },
        { position: 1, color: '#00ff00' }
      ],
      isAnimating: false,
      canvas: ccCanvas
    }
  };
};

const createRecolorLayer = (width: number, height: number): Layer => {
  const baseLayer = createColorCycleLayer(width, height);
  const gradientStops = [
    { position: 0, color: '#ff0000' },
    { position: 1, color: '#00ff00' }
  ];

  let originalImageData: ImageData | undefined;
  if (baseLayer.imageData && typeof ImageData !== 'undefined') {
    originalImageData = new ImageData(
      new Uint8ClampedArray(baseLayer.imageData.data),
      baseLayer.imageData.width,
      baseLayer.imageData.height
    );
  }

  baseLayer.colorCycleData = {
    ...baseLayer.colorCycleData,
    mode: 'recolor',
    recolorSettings: {
      quantizationMode: 'rgb332',
      ditherMode: 'off',
      animation: {
        speed: 0.1,
        fps: 30,
        ticksPerFrame: 1,
        isPlaying: false,
        currentTick: 7,
        flowDirection: 'forward'
      },
      cycleColors: 16,
      gradient: gradientStops,
      mappingMode: 'banded',
      flowMapping: 'palette',
      currentLOD: 'full',
      originalImageData
    }
  };

  return baseLayer;
};

const primeStoreForCrop = (
  layer: Layer,
  projectWidth: number,
  projectHeight: number,
  marquee: Rectangle = { x: 1, y: 1, width: 3, height: 2 }
) => {
  const baseProject = useAppStore.getState().project;
  const project: Project = baseProject
    ? {
        ...baseProject,
        width: projectWidth,
        height: projectHeight,
        layers: [layer],
        updatedAt: new Date()
      }
    : {
        id: 'project-test',
        name: 'Crop Test',
        width: projectWidth,
        height: projectHeight,
        layers: [layer],
        backgroundColor: 'transparent',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
        brushSpecificSettings: {},
        exportLayout: createDefaultExportLayout()
      };

  useAppStore.setState((state) => ({
    project,
    layers: [layer],
    activeLayerId: layer.id,
    currentOffscreenCanvas: null,
    layersNeedRecomposition: false,
    history: {
      undoStack: [],
      redoStack: [],
      maxHistorySize: state.history.maxHistorySize,
      isCapturing: false
    },
    crop: {
      status: 'ready',
      marquee,
      activeHandle: null,
      commitInFlight: false
    },
    canvas: {
      ...state.canvas,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      canvasWidth: projectWidth,
      canvasHeight: projectHeight,
      selection: {
        ...state.canvas.selection,
        active: false,
        bounds: { x: 0, y: 0, width: 0, height: 0 }
      }
    },
    selectionStart: null,
    selectionEnd: null,
    floatingPaste: null
  }));
};

const primeStoreForResize = (
  layer: Layer,
  projectWidth: number,
  projectHeight: number
) => {
  const baseProject = useAppStore.getState().project;
  const project: Project = baseProject
    ? {
        ...baseProject,
        width: projectWidth,
        height: projectHeight,
        layers: [layer],
        updatedAt: new Date()
      }
    : {
        id: 'project-resize-test',
        name: 'Resize Test',
        width: projectWidth,
        height: projectHeight,
        layers: [layer],
        backgroundColor: 'transparent',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
        brushSpecificSettings: {},
        exportLayout: createDefaultExportLayout()
      };

  useAppStore.setState((state) => ({
    project,
    layers: [layer],
    activeLayerId: layer.id,
    currentOffscreenCanvas: null,
    layersNeedRecomposition: false,
    canvas: {
      ...state.canvas,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      canvasWidth: projectWidth,
      canvasHeight: projectHeight,
    },
  }));
};

describe('useAppStore commitCrop', () => {
  it('compensates a full-image replay back to null pixels and the original framebuffer dimensions', async () => {
    const layer = createLayer(6, 4);
    layer.imageData = null;
    const context = layer.framebuffer.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    context?.clearRect(0, 0, 6, 4);
    primeStoreForCrop(layer, 6, 4);
    const delta = new ResizeLayerDelta(layer.id, null, createImageData(3, 2), false, {
      before: { width: 6, height: 4 },
      after: { width: 3, height: 2 },
    });
    const prepared = delta.prepare('forward');
    await prepared.apply();
    expect(useAppStore.getState().layers[0].imageData?.width).toBe(3);
    expect(prepared.requiresCompensation()).toBe(true);
    await prepared.compensate();
    const restored = useAppStore.getState().layers[0];
    expect(restored.imageData).toBeNull();
    expect([restored.framebuffer.width, restored.framebuffer.height]).toEqual([6, 4]);
    expect(context?.getImageData(0, 0, 6, 4).data).toEqual(new Uint8ClampedArray(6 * 4 * 4));
  });

  it.each([false, true])('roundtrips crop with the actual new-project default layers (resident CC: %s)', async (residentColorCycle) => {
    useAppStore.getState().newProject(6, 4, 'Crop default layers');
    const state = useAppStore.getState();
    const raster = state.layers.find((layer) => layer.layerType === 'normal')!;
    const colorCycle = state.layers.find((layer) => layer.layerType === 'color-cycle')!;
    expect(colorCycle.imageData).toBeNull();
    if (residentColorCycle) state.initColorCycleForLayer(colorCycle.id, 6, 4);
    state.updateLayer(raster.id, { imageData: createImageData(6, 4) });
    state.updateLayer(colorCycle.id, { visible: false });
    state.setActiveLayer(raster.id);
    state.pauseColorCycle('toolbar');
    state.setCropState({ status: 'ready', marquee: { x: 1, y: 1, width: 3, height: 2 } });
    historyManager.clear();
    await useAppStore.getState().commitCrop();
    const after = useAppStore.getState().layers.find((layer) => layer.id === raster.id)!.imageData!;
    const pixels = new Uint8ClampedArray(after.data);
    expect(historyManager.entries()).toHaveLength(1);
    await historyManager.undo();
    expect([useAppStore.getState().project?.width, useAppStore.getState().project?.height]).toEqual([6, 4]);
    const undoneColorCycle = useAppStore.getState().layers.find((layer) => layer.id === colorCycle.id)!;
    expect(undoneColorCycle.imageData).toBeNull();
    expect([undoneColorCycle.framebuffer.width, undoneColorCycle.framebuffer.height]).toEqual([6, 4]);
    await historyManager.redo();
    expect([useAppStore.getState().project?.width, useAppStore.getState().project?.height]).toEqual([3, 2]);
    const redone = useAppStore.getState().layers.find((layer) => layer.id === raster.id)!;
    expect(redone.imageData?.data).toEqual(pixels);
    expect([redone.framebuffer.width, redone.framebuffer.height]).toEqual([3, 2]);
  });

  it('retains the complete crop state when history is busy and retries after admission is available', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const layer = createLayer(6, 4);
    primeStoreForCrop(layer, 6, 4);
    const mask = new ImageData(3, 2);
    mask.data[3] = 127;
    useAppStore.setState({
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 4, y: 3 },
      selectionMask: mask,
      selectionMaskBounds: { x: 1, y: 1, width: 3, height: 2 },
      selectionMaskLayerId: layer.id,
      selectionVectorPath: { mode: 'freehand', points: [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 3 }] },
    });
    const before = useAppStore.getState();
    const beforePixels = new Uint8ClampedArray(layer.imageData!.data);
    const beforeSelection = selectionSnapshotFromState(before);
    const held = historyManager.begin('selection-change');
    try {
      await before.commitCrop();
      const refused = useAppStore.getState();
      expect(refused.project).toBe(before.project);
      expect(refused.layers).toBe(before.layers);
      expect(refused.canvas).toBe(before.canvas);
      expect(refused.crop).toBe(before.crop);
      expect(refused.currentOffscreenCanvas).toBe(before.currentOffscreenCanvas);
      expect(refused.layersNeedRecomposition).toBe(before.layersNeedRecomposition);
      expect(refused.floatingPaste).toBe(before.floatingPaste);
      expect(selectionSnapshotFromState(refused)).toEqual(beforeSelection);
      expect(layer.imageData?.data).toEqual(beforePixels);
      const context = layer.framebuffer.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      expect(context?.getImageData(0, 0, 6, 4).data).toEqual(beforePixels);
      expect(historyManager.entries()).toHaveLength(0);
      expect(errorLog).toHaveBeenCalledWith('[crop] History is unavailable for crop', expect.any(Error));
    } finally {
      held.cancel();
    }
    await useAppStore.getState().commitCrop();
    expect([useAppStore.getState().project?.width, useAppStore.getState().project?.height]).toEqual([3, 2]);
    expect(historyManager.entries()).toHaveLength(1);
    expect(useAppStore.getState().crop.commitInFlight).toBe(false);
    await historyManager.undo();
    expect(useAppStore.getState().layers[0].imageData?.data).toEqual(beforePixels);
  });

  it('restores admitted crop state after blob storage rejects and retries with exact history', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const layer = createLayer(6, 4);
    primeStoreForCrop(layer, 6, 4, { x: 1, y: 1, width: 6, height: 4 });
    const mask = new ImageData(3, 2);
    mask.data[3] = 127;
    const offscreen = document.createElement('canvas');
    useAppStore.setState({
      currentOffscreenCanvas: offscreen,
      selectionStart: { x: 1, y: 1 }, selectionEnd: { x: 4, y: 3 },
      selectionMask: mask, selectionMaskBounds: { x: 1, y: 1, width: 3, height: 2 },
      selectionMaskLayerId: layer.id,
      selectionVectorPath: { mode: 'freehand', points: [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 3 }] },
    });
    const before = useAppStore.getState();
    const selection = selectionSnapshotFromState(before);
    const pixels = layer.imageData!.data.slice();
    const storage = jest.spyOn(historyBlobs, 'storeBlob').mockRejectedValueOnce(new Error('resident blob allocation failed'));
    await before.commitCrop();
    const failed = useAppStore.getState();
    expect(storage).toHaveBeenCalled();
    expect(failed.project).toEqual(before.project);
    expect(failed.layers).toEqual(before.layers);
    expect(failed.canvas).toEqual(before.canvas);
    expect(failed.crop).toEqual(before.crop);
    expect(failed.currentOffscreenCanvas).toBe(offscreen);
    expect(selectionSnapshotFromState(failed)).toEqual(selection);
    expect(layer.imageData!.data).toEqual(pixels);
    expect(historyManager.entries()).toHaveLength(0);
    const probe = historyManager.begin('selection-change'); probe.cancel();
    expect(errorLog).toHaveBeenCalledWith('[crop] Failed to commit crop', expect.any(Error));
    await failed.commitCrop();
    const cropped = useAppStore.getState().layers[0].imageData!.data.slice();
    expect(cropped).not.toEqual(pixels);
    expect(historyManager.entries()).toHaveLength(1);
    await historyManager.undo();
    expect(useAppStore.getState().layers[0].imageData!.data).toEqual(pixels);
    expect(selectionSnapshotFromState(useAppStore.getState())).toMatchObject({ ...selection, provenance: expect.objectContaining({ ownerKind: 'history-restored' }) });
    await historyManager.redo();
    expect(useAppStore.getState().layers[0].imageData!.data).toEqual(cropped);
  });

  it('preserves concurrent layer metadata, membership and playback speed when pending storage rejects', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const layer = createLayer(6, 4);
    primeStoreForCrop(layer, 6, 4, { x: 1, y: 1, width: 6, height: 4 });
    const removed = { ...createLayer(6, 4), id: 'removed-during-crop', order: 1 };
    useAppStore.setState((state) => ({ layers: [layer, removed], project: { ...state.project!, layers: [layer, removed] } }));
    const originalPixels = layer.imageData!.data.slice();
    const originalPlayback = useAppStore.getState().colorCyclePlayback;
    let rejectStorage!: (error: Error) => void;
    let storageReached!: () => void;
    const reached = new Promise<void>((resolve) => { storageReached = resolve; });
    jest.spyOn(historyBlobs, 'storeBlob').mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectStorage = reject;
      storageReached();
    }));
    const pending = useAppStore.getState().commitCrop();
    await reached;
    useAppStore.getState().updateLayer(layer.id, { name: 'Renamed while pending', visible: false, opacity: 0.4 });
    const added = { ...createLayer(6, 4), id: 'added-during-crop', order: 0 };
    useAppStore.setState((state) => ({
      layers: [added, ...state.layers.filter((candidate) => candidate.id !== removed.id)],
      colorCyclePlayback: { ...state.colorCyclePlayback, playbackSpeedScale: 2 },
    }));
    rejectStorage(new Error('deferred resident allocation failed'));
    await pending;
    const failed = useAppStore.getState();
    expect(failed.layers.map((candidate) => candidate.id)).toEqual([added.id, layer.id]);
    expect(failed.layers[0]).toBe(added);
    expect(failed.layers[1]).toMatchObject({ name: 'Renamed while pending', visible: false, opacity: 0.4 });
    expect(failed.layers[1].imageData!.data).toEqual(originalPixels);
    expect([failed.layers[1].framebuffer.width, failed.layers[1].framebuffer.height]).toEqual([6, 4]);
    expect(failed.project?.layers).toBe(failed.layers);
    expect(failed.colorCyclePlayback).toEqual({ ...originalPlayback, playbackSpeedScale: 2 });
    expect(failed.crop.marquee).toEqual({ x: 1, y: 1, width: 6, height: 4 });
    expect(historyManager.entries()).toHaveLength(0);
  });

  it.each([
    { resident: false, failure: 'storage' },
    { resident: true, failure: 'storage' },
    { resident: true, failure: 'runtime' },
  ])('restores the canonical CC document and residency after $failure rejection (resident: $resident)', async ({ resident, failure }) => {
    const manager = getColorCycleBrushManager();
    const layer = createColorCycleLayer(6, 4);
    layer.id = `crop-rollback-cc-${resident}`;
    primeStoreForCrop(layer, 6, 4);
    useAppStore.getState().initColorCycleForLayer(layer.id, 6, 4);
    const oldBrush = manager.getBrush(layer.id)!;
    applyColorCycleBrushLayerSnapshotToRuntime(oldBrush, layer.id, {
      paintBuffer: new Uint8Array(24).fill(1).buffer,
      gradientIdBuffer: Uint8Array.from({ length: 24 }, (_, i) => i).buffer,
      gradientDefIdBuffer: Uint16Array.from({ length: 24 }, (_, i) => i + 100).buffer,
      speedBuffer: new Uint8Array(24).fill(12).buffer,
      flowBuffer: new Uint8Array(24).fill(2).buffer,
      phaseBuffer: Uint8Array.from({ length: 24 }, (_, i) => i * 7).buffer,
      hasContent: true, strokeCounter: 3,
    });
    if (!resident) manager.discardRuntimeRetainingDocument(layer.id);
    const originalDocument = manager.getDocument(layer.id)!;
    const originalRead = originalDocument.read();
    const originalAudit = originalDocument.getAuditLog();
    const originalDirty = originalDocument.peekDirtyBatch();
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    if (failure === 'storage') {
      jest.spyOn(historyBlobs, 'storeBlob').mockRejectedValueOnce(new Error('CC history allocation failed'));
    } else {
      jest.spyOn(manager, 'createBrush').mockImplementationOnce(() => { throw new Error('CC runtime creation failed'); });
    }
    await useAppStore.getState().commitCrop();
    expect(manager.getDocument(layer.id)).toBe(originalDocument);
    expect(originalDocument.read()).toEqual(originalRead);
    expect(originalDocument.getAuditLog()).toEqual(originalAudit);
    expect(originalDocument.peekDirtyBatch()).toEqual(originalDirty);
    expect([useAppStore.getState().project?.width, useAppStore.getState().project?.height]).toEqual([6, 4]);
    expect(useAppStore.getState().crop.marquee).toEqual({ x: 1, y: 1, width: 3, height: 2 });
    expect(historyManager.entries()).toHaveLength(0);
    expect(errorLog).not.toHaveBeenCalledWith('[crop] Failed to restore crop after error', expect.anything());
    if (resident) {
      const restoredBrush = manager.getBrush(layer.id)!;
      expect(restoredBrush).not.toBe(oldBrush);
      expect(useAppStore.getState().layers[0].colorCycleData!.colorCycleBrush).toBe(restoredBrush);
      expect(readTestColorCycleBrushLayerSnapshot(restoredBrush, layer.id)?.paintBuffer).toEqual(originalRead.snapshot.paintBuffer);
      expect([restoredBrush.getCanvas?.().width, restoredBrush.getCanvas?.().height]).toEqual([6, 4]);
    } else {
      expect(manager.getBrush(layer.id)).toBeUndefined();
    }
    manager.deleteBrush(layer.id);
  });

  it.each([
    { name: 'shrink', rect: { x: 1, y: 1, width: 3, height: 2 }, transparent: false },
    { name: 'extend', rect: { x: -2, y: -1, width: 9, height: 6 }, transparent: false },
    { name: 'transparent shrink', rect: { x: 1, y: 1, width: 3, height: 2 }, transparent: true },
    { name: 'transparent extend', rect: { x: -2, y: -1, width: 9, height: 6 }, transparent: true },
  ])('restores exact raster dimensions and pixels through $name undo and redo', async ({ rect, transparent }) => {
    const layer = createLayer(6, 4);
    if (transparent) {
      layer.imageData!.data.fill(0);
      const context = layer.framebuffer.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      context?.clearRect(0, 0, 6, 4);
    }
    const before = new ImageData(new Uint8ClampedArray(layer.imageData!.data), 6, 4);
    const expected = new ImageData(rect.width, rect.height);
    for (let y = 0; y < rect.height; y += 1) {
      for (let x = 0; x < rect.width; x += 1) {
        const sourceX = rect.x + x;
        const sourceY = rect.y + y;
        if (sourceX < 0 || sourceX >= before.width || sourceY < 0 || sourceY >= before.height) continue;
        const source = (sourceY * before.width + sourceX) * 4;
        expected.data.set(before.data.subarray(source, source + 4), (y * rect.width + x) * 4);
      }
    }
    primeStoreForCrop(layer, 6, 4, rect);
    const expectSurface = (image: ImageData) => {
      const state = useAppStore.getState();
      const current = state.layers[0];
      expect([state.project?.width, state.project?.height]).toEqual([image.width, image.height]);
      expect([current.imageData?.width, current.imageData?.height]).toEqual([image.width, image.height]);
      expect(current.imageData?.data).toEqual(image.data);
      expect([current.framebuffer.width, current.framebuffer.height]).toEqual([image.width, image.height]);
      const context = current.framebuffer.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      expect(context?.getImageData(0, 0, image.width, image.height).data).toEqual(image.data);
    };
    await useAppStore.getState().commitCrop();
    expect(historyManager.entries()).toHaveLength(1);
    expectSurface(expected);
    await historyManager.undo();
    expectSurface(before);
    await historyManager.redo();
    expectSurface(expected);
  });

  it.each([
    { name: 'absent', shape: undefined, present: false },
    { name: 'explicit undefined', shape: undefined, present: true },
    { name: 'rectangle', shape: createDefaultCanvasShape(6, 4), present: true },
    { name: 'circle', shape: { kind: 'circle', center: { x: 3, y: 2 }, radius: 2, bounds: { x: 1, y: 0, width: 4, height: 4 } } as CanvasShape, present: true },
    { name: 'closed freehand', shape: { kind: 'freehand', points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 3, y: 4 }, { x: 0, y: 0 }], bounds: { x: 0, y: 0, width: 6, height: 4 } } as CanvasShape, present: true },
  ])('replays exact $name shape and mixed auto alignment after the complete crop entry', async ({ shape, present }) => {
    const layer = createLayer(6, 4);
    layer.imageData!.data.fill(0, 0, 4 * 6);
    primeStoreForCrop(layer, 6, 4);
    const sequence: Layer = {
      ...createLayer(6, 4), id: 'sequence', layerType: 'sequential', imageData: null,
      alignment: { ...createDefaultLayerAlignment(), offsetPercent: { x: 25, y: 75 } },
      sequentialData: { frameCount: 2, fps: 12, durationMs: 1000 / 6, events: [] },
    };
    useAppStore.setState((state) => {
      const project = { ...state.project! };
      if (present) project.canvasShape = shape;
      else delete project.canvasShape;
      return { project, layers: [layer, sequence] };
    });
    const geometry = () => {
      const state = useAppStore.getState();
      return {
        shape: state.project?.canvasShape,
        present: Object.prototype.hasOwnProperty.call(state.project, 'canvasShape'),
        alignments: state.layers.map((entry) => entry.alignment),
      };
    };
    const before = geometry();
    await useAppStore.getState().commitCrop();
    const after = geometry();
    expect(after.shape).toEqual(shape);
    for (let i = 0; i < 2; i += 1) {
      await historyManager.undo();
      expect(geometry()).toEqual(before);
      await historyManager.redo();
      expect(geometry()).toEqual(after);
    }
  });

  it('compensates only Crop geometry while preserving unrelated layer edits and replacement projects', async () => {
    const layer = createLayer(6, 4);
    primeStoreForCrop(layer, 6, 4);
    const original = useAppStore.getState();
    const before = { project: original.project!, alignments: new Map([[layer.id, layer.alignment]]) };
    const after = {
      project: { ...original.project!, canvasShape: createDefaultCanvasShape(3, 2) },
      alignments: new Map([[layer.id, { ...layer.alignment, offsetPercent: { x: 1, y: 2 } }]]),
    };
    const prepared = await createCropGeometryDelta(before, after).prepare('forward');
    await prepared.apply();
    await prepared.finalize?.();
    useAppStore.setState((state) => ({ layers: state.layers.map((entry) => ({
      ...entry, name: 'Unrelated rename',
      alignment: { ...entry.alignment, fit: 'cover', offsetPx: { x: 9, y: 10 } },
    })) }));
    await prepared.compensate();
    expect(useAppStore.getState().project?.canvasShape).toEqual(original.project?.canvasShape);
    expect(useAppStore.getState().layers[0].alignment).toEqual({
      ...layer.alignment, fit: 'cover', offsetPx: { x: 9, y: 10 },
    });
    expect(useAppStore.getState().layers[0].name).toBe('Unrelated rename');
    expect(useAppStore.getState().layersNeedRecomposition).toBe(original.layersNeedRecomposition);
    const replacement = { ...original.project!, id: 'replacement-document' };
    useAppStore.setState({ project: replacement });
    await prepared.finalize?.();
    await prepared.compensate();
    expect(useAppStore.getState().project).toBe(replacement);
  });

  it('records full selection reset in the same crop transaction', async () => {
    const layer = createLayer(6, 4);
    primeStoreForCrop(layer, 6, 4);
    const mask = new ImageData(3, 2);
    mask.data[3] = 127;
    mask.data[7] = 255;
    useAppStore.setState({
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 4, y: 3 },
      selectionMask: mask,
      selectionMaskBounds: { x: 1, y: 1, width: 3, height: 2 },
      selectionMaskLayerId: layer.id,
      selectionVectorPath: { mode: 'freehand', points: [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 3 }] },
    });
    const before = selectionSnapshotFromState(useAppStore.getState());
    await useAppStore.getState().commitCrop();
    expect(historyManager.entries()).toHaveLength(1);
    const expectCleared = () => {
      const state = useAppStore.getState();
      expect([state.selectionStart, state.selectionEnd, state.selectionMask, state.selectionMaskBounds,
        state.selectionMaskLayerId, state.selectionVectorPath, state.selectionLastAction]).toEqual(Array(7).fill(null));
    };
    expectCleared();
    await historyManager.undo();
    expect([useAppStore.getState().project?.width, useAppStore.getState().project?.height]).toEqual([6, 4]);
    const restored = selectionSnapshotFromState(useAppStore.getState());
    expect({ ...restored, provenance: null }).toEqual(before);
    expect(restored.provenance?.restoredFromHistory).toBe(true);
    await historyManager.redo();
    expect([useAppStore.getState().project?.width, useAppStore.getState().project?.height]).toEqual([3, 2]);
    const after = useAppStore.getState();
    expect([after.selectionStart, after.selectionEnd, after.selectionMask, after.selectionMaskBounds,
      after.selectionMaskLayerId, after.selectionVectorPath]).toEqual(Array(6).fill(null));
  });

  it('crops the project and layer image data to the marquee bounds', async () => {
    const layer = createLayer(6, 4);
    primeStoreForCrop(layer, 6, 4);

    await useAppStore.getState().commitCrop();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const state = useAppStore.getState();

    expect(state.project?.width).toBe(3);
    expect(state.project?.height).toBe(2);

    const updatedLayer = state.layers[0];
    expect(updatedLayer.imageData).toBeDefined();
    expect(updatedLayer.imageData?.width).toBe(3);
    expect(updatedLayer.imageData?.height).toBe(2);

    const pixels = updatedLayer.imageData?.data ?? new Uint8ClampedArray();
    // First pixel should originate from original (1,1)
    expect(Array.from(pixels.slice(0, 4))).toEqual([1, 1, 0, 255]);
    // Last pixel corresponds to original (3,2)
    const finalIndex = (3 * 2 - 1) * 4;
    expect(Array.from(pixels.slice(finalIndex, finalIndex + 4))).toEqual([3, 2, 0, 255]);

    expect(state.canvas.offsetX).toBe(1);
    expect(state.canvas.offsetY).toBe(1);

    expect(state.crop.marquee).toBeNull();
    expect(state.crop.status).toBe('idle');
  });

  it('extends the canvas when the crop marquee exceeds the project bounds', async () => {
    const layer = createLayer(6, 4);
    primeStoreForCrop(layer, 6, 4, { x: -2, y: -1, width: 9, height: 6 });

    await useAppStore.getState().commitCrop();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const state = useAppStore.getState();
    expect(state.project?.width).toBe(9);
    expect(state.project?.height).toBe(6);

    const updatedLayer = state.layers[0];
    expect(updatedLayer.imageData?.width).toBe(9);
    expect(updatedLayer.imageData?.height).toBe(6);

    const pixels = updatedLayer.imageData?.data ?? new Uint8ClampedArray();
    const destOriginIndex = ((1 * 9) + 2) * 4;
    expect(Array.from(pixels.slice(destOriginIndex, destOriginIndex + 4))).toEqual([0, 0, 0, 255]);

    const blankPaddingIndex = ((1 * 9) + 0) * 4;
    expect(Array.from(pixels.slice(blankPaddingIndex, blankPaddingIndex + 4))).toEqual([0, 0, 0, 0]);

    expect(state.canvas.offsetX).toBe(-2);
    expect(state.canvas.offsetY).toBe(-1);
  });

  it('crops layer-owned objects and restores them through undo and redo', async () => {
    const layer = createLayer(6, 4);
    primeStoreForCrop(layer, 6, 4);
    const txtInside: TxtShape = {
      id: 'txt-inside',
      layerId: layer.id,
      x: 2,
      y: 1,
      width: 2,
      height: 2,
      content: 'inside',
      fontFamily: 'mek-mono',
      fontSize: 12,
      lineHeight: 1.2,
      textAlign: 'left',
      colorSource: 'manual',
      color: '#000000',
      selectionColor: '#ffffff',
      selectionBackgroundColor: '#000000',
      selections: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const txtOutside: TxtShape = {
      ...txtInside,
      id: 'txt-outside',
      x: 5,
      y: 3,
    };
    const uiInside: UiShape = {
      id: 'ui-inside',
      layerId: layer.id,
      x: 0,
      y: 0,
      width: 2,
      height: 2,
      gridSize: 1,
      theme: 'windows-3.1',
      drawMode: 'fill',
      regionKind: 'rectangle',
      componentKinds: [],
      colorSource: 'default',
      palette: { ...WINDOWS_31_UI_SHAPE_PALETTE },
      components: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const uiOutside: UiShape = {
      ...uiInside,
      id: 'ui-outside',
      x: 4,
      y: 3,
    };
    useAppStore.setState((state) => ({
      project: state.project
        ? {
            ...state.project,
            txtShapes: [txtInside, txtOutside],
            uiShapes: [uiInside, uiOutside],
          }
        : null,
    }));

    await useAppStore.getState().commitCrop();

    let project = useAppStore.getState().project;
    expect(project?.txtShapes).toEqual([
      expect.objectContaining({ id: txtInside.id, x: 1, y: 0 }),
    ]);
    expect(project?.uiShapes).toEqual([
      expect.objectContaining({ id: uiInside.id, x: -1, y: -1 }),
    ]);
    expect(historyManager.peekUndo()?.deltas.map((delta) => delta._tag)).toEqual(
      expect.arrayContaining(['txt-shapes', 'ui-shapes']),
    );

    await useAppStore.getState().undo();
    project = useAppStore.getState().project;
    expect(project?.txtShapes).toEqual([txtInside, txtOutside]);
    expect(project?.uiShapes).toEqual([uiInside, uiOutside]);

    await useAppStore.getState().redo();
    project = useAppStore.getState().project;
    expect(project?.txtShapes).toEqual([
      expect.objectContaining({ id: txtInside.id, x: 1, y: 0 }),
    ]);
    expect(project?.uiShapes).toEqual([
      expect.objectContaining({ id: uiInside.id, x: -1, y: -1 }),
    ]);
  });

  it('crops color-cycle layers and preserves their canvas bindings', async () => {
    const layer = createColorCycleLayer(6, 4);
    primeStoreForCrop(layer, 6, 4);

    await useAppStore.getState().commitCrop();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const state = useAppStore.getState();
    expect(state.project?.width).toBe(3);
    expect(state.project?.height).toBe(2);

    const updatedLayer = state.layers[0];
    expect(updatedLayer.layerType).toBe('color-cycle');
    expect(updatedLayer.imageData?.width).toBe(3);
    expect(updatedLayer.imageData?.height).toBe(2);
    expect(updatedLayer.colorCycleData?.canvas?.width).toBe(3);
    expect(updatedLayer.colorCycleData?.canvas?.height).toBe(2);
    expect(updatedLayer.colorCycleData?.gradient).toEqual(layer.colorCycleData?.gradient);

    const pixels = updatedLayer.imageData?.data ?? new Uint8ClampedArray();
    expect(Array.from(pixels.slice(0, 4))).toEqual([1, 1, 0, 255]);
  });

  it('crops cold color-cycle snapshots to the marquee bounds', async () => {
    const layer = createColorCycleLayer(6, 4);
    const snapshot = createImageData(6, 4);
    layer.colorCycleData = {
      ...layer.colorCycleData,
      runtimeHydrationState: 'cold',
      canvasImageData: snapshot,
      canvasWidth: 6,
      canvasHeight: 4,
    };
    primeStoreForCrop(layer, 6, 4);

    await useAppStore.getState().commitCrop();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updatedLayer = useAppStore.getState().layers[0];
    const snapshotAfter = updatedLayer.colorCycleData?.canvasImageData;
    const pixels = snapshotAfter?.data ?? new Uint8ClampedArray();

    expect(snapshotAfter?.width).toBe(3);
    expect(snapshotAfter?.height).toBe(2);
    expect(updatedLayer.colorCycleData?.canvasWidth).toBe(3);
    expect(updatedLayer.colorCycleData?.canvasHeight).toBe(2);
    expect(Array.from(pixels.slice(0, 4))).toEqual([1, 1, 0, 255]);
  });

  it('crops color-cycle masks to the marquee bounds', async () => {
    const layer = createColorCycleLayer(6, 4);
    const eraseMask = document.createElement('canvas');
    eraseMask.width = 6;
    eraseMask.height = 4;
    const eraseCtx = eraseMask.getContext('2d');
    eraseCtx!.fillStyle = 'rgba(255, 255, 255, 1)';
    eraseCtx!.fillRect(1, 1, 1, 1);
    const eraseMaskImageData = eraseCtx!.getImageData(0, 0, 6, 4);
    layer.colorCycleData = {
      ...layer.colorCycleData,
      eraseMask,
      eraseMaskImageData,
      eraseMaskVersion: 2,
    };
    primeStoreForCrop(layer, 6, 4);

    await useAppStore.getState().commitCrop();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updatedLayer = useAppStore.getState().layers[0];
    const croppedMask = updatedLayer.colorCycleData?.eraseMask;
    const croppedMaskImageData = updatedLayer.colorCycleData?.eraseMaskImageData;
    const maskPixel = croppedMask?.getContext('2d')?.getImageData(0, 0, 1, 1).data;
    const imageDataPixel = croppedMaskImageData?.data.slice(0, 4);

    expect(croppedMask?.width).toBe(3);
    expect(croppedMask?.height).toBe(2);
    expect(croppedMaskImageData?.width).toBe(3);
    expect(croppedMaskImageData?.height).toBe(2);
    expect(updatedLayer.colorCycleData?.eraseMaskVersion).toBe(3);
    expect(Array.from(maskPixel ?? [])).toEqual([255, 255, 255, 255]);
    expect(Array.from(imageDataPixel ?? [])).toEqual([255, 255, 255, 255]);
  });

  it('rebinds color-cycle brushes to the cropped canvas dimensions', async () => {
    const layer = createColorCycleLayer(6, 4);
    primeStoreForCrop(layer, 6, 4);

    await useAppStore.getState().commitCrop();
    await new Promise((resolve) => setTimeout(resolve, 25));

    const state = useAppStore.getState();
    const updatedLayer = state.layers[0];
    const brush = updatedLayer.colorCycleData?.colorCycleBrush;
    const brushCanvas = brush?.getCanvas?.();

    expect(brush).toBeDefined();
    expect(brushCanvas?.width).toBe(3);
    expect(brushCanvas?.height).toBe(2);
    expect(updatedLayer.colorCycleData?.canvas).toBe(brushCanvas);

    const brushCtx = brushCanvas?.getContext('2d');
    const pixelSample = brushCtx?.getImageData(0, 0, 1, 1);
    expect(Array.from(pixelSample?.data ?? [])).toEqual([1, 1, 0, 255]);
  });

  it('preserves color-cycle animation buffers after cropping', async () => {
    const layer = createColorCycleLayer(6, 4);
    primeStoreForCrop(layer, 6, 4);

    useAppStore.getState().initColorCycleForLayer(layer.id, 6, 4);
    const brush = getColorCycleBrushManager().getBrush(layer.id);
    expect(brush).toBeDefined();

    const paint = new Uint8Array(24).fill(1);
    const gradientIds = Uint8Array.from({ length: 24 }, (_, idx) => idx);
    const gradientDefIds = Uint16Array.from({ length: 24 }, (_, idx) => idx + 100);
    const speed = new Uint8Array(24).fill(12);
    const flow = Uint8Array.from({ length: 24 }, (_, idx) => idx + 20);
    const phase = Uint8Array.from({ length: 24 }, (_, idx) => idx + 40);

    if (brush) applyColorCycleBrushLayerSnapshotToRuntime(brush, layer.id, {
      paintBuffer: paint.buffer.slice(0),
      gradientIdBuffer: gradientIds.buffer.slice(0),
      gradientDefIdBuffer: gradientDefIds.buffer.slice(0),
      speedBuffer: speed.buffer.slice(0),
      flowBuffer: flow.buffer.slice(0),
      phaseBuffer: phase.buffer.slice(0),
      hasContent: true,
      strokeCounter: 3
    });

    const original = readTestColorCycleBrushLayerSnapshot(brush, layer.id);
    await useAppStore.getState().commitCrop();

    const updatedLayer = useAppStore.getState().layers[0];
    const updatedBrush = updatedLayer.colorCycleData?.colorCycleBrush;
    const snapshot = readTestColorCycleBrushLayerSnapshot(updatedBrush, layer.id);

    expect(snapshot?.paintBuffer).toBeDefined();
    expect(snapshot?.gradientIdBuffer).toBeDefined();
    expect(snapshot?.gradientDefIdBuffer).toBeDefined();
    expect(snapshot?.flowBuffer).toBeDefined();
    expect(snapshot?.phaseBuffer).toBeDefined();
    expect(snapshot?.hasContent).toBe(true);

    expect(Array.from(new Uint8Array(snapshot?.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual([
      7, 8, 9,
      13, 14, 15,
    ]);
    expect(Array.from(new Uint16Array(snapshot?.gradientDefIdBuffer ?? new ArrayBuffer(0)))).toEqual([
      107, 108, 109,
      113, 114, 115,
    ]);
    expect(Array.from(new Uint8Array(snapshot?.flowBuffer ?? new ArrayBuffer(0)))).toEqual([
      27, 28, 29,
      33, 34, 35,
    ]);
    expect(Array.from(new Uint8Array(snapshot?.phaseBuffer ?? new ArrayBuffer(0)))).toEqual([
      47, 48, 49,
      53, 54, 55,
    ]);
    expect(historyManager.entries()).toHaveLength(1);
    const read = () => getColorCycleBrushManager().getDocument(layer.id)?.read().snapshot;
    const fields = ['paintBuffer', 'gradientIdBuffer', 'gradientDefIdBuffer', 'speedBuffer', 'flowBuffer', 'phaseBuffer'] as const;
    await historyManager.undo();
    expect([read()?.width, read()?.height]).toEqual([6, 4]);
    for (const field of fields) expect(read()?.[field]).toEqual(original?.[field]);
    await historyManager.redo();
    expect([read()?.width, read()?.height]).toEqual([3, 2]);
    for (const field of fields) expect(read()?.[field]).toEqual(snapshot?.[field]);
  });

  it('does not preserve phantom color-cycle content when the crop region is empty', async () => {
    const layer = createColorCycleLayer(6, 4);
    const ccCanvas = layer.colorCycleData?.canvas;
    const ccCtx = ccCanvas?.getContext('2d');
    ccCtx?.clearRect(0, 0, 6, 4);
    ccCtx!.fillStyle = 'rgba(255, 0, 0, 1)';
    ccCtx?.fillRect(0, 0, 1, 1);
    layer.imageData = ccCtx?.getImageData(0, 0, 6, 4) ?? layer.imageData;
    primeStoreForCrop(layer, 6, 4);

    useAppStore.getState().initColorCycleForLayer(layer.id, 6, 4);
    const brush = getColorCycleBrushManager().getBrush(layer.id);
    expect(brush).toBeDefined();

    const paint = new Uint8Array(24);
    const gradientIds = new Uint8Array(24);
    const gradientDefIds = new Uint16Array(24);
    const speed = new Uint8Array(24);
    const flow = new Uint8Array(24);
    const phase = new Uint8Array(24);
    paint[0] = 1;
    gradientIds[0] = 1;
    gradientDefIds[0] = 1;
    speed[0] = 1;
    flow[0] = 1;
    phase[0] = 1;

    if (brush) applyColorCycleBrushLayerSnapshotToRuntime(brush, layer.id, {
      paintBuffer: paint.buffer.slice(0),
      gradientIdBuffer: gradientIds.buffer.slice(0),
      gradientDefIdBuffer: gradientDefIds.buffer.slice(0),
      speedBuffer: speed.buffer.slice(0),
      flowBuffer: flow.buffer.slice(0),
      phaseBuffer: phase.buffer.slice(0),
      hasContent: true,
      strokeCounter: 4
    });

    await useAppStore.getState().commitCrop();
    await new Promise((resolve) => setTimeout(resolve, 25));

    const updatedLayer = useAppStore.getState().layers[0];
    const updatedBrush = updatedLayer.colorCycleData?.colorCycleBrush;
    const snapshot = readTestColorCycleBrushLayerSnapshot(updatedBrush, layer.id);

    expect(snapshot?.paintBuffer).toBeDefined();
    expect(snapshot?.hasContent).toBe(false);
    expect(new Uint8Array(snapshot?.paintBuffer ?? new ArrayBuffer(0)).some((value) => value !== 0)).toBe(false);
    expect(updatedLayer.imageData?.data.some((value, index) => index % 4 === 3 && value !== 0)).toBe(false);
  });

  it('keeps cropped color-cycle bitmap pixels when cropped canonical buffers are empty', async () => {
    const layer = createColorCycleLayer(6, 4);
    primeStoreForCrop(layer, 6, 4);

    useAppStore.getState().initColorCycleForLayer(layer.id, 6, 4);
    const brush = getColorCycleBrushManager().getBrush(layer.id);
    expect(brush).toBeDefined();

    const paint = new Uint8Array(24);
    const gradientIds = new Uint8Array(24);
    const gradientDefIds = new Uint16Array(24);
    const speed = new Uint8Array(24);
    const flow = new Uint8Array(24);
    const phase = new Uint8Array(24);
    paint[0] = 1;
    gradientIds[0] = 1;
    gradientDefIds[0] = 1;
    speed[0] = 1;
    flow[0] = 1;
    phase[0] = 1;

    if (brush) applyColorCycleBrushLayerSnapshotToRuntime(brush, layer.id, {
      paintBuffer: paint.buffer.slice(0),
      gradientIdBuffer: gradientIds.buffer.slice(0),
      gradientDefIdBuffer: gradientDefIds.buffer.slice(0),
      speedBuffer: speed.buffer.slice(0),
      flowBuffer: flow.buffer.slice(0),
      phaseBuffer: phase.buffer.slice(0),
      hasContent: true,
      strokeCounter: 5
    });

    await useAppStore.getState().commitCrop();
    await new Promise((resolve) => setTimeout(resolve, 25));

    const updatedLayer = useAppStore.getState().layers[0];
    const updatedBrush = updatedLayer.colorCycleData?.colorCycleBrush;
    const brushCanvas = updatedLayer.colorCycleData?.canvas;
    const snapshot = readTestColorCycleBrushLayerSnapshot(updatedBrush, layer.id);

    expect(snapshot?.hasContent).toBe(false);
    expect(new Uint8Array(snapshot?.paintBuffer ?? new ArrayBuffer(0)).some((value) => value !== 0)).toBe(false);

    updatedBrush?.renderDirectToCanvas?.(brushCanvas as HTMLCanvasElement, layer.id);
    const pixelSample = brushCanvas?.getContext('2d')?.getImageData(0, 0, 1, 1);
    expect(Array.from(pixelSample?.data ?? [])).toEqual([1, 1, 0, 255]);
  });

  it('restores color-cycle gradient slot runtime metadata after cropping', async () => {
    const layer = createColorCycleLayer(6, 4);
    primeStoreForCrop(layer, 6, 4);

    useAppStore.getState().initColorCycleForLayer(layer.id, 6, 4);
    const brush = getColorCycleBrushManager().getBrush(layer.id);
    expect(brush).toBeDefined();

    useAppStore.setState((state) => ({
      layers: state.layers.map((candidate) =>
        candidate.id === layer.id && candidate.colorCycleData
          ? {
              ...candidate,
              colorCycleData: {
                ...candidate.colorCycleData,
                gradientDefs: [
                  { id: 'g0', name: 'Base', currentSlot: 2 },
                  { id: 'g1', name: 'Accent', currentSlot: 5 },
                ],
                gradientDefStore: [
                  {
                    id: 101,
                    kind: 'linear',
                    stops: [
                      { position: 0, color: '#110000' },
                      { position: 1, color: '#220000' },
                    ],
                    hash: 'base',
                    source: 'manual',
                    createdAtMs: 1,
                    slot: 2,
                  },
                  {
                    id: 102,
                    kind: 'linear',
                    stops: [
                      { position: 0, color: '#001100' },
                      { position: 1, color: '#002200' },
                    ],
                    hash: 'accent',
                    source: 'manual',
                    createdAtMs: 2,
                    slot: 5,
                  },
                ],
                slotPalettes: [
                  {
                    slot: 2,
                    stops: [
                      { position: 0, color: '#110000' },
                      { position: 1, color: '#220000' },
                    ],
                  },
                  {
                    slot: 5,
                    stops: [
                      { position: 0, color: '#001100' },
                      { position: 1, color: '#002200' },
                    ],
                  },
                ],
                activeGradientId: 'g1',
                paintSlot: 5,
                legacyRemap: { from: 63, to: 5 },
              },
            }
          : candidate
      ),
    }));
    brush?.setActiveGradientSlot?.(layer.id, 5);

    await useAppStore.getState().commitCrop();
    await new Promise((resolve) => setTimeout(resolve, 25));

    const updatedBrush = getColorCycleBrushManager().getBrush(layer.id);
    expect(updatedBrush?.getActiveGradientSlot?.(layer.id)).toBe(5);
  });

  it('restores color-cycle brush animation state after cropping', async () => {
    const layer = createColorCycleLayer(6, 4);
    primeStoreForCrop(layer, 6, 4);

    const storeBefore = useAppStore.getState();
    storeBefore.initColorCycleForLayer(layer.id, 6, 4);

    const initialBrush = getColorCycleBrushManager().getBrush(layer.id);
    initialBrush?.setActiveLayer?.(layer.id);
    if (initialBrush) applyColorCycleBrushLayerSnapshotToRuntime(initialBrush, layer.id, {
      paintBuffer: new Uint8Array(24).fill(1).buffer,
      hasContent: true,
      strokeCounter: 1,
    });
    initialBrush?.startAnimation();

    useAppStore.setState((state) => ({
      layers: state.layers.map((l) =>
        l.id === layer.id && l.colorCycleData
          ? {
              ...l,
              colorCycleData: {
                ...l.colorCycleData,
                isAnimating: true,
                brushSpeed: 0.33
              }
            }
          : l
      )
    }));

    await useAppStore.getState().commitCrop();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const state = useAppStore.getState();
    const updatedLayer = state.layers[0];
    const restoredBrush = getColorCycleBrushManager().getBrush(layer.id);

    expect(updatedLayer.colorCycleData?.brushSpeed).toBeCloseTo(0.33);
    expect(updatedLayer.colorCycleData?.isAnimating).toBe(true);
    expect(restoredBrush?.isPlaying?.()).toBe(true);
  });

  it('rebuilds recolor color-cycle data after cropping', async () => {
    const layer = createRecolorLayer(6, 4);
    primeStoreForCrop(layer, 6, 4);

    const restoreLayerMock = jest.fn().mockResolvedValue(true);
    jest.spyOn(RecolorManager, 'getInstance').mockReturnValue({
      restoreLayer: restoreLayerMock
    } as unknown as RecolorManager);

    await useAppStore.getState().commitCrop();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const state = useAppStore.getState();
    const updatedLayer = state.layers[0];

    expect(updatedLayer.imageData?.width).toBe(3);
    expect(updatedLayer.imageData?.height).toBe(2);

    const recolorSettings = updatedLayer.colorCycleData?.recolorSettings;
    expect(recolorSettings?.originalImageData?.width).toBe(3);
    expect(recolorSettings?.originalImageData?.height).toBe(2);

    expect(restoreLayerMock).toHaveBeenCalledTimes(1);
    const [passedLayer] = restoreLayerMock.mock.calls[0];
    expect(passedLayer.id).toBe(updatedLayer.id);
    expect(passedLayer.colorCycleData.recolorSettings.cycleColors).toBe(16);
    expect(passedLayer.colorCycleData.recolorSettings.gradient).toEqual([
      { position: 0, color: '#ff0000' },
      { position: 1, color: '#00ff00' }
    ]);
  });

  it.each([
    { x: 1, y: 1, width: 3, height: 2 },
    { x: -2, y: -1, width: 8, height: 6 },
    { x: 1, y: 0, width: 6, height: 4 },
  ])('projects complete indexed Recolor state and replays it exactly for %j', async (rect) => {
    const layer = createRecolorLayer(6, 4);
    const settings = layer.colorCycleData!.recolorSettings!;
    settings.indexBuffer = Uint8Array.from({ length: 24 }, (_, index) => index + 1);
    settings.phaseMap = Uint8Array.from({ length: 24 }, (_, index) => index * 3);
    settings.indexPhaseMap = new Uint8Array([14, 28, 42]);
    settings.palette = new Uint32Array([0, 0xff332211, 0xff665544]);
    settings.colorMap = new Map([[0x332211, 1], [0x665544, 2]]);
    settings.quantizationMode = 'oklab-median-cut';
    settings.ditherMode = 'bayer4';
    settings.animation.currentTick = 7.25;
    const before = cloneRecolorSettings(settings)!;
    // Derived pixels deliberately differ from the source to exercise the 2D readback path.
    layer.colorCycleData!.canvas!.getContext('2d')!.fillRect(0, 0, 6, 4);
    primeStoreForCrop(layer, 6, 4, rect);
    const restoreLayer = jest.fn().mockResolvedValue(true);
    jest.spyOn(RecolorManager, 'getInstance').mockReturnValue({ restoreLayer } as unknown as RecolorManager);

    await useAppStore.getState().commitCrop();
    const after = cloneRecolorSettings(useAppStore.getState().layers[0].colorCycleData!.recolorSettings)!;
    expect(after.animation).toEqual(before.animation);
    expect(after.gradient).toEqual(before.gradient);
    expect(after.palette).toEqual(before.palette);
    expect(after.colorMap).toEqual(before.colorMap);
    expect(after.indexPhaseMap).toEqual(before.indexPhaseMap);
    expect(after.quantizationMode).toBe(before.quantizationMode);
    expect(after.ditherMode).toBe(before.ditherMode);
    expect(after.originalImageData!.width).toBe(rect.width);
    expect(after.originalImageData!.height).toBe(rect.height);
    for (let y = 0; y < rect.height; y += 1) {
      for (let x = 0; x < rect.width; x += 1) {
        const inside = x + rect.x >= 0 && y + rect.y >= 0 && x + rect.x < 6 && y + rect.y < 4;
        const source = (y + rect.y) * 6 + x + rect.x;
        const target = y * rect.width + x;
        expect(after.indexBuffer![target]).toBe(inside ? before.indexBuffer![source] : 0);
        expect(after.phaseMap![target]).toBe(inside ? before.phaseMap![source] : 0);
        expect(Array.from(after.originalImageData!.data.slice(target * 4, target * 4 + 4)))
          .toEqual(inside ? Array.from(before.originalImageData!.data.slice(source * 4, source * 4 + 4)) : [0, 0, 0, 0]);
      }
    }
    await historyManager.undo();
    expect(useAppStore.getState().layers[0].colorCycleData!.recolorSettings).toEqual(before);
    expect(useAppStore.getState().project).toMatchObject({ width: 6, height: 4 });
    await historyManager.redo();
    expect(useAppStore.getState().layers[0].colorCycleData!.recolorSettings).toEqual(after);
    expect(useAppStore.getState().project).toMatchObject({ width: rect.width, height: rect.height });
    expect(restoreLayer).toHaveBeenCalledTimes(3);
  });

  it('restores indexed Recolor settings and the real renderer after admitted storage failure', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const layer = createRecolorLayer(6, 4);
    layer.id = 'crop-recolor-rollback';
    const settings = layer.colorCycleData!.recolorSettings!;
    settings.indexBuffer = Uint8Array.from({ length: 24 }, (_, index) => 1 + index % 2);
    settings.palette = new Uint32Array([0, 0xff332211, 0xff665544]);
    settings.phaseMap = Uint8Array.from({ length: 24 }, (_, index) => index * 3);
    settings.indexPhaseMap = new Uint8Array([14, 28, 42]);
    settings.colorMap = new Map([[0x332211, 1], [0x665544, 2]]);
    primeStoreForCrop(layer, 6, 4, { x: 1, y: 0, width: 6, height: 4 });
    const manager = RecolorManager.getInstance();
    expect(await manager.restoreLayer(layer)).toBe(true);
    const restore = jest.spyOn(manager, 'restoreLayer');
    const before = cloneRecolorSettings(layer.colorCycleData!.recolorSettings);
    const pixels = layer.imageData!.data.slice();
    jest.spyOn(historyBlobs, 'storeBlob').mockRejectedValueOnce(new Error('Recolor history allocation failed'));
    await useAppStore.getState().commitCrop();
    const failed = useAppStore.getState();
    expect(failed.layers[0].colorCycleData!.recolorSettings).toEqual(before);
    expect(failed.layers[0].imageData!.data).toEqual(pixels);
    expect(failed.project).toMatchObject({ width: 6, height: 4 });
    expect(failed.crop.marquee).toEqual({ x: 1, y: 0, width: 6, height: 4 });
    expect(historyManager.entries()).toHaveLength(0);
    expect(restore).toHaveBeenCalledTimes(2);
    expect(restore.mock.calls[1][0].colorCycleData!.recolorSettings!.originalImageData!.width).toBe(6);
  });

  it('preserves Recolor settings edited during pending storage and restores spatial data before rerendering', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const layer = createRecolorLayer(6, 4);
    layer.id = 'crop-recolor-pending-settings';
    const settings = layer.colorCycleData!.recolorSettings!;
    settings.indexBuffer = Uint8Array.from({ length: 24 }, (_, index) => 1 + index % 2);
    settings.palette = new Uint32Array([0, 0xff332211, 0xff665544]);
    settings.phaseMap = Uint8Array.from({ length: 24 }, (_, index) => index * 3);
    primeStoreForCrop(layer, 6, 4, { x: 1, y: 0, width: 6, height: 4 });
    const manager = RecolorManager.getInstance();
    expect(await manager.restoreLayer(layer)).toBe(true);
    const restore = jest.spyOn(manager, 'restoreLayer');
    const before = cloneRecolorSettings(layer.colorCycleData!.recolorSettings)!;
    const originalPixels = layer.imageData!.data.slice();
    let rejectStorage!: (error: Error) => void;
    let storageReached!: () => void;
    const reached = new Promise<void>((resolve) => { storageReached = resolve; });
    jest.spyOn(historyBlobs, 'storeBlob').mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectStorage = reject;
      storageReached();
    }));
    const pending = useAppStore.getState().commitCrop();
    await reached;
    const current = useAppStore.getState().layers[0];
    const gradient = [{ position: 0, color: '#1040ff' }, { position: 1, color: '#1040ff' }];
    const updatedSettings = {
      ...current.colorCycleData!.recolorSettings!,
      gradient, cycleColors: 8, mappingMode: 'continuous' as const,
      animation: { ...current.colorCycleData!.recolorSettings!.animation, speed: 0.35, flowDirection: 'reverse' as const },
    };
    useAppStore.getState().updateLayer(current.id, { colorCycleData: { ...current.colorCycleData, recolorSettings: updatedSettings } });
    rejectStorage(new Error('deferred Recolor history allocation failed'));
    await pending;
    const restored = useAppStore.getState().layers[0];
    const result = restored.colorCycleData!.recolorSettings!;
    expect(result).toMatchObject({ gradient, cycleColors: 8, mappingMode: 'continuous', animation: { speed: 0.35, flowDirection: 'reverse' } });
    expect(result.originalImageData).toEqual(before.originalImageData);
    expect(result.indexBuffer).toEqual(before.indexBuffer);
    expect(result.phaseMap).toEqual(before.phaseMap);
    expect(restore).toHaveBeenCalledTimes(2);
    const rerendered = restore.mock.calls[1][0];
    expect(rerendered.colorCycleData!.recolorSettings).toMatchObject({
      gradient, originalImageData: { width: 6, height: 4 }, animation: { speed: 0.35 },
    });
    expect(restored.imageData!.data).toEqual(rerendered.imageData!.data);
    expect(restored.imageData!.data).not.toEqual(originalPixels);
    expect(historyManager.entries()).toHaveLength(0);
    expect(useAppStore.getState().crop.marquee).toEqual({ x: 1, y: 0, width: 6, height: 4 });
  });

  it('records crop actions in history with crop actionType', async () => {
    const layer = createLayer(5, 5);
    primeStoreForCrop(layer, 5, 5);

    const store = useAppStore.getState();
    const beforeCount = historyManager.entries().length;

    await store.commitCrop();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const entries = historyManager.entries();
    expect(entries.length).toBeGreaterThan(beforeCount);
    const lastEntry = entries[entries.length - 1];
    expect(lastEntry.action).toBe('crop');
    expect(lastEntry.label).toBe('Crop to selection');
  });

  it('resizes layer content instead of only changing document bounds', async () => {
    const layer = createLayer(2, 2);
    primeStoreForResize(layer, 2, 2);
    useAppStore.setState((state) => ({
      project: state.project
        ? { ...state.project, canvasShape: createDefaultCanvasShape(2, 2) }
        : null,
    }));

    await useAppStore.getState().resizeCanvas(4, 4);

    const state = useAppStore.getState();
    const updatedLayer = state.layers[0];
    const pixels = updatedLayer.imageData?.data ?? new Uint8ClampedArray();
    const pixelAt = (x: number, y: number) => {
      const index = (y * 4 + x) * 4;
      return Array.from(pixels.slice(index, index + 4));
    };

    expect(state.project?.width).toBe(4);
    expect(state.project?.height).toBe(4);
    expect(state.project?.canvasShape).toEqual(createDefaultCanvasShape(4, 4));
    expect(updatedLayer.imageData?.width).toBe(4);
    expect(updatedLayer.imageData?.height).toBe(4);
    expect(pixelAt(0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixelAt(3, 0)).toEqual([1, 0, 0, 255]);
    expect(pixelAt(0, 3)).toEqual([0, 1, 0, 255]);
    expect(pixelAt(3, 3)).toEqual([1, 1, 0, 255]);
  });

  it('resizes recolor source image data with the document', async () => {
    const layer = createRecolorLayer(2, 2);
    primeStoreForResize(layer, 2, 2);

    await useAppStore.getState().resizeCanvas(4, 4);

    const updatedLayer = useAppStore.getState().layers[0];
    const originalImage = updatedLayer.colorCycleData?.recolorSettings?.originalImageData;
    const pixels = originalImage?.data ?? new Uint8ClampedArray();
    const bottomRightIndex = (4 * 4 - 1) * 4;

    expect(originalImage?.width).toBe(4);
    expect(originalImage?.height).toBe(4);
    expect(Array.from(pixels.slice(bottomRightIndex, bottomRightIndex + 4))).toEqual([1, 1, 0, 255]);
    expect(updatedLayer.colorCycleData?.recolorSettings?.indexBuffer).toBeUndefined();
    expect(updatedLayer.colorCycleData?.canvasWidth).toBe(4);
    expect(updatedLayer.colorCycleData?.canvasHeight).toBe(4);
  });

  it('resizes color-cycle runtime buffers with the document', async () => {
    const layer = createColorCycleLayer(2, 2);
    primeStoreForResize(layer, 2, 2);

    useAppStore.getState().initColorCycleForLayer(layer.id, 2, 2);
    const brush = getColorCycleBrushManager().getBrush(layer.id);
    if (brush) applyColorCycleBrushLayerSnapshotToRuntime(brush, layer.id, {
      paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
      gradientIdBuffer: Uint8Array.from([11, 12, 13, 14]).buffer,
      gradientDefIdBuffer: Uint16Array.from([101, 102, 103, 104]).buffer,
      speedBuffer: Uint8Array.from([21, 22, 23, 24]).buffer,
      flowBuffer: Uint8Array.from([31, 32, 33, 34]).buffer,
      phaseBuffer: Uint8Array.from([41, 42, 43, 44]).buffer,
      hasContent: true,
      strokeCounter: 7,
    });

    await useAppStore.getState().resizeCanvas(4, 4);

    const updatedLayer = useAppStore.getState().layers[0];
    const updatedBrush = getColorCycleBrushManager().getBrush(layer.id);
    const snapshot = readTestColorCycleBrushLayerSnapshot(updatedBrush, layer.id);

    expect(updatedLayer.colorCycleData?.canvas?.width).toBe(4);
    expect(updatedLayer.colorCycleData?.canvas?.height).toBe(4);
    expect(updatedBrush?.getCanvas?.().width).toBe(4);
    expect(updatedBrush?.getCanvas?.().height).toBe(4);
    expect(Array.from(new Uint8Array(snapshot?.paintBuffer ?? new ArrayBuffer(0)))).toEqual([
      1, 1, 2, 2,
      1, 1, 2, 2,
      3, 3, 4, 4,
      3, 3, 4, 4,
    ]);
    expect(Array.from(new Uint8Array(snapshot?.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual([
      11, 11, 12, 12,
      11, 11, 12, 12,
      13, 13, 14, 14,
      13, 13, 14, 14,
    ]);
    expect(Array.from(new Uint16Array(snapshot?.gradientDefIdBuffer ?? new ArrayBuffer(0)))).toEqual([
      101, 101, 102, 102,
      101, 101, 102, 102,
      103, 103, 104, 104,
      103, 103, 104, 104,
    ]);
    expect(Array.from(new Uint8Array(snapshot?.phaseBuffer ?? new ArrayBuffer(0)))).toEqual([
      41, 41, 42, 42,
      41, 41, 42, 42,
      43, 43, 44, 44,
      43, 43, 44, 44,
    ]);
  });

  it('resizes a resident color-cycle document after its runtime is retired', async () => {
    const manager = getColorCycleBrushManager();
    const layer = createColorCycleLayer(2, 2);
    layer.id = 'resize-cold-document-layer';
    layer.colorCycleData = {
      ...layer.colorCycleData,
      hasContent: true,
    };
    manager.deleteBrush(layer.id);
    primeStoreForResize(layer, 2, 2);

    useAppStore.getState().initColorCycleForLayer(layer.id, 2, 2);
    const brush = manager.getBrush(layer.id);
    if (brush) applyColorCycleBrushLayerSnapshotToRuntime(brush, layer.id, {
      paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
      gradientIdBuffer: Uint8Array.from([11, 12, 13, 14]).buffer,
      gradientDefIdBuffer: Uint16Array.from([101, 102, 103, 104]).buffer,
      speedBuffer: Uint8Array.from([21, 22, 23, 24]).buffer,
      flowBuffer: Uint8Array.from([31, 32, 33, 34]).buffer,
      phaseBuffer: Uint8Array.from([41, 42, 43, 44]).buffer,
      hasContent: true,
      strokeCounter: 7,
    });
    const documentBeforeResize = manager.getDocument(layer.id);
    manager.discardRuntimeRetainingDocument(layer.id);

    expect(manager.getBrush(layer.id)).toBeUndefined();
    expect(manager.getDocument(layer.id)).toBe(documentBeforeResize);

    await useAppStore.getState().resizeCanvas(4, 4);

    const documentAfterResize = manager.getDocument(layer.id)?.read().snapshot;
    expect(documentAfterResize?.width).toBe(4);
    expect(documentAfterResize?.height).toBe(4);
    expect(Array.from(new Uint8Array(documentAfterResize?.paintBuffer ?? new ArrayBuffer(0)))).toEqual([
      1, 1, 2, 2,
      1, 1, 2, 2,
      3, 3, 4, 4,
      3, 3, 4, 4,
    ]);
    expect(Array.from(new Uint8Array(documentAfterResize?.phaseBuffer ?? new ArrayBuffer(0)))).toEqual([
      41, 41, 42, 42,
      41, 41, 42, 42,
      43, 43, 44, 44,
      43, 43, 44, 44,
    ]);
    expect(manager.getBrush(layer.id)).toBeUndefined();
    manager.deleteBrush(layer.id);
  });

  it('rolls back the color-cycle document when runtime resize rendering fails', async () => {
    const manager = getColorCycleBrushManager();
    const layer = createColorCycleLayer(2, 2);
    layer.id = 'resize-runtime-rollback-layer';
    manager.deleteBrush(layer.id);
    primeStoreForResize(layer, 2, 2);

    useAppStore.getState().initColorCycleForLayer(layer.id, 2, 2);
    const brush = manager.getBrush(layer.id);
    if (brush) applyColorCycleBrushLayerSnapshotToRuntime(brush, layer.id, {
      paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
      gradientIdBuffer: Uint8Array.from([11, 12, 13, 14]).buffer,
      gradientDefIdBuffer: Uint16Array.from([101, 102, 103, 104]).buffer,
      speedBuffer: Uint8Array.from([21, 22, 23, 24]).buffer,
      flowBuffer: Uint8Array.from([31, 32, 33, 34]).buffer,
      phaseBuffer: Uint8Array.from([41, 42, 43, 44]).buffer,
      hasContent: true,
      strokeCounter: 7,
    });
    if (!brush) {
      throw new Error('Expected color-cycle brush runtime');
    }
    jest.spyOn(brush, 'renderDirectToCanvas').mockImplementation(() => {
      throw new Error('forced resize render failure');
    });

    await expect(useAppStore.getState().resizeCanvas(4, 4)).rejects.toThrow(
      'forced resize render failure',
    );

    const restoredDocument = manager.getDocument(layer.id)?.read().snapshot;
    const restoredLayer = useAppStore.getState().layers[0];
    expect(useAppStore.getState().project?.width).toBe(2);
    expect(useAppStore.getState().project?.height).toBe(2);
    expect(restoredDocument?.width).toBe(2);
    expect(restoredDocument?.height).toBe(2);
    expect(Array.from(new Uint8Array(restoredDocument?.paintBuffer ?? new ArrayBuffer(0)))).toEqual([
      1, 2, 3, 4,
    ]);
    expect(restoredLayer.colorCycleData?.canvas?.width).toBe(2);
    expect(restoredLayer.colorCycleData?.canvas?.height).toBe(2);
    manager.deleteBrush(layer.id);
  });

  it('keeps static-preview color-cycle resize history raster-only', async () => {
    const manager = getColorCycleBrushManager();
    const layer = createColorCycleLayer(2, 2);
    layer.id = 'resize-static-preview-layer';
    layer.colorCycleData = {
      ...layer.colorCycleData,
      runtimeHydrationState: 'cold',
      repairStatus: {
        ok: false,
        reason: 'missing-paint-buffer',
        notes: ['static-preview-only'],
      },
    };
    manager.deleteBrush(layer.id);
    primeStoreForResize(layer, 2, 2);

    await useAppStore.getState().resizeCanvas(4, 4);
    expect(historyManager.peekUndo()?.deltas.map((delta) => delta._tag)).not.toContain(
      'color-cycle-stroke',
    );

    await useAppStore.getState().undo();

    const restoredLayer = useAppStore.getState().layers[0];
    expect(useAppStore.getState().project?.width).toBe(2);
    expect(restoredLayer.imageData?.width).toBe(2);
    expect(restoredLayer.imageData?.height).toBe(2);
    expect(restoredLayer.framebuffer?.width).toBe(2);
    expect(restoredLayer.framebuffer?.height).toBe(2);
    expect(Array.from(restoredLayer.imageData?.data ?? [])).toEqual(
      Array.from(layer.imageData?.data ?? []),
    );
    expect(manager.getDocument(layer.id)).toBeUndefined();
  });

  it('undoes and redoes color-cycle resize dimensions and canonical buffers', async () => {
    const manager = getColorCycleBrushManager();
    const layer = {
      ...createColorCycleLayer(2, 2),
      id: 'resize-history-cc-layer',
    };
    manager.deleteBrush(layer.id);
    primeStoreForResize(layer, 2, 2);

    useAppStore.getState().initColorCycleForLayer(layer.id, 2, 2);
    const brush = manager.getBrush(layer.id);
    if (brush) applyColorCycleBrushLayerSnapshotToRuntime(brush, layer.id, {
      paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
      gradientIdBuffer: Uint8Array.from([11, 12, 13, 14]).buffer,
      gradientDefIdBuffer: Uint16Array.from([101, 102, 103, 104]).buffer,
      speedBuffer: Uint8Array.from([21, 22, 23, 24]).buffer,
      flowBuffer: Uint8Array.from([31, 32, 33, 34]).buffer,
      phaseBuffer: Uint8Array.from([41, 42, 43, 44]).buffer,
      hasContent: true,
      strokeCounter: 7,
    });
    const beforeResizeRead = manager.getDocument(layer.id)?.read();

    await useAppStore.getState().resizeCanvas(4, 4);
    const afterResizeRead = manager.getDocument(layer.id)?.read();
    expect(historyManager.peekUndo()?.deltas.map((delta) => delta._tag)).toContain(
      'color-cycle-stroke',
    );
    await useAppStore.getState().undo();

    let documentRead = manager.getDocument(layer.id)?.read();
    let snapshot = documentRead?.snapshot;
    let updatedLayer = useAppStore.getState().layers[0];
    expect(useAppStore.getState().project?.width).toBe(2);
    expect({
      document: [snapshot?.width, snapshot?.height],
      canvas: [
        updatedLayer.colorCycleData?.canvas?.width,
        updatedLayer.colorCycleData?.canvas?.height,
      ],
    }).toEqual({
      document: [2, 2],
      canvas: [2, 2],
    });
    expect(Array.from(new Uint8Array(snapshot?.paintBuffer ?? new ArrayBuffer(0)))).toEqual([1, 2, 3, 4]);
    expect(Array.from(new Uint8Array(snapshot?.phaseBuffer ?? new ArrayBuffer(0)))).toEqual([41, 42, 43, 44]);
    expect(documentRead?.pixelVersion).toBe(beforeResizeRead?.pixelVersion);

    await useAppStore.getState().redo();

    documentRead = manager.getDocument(layer.id)?.read();
    snapshot = documentRead?.snapshot;
    updatedLayer = useAppStore.getState().layers[0];
    expect(useAppStore.getState().project?.width).toBe(4);
    expect(snapshot?.width).toBe(4);
    expect(snapshot?.height).toBe(4);
    expect(updatedLayer.colorCycleData?.canvas?.width).toBe(4);
    expect(updatedLayer.colorCycleData?.canvas?.height).toBe(4);
    expect(Array.from(new Uint8Array(snapshot?.paintBuffer ?? new ArrayBuffer(0)))).toEqual([
      1, 1, 2, 2,
      1, 1, 2, 2,
      3, 3, 4, 4,
      3, 3, 4, 4,
    ]);
    expect(documentRead?.pixelVersion).toBe(afterResizeRead?.pixelVersion);
    manager.deleteBrush(layer.id);
  });

  it('records canvas resize in history so undo and redo restore dimensions and pixels', async () => {
    const layer = createLayer(2, 2);
    primeStoreForResize(layer, 2, 2);
    useAppStore.setState((state) => ({
      project: state.project
        ? { ...state.project, canvasShape: createDefaultCanvasShape(2, 2) }
        : null,
    }));

    await useAppStore.getState().resizeCanvas(4, 4);

    expect(historyManager.peekUndo()?.action).toBe('project-transform');
    expect(useAppStore.getState().project?.width).toBe(4);
    expect(useAppStore.getState().project?.height).toBe(4);

    await useAppStore.getState().undo();

    let state = useAppStore.getState();
    let updatedLayer = state.layers[0];
    expect(state.project?.width).toBe(2);
    expect(state.project?.height).toBe(2);
    expect(state.project?.canvasShape).toEqual(createDefaultCanvasShape(2, 2));
    expect(updatedLayer.imageData?.width).toBe(2);
    expect(updatedLayer.imageData?.height).toBe(2);
    expect(Array.from(updatedLayer.imageData?.data ?? [])).toEqual(Array.from(layer.imageData?.data ?? []));

    await useAppStore.getState().redo();

    state = useAppStore.getState();
    updatedLayer = state.layers[0];
    expect(state.project?.width).toBe(4);
    expect(state.project?.height).toBe(4);
    expect(state.project?.canvasShape).toEqual(createDefaultCanvasShape(4, 4));
    expect(updatedLayer.imageData?.width).toBe(4);
    expect(updatedLayer.imageData?.height).toBe(4);
  });
});
