import { useAppStore } from '@/stores/useAppStore';
import type { Layer, Rectangle } from '@/types';
import { parseCssColor } from '@/utils/color/parseCssColor';

type StoreState = ReturnType<typeof useAppStore.getState>;

const DEFAULT_ALIGNMENT = {
  fit: 'none',
  horizontal: 'center',
  vertical: 'center',
  positioning: 'anchor',
} as const;

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
  gradient: Array<{ position: number; color: string }>
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
  slotStops: Array<{ position: number; color: string }>
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
  gradientStops: Array<{ position: number; color: string }>
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

const installProjectWithLayer = (layer: Layer) => {
  useAppStore.setState((state) => ({
    layers: [layer],
    activeLayerId: layer.id,
    project: state.project
      ? {
          ...state.project,
          width: layer.imageData?.width ?? state.project.width,
          height: layer.imageData?.height ?? state.project.height,
          layers: [layer],
        }
      : {
          id: 'test-project',
          name: 'Test Project',
          width: layer.imageData?.width ?? 2,
          height: layer.imageData?.height ?? 2,
          layers: [layer],
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
    colorAdjust: {
      active: false,
      params: {
        hue: 0,
        saturation: 0,
        vibrance: 0,
        lightness: 0,
        contrast: 0,
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
  const originalGetLayerColorCycleBrush = useAppStore.getState().getLayerColorCycleBrush;

  beforeEach(() => {
    resetStore();
    useAppStore.setState({
      getLayerColorCycleBrush: originalGetLayerColorCycleBrush,
    });
  });

  afterEach(() => {
    resetStore();
    useAppStore.setState({
      getLayerColorCycleBrush: originalGetLayerColorCycleBrush,
    });
  });

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
    const defStoreStops = updatedLayer?.colorCycleData?.gradientDefStore?.[0]?.stops ?? [];

    expect(updatedSlotCount).toBe(originalSlotCount);
    expect(recolorStops.length).toBe(2);
    expect(defStoreStops.length).toBe(2);
    expect(parseCssColor(recolorStops[0]?.color ?? '#000000').r).toBe(255);
    expect(parseCssColor(defStoreStops[0]?.color ?? '#000000').r).toBe(255);
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

    const syncGradientDefRuntime = jest.fn();
    const getLayerColorCycleBrush = jest.fn(() => ({
      syncGradientDefRuntime,
    }));
    useAppStore.setState({
      getLayerColorCycleBrush: getLayerColorCycleBrush as unknown as StoreState['getLayerColorCycleBrush'],
    });

    const store = useAppStore.getState();
    store.startColorAdjustSession();
    store.updateColorAdjustParams({ saturation: -100 });
    store.previewColorAdjust();

    expect(syncGradientDefRuntime).toHaveBeenCalledWith('cc-def-runtime');
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
    useAppStore.setState({
      getLayerColorCycleBrush: jest.fn(() => brush) as unknown as StoreState['getLayerColorCycleBrush'],
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

    const updatedGradientIds = new Uint8Array(updatedLayer?.colorCycleData?.gradientIdBuffer ?? new ArrayBuffer(0));
    expect(updatedGradientIds[0]).toBe(adjustedSlot?.slot ?? 255);
    expect(updatedGradientIds[1]).toBe(0);
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
