import { useAppStore } from '@/stores/useAppStore';
import type { GradientSeamProfile, Layer, Rectangle } from '@/types';
import { parseCssColor } from '@/utils/color/parseCssColor';
import {
  ColorCycleLayerDocument,
  createColorCycleBrushPersistenceLayerMetaFromLayerData,
  mergeColorCycleBrushPersistenceLayerMetaForOwner,
  registerColorCycleBrushLayerSnapshotRuntime,
  setColorCycleBrushPersistenceLayerMeta,
  type ColorCycleBrushPersistenceLayerMeta,
} from '@/lib/colorCycle/document';
import * as layerHistory from '@/history/helpers/layerHistory';
import * as layerStructureHistory from '@/stores/helpers/layerStructureHistory';
import historyManager from '@/history/historyService';
import type { GradientStop } from '@/lib/GradientPalette';
import HistoryManager from '@/history/historyManager';
import { createRehydrationTargets } from '@/history/runtimeRehydration';
import { selectionSnapshotFromState } from '@/history/selectionState';

// eslint-disable-next-line no-var
var mockColorCycleBrushManager: {
  getGradientApplyBrush: jest.Mock;
  getSurfaceBrush: jest.Mock;
  getSelectionMutationBrush: jest.Mock;
  getHistoryBrush: jest.Mock;
  getSerializedStateBrush: jest.Mock;
};

jest.mock('@/stores/colorCycleBrushManager', () => {
  const actual = jest.requireActual('@/stores/colorCycleBrushManager');
  mockColorCycleBrushManager = {
    getGradientApplyBrush: jest.fn(() => null),
    getSurfaceBrush: jest.fn(() => null),
    getSelectionMutationBrush: jest.fn(() => null),
    getHistoryBrush: jest.fn(() => null),
    getSerializedStateBrush: jest.fn(() => null),
  };
  return {
    __esModule: true as const,
    ...actual,
    getColorCycleBrushManager: () => mockColorCycleBrushManager,
  };
});

const DEFAULT_ALIGNMENT = {
  fit: 'none',
  horizontal: 'center',
  vertical: 'center',
  positioning: 'anchor',
} as const;

const makeColorCycleLayerDocumentReader = (
  layerId: string,
  snapshot: {
    paintBuffer: ArrayBuffer;
    gradientIdBuffer?: ArrayBuffer;
    gradientDefIdBuffer?: ArrayBuffer;
    speedBuffer?: ArrayBuffer;
    flowBuffer?: ArrayBuffer;
    phaseBuffer?: ArrayBuffer;
    hasContent: boolean;
    strokeCounter: number;
  },
  width = 2,
  height = 1,
) => ({
  read: () => ({
    version: 1,
    snapshot: {
      layerId,
      width,
      height,
      paintBuffer: snapshot.paintBuffer.slice(0),
      gradientIdBuffer: snapshot.gradientIdBuffer?.slice(0),
      gradientDefIdBuffer: snapshot.gradientDefIdBuffer?.slice(0),
      speedBuffer: snapshot.speedBuffer?.slice(0),
      flowBuffer: snapshot.flowBuffer?.slice(0),
      phaseBuffer: snapshot.phaseBuffer?.slice(0),
      hasContent: snapshot.hasContent,
      sources: {
        brushStateSnapshot: true,
        topLevelBuffers: false,
        legacyStateRefs: false,
      },
    },
  }),
});

const registerMockColorCycleSnapshotRuntime = <
  TBrush extends object,
  TSnapshot extends {
    paintBuffer: ArrayBuffer;
    gradientIdBuffer?: ArrayBuffer;
    gradientDefIdBuffer?: ArrayBuffer;
    speedBuffer?: ArrayBuffer;
    flowBuffer?: ArrayBuffer;
    phaseBuffer?: ArrayBuffer;
    hasContent: boolean;
    strokeCounter: number;
  },
>(
  brush: TBrush,
  currentSnapshot: TSnapshot,
): TBrush => {
  registerColorCycleBrushLayerSnapshotRuntime(brush, {
    apply: (_layerId, snapshot) => {
      currentSnapshot.paintBuffer = snapshot.paintBuffer?.slice(0) ?? new ArrayBuffer(0);
      currentSnapshot.gradientIdBuffer = snapshot.gradientIdBuffer?.slice(0) ?? new ArrayBuffer(0);
      currentSnapshot.gradientDefIdBuffer = snapshot.gradientDefIdBuffer?.slice(0) ?? new ArrayBuffer(0);
      currentSnapshot.speedBuffer = snapshot.speedBuffer?.slice(0);
      currentSnapshot.flowBuffer = snapshot.flowBuffer?.slice(0);
      currentSnapshot.phaseBuffer = snapshot.phaseBuffer?.slice(0);
      currentSnapshot.hasContent = snapshot.hasContent ?? false;
      currentSnapshot.strokeCounter = snapshot.strokeCounter ?? 0;
    },
  });
  return brush;
};

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
    alignment: DEFAULT_ALIGNMENT,
    colorCycleData: undefined,
  };
};

const createColorCycleLayer = (
  id: string,
  gradient: Array<{ position: number; color: string; opacity?: number }>
): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = 2;
  framebuffer.height = 1;

  return {
    id,
    name: 'CC Layer',
    order: 0,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    layerType: 'color-cycle',
    imageData: new ImageData(2, 1),
    framebuffer,
    alignment: DEFAULT_ALIGNMENT,
    colorCycleData: {
      mode: 'brush',
      gradient: gradient.map((stop) => ({ ...stop })),
      gradientDefs: [{ id: 'g0', currentSlot: 0 }],
      slotPalettes: [{ slot: 0, stops: gradient.map((stop) => ({ ...stop })) }],
      activeGradientId: 'g0',
      paintSlot: 0,
    },
  };
};

const createColorCycleLayerWithSlotsOnly = (
  id: string,
  slotStops: Array<{ position: number; color: string; opacity?: number }>
): Layer => {
  const layer = createColorCycleLayer(id, slotStops);
  return {
    ...layer,
    colorCycleData: {
      ...layer.colorCycleData,
      gradient: undefined,
    },
  };
};

const createColorCycleRecolorLayerWithDefStore = (
  id: string,
  gradientStops: Array<{ position: number; color: string; opacity?: number }>
): Layer => {
  const layer = createColorCycleLayer(id, gradientStops);
  return {
    ...layer,
    colorCycleData: {
      ...layer.colorCycleData,
      mode: 'recolor',
      gradient: undefined,
      gradientDefStore: [{
        id: 1,
        kind: 'linear',
        stops: gradientStops.map((stop) => ({ ...stop })),
        hash: 'test-gradient-def',
        source: 'manual',
        createdAtMs: 0,
        slot: 0,
      }],
      recolorSettings: {
        quantizationMode: 'rgb332',
        ditherMode: 'off',
        animation: {
          speed: 1,
          fps: 30,
          ticksPerFrame: 1,
          isPlaying: true,
          currentTick: 0,
          flowDirection: 'forward',
        },
        cycleColors: 16,
        gradient: gradientStops.map((stop) => ({ ...stop })),
        currentLOD: 'full',
      },
    },
  };
};

const createColorCycleLayerWithDefStoreOnly = (
  id: string,
  gradientStops: Array<{ position: number; color: string; opacity?: number }>
): Layer => {
  const layer = createColorCycleLayer(id, gradientStops);
  return {
    ...layer,
    colorCycleData: {
      ...layer.colorCycleData,
      gradient: undefined,
      slotPalettes: [],
      gradientDefs: [],
      activeGradientId: undefined,
      paintSlot: undefined,
      gradientDefStore: [{
        id: 1,
        kind: 'linear',
        stops: gradientStops.map((stop) => ({ ...stop })),
        hash: 'def-only-gradient',
        source: 'manual',
        createdAtMs: 0,
        slot: 7,
      }],
      nextGradientDefId: 2,
    },
  };
};

const installProjectWithLayers = (layers: Layer[], activeLayerId = layers[0]?.id ?? null) => {
  useAppStore.setState((state) => ({
    layers,
    activeLayerId,
    selectedLayerIds: activeLayerId ? [activeLayerId] : [],
    project: state.project
      ? {
          ...state.project,
          width: layers[0]?.imageData?.width ?? state.project.width,
          height: layers[0]?.imageData?.height ?? state.project.height,
          layers,
        }
      : {
          id: 'test-project',
          name: 'Test Project',
          width: layers[0]?.imageData?.width ?? 2,
          height: layers[0]?.imageData?.height ?? 2,
          layers,
          backgroundColor: '#000000',
          createdAt: new Date(),
          updatedAt: new Date(),
          palette: useAppStore.getState().palette,
          metadata: {},
          autosaveEnabled: false,
          customBrushes: [],
        },
  }));
};

const installProjectWithLayer = (layer: Layer) => {
  installProjectWithLayers([layer], layer.id);
};

