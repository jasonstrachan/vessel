import { TextDecoder, TextEncoder } from 'util';

// Polyfill TextEncoder/TextDecoder for blobStore usage in tests (Jest/JSDOM environment)
(global as unknown as { TextEncoder?: typeof TextEncoder }).TextEncoder = TextEncoder;
(global as unknown as { TextDecoder?: typeof TextDecoder }).TextDecoder = TextDecoder;

import { shapeFillBrushPreset, pixelBrushPreset } from '@/presets/brushPresets';
import { commitLayerHistory } from '@/history/helpers/layerHistory';
import { captureSelectionSnapshot, commitSelectionHistory } from '@/history/helpers/selectionHistory';
import historyManager from '@/history/historyService';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

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

    await store.undo();
    expect(useAppStore.getState().layers.map((layer) => layer.id)).toEqual(['layer-A', 'layer-B']);
    expect(useAppStore.getState().activeLayerId).toBe(layerB.id);

    await store.redo();
    expect(useAppStore.getState().layers.map((layer) => layer.id)).toEqual(['layer-A']);
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
});
