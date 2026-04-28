import { TextDecoder, TextEncoder } from 'util';

// Polyfill TextEncoder/TextDecoder for blobStore usage in tests (Jest/JSDOM environment)
(global as unknown as { TextEncoder?: typeof TextEncoder }).TextEncoder = TextEncoder;
(global as unknown as { TextDecoder?: typeof TextDecoder }).TextDecoder = TextDecoder;

import { shapeFillBrushPreset, pixelBrushPreset } from '@/presets/brushPresets';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import { commitLayerHistory } from '@/history/helpers/layerHistory';
import { captureSelectionSnapshot, commitSelectionHistory } from '@/history/helpers/selectionHistory';
import historyManager from '@/history/historyService';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';

const TRIANGLE_POINTS = [
  { x: 0, y: 0 },
  { x: 32, y: 8 },
  { x: 16, y: 28 },
];

const resetShapeState = (): void => {
  const store = useAppStore.getState();
  store.cancelShapeFillSession();
  store.setBrushPreset(pixelBrushPreset);
  useAppStore.setState((state) => ({
    tools: {
      ...state.tools,
      shapeMode: false,
      lastRegularShapeMode: false,
      lastColorCycleShapeMode: false,
    },
    shapeFill: {
      ...state.shapeFill,
      session: null,
      lastFinalize: null,
    },
  }));
};

const resetHistoryState = (): void => {
  historyManager.clear();
  useAppStore.setState((state) => ({
    history: {
      ...state.history,
      undoStack: [],
      redoStack: [],
    },
  }));
};

const clearLayers = (): void => {
  useAppStore.setState((state) => ({
    layers: [],
    activeLayerId: null,
    selectionStart: null,
    selectionEnd: null,
    project: state.project
      ? {
          ...state.project,
          layers: [],
        }
      : state.project,
  }));
};

const cloneData = (data: Uint8ClampedArray): number[] => Array.from(data);

const createLayer = (id: string, imageData: ImageData): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = imageData.width;
  framebuffer.height = imageData.height;
  const ctx = framebuffer.getContext('2d');
  ctx?.putImageData(imageData, 0, 0);

  return {
    id,
    name: 'Layer',
    order: 0,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    layerType: 'normal',
    imageData,
    framebuffer,
    alignment: createDefaultLayerAlignment(),
    colorCycleData: undefined,
  };
};

const readPixelAlpha = (imageData: ImageData, x: number, y: number): number => {
  const index = (y * imageData.width + x) * 4 + 3;
  return imageData.data[index] ?? 0;
};

const createColorCycleLayer = (id: string, width: number, height: number): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const framebuffer = document.createElement('canvas');
  framebuffer.width = width;
  framebuffer.height = height;

  return {
    id,
    name: 'Color Cycle Layer',
    order: 0,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    layerType: 'color-cycle',
    imageData: null,
    framebuffer,
    alignment: createDefaultLayerAlignment(),
    colorCycleData: {
      canvas,
      hasContent: true,
      gradient: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      speed: 1,
      version: 0,
      slotPalettes: [],
      gradientDefs: [],
      gradientDefStore: [],
      activeGradientId: null,
      paintSlot: 1,
      eraseMask: document.createElement('canvas'),
      scalarField: new Float32Array(width * height),
      ditherMap: new Uint8Array(width * height),
      gradientIdBuffer: new Uint8Array(width * height),
      flowMode: 'forward',
      styleVersion: 0,
    },
  } as unknown as Layer;
};