const resetStore = () => {
  useAppStore.setState((state) => ({
    ...state,
    layers: [],
    activeLayerId: null,
    selectionStart: null,
    selectionEnd: null,
    selectionMask: null,
    selectionMaskBounds: null,
    selectionMaskLayerId: null,
    pendingCompositeDirtyBatches: [],
    compositeSegments: [],
    layersNeedRecomposition: false,
    colorAdjust: {
      active: false,
      params: {
        hue: 0,
        saturation: 0,
        vibrance: 0,
        lightness: 0,
        contrast: 0,
        ccInkContrast: 0,
        red: 0,
        green: 0,
        blue: 0,
        hueRangeEnabled: false,
        hueRangeStart: 0,
        hueRangeEnd: 360,
      },
      originalImageData: null,
      originalColorCycleGradient: null,
      targetLayerType: null,
      selectionBounds: null,
      targetLayerId: null,
      targetLayerIds: [],
    },
  }));
};

const pixelAt = (image: ImageData, x: number, y: number): [number, number, number, number] => {
  const idx = (y * image.width + x) * 4;
  return [
    image.data[idx] ?? 0,
    image.data[idx + 1] ?? 0,
    image.data[idx + 2] ?? 0,
    image.data[idx + 3] ?? 0,
  ];
};

