import { TextDecoder, TextEncoder } from 'util';

(global as unknown as { TextEncoder?: typeof TextEncoder }).TextEncoder = TextEncoder;
(global as unknown as { TextDecoder?: typeof TextDecoder }).TextDecoder = TextDecoder;

import { useAppStore } from '@/stores/useAppStore';
import historyManager from '@/history/historyService';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import { createDefaultLayerAlignment, createDefaultExportLayout } from '@/utils/layoutDefaults';
import type { Layer, Project, Rectangle } from '@/types';


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
  resetStore();
});

afterEach(() => {
  jest.restoreAllMocks();
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

describe('useAppStore commitCrop', () => {
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

  it('preserves color-cycle gradient buffers after cropping', async () => {
    const layer = createColorCycleLayer(6, 4);
    primeStoreForCrop(layer, 6, 4);

    useAppStore.getState().initColorCycleForLayer(layer.id, 6, 4);
    const brush = useAppStore.getState().getLayerColorCycleBrush(layer.id);
    expect(brush).toBeDefined();

    const paint = new Uint8Array(24).fill(1);
    const gradientIds = Uint8Array.from({ length: 24 }, (_, idx) => idx);
    const gradientDefIds = Uint16Array.from({ length: 24 }, (_, idx) => idx + 100);
    const speed = new Uint8Array(24).fill(12);

    brush?.applyLayerSnapshot?.(layer.id, {
      paintBuffer: paint.buffer.slice(0),
      gradientIdBuffer: gradientIds.buffer.slice(0),
      gradientDefIdBuffer: gradientDefIds.buffer.slice(0),
      speedBuffer: speed.buffer.slice(0),
      hasContent: true,
      strokeCounter: 3
    });

    await useAppStore.getState().commitCrop();
    await new Promise((resolve) => setTimeout(resolve, 25));

    const updatedLayer = useAppStore.getState().layers[0];
    const updatedBrush = updatedLayer.colorCycleData?.colorCycleBrush;
    const snapshot = updatedBrush?.getLayerSnapshot?.(layer.id);

    expect(snapshot?.paintBuffer).toBeDefined();
    expect(snapshot?.gradientIdBuffer).toBeDefined();
    expect(snapshot?.gradientDefIdBuffer).toBeDefined();

    expect(Array.from(new Uint8Array(snapshot?.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual([
      7, 8, 9,
      13, 14, 15,
    ]);
    expect(Array.from(new Uint16Array(snapshot?.gradientDefIdBuffer ?? new ArrayBuffer(0)))).toEqual([
      107, 108, 109,
      113, 114, 115,
    ]);
  });

  it('restores color-cycle brush animation state after cropping', async () => {
    const layer = createColorCycleLayer(6, 4);
    primeStoreForCrop(layer, 6, 4);

    const storeBefore = useAppStore.getState();
    storeBefore.initColorCycleForLayer(layer.id, 6, 4);

    const initialBrush = useAppStore.getState().getLayerColorCycleBrush(layer.id);
    initialBrush?.setActiveLayer?.(layer.id);
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
    const restoredBrush = state.getLayerColorCycleBrush(layer.id);

    expect(updatedLayer.colorCycleData?.brushSpeed).toBeCloseTo(0.33);
    expect(updatedLayer.colorCycleData?.isAnimating).toBe(true);
    expect(restoredBrush?.isPlaying?.()).toBe(true);
  });

  it('rebuilds recolor color-cycle data after cropping', async () => {
    const layer = createRecolorLayer(6, 4);
    primeStoreForCrop(layer, 6, 4);

    const processLayerMock = jest.fn().mockResolvedValue(true);
    jest.spyOn(RecolorManager, 'getInstance').mockReturnValue({
      processLayer: processLayerMock
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

    expect(processLayerMock).toHaveBeenCalledTimes(1);
    const [passedLayer, options] = processLayerMock.mock.calls[0];
    expect(passedLayer.id).toBe(updatedLayer.id);
    expect(options?.cycleColors).toBe(16);
    expect(options?.customGradient).toEqual([
      { position: 0, color: '#ff0000' },
      { position: 1, color: '#00ff00' }
    ]);
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
});