describe('history integration', () => {
  beforeEach(() => {
    resetHistoryState();
    resetShapeState();
    clearLayers();
  });

  afterEach(() => {
    resetHistoryState();
    resetShapeState();
    clearLayers();
  });

  it('captures shape fill session lifecycle in history', async () => {
    const store = useAppStore.getState();
    store.setBrushPreset(shapeFillBrushPreset);
    store.beginShapeFillSession(TRIANGLE_POINTS);

    // Transaction remains open during live session.
    expect(historyManager.entries()).toHaveLength(0);

    store.cancelShapeFillSession();
    expect(historyManager.entries()).toHaveLength(1);
    expect(historyManager.peekUndo()?.action).toBe('shape-session');
    expect(useAppStore.getState().shapeFill.session).toBeNull();

    await historyManager.undo();
    const restoredSession = useAppStore.getState().shapeFill.session;
    expect(restoredSession).not.toBeNull();
    expect(restoredSession?.points).toHaveLength(TRIANGLE_POINTS.length);

    await historyManager.redo();
    expect(useAppStore.getState().shapeFill.session).toBeNull();
  });

  it('records bitmap deltas for flood fill commits', async () => {
    const before = new ImageData(
      new Uint8ClampedArray([
        0, 0, 0, 255,
        0, 0, 0, 255,
        0, 0, 0, 255,
        0, 0, 0, 255,
      ]),
      2,
      2,
    );
    const after = new ImageData(
      new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 255, 0, 255,
        0, 0, 255, 255,
        255, 255, 0, 255,
      ]),
      2,
      2,
    );

    const layer = createLayer('layer-1', after);
    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      project: state.project
        ? {
            ...state.project,
            layers: [layer],
          }
        : state.project,
    }));

    await commitLayerHistory({
      layerId: layer.id,
      beforeImage: before,
      beforeColorState: null,
      actionType: 'fill',
      description: 'Flood fill',
      tool: 'fill',
    });

    const entry = historyManager.peekUndo();
    expect(entry?.action).toBe('fill');
    expect(entry?.deltas.some((delta) => delta._tag === 'bitmap-tile')).toBe(true);

    await historyManager.undo();
    const afterUndo = useAppStore.getState().layers.find((l) => l.id === layer.id);
    expect(afterUndo?.imageData).not.toBeNull();
    expect(cloneData(afterUndo!.imageData!.data)).toEqual(cloneData(before.data));

    await historyManager.redo();
    const afterRedo = useAppStore.getState().layers.find((l) => l.id === layer.id);
    expect(afterRedo?.imageData).not.toBeNull();
    expect(cloneData(afterRedo!.imageData!.data)).toEqual(cloneData(after.data));
  });

  it('records selection toggles and restores them via undo/redo', async () => {
    const store = useAppStore.getState();
    const createBefore = captureSelectionSnapshot();

    store.setSelectionBounds({ x: 2, y: 4 }, { x: 10, y: 12 });
    commitSelectionHistory({ before: createBefore, description: 'Create marquee (test)' });

    expect(historyManager.entries()).toHaveLength(1);
    const createdSelectionStart = useAppStore.getState().selectionStart;
    expect(createdSelectionStart).toEqual({ x: 2, y: 4 });

    const clearBefore = captureSelectionSnapshot();
    store.clearSelection();
    commitSelectionHistory({ before: clearBefore, description: 'Clear selection (test)' });

    expect(historyManager.entries()).toHaveLength(2);
    expect(historyManager.peekUndo()?.action).toBe('selection-change');

    await historyManager.undo();
    const restoredSelection = useAppStore.getState().selectionStart;
    expect(restoredSelection).toEqual({ x: 2, y: 4 });

    await historyManager.undo();
    expect(useAppStore.getState().selectionStart).toBeNull();

    await historyManager.redo();
    expect(useAppStore.getState().selectionStart).toEqual({ x: 2, y: 4 });

    await historyManager.redo();
    expect(useAppStore.getState().selectionStart).toBeNull();
  });

  it('restores layer order after reorder undo/redo actions', async () => {
    const makeImage = (r: number, g: number, b: number): ImageData =>
      new ImageData(new Uint8ClampedArray([r, g, b, 255]), 1, 1);

    const layerA = createLayer('layer-A', makeImage(255, 0, 0));
    const layerB = createLayer('layer-B', makeImage(0, 255, 0));
    const layerC = createLayer('layer-C', makeImage(0, 0, 255));

    useAppStore.setState(() => ({
      layers: [layerA, layerB, layerC],
      activeLayerId: layerA.id,
      project: {
        id: 'proj-test',
        name: 'Test Project',
        width: 32,
        height: 32,
        layers: [layerA, layerB, layerC],
        backgroundColor: '#00000000',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
    }));

    const store = useAppStore.getState();
    store.reorderLayers(0, 2);

    expect(useAppStore.getState().layers.map((l) => l.id)).toEqual(['layer-B', 'layer-C', 'layer-A']);
    expect(historyManager.peekUndo()?.action).toBe('layer-structure');

    await historyManager.undo();
    expect(useAppStore.getState().layers.map((l) => l.id)).toEqual(['layer-A', 'layer-B', 'layer-C']);

    await historyManager.redo();
    expect(useAppStore.getState().layers.map((l) => l.id)).toEqual(['layer-B', 'layer-C', 'layer-A']);
  });

  it('undo/redo via store restores removed layers', async () => {
    const makeImage = (value: number): ImageData =>
      new ImageData(new Uint8ClampedArray([value, value, value, 255]), 1, 1);

    const layerA = createLayer('layer-A', makeImage(0));
    const layerB = createLayer('layer-B', makeImage(255));

    useAppStore.setState(() => ({
      layers: [layerA, layerB],
      activeLayerId: layerB.id,
      selectedLayerIds: [layerB.id],
      referenceLayerId: layerB.id,
      project: {
        id: 'proj-layer-remove',
        name: 'Layer Remove',
        width: 8,
        height: 8,
        layers: [layerA, layerB],
        backgroundColor: '#00000000',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
    }));

    const store = useAppStore.getState();
    store.removeLayer(layerB.id);
    expect(useAppStore.getState().layers.map((layer) => layer.id)).toEqual(['layer-A']);
    expect(useAppStore.getState().referenceLayerId).toBeNull();

    await store.undo();
    expect(useAppStore.getState().layers.map((layer) => layer.id)).toEqual(['layer-A', 'layer-B']);
    expect(useAppStore.getState().activeLayerId).toBe(layerB.id);
    expect(useAppStore.getState().referenceLayerId).toBe(layerB.id);

    await store.redo();
    expect(useAppStore.getState().layers.map((layer) => layer.id)).toEqual(['layer-A']);
    expect(useAppStore.getState().referenceLayerId).toBeNull();
  });

  it('restores color-cycle brush buffers when undoing layer removal', async () => {
    const width = 4;
    const height = 4;
    const layer = createColorCycleLayer('layer-cc-remove-restore', width, height);
    layer.colorCycleData = {
      ...layer.colorCycleData,
      gradientDefs: [{ id: 'g3', currentSlot: 3 }],
      activeGradientId: 'g3',
      paintSlot: 3,
      slotPalettes: [{
        slot: 3,
        stops: [
          { position: 0, color: '#111111' },
          { position: 1, color: '#eeeeee' },
        ],
      }],
      gradientDefStore: [{
        id: 7,
        kind: 'linear',
        stops: [
          { position: 0, color: '#111111' },
          { position: 1, color: '#eeeeee' },
        ],
        hash: 'linear:remove-restore',
        source: 'manual',
        createdAtMs: 0,
        slot: 3,
      }],
      nextGradientDefId: 8,
    };

    useAppStore.setState(() => ({
      layers: [layer],
      activeLayerId: layer.id,
      selectedLayerIds: [layer.id],
      project: {
        id: 'proj-cc-remove-restore',
        name: 'CC Remove Restore',
        width,
        height,
        layers: [layer],
        backgroundColor: '#00000000',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
    }));

    const store = useAppStore.getState();
    store.initColorCycleForLayer(layer.id, width, height);
    const manager = getColorCycleBrushManager();
    const brush = manager.getLayerColorCycleBrush(layer.id);
    expect(brush).not.toBeNull();

    const paint = new Uint8Array(width * height);
    const gradientIds = new Uint8Array(width * height);
    const gradientDefIds = new Uint16Array(width * height);
    paint[0] = 55;
    gradientIds[0] = 3;
    gradientDefIds[0] = 7;
    brush?.applyLayerSnapshot?.(layer.id, {
      paintBuffer: paint.buffer,
      gradientIdBuffer: gradientIds.buffer,
      gradientDefIdBuffer: gradientDefIds.buffer,
      hasContent: true,
      strokeCounter: 4,
    });

    store.removeLayer(layer.id);
    expect(useAppStore.getState().layers).toHaveLength(0);
    expect(manager.getLayerColorCycleBrush(layer.id)).toBeNull();

    await store.undo();

    const restoredBrush = manager.getLayerColorCycleBrush(layer.id);
    expect(restoredBrush).not.toBeNull();
    const restoredSnapshot = restoredBrush?.getLayerSnapshot?.(layer.id);
    const restoredPaint = restoredSnapshot?.paintBuffer ? new Uint8Array(restoredSnapshot.paintBuffer) : null;
    const restoredGradientIds = restoredSnapshot?.gradientIdBuffer
      ? new Uint8Array(restoredSnapshot.gradientIdBuffer)
      : null;
    const restoredGradientDefIds = restoredSnapshot?.gradientDefIdBuffer
      ? new Uint16Array(restoredSnapshot.gradientDefIdBuffer)
      : null;

    expect(restoredPaint?.[0]).toBe(55);
    expect(restoredGradientIds?.[0]).toBe(3);
    expect(restoredGradientDefIds?.[0]).toBe(7);
  });

  it('preserves restored pixels when drawing after undoing layer removal', async () => {
    const size = 4;
    const makeSolidImage = (r: number, g: number, b: number): ImageData => {
      const data = new Uint8ClampedArray(size * size * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
      return new ImageData(data, size, size);
    };

    const layer = createLayer('layer-solid', makeSolidImage(10, 20, 30));
    layer.imageData = null; // mimic runtime layers that rely on framebuffer only

    useAppStore.setState(() => ({
      layers: [layer],
      activeLayerId: layer.id,
      selectedLayerIds: [layer.id],
      project: {
        id: 'proj-undo-draw',
        name: 'Undo Draw',
        width: size,
        height: size,
        layers: [layer],
        backgroundColor: '#00000000',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
    }));

    const store = useAppStore.getState();
    store.removeLayer(layer.id);
    await store.undo();

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = size;
    sourceCanvas.height = size;
    const ctx = sourceCanvas.getContext('2d');
    expect(ctx).not.toBeNull();
    ctx!.clearRect(0, 0, size, size);
    ctx!.fillStyle = '#ff0000';
    ctx!.fillRect(0, 0, 1, 1);

    await store.captureCanvasToActiveLayer(sourceCanvas, { x: 0, y: 0, width: 1, height: 1 });

    const finalImageData = useAppStore.getState().layers[0].imageData;
    expect(finalImageData).not.toBeNull();
    const pixel = (x: number, y: number): [number, number, number, number] => {
      const idx = (y * size + x) * 4;
      return [
        finalImageData!.data[idx],
        finalImageData!.data[idx + 1],
        finalImageData!.data[idx + 2],
        finalImageData!.data[idx + 3],
      ];
    };

    expect(pixel(0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(2, 2)).toEqual([10, 20, 30, 255]);
  });

  it('keeps restored pixels when captureCanvasToActiveLayer runs without ROI', async () => {
    const size = 4;
    const backgroundImage = new ImageData(
      new Uint8ClampedArray([
        10, 20, 30, 255,
        10, 20, 30, 255,
        10, 20, 30, 255,
        10, 20, 30, 255,
      ]),
      2,
      2
    );

    const layer = createLayer('layer-full', backgroundImage);

    useAppStore.setState(() => ({
      layers: [layer],
      activeLayerId: layer.id,
      selectedLayerIds: [layer.id],
      project: {
        id: 'proj-undo-full',
        name: 'Undo Full',
        width: size,
        height: size,
        layers: [layer],
        backgroundColor: '#00000000',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
    }));

    const store = useAppStore.getState();
    store.removeLayer(layer.id);
    await store.undo();

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = size;
    sourceCanvas.height = size;
    const ctx = sourceCanvas.getContext('2d');
    expect(ctx).not.toBeNull();
    ctx!.clearRect(0, 0, size, size);
    ctx!.fillStyle = '#ff0000';
    ctx!.fillRect(0, 0, 1, 1);

    await store.captureCanvasToActiveLayer(sourceCanvas);

    const finalImageData = useAppStore.getState().layers[0].imageData;
    expect(finalImageData).not.toBeNull();
    const pixel = (x: number, y: number): [number, number, number, number] => {
      const idx = (y * size + x) * 4;
      return [
        finalImageData!.data[idx],
        finalImageData!.data[idx + 1],
        finalImageData!.data[idx + 2],
        finalImageData!.data[idx + 3],
      ];
    };

    expect(pixel(0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(1, 1)).toEqual([10, 20, 30, 255]);
  });

  it('skips raster capture when the active layer is color-cycle', async () => {
    const size = 4;
    const framebuffer = document.createElement('canvas');
    framebuffer.width = size;
    framebuffer.height = size;
    const ctx = framebuffer.getContext('2d');
    ctx?.fillRect(0, 0, size, size);

    const ccLayer: Layer = {
      id: 'cc-layer',
      name: 'CC Layer',
      order: 0,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      layerType: 'color-cycle',
      imageData: null,
      framebuffer,
      alignment: createDefaultLayerAlignment(),
      colorCycleData: {
        mode: 'brush',
        gradient: [],
        hasContent: true,
        canvas: framebuffer,
      },
    } as Layer;

    useAppStore.setState(() => ({
      layers: [ccLayer],
      activeLayerId: ccLayer.id,
      selectedLayerIds: [ccLayer.id],
      project: {
        id: 'proj-cc',
        name: 'CC Project',
        width: size,
        height: size,
        layers: [ccLayer],
        backgroundColor: '#00000000',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
    }));

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = size;
    sourceCanvas.height = size;

    const store = useAppStore.getState();
    await store.captureCanvasToActiveLayer(sourceCanvas);

    const afterState = useAppStore.getState();
    expect(afterState.layers[0].imageData).toBeNull();
    expect(afterState.layersNeedRecomposition).toBe(true);
  });

  it('undo restores source pixels after selection move commit', async () => {
    const imageData = new ImageData(6, 4);
    const sourceIndex = (1 * imageData.width + 1) * 4;
    imageData.data[sourceIndex] = 255;
    imageData.data[sourceIndex + 1] = 0;
    imageData.data[sourceIndex + 2] = 0;
    imageData.data[sourceIndex + 3] = 255;

    const layer = createLayer('layer-move-1', imageData);

    useAppStore.setState(() => ({
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 2, y: 2 },
      project: {
        id: 'proj-move-1',
        name: 'Move Test',
        width: 6,
        height: 4,
        layers: [layer],
        backgroundColor: '#00000000',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
    }));

    const store = useAppStore.getState();
    const extracted = store.extractSelectionToFloatingPaste();
    expect(extracted).toBe(true);

    store.updateFloatingPastePosition({ x: 3, y: 1 });
    await store.commitFloatingPaste();

    let movedLayer = useAppStore.getState().layers.find((candidate) => candidate.id === layer.id);
    expect(movedLayer?.imageData).not.toBeNull();
    expect(readPixelAlpha(movedLayer!.imageData!, 1, 1)).toBe(0);

    await store.undo();

    movedLayer = useAppStore.getState().layers.find((candidate) => candidate.id === layer.id);
    expect(movedLayer?.imageData).not.toBeNull();
    expect(readPixelAlpha(movedLayer!.imageData!, 1, 1)).toBe(255);
  });

  it('undoes non-square marquee resize without leaving transparent artifacts', async () => {
    const width = 12;
    const height = 10;
    const before = new ImageData(width, height);
    for (let i = 0; i < before.data.length; i += 4) {
      before.data[i] = 80;
      before.data[i + 1] = 140;
      before.data[i + 2] = 200;
      before.data[i + 3] = 255;
    }

    const layer = createLayer(
      'layer-resize-undo',
      new ImageData(new Uint8ClampedArray(before.data), width, height),
    );

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: { x: 2, y: 2 },
      selectionEnd: { x: 6, y: 4 },
      project: state.project
        ? {
            ...state.project,
            width,
            height,
            layers: [layer],
          }
        : state.project,
    }));

    const store = useAppStore.getState();
    const extracted = store.extractSelectionToFloatingPaste();
    expect(extracted).toBe(true);
    store.updateFloatingPasteRect({ x: 7, y: 5, width: 3, height: 5 });
    await store.commitFloatingPaste();
    await store.undo();

    const layerAfterUndo = useAppStore.getState().layers.find((candidate) => candidate.id === layer.id);
    expect(layerAfterUndo?.imageData).not.toBeNull();
    expect(Array.from(layerAfterUndo!.imageData!.data)).toEqual(Array.from(before.data));
  });

  it('commits floating paste into fully transparent destination pixels on normal layers', async () => {
    const width = 16;
    const height = 16;
    const layer = createLayer('layer-transparent-paste', new ImageData(width, height));

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: null,
      selectionEnd: null,
      project: state.project
        ? {
            ...state.project,
            width,
            height,
            layers: [layer],
          }
        : state.project,
    }));

    useAppStore.getState().setFloatingPaste({
      imageData: new ImageData(
        new Uint8ClampedArray([
          255, 0, 0, 255,
          0, 255, 0, 255,
          0, 0, 255, 255,
          255, 255, 0, 255,
        ]),
        2,
        2,
      ),
      position: { x: 5, y: 6 },
      width: 2,
      height: 2,
      displayWidth: 2,
      displayHeight: 2,
    });

    await useAppStore.getState().commitFloatingPaste();

    const updatedLayer = useAppStore.getState().layers.find((candidate) => candidate.id === layer.id);
    expect(updatedLayer?.imageData).not.toBeNull();
    const readPixel = (x: number, y: number): [number, number, number, number] => {
      const data = updatedLayer?.imageData?.data ?? new Uint8ClampedArray();
      const index = (y * width + x) * 4;
      return [
        data[index] ?? 0,
        data[index + 1] ?? 0,
        data[index + 2] ?? 0,
        data[index + 3] ?? 0,
      ];
    };

    expect(readPixel(5, 6)).toEqual([255, 0, 0, 255]);
    expect(readPixel(6, 6)).toEqual([0, 255, 0, 255]);
    expect(readPixel(5, 7)).toEqual([0, 0, 255, 255]);
    expect(readPixel(6, 7)).toEqual([255, 255, 0, 255]);
  });

  it('records and replays color-cycle selection move commits', async () => {
    const width = 8;
    const height = 6;
    const layer = createColorCycleLayer('layer-cc-move', width, height);

    useAppStore.setState(() => ({
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 3, y: 3 },
      project: {
        id: 'proj-cc-move-1',
        name: 'CC Move Test',
        width,
        height,
        layers: [layer],
        backgroundColor: '#00000000',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
    }));

    const manager = getColorCycleBrushManager();
    useAppStore.getState().initColorCycleForLayer(layer.id, width, height);
    const brush = manager.getLayerColorCycleBrush(layer.id);
    expect(brush).not.toBeNull();

    const seed = new Uint8Array(width * height);
    const seedSpeed = new Uint8Array(width * height);
    const seedFlow = new Uint8Array(width * height);
    seed[1 + (1 * width)] = 9;
    seed[2 + (1 * width)] = 10;
    seed[1 + (2 * width)] = 11;
    seed[2 + (2 * width)] = 12;
    seedSpeed[1 + (1 * width)] = 120;
    seedSpeed[2 + (1 * width)] = 121;
    seedSpeed[1 + (2 * width)] = 122;
    seedSpeed[2 + (2 * width)] = 123;
    seedFlow[1 + (1 * width)] = 1;
    seedFlow[2 + (1 * width)] = 2;
    seedFlow[1 + (2 * width)] = 1;
    seedFlow[2 + (2 * width)] = 2;
    brush?.applyLayerSnapshot?.(layer.id, {
      paintBuffer: seed.slice().buffer,
      speedBuffer: seedSpeed.slice().buffer,
      flowBuffer: seedFlow.slice().buffer,
      hasContent: true,
      strokeCounter: 1,
    });
    const preMoveSnapshot = brush?.getLayerSnapshot?.(layer.id);
    const preMoveSpeed = preMoveSnapshot?.speedBuffer ? new Uint8Array(preMoveSnapshot.speedBuffer) : null;
    expect(preMoveSpeed).not.toBeNull();
    expect(preMoveSpeed![1 + (1 * width)]).toBe(120);

    const store = useAppStore.getState();
    const extracted = store.extractSelectionToFloatingPaste();
    expect(extracted).toBe(true);

    const extractedPaste = useAppStore.getState().floatingPaste;
    expect(extractedPaste?.imageData).not.toBeNull();
    if (extractedPaste?.imageData) {
      const opaqueData = new Uint8ClampedArray(extractedPaste.imageData.data);
      for (let i = 3; i < opaqueData.length; i += 4) {
        opaqueData[i] = 255;
      }
      useAppStore.setState({
        floatingPaste: {
          ...extractedPaste,
          imageData: new ImageData(opaqueData, extractedPaste.imageData.width, extractedPaste.imageData.height),
        },
      });
    }

    store.updateFloatingPastePosition({ x: 4, y: 2 });
    await store.commitFloatingPaste();

    const movedSnapshot = brush?.getLayerSnapshot?.(layer.id);
    const movedBuffer = movedSnapshot?.paintBuffer ? new Uint8Array(movedSnapshot.paintBuffer) : null;
    expect(movedBuffer).not.toBeNull();
    expect(movedBuffer![1 + (1 * width)]).toBe(0);
    expect(store.canUndo()).toBe(true);

    await store.undo();
    expect(store.canRedo()).toBe(true);
    const undoSnapshot = brush?.getLayerSnapshot?.(layer.id);
    const undoSpeed = undoSnapshot?.speedBuffer ? new Uint8Array(undoSnapshot.speedBuffer) : null;
    expect(undoSpeed).not.toBeNull();
    expect(undoSpeed![1 + (1 * width)]).toBe(120);
    expect(undoSpeed![2 + (1 * width)]).toBe(121);
  });

  it('extracts CC slot palettes into floating paste for marquee cut', () => {
    const width = 4;
    const height = 4;
    const layer = createColorCycleLayer('layer-cc-slot-extract', width, height);
    layer.colorCycleData = {
      ...layer.colorCycleData,
      slotPalettes: [{
        slot: 9,
        stops: [
          { position: 0, color: '#ff0000' },
          { position: 1, color: '#00ff00' },
        ],
      }],
      gradientDefStore: [{
        id: 2,
        kind: 'linear',
        stops: [
          { position: 0, color: '#ff0000' },
          { position: 1, color: '#00ff00' },
        ],
        hash: 'linear:red-green',
        source: 'manual',
        createdAtMs: 0,
        slot: 9,
      }],
      nextGradientDefId: 3,
    };

    useAppStore.setState(() => ({
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 3, y: 3 },
      project: {
        id: 'proj-cc-slot-extract',
        name: 'CC Slot Extract Test',
        width,
        height,
        layers: [layer],
        backgroundColor: '#00000000',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
    }));

    const manager = getColorCycleBrushManager();
    useAppStore.getState().initColorCycleForLayer(layer.id, width, height);
    const brush = manager.getLayerColorCycleBrush(layer.id);
    expect(brush).not.toBeNull();

    const paint = new Uint8Array(width * height);
    const gradientIds = new Uint8Array(width * height);
    const gradientDefIds = new Uint16Array(width * height);
    paint[1 + (1 * width)] = 1;
    paint[2 + (1 * width)] = 1;
    paint[1 + (2 * width)] = 1;
    paint[2 + (2 * width)] = 1;
    gradientIds[1 + (1 * width)] = 9;
    gradientIds[2 + (1 * width)] = 9;
    gradientIds[1 + (2 * width)] = 9;
    gradientIds[2 + (2 * width)] = 9;
    gradientDefIds[1 + (1 * width)] = 2;
    gradientDefIds[2 + (1 * width)] = 2;
    gradientDefIds[1 + (2 * width)] = 2;
    gradientDefIds[2 + (2 * width)] = 2;

    brush?.applyLayerSnapshot?.(layer.id, {
      paintBuffer: paint.buffer,
      gradientIdBuffer: gradientIds.buffer,
      gradientDefIdBuffer: gradientDefIds.buffer,
      hasContent: true,
      strokeCounter: 1,
    });

    const extracted = useAppStore.getState().extractSelectionToFloatingPaste();
    expect(extracted).toBe(true);

    const floatingPaste = useAppStore.getState().floatingPaste;
    expect(floatingPaste?.colorCycleGradientIds).toEqual(new Uint8Array([9, 9, 9, 9]));
    expect(floatingPaste?.colorCycleGradientDefIds).toEqual(new Uint16Array([2, 2, 2, 2]));
    expect(floatingPaste?.colorCycleSlotPalettes).toEqual([{
      slot: 9,
      stops: [
        { position: 0, color: '#ff0000' },
        { position: 1, color: '#00ff00' },
      ],
    }]);
  });

  it('cuts and pastes slot-bound CC strokes onto a new CC layer', async () => {
    const width = 6;
    const height = 6;
    const sourceLayer = createColorCycleLayer('layer-cc-stroke-source', width, height);
    sourceLayer.colorCycleData = {
      ...sourceLayer.colorCycleData,
      slotPalettes: [{
        slot: 9,
        stops: [
          { position: 0, color: '#ff0000' },
          { position: 1, color: '#00ff00' },
        ],
      }],
      gradientDefs: [{ id: 'g9', currentSlot: 9 }],
      activeGradientId: 'g9',
      paintSlot: 9,
      gradientDefStore: [{
        id: 2,
        kind: 'linear',
        stops: [
          { position: 0, color: '#ff0000' },
          { position: 1, color: '#00ff00' },
        ],
        hash: 'linear:red-green',
        source: 'manual',
        createdAtMs: 0,
        slot: 9,
      }],
      nextGradientDefId: 3,
    };
    const targetLayer = createColorCycleLayer('layer-cc-stroke-target', width, height);

    useAppStore.setState(() => ({
      layers: [sourceLayer, targetLayer],
      activeLayerId: sourceLayer.id,
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 3, y: 3 },
      project: {
        id: 'proj-cc-stroke-cross-layer',
        name: 'CC Stroke Cross Layer Test',
        width,
        height,
        layers: [sourceLayer, targetLayer],
        backgroundColor: '#00000000',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
    }));

    const manager = getColorCycleBrushManager();
    useAppStore.getState().initColorCycleForLayer(sourceLayer.id, width, height);
    useAppStore.getState().initColorCycleForLayer(targetLayer.id, width, height);
    const sourceBrush = manager.getLayerColorCycleBrush(sourceLayer.id);
    const targetBrush = manager.getLayerColorCycleBrush(targetLayer.id);
    expect(sourceBrush).not.toBeNull();
    expect(targetBrush).not.toBeNull();

    const paint = new Uint8Array(width * height);
    const gradientIds = new Uint8Array(width * height);
    const gradientDefIds = new Uint16Array(width * height);
    for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]] as const) {
      const index = x + (y * width);
      paint[index] = 1;
      gradientIds[index] = 9;
      gradientDefIds[index] = 2;
    }

    sourceBrush?.applyLayerSnapshot?.(sourceLayer.id, {
      paintBuffer: paint.slice().buffer,
      gradientIdBuffer: gradientIds.slice().buffer,
      gradientDefIdBuffer: gradientDefIds.slice().buffer,
      hasContent: true,
      strokeCounter: 1,
    });

    const store = useAppStore.getState();
    const extracted = store.extractSelectionToFloatingPaste();
    expect(extracted).toBe(true);

    const sourceAfterExtract = sourceBrush?.getLayerSnapshot?.(sourceLayer.id);
    const sourceAfterPaint = sourceAfterExtract?.paintBuffer ? new Uint8Array(sourceAfterExtract.paintBuffer) : null;
    expect(sourceAfterPaint).not.toBeNull();
    expect(sourceAfterPaint![1 + (1 * width)]).toBe(0);
    expect(sourceAfterPaint![2 + (1 * width)]).toBe(0);

    useAppStore.setState({ activeLayerId: targetLayer.id });
    await store.commitFloatingPaste();

    const targetSnapshot = targetBrush?.getLayerSnapshot?.(targetLayer.id);
    const targetPaint = targetSnapshot?.paintBuffer ? new Uint8Array(targetSnapshot.paintBuffer) : null;
    const targetGradientIds = targetSnapshot?.gradientIdBuffer ? new Uint8Array(targetSnapshot.gradientIdBuffer) : null;
    const targetGradientDefIds = targetSnapshot?.gradientDefIdBuffer ? new Uint16Array(targetSnapshot.gradientDefIdBuffer) : null;
    expect(targetPaint).not.toBeNull();
    expect(targetGradientIds).not.toBeNull();
    expect(targetGradientDefIds).not.toBeNull();
    expect(targetPaint![1 + (1 * width)]).toBe(1);
    expect(targetPaint![2 + (1 * width)]).toBe(1);

    const updatedTargetLayer = useAppStore.getState().layers.find((layer) => layer.id === targetLayer.id);
    expect(updatedTargetLayer?.colorCycleData?.slotPalettes).toEqual(expect.arrayContaining([
      expect.objectContaining({ slot: 9 }),
    ]));
    expect(targetGradientIds![1 + (1 * width)]).toBe(9);
    expect(targetGradientDefIds![1 + (1 * width)]).toBe(2);
  });

  it('does not restore untouched color-cycle layers when undoing a lower-layer commit', async () => {
    const width = 4;
    const height = 4;
    const topLayer = createColorCycleLayer('layer-cc-top', width, height);
    const bottomLayer = createColorCycleLayer('layer-cc-bottom', width, height);
    topLayer.order = 0;
    bottomLayer.order = 1;

    useAppStore.setState(() => ({
      layers: [topLayer, bottomLayer],
      activeLayerId: bottomLayer.id,
      project: {
        id: 'proj-cc-undo-cross-layer',
        name: 'CC Undo Cross Layer Test',
        width,
        height,
        layers: [topLayer, bottomLayer],
        backgroundColor: '#00000000',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
    }));

    const manager = getColorCycleBrushManager();
    useAppStore.getState().initColorCycleForLayer(topLayer.id, width, height);
    useAppStore.getState().initColorCycleForLayer(bottomLayer.id, width, height);
    const topBrush = manager.getLayerColorCycleBrush(topLayer.id);
    const bottomBrush = manager.getLayerColorCycleBrush(bottomLayer.id);
    expect(topBrush).not.toBeNull();
    expect(bottomBrush).not.toBeNull();

    const topPaint = new Uint8Array(width * height);
    topPaint[0] = 77;
    topBrush?.applyLayerSnapshot?.(topLayer.id, {
      paintBuffer: topPaint.slice().buffer,
      hasContent: true,
      strokeCounter: 1,
    });

    const bottomBefore = new Uint8Array(width * height);
    bottomBefore[5] = 11;
    bottomBrush?.applyLayerSnapshot?.(bottomLayer.id, {
      paintBuffer: bottomBefore.slice().buffer,
      hasContent: true,
      strokeCounter: 1,
    });
    const beforeBottomState = captureColorCycleBrushState(bottomLayer.id);

    const bottomAfter = bottomBefore.slice();
    bottomAfter[6] = 22;
    bottomBrush?.applyLayerSnapshot?.(bottomLayer.id, {
      paintBuffer: bottomAfter.buffer,
      hasContent: true,
      strokeCounter: 2,
    });

    useAppStore.setState((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === topLayer.id && layer.colorCycleData
          ? {
              ...layer,
              colorCycleData: {
                ...layer.colorCycleData,
                brushState: {
                  layers: [{
                    layerId: topLayer.id,
                    strokeData: {
                      paintBuffer: new Uint8Array(width * height).buffer,
                      hasContent: false,
                      strokeCounter: 0,
                    },
                  }],
                },
              },
            }
          : layer
      ),
      project: state.project
        ? {
            ...state.project,
            layers: state.layers.map((layer) =>
              layer.id === topLayer.id && layer.colorCycleData
                ? {
                    ...layer,
                    colorCycleData: {
                      ...layer.colorCycleData,
                      brushState: {
                        layers: [{
                          layerId: topLayer.id,
                          strokeData: {
                            paintBuffer: new Uint8Array(width * height).buffer,
                            hasContent: false,
                            strokeCounter: 0,
                          },
                        }],
                      },
                    },
                  }
                : layer
            ),
          }
        : state.project,
    }));

    await commitLayerHistory({
      layerId: bottomLayer.id,
      beforeImage: null,
      beforeColorState: beforeBottomState,
      actionType: 'fill',
      description: 'Bottom CC shape',
      tool: 'shape',
      skipBitmapDelta: true,
    });

    const restoreTopSpy = jest.spyOn(
      topBrush as NonNullable<typeof topBrush> & { restoreFullState: (state: unknown) => void },
      'restoreFullState'
    );

    await useAppStore.getState().undo();

    expect(restoreTopSpy).not.toHaveBeenCalled();
    const topSnapshot = topBrush?.getLayerSnapshot?.(topLayer.id);
    const topAfterUndo = topSnapshot?.paintBuffer ? new Uint8Array(topSnapshot.paintBuffer) : null;
    expect(topAfterUndo).not.toBeNull();
    expect(topAfterUndo![0]).toBe(77);

    const bottomSnapshot = bottomBrush?.getLayerSnapshot?.(bottomLayer.id);
    const bottomAfterUndo = bottomSnapshot?.paintBuffer ? new Uint8Array(bottomSnapshot.paintBuffer) : null;
    expect(bottomAfterUndo).not.toBeNull();
    expect(bottomAfterUndo![5]).toBe(11);
    expect(bottomAfterUndo![6]).toBe(0);
  });

  it('commits resized marquee transforms on color-cycle layers', async () => {
    const width = 8;
    const height = 8;
    const layer = createColorCycleLayer('layer-cc-resize', width, height);

    useAppStore.setState(() => ({
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 3, y: 3 },
      project: {
        id: 'proj-cc-resize-1',
        name: 'CC Resize Test',
        width,
        height,
        layers: [layer],
        backgroundColor: '#00000000',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
    }));

    const manager = getColorCycleBrushManager();
    useAppStore.getState().initColorCycleForLayer(layer.id, width, height);
    const brush = manager.getLayerColorCycleBrush(layer.id);
    expect(brush).not.toBeNull();

    const seed = new Uint8Array(width * height);
    seed[1 + (1 * width)] = 9;
    seed[2 + (1 * width)] = 10;
    seed[1 + (2 * width)] = 11;
    seed[2 + (2 * width)] = 12;
    brush?.applyLayerSnapshot?.(layer.id, {
      paintBuffer: seed.slice().buffer,
      hasContent: true,
      strokeCounter: 1,
    });

    const store = useAppStore.getState();
    const extracted = store.extractSelectionToFloatingPaste();
    expect(extracted).toBe(true);
    const extractedPaste = useAppStore.getState().floatingPaste;
    expect(extractedPaste).not.toBeNull();
    if (extractedPaste?.imageData) {
      const opaqueData = new Uint8ClampedArray(extractedPaste.imageData.data);
      for (let i = 3; i < opaqueData.length; i += 4) {
        opaqueData[i] = 255;
      }
      useAppStore.setState({
        floatingPaste: {
          ...extractedPaste,
          imageData: new ImageData(opaqueData, extractedPaste.imageData.width, extractedPaste.imageData.height),
        },
      });
    }

    store.updateFloatingPasteRect({ x: 4, y: 3, width: 4, height: 4 });
    await store.commitFloatingPaste();

    const snapshot = brush?.getLayerSnapshot?.(layer.id);
    const buffer = snapshot?.paintBuffer ? new Uint8Array(snapshot.paintBuffer) : null;
    expect(buffer).not.toBeNull();

    // Scaled 2x2 -> 4x4 should preserve nearest-neighbor block structure.
    expect(buffer![4 + (3 * width)]).toBe(9);
    expect(buffer![5 + (3 * width)]).toBe(9);
    expect(buffer![6 + (3 * width)]).toBe(10);
    expect(buffer![7 + (3 * width)]).toBe(10);

    expect(buffer![4 + (5 * width)]).toBe(11);
    expect(buffer![5 + (5 * width)]).toBe(11);
    expect(buffer![6 + (5 * width)]).toBe(12);
    expect(buffer![7 + (5 * width)]).toBe(12);
  });
});