describe('colorAdjustSlice preview performance path', () => {
  beforeEach(() => {
    resetStore();
    mockColorCycleBrushManager.getGradientApplyBrush.mockReset();
    mockColorCycleBrushManager.getGradientApplyBrush.mockReturnValue(null);
    mockColorCycleBrushManager.getSurfaceBrush.mockReset();
    mockColorCycleBrushManager.getSurfaceBrush.mockReturnValue(null);
    mockColorCycleBrushManager.getSelectionMutationBrush.mockReset();
    mockColorCycleBrushManager.getSelectionMutationBrush.mockReturnValue(null);
    mockColorCycleBrushManager.getHistoryBrush.mockReset();
    mockColorCycleBrushManager.getHistoryBrush.mockReturnValue(null);
    mockColorCycleBrushManager.getSerializedStateBrush.mockReset();
    mockColorCycleBrushManager.getSerializedStateBrush.mockReturnValue(null);
  });

  afterEach(() => {
    resetStore();
  });

  it.each(['normal', 'color-cycle'] as const)(
    'keeps %s material unchanged when an active selection is outside the layer',
    async (type) => {
      const source = new ImageData(new Uint8ClampedArray([0, 128, 255, 255, 64, 96, 128, 128]), 2, 1);
      const gradient = [{ position: 0, color: '#0000ff' }, { position: 1, color: '#00ff00' }];
      const layer = type === 'normal'
        ? createLayer('outside-raster', source)
        : createColorCycleLayer('outside-cc', gradient);
      installProjectWithLayer(layer);
      useAppStore.setState({
        selectionStart: { x: -4, y: 0 },
        selectionEnd: { x: 0, y: 1 },
      });

      const store = useAppStore.getState();
      const historyBefore = historyManager.entries().length;
      store.startColorAdjustSession();
      store.updateColorAdjustParams({ hue: 120 });
      store.previewColorAdjust();
      await store.applyColorAdjust();

      const updated = useAppStore.getState().layers[0];
      if (type === 'normal') {
        expect(Array.from(updated.imageData!.data)).toEqual(Array.from(source.data));
      } else {
        expect(updated.colorCycleData?.gradient).toEqual(gradient);
        expect(updated.colorCycleData?.slotPalettes?.[0].stops).toEqual(gradient);
      }
      expect(useAppStore.getState().selectionStart).toEqual({ x: -4, y: 0 });
      expect(useAppStore.getState().selectionEnd).toEqual({ x: 0, y: 1 });
      expect(historyManager.entries()).toHaveLength(historyBefore);
    },
  );

  it.each(['normal', 'color-cycle'] as const)(
    'discards a pending %s preview if its target becomes locked before Apply',
    async (type) => {
      const source = new ImageData(new Uint8ClampedArray([0, 128, 255, 255, 64, 96, 128, 128]), 2, 1);
      const gradient = [{ position: 0, color: '#0000ff' }, { position: 1, color: '#00ff00' }];
      const layer = type === 'normal'
        ? createLayer('lock-raster', source)
        : createColorCycleLayer('lock-cc', gradient);
      installProjectWithLayer(layer);
      const store = useAppStore.getState();
      store.startColorAdjustSession();
      store.updateColorAdjustParams({ hue: 120 });
      store.previewColorAdjust();
      const preview = useAppStore.getState().layers[0];
      if (type === 'normal') {
        expect(Array.from(preview.imageData!.data)).not.toEqual(Array.from(source.data));
      } else {
        expect(preview.colorCycleData?.gradient).not.toEqual(gradient);
      }

      store.updateLayer(layer.id, { locked: true });
      await store.applyColorAdjust();

      const updated = useAppStore.getState().layers[0];
      expect(updated.locked).toBe(true);
      if (type === 'normal') {
        expect(Array.from(updated.imageData!.data)).toEqual(Array.from(source.data));
      } else {
        expect(updated.colorCycleData?.gradient).toEqual(gradient);
        expect(updated.colorCycleData?.slotPalettes?.[0].stops).toEqual(gradient);
      }
    },
  );

  it.each(['normal', 'color-cycle'] as const)(
    'cancels the complete mixed session if its %s target becomes locked',
    async (lockedType) => {
      const source = new ImageData(new Uint8ClampedArray([0, 128, 255, 255, 64, 96, 128, 128]), 2, 1);
      const gradient = [{ position: 0, color: '#0000ff' }, { position: 1, color: '#00ff00' }];
      const normal = createLayer('mixed-raster', source);
      const cc = createColorCycleLayer('mixed-cc', gradient);
      installProjectWithLayers([normal, cc], cc.id);
      useAppStore.setState({ selectedLayerIds: [normal.id, cc.id] });
      const store = useAppStore.getState();
      store.startColorAdjustSession();
      store.updateColorAdjustParams({ hue: 120 });
      store.previewColorAdjust();
      expect(Array.from(useAppStore.getState().layers[0].imageData!.data))
        .not.toEqual(Array.from(source.data));
      expect(useAppStore.getState().layers[1].colorCycleData?.gradient).not.toEqual(gradient);

      store.updateLayer(lockedType === 'normal' ? normal.id : cc.id, { locked: true });
      const rasterCommit = jest.spyOn(layerHistory, 'commitLayerHistory');
      const ccCommit = jest.spyOn(layerStructureHistory, 'commitLayerStructureHistory');
      try {
        await store.applyColorAdjust();
        const state = useAppStore.getState();
        expect(Array.from(state.layers[0].imageData!.data)).toEqual(Array.from(source.data));
        expect(state.layers[1].colorCycleData?.gradient).toEqual(gradient);
        expect(state.layers[0].locked).toBe(lockedType === 'normal');
        expect(state.layers[1].locked).toBe(lockedType === 'color-cycle');
        expect(state.colorAdjust.active).toBe(false);
        expect(rasterCommit).not.toHaveBeenCalled();
        expect(ccCommit).not.toHaveBeenCalled();
      } finally {
        rasterCommit.mockRestore();
        ccCommit.mockRestore();
      }
    },
  );

  it('limits adjustments to the selection ROI and leaves outside pixels untouched', () => {
    // 4x4 green image
    const base = new ImageData(4, 4);
    base.data.fill(0);
    for (let i = 0; i < base.data.length; i += 4) {
      base.data[i + 1] = 255; // green channel
      base.data[i + 3] = 255; // alpha
    }
    const layer = createLayer('roi-layer', base);
    installProjectWithLayer(layer);

    // Selection from (1,1) to (3,3) => width/height 2
    const selection: Rectangle = { x: 1, y: 1, width: 2, height: 2 };
    useAppStore.setState({
      selectionStart: { x: selection.x, y: selection.y },
      selectionEnd: { x: selection.x + selection.width, y: selection.y + selection.height },
    });

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ red: 100 });
    store.previewColorAdjust();

    const updated = useAppStore.getState().layers[0]?.imageData as ImageData;

    // Inside ROI: red increased (100% => +255)
    expect(pixelAt(updated, 1, 1)[0]).toBe(255);
    expect(pixelAt(updated, 2, 2)[0]).toBe(255);
    // Outside ROI: unchanged (still 0 red)
    expect(pixelAt(updated, 0, 0)[0]).toBe(0);
    expect(pixelAt(updated, 3, 3)[0]).toBe(0);
    expect(useAppStore.getState().pendingCompositeDirtyBatches).toEqual([
      {
        layerId: layer.id,
        version: 0,
        rects: [selection],
      },
    ]);
    expect(useAppStore.getState().layersNeedRecomposition).toBe(true);
  });

  it('previews saturation changes across all selected raster layers', () => {
    const first = new ImageData(1, 1);
    first.data.set([255, 0, 0, 255]);
    const second = new ImageData(1, 1);
    second.data.set([0, 255, 0, 255]);

    const layerA = createLayer('layer-a', first);
    const layerB = createLayer('layer-b', second);
    installProjectWithLayers([layerA, layerB], layerA.id);
    useAppStore.setState({ selectedLayerIds: [layerA.id, layerB.id] });

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ saturation: -100 });
    store.previewColorAdjust();

    const nextState = useAppStore.getState();
    const nextLayerA = nextState.layers.find((layer) => layer.id === layerA.id);
    const nextLayerB = nextState.layers.find((layer) => layer.id === layerB.id);

    expect(pixelAt(nextLayerA!.imageData!, 0, 0)).toEqual([128, 128, 128, 255]);
    expect(pixelAt(nextLayerB!.imageData!, 0, 0)).toEqual([128, 128, 128, 255]);
    expect(nextState.colorAdjust.targetLayerIds).toEqual([layerA.id, layerB.id]);
    expect(nextState.pendingCompositeDirtyBatches).toEqual([
      {
        layerId: layerA.id,
        version: 0,
        rects: [{ x: 0, y: 0, width: 1, height: 1 }],
      },
      {
        layerId: layerB.id,
        version: 0,
        rects: [{ x: 0, y: 0, width: 1, height: 1 }],
      },
    ]);
  });

  it('restores all selected raster layers on cancel', () => {
    const first = new ImageData(1, 1);
    first.data.set([255, 0, 0, 255]);
    const second = new ImageData(1, 1);
    second.data.set([0, 255, 0, 255]);

    const layerA = createLayer('layer-a', first);
    const layerB = createLayer('layer-b', second);
    installProjectWithLayers([layerA, layerB], layerA.id);
    useAppStore.setState({ selectedLayerIds: [layerA.id, layerB.id] });

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ saturation: -100 });
    store.previewColorAdjust();
    useAppStore.setState({ layersNeedRecomposition: false, pendingCompositeDirtyBatches: [] });
    store.cancelColorAdjust();

    const nextState = useAppStore.getState();
    const nextLayerA = nextState.layers.find((layer) => layer.id === layerA.id);
    const nextLayerB = nextState.layers.find((layer) => layer.id === layerB.id);

    expect(pixelAt(nextLayerA!.imageData!, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(nextLayerB!.imageData!, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(nextState.colorAdjust.targetLayerIds).toEqual([]);
    expect(nextState.pendingCompositeDirtyBatches).toEqual([
      {
        layerId: layerA.id,
        version: 0,
        rects: [{ x: 0, y: 0, width: 1, height: 1 }],
      },
      {
        layerId: layerB.id,
        version: 0,
        rects: [{ x: 0, y: 0, width: 1, height: 1 }],
      },
    ]);
  });

  it('reuses the working buffer across previews (no churn)', () => {
    const base = new ImageData(2, 2);
    base.data.set([
      0, 255, 0, 255, 0, 255, 0, 255,
      0, 255, 0, 255, 0, 255, 0, 255,
    ]);
    const layer = createLayer('reuse-layer', base);
    installProjectWithLayer(layer);
    useAppStore.setState({
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 2, y: 2 },
    });

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ red: 50 });
    store.previewColorAdjust();

    const firstRef = useAppStore.getState().layers[0]?.imageData as ImageData;
    // 50% => +127/128 (rounding)
    expect(pixelAt(firstRef, 0, 0)[0]).toBe(127);

    // Second preview with different adjustment should keep same ImageData object
    store.updateColorAdjustParams({ red: 20 });
    store.previewColorAdjust();
    const secondRef = useAppStore.getState().layers[0]?.imageData as ImageData;

    expect(firstRef).toBe(secondRef);
    expect(pixelAt(secondRef, 0, 0)[0]).toBe(51);
  });

  it('uses the latest selection bounds after the session starts', () => {
    const base = new ImageData(4, 1);
    base.data.set([
      0, 255, 0, 255,
      0, 255, 0, 255,
      0, 255, 0, 255,
      0, 255, 0, 255,
    ]);
    const layer = createLayer('moving-selection-layer', base);
    installProjectWithLayer(layer);
    useAppStore.setState({
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 1, y: 1 },
    });

    const store = useAppStore.getState();
    store.startColorAdjustSession();

    useAppStore.setState({
      selectionStart: { x: 2, y: 0 },
      selectionEnd: { x: 4, y: 1 },
    });

    store.updateColorAdjustParams({ red: 100 });
    store.previewColorAdjust();

    const updated = useAppStore.getState().layers[0]?.imageData as ImageData;
    expect(pixelAt(updated, 0, 0)[0]).toBe(0);
    expect(pixelAt(updated, 1, 0)[0]).toBe(0);
    expect(pixelAt(updated, 2, 0)[0]).toBe(255);
    expect(pixelAt(updated, 3, 0)[0]).toBe(255);
  });

  it('limits raster adjustments to mask-backed selections', () => {
    const base = new ImageData(3, 1);
    base.data.set([
      0, 255, 0, 255,
      0, 255, 0, 255,
      0, 255, 0, 255,
    ]);
    const layer = createLayer('mask-selection-layer', base);
    installProjectWithLayer(layer);

    const mask = new ImageData(3, 1);
    mask.data[7] = 255;

    useAppStore.setState({
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 3, y: 1 },
      selectionMask: mask,
      selectionMaskBounds: { x: 0, y: 0, width: 3, height: 1 },
    });

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ red: 100 });
    store.previewColorAdjust();

    const updated = useAppStore.getState().layers[0]?.imageData as ImageData;
    expect(pixelAt(updated, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(updated, 1, 0)).toEqual([255, 255, 0, 255]);
    expect(pixelAt(updated, 2, 0)).toEqual([0, 255, 0, 255]);
    expect(useAppStore.getState().pendingCompositeDirtyBatches).toEqual([
      {
        layerId: layer.id,
        version: 0,
        rects: [{ x: 0, y: 0, width: 3, height: 1 }],
      },
    ]);
  });

  it('adjusts gradient colors for color-cycle brush layers', () => {
    const layer = createColorCycleLayer('cc-layer', [
      { position: 0, color: '#000000' },
      { position: 1, color: '#101010' },
    ]);
    installProjectWithLayer(layer);

    const store = useAppStore.getState();
    const originalUpdateLayer = store.updateLayer;
    const updateLayerSpy = jest.fn(originalUpdateLayer);
    useAppStore.setState({ updateLayer: updateLayerSpy });
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ red: 100 });
    store.previewColorAdjust();

    const updatedLayer = useAppStore.getState().layers[0];
    const updatedGradient = updatedLayer?.colorCycleData?.gradient ?? [];

    expect(updatedGradient.length).toBe(2);
    const firstColor = parseCssColor(updatedGradient[0]?.color ?? '#000000');
    const secondColor = parseCssColor(updatedGradient[1]?.color ?? '#000000');
    expect(firstColor.r).toBe(255);
    expect(secondColor.r).toBe(255);
    expect(updateLayerSpy).not.toHaveBeenCalled();
    expect(useAppStore.getState().pendingCompositeDirtyBatches).toEqual([
      {
        layerId: layer.id,
        version: 0,
        rects: [{ x: 0, y: 0, width: 2, height: 1 }],
      },
    ]);
  });

  it('keeps fixed-midpoint Contrast behavior for color-cycle gradient colors', () => {
    const layer = createColorCycleLayer('cc-standard-contrast', [
      { position: 0, color: 'rgb(32, 32, 32)' },
      { position: 1, color: 'rgb(64, 64, 64)' },
    ]);
    installProjectWithLayer(layer);

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ contrast: -50 });
    store.previewColorAdjust();

    const stops = useAppStore.getState().layers[0]?.colorCycleData?.gradient ?? [];
    const values = stops.map((stop) => parseCssColor(stop.color).r);

    expect(values).toEqual([96, 106]);
  });

  it('adjusts contrast between inks around each color-cycle gradient center', () => {
    const layer = createColorCycleRecolorLayerWithDefStore('cc-ink-contrast', [
      { position: 0, color: 'rgb(32, 32, 32)' },
      { position: 1, color: 'rgb(64, 64, 64)' },
    ]);
    layer.colorCycleData = {
      ...layer.colorCycleData,
      gradientDefStore: [
        ...(layer.colorCycleData?.gradientDefStore ?? []),
        {
          id: 2,
          kind: 'linear',
          stops: [
            { position: 0, color: 'rgb(192, 192, 192)' },
            { position: 1, color: 'rgb(224, 224, 224)' },
          ],
          hash: 'light-gradient-def',
          source: 'manual',
          createdAtMs: 0,
          slot: 1,
        },
      ],
    };
    installProjectWithLayer(layer);

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ ccInkContrast: 50 });
    store.previewColorAdjust();

    const definitions = useAppStore.getState().layers[0]?.colorCycleData?.gradientDefStore ?? [];
    const darkValues = definitions[0]?.stops.map((stop) => parseCssColor(stop.color).r) ?? [];
    const lightValues = definitions[1]?.stops.map((stop) => parseCssColor(stop.color).r) ?? [];

    expect(darkValues[0]).toBeLessThan(32);
    expect(darkValues[1]).toBeGreaterThan(64);
    expect(lightValues[0]).toBeLessThan(192);
    expect(lightValues[1]).toBeGreaterThan(224);
    expect(Math.abs(((darkValues[0] ?? 0) + (darkValues[1] ?? 0)) / 2 - 48)).toBeLessThanOrEqual(1);
    expect(Math.abs(((lightValues[0] ?? 0) + (lightValues[1] ?? 0)) / 2 - 208)).toBeLessThanOrEqual(1);
  });

  it('temporarily restores originals for picking and applies the retained adjustment afterwards', async () => {
    const layer = createColorCycleLayer('cc-pick', [
      { position: 0, color: 'rgb(0, 0, 128)' },
      { position: 1, color: 'rgb(0, 128, 0)' },
    ]);
    installProjectWithLayer(layer);
    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ lightness: 20 });
    store.previewColorAdjust();
    store.setColorAdjustPickingTarget(true);
    expect(parseCssColor(useAppStore.getState().layers[0].colorCycleData!.gradient![0].color).b).toBe(128);
    store.pickColorAdjustTarget('rgb(0, 0, 128)');
    store.previewColorAdjust();
    expect(useAppStore.getState().colorAdjust.isPickingTarget).toBe(false);
    expect(useAppStore.getState().colorAdjust.params.lightness).toBe(20);
    const stops = useAppStore.getState().layers[0].colorCycleData!.gradient!;
    expect(parseCssColor(stops[0].color).b).toBeGreaterThan(128);
    expect(parseCssColor(stops[1].color).g).toBe(128);
    store.setColorAdjustPickingTarget(true);
    await store.applyColorAdjust();
    expect(parseCssColor(useAppStore.getState().layers[0].colorCycleData!.gradient![0].color).b).toBeGreaterThan(128);
  });

  it('restricts CC ink contrast with lightness and saturation targets', () => {
    const layer = createColorCycleLayer('cc-target-ink', [
      { position: 0, color: 'rgb(0, 0, 64)' },
      { position: 0.5, color: 'rgb(64, 64, 64)' },
      { position: 1, color: 'rgb(128, 128, 255)' },
    ]);
    installProjectWithLayer(layer);
    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ ccInkContrast: 50, lightnessRangeEnabled: true,
      lightnessRangeStart: 0, lightnessRangeEnd: 30,
      saturationRangeEnabled: true, saturationRangeStart: 50, saturationRangeEnd: 100 });
    store.previewColorAdjust();
    const stops = useAppStore.getState().layers[0].colorCycleData!.gradient!;
    expect(stops[0].color).not.toBe('rgb(0, 0, 64)');
    expect(parseCssColor(stops[1].color)).toMatchObject({ r: 64, g: 64, b: 64 });
    expect(parseCssColor(stops[2].color)).toMatchObject({ r: 128, g: 128, b: 255 });
  });

  it('compresses color-cycle inks independently of fixed-midpoint contrast', () => {
    const layer = createColorCycleLayer('cc-ink-compression', [
      { position: 0, color: 'rgb(32, 32, 32)' },
      { position: 1, color: 'rgb(64, 64, 64)' },
    ]);
    installProjectWithLayer(layer);

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ ccInkContrast: -50 });
    store.previewColorAdjust();

    const stops = useAppStore.getState().layers[0]?.colorCycleData?.gradient ?? [];
    const values = stops.map((stop) => parseCssColor(stop.color).r);

    expect(values[0]).toBeGreaterThan(32);
    expect(values[1]).toBeLessThan(64);
    expect((values[1] ?? 0) - (values[0] ?? 0)).toBeLessThan(32);
    expect(Math.abs(((values[0] ?? 0) + (values[1] ?? 0)) / 2 - 48)).toBeLessThanOrEqual(1);
  });

  it('does not weight a repeated cyclic endpoint as an extra color-cycle ink', () => {
    const layer = createColorCycleLayer('cc-repeated-endpoint', [
      { position: 0, color: 'rgb(32, 32, 32)' },
      { position: 0.5, color: 'rgb(64, 64, 64)' },
      { position: 1, color: 'rgb(32, 32, 32)' },
    ]);
    installProjectWithLayer(layer);

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ ccInkContrast: -100 });
    store.previewColorAdjust();

    const stops = useAppStore.getState().layers[0]?.colorCycleData?.gradient ?? [];
    const values = stops.map((stop) => parseCssColor(stop.color).r);

    expect(new Set(values).size).toBe(1);
    expect(values[0]).toBeGreaterThanOrEqual(47);
    expect(values[0]).toBeLessThanOrEqual(50);
  });

  it('applies hue-range targeting to raster previews using the current selection bounds', () => {
    const base = new ImageData(2, 1);
    base.data.set([
      255, 0, 0, 255,
      0, 255, 0, 255,
    ]);
    const layer = createLayer('targeted-raster-layer', base);
    installProjectWithLayer(layer);

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({
      saturation: -100,
      hueRangeEnabled: true,
      hueRangeStart: 0,
      hueRangeEnd: 40,
    });
    store.previewColorAdjust();

    const updated = useAppStore.getState().layers[0]?.imageData as ImageData;
    expect(pixelAt(updated, 0, 0)).toEqual([128, 128, 128, 255]);
    expect(pixelAt(updated, 1, 0)).toEqual([0, 255, 0, 255]);
  });

  it('adjusts slot palettes for color-cycle layers that only persist slot palettes', () => {
    const layer = createColorCycleLayerWithSlotsOnly('cc-layer-slots', [
      { position: 0, color: '#000000' },
      { position: 1, color: '#101010' },
    ]);
    installProjectWithLayer(layer);

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ red: 100 });
    store.previewColorAdjust();

    const updatedLayer = useAppStore.getState().layers[0];
    const slotStops = updatedLayer?.colorCycleData?.slotPalettes?.[0]?.stops ?? [];
    expect(slotStops.length).toBe(2);
    const firstColor = parseCssColor(slotStops[0]?.color ?? '#000000');
    expect(firstColor.r).toBe(255);
  });

  it('adjusts recolor gradients and gradient def store without changing slot count', () => {
    const layer = createColorCycleRecolorLayerWithDefStore('cc-layer-recolor', [
      { position: 0, color: '#000000' },
      { position: 1, color: '#101010' },
    ]);
    installProjectWithLayer(layer);

    const store = useAppStore.getState();
    const originalSlotCount = layer.colorCycleData?.slotPalettes?.length ?? 0;
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ red: 100 });
    store.previewColorAdjust();

    const updatedLayer = useAppStore.getState().layers[0];
    const updatedSlotCount = updatedLayer?.colorCycleData?.slotPalettes?.length ?? 0;
    const recolorStops = updatedLayer?.colorCycleData?.recolorSettings?.gradient ?? [];
    const defStore = updatedLayer?.colorCycleData?.gradientDefStore ?? [];
    const defStoreStops = defStore[0]?.stops ?? [];

    expect(updatedSlotCount).toBe(originalSlotCount);
    expect(recolorStops.length).toBe(2);
    expect(defStoreStops.length).toBe(2);
    expect(parseCssColor(recolorStops[0]?.color ?? '#000000').r).toBe(255);
    expect(parseCssColor(defStoreStops[0]?.color ?? '#000000').r).toBe(255);
    expect(defStore[0]?.hash).not.toBe('test-gradient-def');
  });

  it('preserves color-cycle stop opacity while adjusting hue and saturation', () => {
    const layer = createColorCycleRecolorLayerWithDefStore('cc-layer-transparent', [
      { position: 0, color: '#b7ff00' },
      { position: 0.5, color: '#fff200', opacity: 0 },
      { position: 1, color: '#7fff00' },
    ]);
    installProjectWithLayer(layer);

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ hue: 20, saturation: -25 });
    store.previewColorAdjust();

    const updatedLayer = useAppStore.getState().layers[0];
    const adjustedTransparentStops = [
      updatedLayer?.colorCycleData?.gradientDefStore?.[0]?.stops[1],
      updatedLayer?.colorCycleData?.slotPalettes?.[0]?.stops[1],
      updatedLayer?.colorCycleData?.recolorSettings?.gradient[1],
    ];

    adjustedTransparentStops.forEach((stop) => {
      expect(stop?.opacity).toBe(0);
      expect(parseCssColor(stop?.color ?? '#ffffff').a).toBe(255);
    });
  });

  it('refreshes gradient-def runtime for brush-mode color-cycle previews', () => {
    const layer = createColorCycleRecolorLayerWithDefStore('cc-def-runtime', [
      { position: 0, color: 'rgb(255, 0, 0)' },
      { position: 1, color: 'rgb(255, 255, 0)' },
    ]);
    const brushLayer: Layer = {
      ...layer,
      colorCycleData: {
        ...layer.colorCycleData,
        mode: 'brush',
      },
    };
    installProjectWithLayer(brushLayer);

    const setLayerColorCycleMeta = jest.fn();
    const syncGradientDefRuntime = jest.fn();
    mockColorCycleBrushManager.getGradientApplyBrush.mockReturnValue({
      setLayerColorCycleMeta,
      syncGradientDefRuntime,
    });

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ saturation: -100 });
    store.previewColorAdjust();

    expect(setLayerColorCycleMeta).toHaveBeenCalledWith(
      'cc-def-runtime',
      expect.objectContaining({
        gradientDefStore: expect.any(Array),
      }),
    );
    const runtimeMeta = setLayerColorCycleMeta.mock.calls[0]?.[1];
    const adjustedStop = parseCssColor(
      runtimeMeta?.gradientDefStore?.[0]?.stops[0]?.color ?? '#000000',
    );
    expect(adjustedStop.r).toBe(adjustedStop.g);
    expect(adjustedStop.g).toBe(adjustedStop.b);
    expect(setLayerColorCycleMeta.mock.invocationCallOrder[0]).toBeLessThan(
      syncGradientDefRuntime.mock.invocationCallOrder[0],
    );
    expect(syncGradientDefRuntime).toHaveBeenCalledWith('cc-def-runtime');
  });

  it('publishes the current whole-layer palette with restored paint after consecutive previews', () => {
    const layerId = 'cc-current-preview-document';
    const sourceStops = [
      { position: 0, color: 'rgb(255, 0, 0)', opacity: 1 },
      { position: 0.5, color: 'rgb(0, 255, 0)', opacity: 1 },
      { position: 1, color: 'rgb(0, 0, 255)', opacity: 1 },
    ];
    const layer = createColorCycleLayer(layerId, sourceStops);
    layer.colorCycleData = {
      ...layer.colorCycleData,
      gradientDefStore: [{
        id: 1,
        kind: 'concentric',
        stops: sourceStops,
        sourceStops,
        hash: 'original-rgb',
        source: 'manual',
        createdAtMs: 0,
        slot: 0,
      }],
    };
    installProjectWithLayer(layer);

    const planes = {
      paintBuffer: new Uint8Array([1, 1]).buffer,
      gradientIdBuffer: new Uint8Array([0, 0]).buffer,
      gradientDefIdBuffer: new Uint16Array([1, 1]).buffer,
      speedBuffer: new Uint8Array([25, 25]).buffer,
      flowBuffer: new Uint8Array([1, 1]).buffer,
      phaseBuffer: new Uint8Array([0, 0]).buffer,
    };
    const serializeStop = (stop: GradientStop) => ({
      ...stop,
      color: typeof stop.color === 'string'
        ? stop.color
        : `rgb(${stop.color.r}, ${stop.color.g}, ${stop.color.b})`,
    });
    const readSeamProfile = (value: unknown): GradientSeamProfile | undefined => {
      if (value === undefined || value === 'hard' || value === 'soft') return value;
      throw new Error('Unexpected fixture gradient seam profile');
    };
    const documentMetadata = (metadata: ColorCycleBrushPersistenceLayerMeta | null) => ({
      ...metadata,
      slotPalettes: metadata?.slotPalettes?.map((entry) => ({
        ...entry,
        stops: entry.stops.map(serializeStop),
        seamProfile: readSeamProfile(entry.seamProfile),
      })),
      gradientDefStore: metadata?.gradientDefStore?.map((entry) => ({
        ...entry,
        stops: entry.stops.map(serializeStop),
        sourceStops: entry.sourceStops?.map(serializeStop),
        seamProfile: readSeamProfile(entry.seamProfile),
      })),
    });
    const document = new ColorCycleLayerDocument({
      layerId,
      width: 2,
      height: 1,
      ...planes,
      ...documentMetadata(createColorCycleBrushPersistenceLayerMetaFromLayerData(layer.colorCycleData)),
      hasContent: true,
      sources: { brushStateSnapshot: true, topLevelBuffers: false, legacyStateRefs: false },
    });
    const brush = {
      getColorCycleLayerDocument: () => document,
      setLayerColorCycleMeta: (id: string, meta: ColorCycleBrushPersistenceLayerMeta | null) => {
        setColorCycleBrushPersistenceLayerMeta(brush, id, meta);
      },
      syncGradientDefRuntime: jest.fn(),
    };
    registerColorCycleBrushLayerSnapshotRuntime(brush, {
      apply: (id, snapshot) => {
        // The runtime publication boundary assembles paint with metadata visible now.
        const currentLayer = useAppStore.getState().layers.find((entry) => entry.id === id);
        const metadata = mergeColorCycleBrushPersistenceLayerMetaForOwner(
          brush,
          id,
          createColorCycleBrushPersistenceLayerMetaFromLayerData(currentLayer?.colorCycleData),
        );
        document.replaceState({
          ...document.read().snapshot,
          ...documentMetadata(metadata),
          paintBuffer: snapshot.paintBuffer?.slice(0),
          gradientIdBuffer: snapshot.gradientIdBuffer?.slice(0),
          gradientDefIdBuffer: snapshot.gradientDefIdBuffer?.slice(0),
          speedBuffer: snapshot.speedBuffer?.slice(0),
          flowBuffer: snapshot.flowBuffer?.slice(0),
          phaseBuffer: snapshot.phaseBuffer?.slice(0),
          hasContent: snapshot.hasContent ?? false,
        }, 'snapshot-apply');
      },
    });
    mockColorCycleBrushManager.getSelectionMutationBrush.mockReturnValue(brush);
    mockColorCycleBrushManager.getGradientApplyBrush.mockReturnValue(brush);
    const store = useAppStore.getState();
    const original = document.read().snapshot;
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ hue: 121 });
    store.previewColorAdjust();
    store.updateColorAdjustParams({ hue: 120 });
    store.previewColorAdjust();

    const rgb = (stops: Array<{ color: string }> | undefined) => stops?.map((stop) => {
      const parsed = parseCssColor(stop.color);
      return [parsed.r, parsed.g, parsed.b];
    });
    const expected = [[0, 255, 0], [0, 0, 255], [255, 0, 0]];
    const currentData = useAppStore.getState().layers[0].colorCycleData;
    expect(rgb(currentData?.gradientDefStore?.[0].stops)).toEqual(expected);
    const published = document.read().snapshot;
    expect(rgb(published.gradientDefStore?.[0].stops)).toEqual(expected);
    expect(rgb(published.gradientDefStore?.[0].sourceStops)).toEqual(expected);
    expect(rgb(published.slotPalettes?.[0].stops)).toEqual(expected);
    for (const key of Object.keys(planes) as Array<keyof typeof planes>) {
      expect(published[key]).toEqual(original[key]);
    }

    store.resetColorAdjustParams();
    store.previewColorAdjust();
    expect(document.read().snapshot).toEqual(original);
    store.updateColorAdjustParams({ hue: 121 });
    store.previewColorAdjust();
    store.updateColorAdjustParams({ hue: 120 });
    store.previewColorAdjust();
    expect(rgb(document.read().snapshot.gradientDefStore?.[0].stops)).toEqual(expected);
    store.cancelColorAdjust();
    expect(document.read().snapshot).toEqual(original);
  });

  it('applies hue-range targeting to color-cycle gradients', () => {
    const layer = createColorCycleLayer('cc-targeted-layer', [
      { position: 0, color: 'rgb(255, 0, 0)' },
      { position: 1, color: 'rgb(0, 255, 0)' },
    ]);
    installProjectWithLayer(layer);

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({
      saturation: -100,
      hueRangeEnabled: true,
      hueRangeStart: 0,
      hueRangeEnd: 40,
    });
    store.previewColorAdjust();

    const updatedGradient = useAppStore.getState().layers[0]?.colorCycleData?.gradient ?? [];
    expect(parseCssColor(updatedGradient[0]?.color ?? '#000000')).toMatchObject({ r: 128, g: 128, b: 128 });
    expect(parseCssColor(updatedGradient[1]?.color ?? '#000000')).toMatchObject({ r: 0, g: 255, b: 0 });
  });

  it('supports wrap-around hue targeting for color-cycle gradients', () => {
    const layer = createColorCycleLayer('cc-wrap-layer', [
      { position: 0, color: 'rgb(255, 0, 0)' },
      { position: 1, color: 'rgb(255, 255, 0)' },
    ]);
    installProjectWithLayer(layer);

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({
      saturation: -100,
      hueRangeEnabled: true,
      hueRangeStart: 330,
      hueRangeEnd: 20,
    });
    store.previewColorAdjust();

    const updatedGradient = useAppStore.getState().layers[0]?.colorCycleData?.gradient ?? [];
    expect(parseCssColor(updatedGradient[0]?.color ?? '#000000')).toMatchObject({ r: 128, g: 128, b: 128 });
    expect(parseCssColor(updatedGradient[1]?.color ?? '#000000')).toMatchObject({ r: 255, g: 255, b: 0 });
  });

  it.each(['neutral entry', 'positive preview then Reset', 'no-input Apply'] as const)(
    'preserves selected CC bindings and neutral history for %s',
    async (scenario) => {
      const sourceStops = [
        { position: 0, color: 'rgb(255, 0, 0)', opacity: 1 },
        { position: 1, color: 'rgb(255, 255, 0)', opacity: 1 },
      ];
      const layer = createColorCycleLayerWithDefStoreOnly('cc-neutral-selected', sourceStops);
      layer.colorCycleData = {
        ...layer.colorCycleData,
        gradient: sourceStops,
        gradientDefs: [{ id: 'g0', currentSlot: 0 }],
        slotPalettes: [{ slot: 0, stops: sourceStops }],
        gradientDefStore: layer.colorCycleData?.gradientDefStore?.map((entry) => ({ ...entry, slot: 0 })),
        activeGradientId: 'g0',
        paintSlot: 0,
      };
      installProjectWithLayer(layer);
      const currentSnapshot = {
        paintBuffer: new Uint8Array([1, 1]).buffer,
        gradientIdBuffer: new Uint8Array([0, 0]).buffer,
        gradientDefIdBuffer: new Uint16Array([1, 1]).buffer,
        speedBuffer: new Uint8Array([25, 25]).buffer,
        flowBuffer: new Uint8Array([1, 1]).buffer,
        phaseBuffer: new Uint8Array([0, 0]).buffer,
        hasContent: true,
        strokeCounter: 0,
      };
      const originalSnapshot = structuredClone(currentSnapshot);
      const brush = registerMockColorCycleSnapshotRuntime({
        getColorCycleLayerDocument: () => makeColorCycleLayerDocumentReader(layer.id, currentSnapshot),
        getCanvas: () => layer.framebuffer,
        renderDirectToCanvas: jest.fn(),
        setLayerColorCycleMeta: jest.fn(),
        syncGradientDefRuntime: jest.fn(),
      }, currentSnapshot);
      mockColorCycleBrushManager.getSelectionMutationBrush.mockReturnValue(brush);
      mockColorCycleBrushManager.getSurfaceBrush.mockReturnValue(brush);
      mockColorCycleBrushManager.getGradientApplyBrush.mockReturnValue(brush);
      mockColorCycleBrushManager.getHistoryBrush.mockReturnValue(brush);
      useAppStore.setState({
        selectionStart: { x: 0, y: 0 },
        selectionEnd: { x: 1, y: 1 },
      });
      const metadata = () => {
        const data = useAppStore.getState().layers[0].colorCycleData;
        return structuredClone({
          gradient: data?.gradient,
          gradientDefs: data?.gradientDefs,
          slotPalettes: data?.slotPalettes,
          gradientDefStore: data?.gradientDefStore,
          nextGradientDefId: data?.nextGradientDefId,
          paintSlot: data?.paintSlot,
        });
      };
      const originalMetadata = metadata();
      const historyBefore = historyManager.entries().length;
      const store = useAppStore.getState();
      store.startColorAdjustSession();

      if (scenario === 'positive preview then Reset') {
        store.updateColorAdjustParams({ hue: 120 });
        store.previewColorAdjust();
        expect(Array.from(new Uint16Array(currentSnapshot.gradientDefIdBuffer))).toEqual([2, 1]);
        const adjusted = useAppStore.getState().layers[0].colorCycleData?.gradientDefStore?.find(
          (entry) => entry.id === 2,
        );
        expect(parseCssColor(adjusted?.stops[0].color ?? '#000000')).toMatchObject({ r: 0, g: 255, b: 0 });
        store.resetColorAdjustParams();
        store.previewColorAdjust();
      } else if (scenario === 'no-input Apply') {
        await store.applyColorAdjust();
      } else {
        store.previewColorAdjust();
      }

      expect(Array.from(new Uint8Array(currentSnapshot.gradientIdBuffer))).toEqual([0, 0]);
      expect(Array.from(new Uint16Array(currentSnapshot.gradientDefIdBuffer))).toEqual([1, 1]);
      expect(currentSnapshot).toEqual(originalSnapshot);
      expect(metadata()).toEqual(originalMetadata);
      expect(historyManager.entries()).toHaveLength(historyBefore);
      store.cancelColorAdjust();
    },
  );

  it('replays mixed raster and CC edits without rewinding the raster twice', async () => {
    historyManager.clear();
    const source = new ImageData(new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255]), 2, 1);
    const normal = createLayer('mixed-history-normal', source);
    const cc = createColorCycleLayer('mixed-history-cc', [
      { position: 0, color: '#ff0000' },
      { position: 1, color: '#0000ff' },
    ]);
    if (!(normal.framebuffer instanceof HTMLCanvasElement)) throw new Error('Expected normal fixture canvas');
    const context = normal.framebuffer.getContext('2d');
    if (!context) throw new Error('Expected normal fixture context');
    let framebufferPixels = source.data.slice();
    const putPixels = jest.spyOn(context, 'putImageData').mockImplementation((image) => {
      framebufferPixels = image.data.slice();
    });
    const getPixels = jest.spyOn(context, 'getImageData').mockImplementation((x, y, width, height) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const offset = ((y + row) * 2 + x + col) * 4;
          data.set(framebufferPixels.subarray(offset, offset + 4), (row * width + col) * 4);
        }
      }
      return new ImageData(data, width, height);
    });
    const capture = jest.spyOn(layerStructureHistory, 'captureLayerStructureSnapshot');
    try {
      installProjectWithLayers([normal, cc], normal.id);
      useAppStore.setState({ selectedLayerIds: [normal.id, cc.id] });
      const ccMetadata = () => {
        const data = useAppStore.getState().layers.find((layer) => layer.id === cc.id)?.colorCycleData;
        return structuredClone({
          gradient: data?.gradient,
          gradientDefs: data?.gradientDefs,
          gradientDefStore: data?.gradientDefStore,
          slotPalettes: data?.slotPalettes,
          activeGradientId: data?.activeGradientId,
          paintSlot: data?.paintSlot,
          nextGradientDefId: data?.nextGradientDefId,
        });
      };
      const originalCcMetadata = ccMetadata();
      const store = useAppStore.getState();
      store.startColorAdjustSession();
      const initialCapture = capture.mock.results[0];
      if (!initialCapture || initialCapture.type !== 'return') throw new Error('Expected session baseline');
      const sessionBaseline = initialCapture.value;
      store.updateColorAdjustParams({ hue: 120 });
      store.previewColorAdjust();
      await store.applyColorAdjust();
      const emitted = historyManager.entries();
      expect(emitted.map((entry) => entry.deltas.map((delta) => delta._tag))).toEqual([
        ['bitmap-tile'],
        ['layer-structure'],
      ]);
      const afterCapture = capture.mock.results[1];
      if (!afterCapture || afterCapture.type !== 'return') throw new Error('Expected CC after snapshot');
      const afterSnapshot = afterCapture.value;
      const committedCcMetadata = ccMetadata();
      // Only external renderer hydration is isolated; replay uses the actual emitted deltas.
      const replay = new HistoryManager({
        runtimeRehydration: { createTargets: createRehydrationTargets, rehydrate: async () => {} },
      });
      for (const entry of emitted) {
        const transaction = replay.begin(entry.action, entry.meta);
        entry.deltas.forEach((delta) => transaction.push(delta));
        transaction.commit(entry.label);
      }
      const red = [255, 0, 0, 255, 255, 0, 0, 255];
      const green = [0, 255, 0, 255, 0, 255, 0, 255];
      const expectMaterial = (
        raster: number[],
        ccRgb: { r: number; g: number; b: number },
        expectedCcMetadata: ReturnType<typeof ccMetadata>,
      ) => {
        const layers = useAppStore.getState().layers;
        const rasterLayer = layers.find((layer) => layer.id === normal.id);
        const ccLayer = layers.find((layer) => layer.id === cc.id);
        const framebuffer = rasterLayer?.framebuffer;
        if (!(framebuffer instanceof HTMLCanvasElement)) throw new Error('Expected replayed normal canvas');
        expect(Array.from(rasterLayer?.imageData?.data ?? [])).toEqual(raster);
        expect(Array.from(framebuffer.getContext('2d')?.getImageData(0, 0, 2, 1).data ?? [])).toEqual(raster);
        expect(parseCssColor(ccLayer?.colorCycleData?.slotPalettes?.[0].stops[0].color ?? '#000000')).toMatchObject(ccRgb);
        expect(ccMetadata()).toEqual(expectedCcMetadata);
      };
      expectMaterial(green, { r: 0, g: 255, b: 0 }, committedCcMetadata);
      for (let cycle = 0; cycle < 2; cycle++) {
        await replay.undo();
        expectMaterial(green, { r: 255, g: 0, b: 0 }, originalCcMetadata);
        expect(replay.entries()).toHaveLength(1);
        await replay.undo();
        expectMaterial(red, { r: 255, g: 0, b: 0 }, originalCcMetadata);
        expect(replay.entries()).toHaveLength(0);
        await replay.redo();
        expectMaterial(green, { r: 255, g: 0, b: 0 }, originalCcMetadata);
        expect(replay.entries()).toHaveLength(1);
        await replay.redo();
        expectMaterial(green, { r: 0, g: 255, b: 0 }, committedCcMetadata);
        expect(replay.entries()).toHaveLength(2);
      }
      expect(Array.from(sessionBaseline.snapshot.layers.find((layer) => layer.id === normal.id)?.imageData?.data ?? [])).toEqual(red);
      expect(Array.from(afterSnapshot.snapshot.layers.find((layer) => layer.id === normal.id)?.imageData?.data ?? [])).toEqual(green);
    } finally {
      capture.mockRestore();
      putPixels.mockRestore();
      getPixels.mockRestore();
      historyManager.clear();
    }
  });

  it('preserves a normal selection mask and vector while replaying its adjusted pixels', async () => {
    historyManager.clear();
    const source = new ImageData(new Uint8ClampedArray([
      255, 0, 0, 255, 255, 0, 0, 255,
      255, 0, 0, 255, 255, 0, 0, 255,
    ]), 2, 2);
    const layer = createLayer('masked-normal-history', source);
    installProjectWithLayer(layer);
    const mask = new ImageData(new Uint8ClampedArray([
      0, 0, 0, 255, 0, 0, 0, 255,
      0, 0, 0, 255, 0, 0, 0, 0,
    ]), 2, 2);
    useAppStore.setState({
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 2, y: 2 },
      selectionMask: mask,
      selectionMaskBounds: { x: 0, y: 0, width: 2, height: 2 },
      selectionMaskLayerId: layer.id,
      selectionVectorPath: {
        mode: 'freehand',
        points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }],
      },
      selectionLastAction: {
        action: 'set-bounds',
        source: 'freehand-selection',
        ownerKind: 'mask-selection',
        t: 123,
        activeLayerId: layer.id,
        maskLayerId: layer.id,
        bounds: { x: 0, y: 0, width: 2, height: 2 },
      },
    });
    const originalSelection = selectionSnapshotFromState(useAppStore.getState());
    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ hue: 120 });
    store.previewColorAdjust();
    await store.applyColorAdjust();
    const adjusted = [
      0, 255, 0, 255, 0, 255, 0, 255,
      0, 255, 0, 255, 255, 0, 0, 255,
    ];
    expect(Array.from(useAppStore.getState().layers[0].imageData?.data ?? [])).toEqual(adjusted);
    expect(selectionSnapshotFromState(useAppStore.getState())).toEqual(originalSelection);
    expect(historyManager.entries()).toHaveLength(1);
    const replay = new HistoryManager({
      runtimeRehydration: { createTargets: createRehydrationTargets, rehydrate: async () => {} },
    });
    for (const entry of historyManager.entries()) {
      const transaction = replay.begin(entry.action, entry.meta);
      entry.deltas.forEach((delta) => transaction.push(delta));
      transaction.commit(entry.label);
    }
    try {
      for (let cycle = 0; cycle < 2; cycle++) {
        await replay.undo();
        expect(Array.from(useAppStore.getState().layers[0].imageData?.data ?? [])).toEqual(Array.from(source.data));
        expect(selectionSnapshotFromState(useAppStore.getState())).toEqual(originalSelection);
        await replay.redo();
        expect(Array.from(useAppStore.getState().layers[0].imageData?.data ?? [])).toEqual(adjusted);
        expect(selectionSnapshotFromState(useAppStore.getState())).toEqual(originalSelection);
      }
    } finally {
      historyManager.clear();
    }
  });

  it('limits color-cycle preview adjustments to the selected region by remapping slot ids', () => {
    const layer = createColorCycleLayer('cc-selection-layer', [
      { position: 0, color: 'rgb(255, 0, 0)' },
      { position: 1, color: 'rgb(255, 255, 0)' },
    ]);
    installProjectWithLayer(layer);

    const currentSnapshot = {
      paintBuffer: new Uint8Array([1, 1]).buffer,
      gradientIdBuffer: new Uint8Array([0, 0]).buffer,
      hasContent: true,
      strokeCounter: 0,
    };
    const applyLayerSnapshot = jest.fn((_: string, payload: typeof currentSnapshot) => {
      currentSnapshot.paintBuffer = payload.paintBuffer.slice(0);
      currentSnapshot.gradientIdBuffer = payload.gradientIdBuffer?.slice(0) ?? new ArrayBuffer(0);
      currentSnapshot.hasContent = payload.hasContent;
      currentSnapshot.strokeCounter = payload.strokeCounter;
    });
    const brush = {
      getColorCycleLayerDocument: jest.fn(() => makeColorCycleLayerDocumentReader(layer.id, currentSnapshot)),
      getLayerSnapshot: jest.fn(() => ({
        paintBuffer: currentSnapshot.paintBuffer.slice(0),
        gradientIdBuffer: currentSnapshot.gradientIdBuffer.slice(0),
        hasContent: currentSnapshot.hasContent,
        strokeCounter: currentSnapshot.strokeCounter,
      })),
      applyLayerSnapshot,
      renderDirectToCanvas: jest.fn(),
      getCanvas: jest.fn(() => layer.framebuffer),
    };
    registerMockColorCycleSnapshotRuntime(brush, currentSnapshot);
    mockColorCycleBrushManager.getSelectionMutationBrush.mockReturnValue(brush);
    mockColorCycleBrushManager.getSurfaceBrush.mockReturnValue(brush);
    mockColorCycleBrushManager.getGradientApplyBrush.mockReturnValue(brush);
    useAppStore.setState({
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 1, y: 1 },
    });

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ saturation: -100 });
    store.previewColorAdjust();

    const updatedLayer = useAppStore.getState().layers[0];
    const slotPalettes = updatedLayer?.colorCycleData?.slotPalettes ?? [];
    expect(slotPalettes).toHaveLength(2);

    const originalSlot = slotPalettes.find((entry) => entry.slot === 0);
    const adjustedSlot = slotPalettes.find((entry) => entry.slot !== 0);
    expect(originalSlot).toBeDefined();
    expect(adjustedSlot).toBeDefined();
    expect(parseCssColor(originalSlot?.stops[0]?.color ?? '#000000')).toMatchObject({ r: 255, g: 0, b: 0 });
    expect(parseCssColor(adjustedSlot?.stops[0]?.color ?? '#000000')).toMatchObject({ r: 128, g: 128, b: 128 });

    const updatedGradientIds = new Uint8Array(currentSnapshot.gradientIdBuffer);
    expect(updatedGradientIds[0]).toBe(adjustedSlot?.slot ?? 255);
    expect(updatedGradientIds[1]).toBe(0);
    expect(useAppStore.getState().pendingCompositeDirtyBatches).toEqual([
      {
        layerId: layer.id,
        version: 0,
        rects: [{ x: 0, y: 0, width: 1, height: 1 }],
      },
    ]);
  });

  it('captures selection bounds for color-cycle sessions', () => {
    const layer = createColorCycleLayer('cc-selection-session-layer', [
      { position: 0, color: 'rgb(255, 0, 0)' },
      { position: 1, color: 'rgb(255, 255, 0)' },
    ]);
    installProjectWithLayer(layer);

    useAppStore.setState({
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 1, y: 1 },
    });

    const store = useAppStore.getState();
    store.startColorAdjustSession();

    expect(useAppStore.getState().colorAdjust.selectionBounds).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it('limits color-cycle preview adjustments to selected def-bound pixels by remapping def ids', () => {
    const layer = createColorCycleLayer('cc-selection-def-layer', [
      { position: 0, color: 'rgb(255, 0, 0)' },
      { position: 1, color: 'rgb(255, 255, 0)' },
    ]);
    const defBoundLayer: Layer = {
      ...layer,
      colorCycleData: {
        ...layer.colorCycleData,
        gradientDefStore: [{
          id: 1,
          kind: 'linear',
          stops: [
            { position: 0, color: 'rgb(255, 0, 0)' },
            { position: 1, color: 'rgb(255, 255, 0)' },
          ],
          hash: 'linear:def-original',
          source: 'manual',
          createdAtMs: 0,
          slot: 0,
        }],
        nextGradientDefId: 2,
      },
    };
    installProjectWithLayer(defBoundLayer);

    const currentSnapshot = {
      paintBuffer: new Uint8Array([1, 1]).buffer,
      gradientIdBuffer: new Uint8Array([0, 0]).buffer,
      gradientDefIdBuffer: new Uint16Array([1, 1]).buffer,
      hasContent: true,
      strokeCounter: 0,
    };
    const applyLayerSnapshot = jest.fn((_: string, payload: typeof currentSnapshot) => {
      currentSnapshot.paintBuffer = payload.paintBuffer.slice(0);
      currentSnapshot.gradientIdBuffer = payload.gradientIdBuffer?.slice(0) ?? new ArrayBuffer(0);
      currentSnapshot.gradientDefIdBuffer = payload.gradientDefIdBuffer?.slice(0) ?? new ArrayBuffer(0);
      currentSnapshot.hasContent = payload.hasContent;
      currentSnapshot.strokeCounter = payload.strokeCounter;
    });
    const brush = {
      getColorCycleLayerDocument: jest.fn(() => makeColorCycleLayerDocumentReader(defBoundLayer.id, currentSnapshot)),
      getLayerSnapshot: jest.fn(() => ({
        paintBuffer: currentSnapshot.paintBuffer.slice(0),
        gradientIdBuffer: currentSnapshot.gradientIdBuffer.slice(0),
        gradientDefIdBuffer: currentSnapshot.gradientDefIdBuffer.slice(0),
        hasContent: currentSnapshot.hasContent,
        strokeCounter: currentSnapshot.strokeCounter,
      })),
      applyLayerSnapshot,
      renderDirectToCanvas: jest.fn(),
      getCanvas: jest.fn(() => defBoundLayer.framebuffer),
    };
    registerMockColorCycleSnapshotRuntime(brush, currentSnapshot);
    mockColorCycleBrushManager.getSelectionMutationBrush.mockReturnValue(brush);
    mockColorCycleBrushManager.getSurfaceBrush.mockReturnValue(brush);
    mockColorCycleBrushManager.getGradientApplyBrush.mockReturnValue(brush);
    useAppStore.setState({
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 1, y: 1 },
    });

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ saturation: -100 });
    store.previewColorAdjust();

    const updatedLayer = useAppStore.getState().layers[0];
    const defStore = updatedLayer?.colorCycleData?.gradientDefStore ?? [];
    expect(defStore).toHaveLength(2);

    const originalDef = defStore.find((entry) => entry.id === 1);
    const adjustedDef = defStore.find((entry) => entry.id !== 1);
    expect(originalDef).toBeDefined();
    expect(adjustedDef).toBeDefined();
    expect(parseCssColor(originalDef?.stops[0]?.color ?? '#000000')).toMatchObject({ r: 255, g: 0, b: 0 });
    expect(parseCssColor(adjustedDef?.stops[0]?.color ?? '#000000')).toMatchObject({ r: 128, g: 128, b: 128 });

    const updatedDefIds = new Uint16Array(currentSnapshot.gradientDefIdBuffer);
    expect(updatedDefIds[0]).toBe(adjustedDef?.id ?? 0);
  });

  it('adjusts selected def-bound pixels even when the layer has no slot palettes', () => {
    const layer = createColorCycleLayerWithDefStoreOnly('cc-selection-def-only-layer', [
      { position: 0, color: 'rgb(255, 0, 0)' },
      { position: 1, color: 'rgb(255, 255, 0)' },
    ]);
    installProjectWithLayer(layer);

    const currentSnapshot = {
      paintBuffer: new Uint8Array([1, 1]).buffer,
      gradientIdBuffer: new Uint8Array([7, 7]).buffer,
      gradientDefIdBuffer: new Uint16Array([1, 1]).buffer,
      hasContent: true,
      strokeCounter: 0,
    };
    const applyLayerSnapshot = jest.fn((_: string, payload: typeof currentSnapshot) => {
      currentSnapshot.paintBuffer = payload.paintBuffer.slice(0);
      currentSnapshot.gradientIdBuffer = payload.gradientIdBuffer?.slice(0) ?? new ArrayBuffer(0);
      currentSnapshot.gradientDefIdBuffer = payload.gradientDefIdBuffer?.slice(0) ?? new ArrayBuffer(0);
      currentSnapshot.hasContent = payload.hasContent;
      currentSnapshot.strokeCounter = payload.strokeCounter;
    });
    const brush = {
      getColorCycleLayerDocument: jest.fn(() => makeColorCycleLayerDocumentReader(layer.id, currentSnapshot)),
      getLayerSnapshot: jest.fn(() => ({
        paintBuffer: currentSnapshot.paintBuffer.slice(0),
        gradientIdBuffer: currentSnapshot.gradientIdBuffer.slice(0),
        gradientDefIdBuffer: currentSnapshot.gradientDefIdBuffer.slice(0),
        hasContent: currentSnapshot.hasContent,
        strokeCounter: currentSnapshot.strokeCounter,
      })),
      applyLayerSnapshot,
      renderDirectToCanvas: jest.fn(),
      getCanvas: jest.fn(() => layer.framebuffer),
      syncGradientDefRuntime: jest.fn(),
    };
    registerMockColorCycleSnapshotRuntime(brush, currentSnapshot);
    mockColorCycleBrushManager.getSelectionMutationBrush.mockReturnValue(brush);
    mockColorCycleBrushManager.getSurfaceBrush.mockReturnValue(brush);
    mockColorCycleBrushManager.getGradientApplyBrush.mockReturnValue(brush);
    useAppStore.setState({
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 1, y: 1 },
    });

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ saturation: -100 });
    store.previewColorAdjust();

    const updatedLayer = useAppStore.getState().layers[0];
    const defStore = updatedLayer?.colorCycleData?.gradientDefStore ?? [];
    expect(defStore).toHaveLength(2);

    const adjustedDef = defStore.find((entry) => entry.id !== 1);
    expect(adjustedDef).toBeDefined();
    expect(parseCssColor(adjustedDef?.stops[0]?.color ?? '#000000')).toMatchObject({ r: 128, g: 128, b: 128 });

    const updatedDefIds = new Uint16Array(currentSnapshot.gradientDefIdBuffer);
    expect(updatedDefIds[0]).toBe(adjustedDef?.id ?? 0);
    expect(brush.syncGradientDefRuntime).toHaveBeenCalledWith('cc-selection-def-only-layer');
  });

  it('adjusts selected slot-bound pixels when the slot palette is missing but a def store entry owns the slot', () => {
    const layer = createColorCycleLayerWithDefStoreOnly('cc-selection-slot-fallback-layer', [
      { position: 0, color: 'rgb(255, 0, 0)' },
      { position: 1, color: 'rgb(255, 255, 0)' },
    ]);
    installProjectWithLayer(layer);

    const currentSnapshot = {
      paintBuffer: new Uint8Array([1, 1]).buffer,
      gradientIdBuffer: new Uint8Array([7, 7]).buffer,
      hasContent: true,
      strokeCounter: 0,
    };
    const applyLayerSnapshot = jest.fn((_: string, payload: typeof currentSnapshot) => {
      currentSnapshot.paintBuffer = payload.paintBuffer.slice(0);
      currentSnapshot.gradientIdBuffer = payload.gradientIdBuffer?.slice(0) ?? new ArrayBuffer(0);
      currentSnapshot.hasContent = payload.hasContent;
      currentSnapshot.strokeCounter = payload.strokeCounter;
    });
    const brush = {
      getColorCycleLayerDocument: jest.fn(() => makeColorCycleLayerDocumentReader(layer.id, currentSnapshot)),
      getLayerSnapshot: jest.fn(() => ({
        paintBuffer: currentSnapshot.paintBuffer.slice(0),
        gradientIdBuffer: currentSnapshot.gradientIdBuffer.slice(0),
        hasContent: currentSnapshot.hasContent,
        strokeCounter: currentSnapshot.strokeCounter,
      })),
      applyLayerSnapshot,
      renderDirectToCanvas: jest.fn(),
      getCanvas: jest.fn(() => layer.framebuffer),
      syncGradientDefRuntime: jest.fn(),
    };
    registerMockColorCycleSnapshotRuntime(brush, currentSnapshot);
    mockColorCycleBrushManager.getSelectionMutationBrush.mockReturnValue(brush);
    mockColorCycleBrushManager.getSurfaceBrush.mockReturnValue(brush);
    mockColorCycleBrushManager.getGradientApplyBrush.mockReturnValue(brush);
    useAppStore.setState({
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 1, y: 1 },
    });

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ saturation: -100 });
    store.previewColorAdjust();

    const updatedLayer = useAppStore.getState().layers[0];
    const slotPalettes = updatedLayer?.colorCycleData?.slotPalettes ?? [];
    const adjustedSlot = slotPalettes.find((entry) => entry.slot !== 7);

    expect(adjustedSlot).toBeDefined();
    expect(parseCssColor(adjustedSlot?.stops[0]?.color ?? '#000000')).toMatchObject({ r: 128, g: 128, b: 128 });

    const updatedGradientIds = new Uint8Array(currentSnapshot.gradientIdBuffer);
    expect(updatedGradientIds[0]).toBe(adjustedSlot?.slot ?? 255);
    expect(brush.syncGradientDefRuntime).toHaveBeenCalledWith('cc-selection-slot-fallback-layer');
  });

  it('restores original color-cycle gradients on cancel', () => {
    const layer = createColorCycleLayer('cc-layer-cancel', [
      { position: 0, color: '#000000' },
      { position: 1, color: '#101010' },
    ]);
    installProjectWithLayer(layer);

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ red: 100 });
    store.previewColorAdjust();
    store.cancelColorAdjust();

    const restoredLayer = useAppStore.getState().layers[0];
    const restoredGradient = restoredLayer?.colorCycleData?.gradient ?? [];
    const restoredSlotStops = restoredLayer?.colorCycleData?.slotPalettes?.[0]?.stops ?? [];

    expect(parseCssColor(restoredGradient[0]?.color ?? '#ffffff').r).toBe(0);
    expect(parseCssColor(restoredSlotStops[0]?.color ?? '#ffffff').r).toBe(0);
  });
});
