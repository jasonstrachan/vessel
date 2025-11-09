import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';

const makeCanvas = () => {
  const ctx = {
    clearRect: jest.fn(),
    putImageData: jest.fn(),
    drawImage: jest.fn(),
    getImageData: jest.fn(() => new ImageData(32, 32)),
  } as unknown as CanvasRenderingContext2D;

  return {
    width: 32,
    height: 32,
    getContext: jest.fn(() => ctx),
  } as unknown as HTMLCanvasElement;
};

const mockBrush = {
  getCanvas: jest.fn(() => makeCanvas()),
  setSpeed: jest.fn(),
  setTargetCanvas: jest.fn(),
  renderDirectToCanvas: jest.fn(),
  setActiveLayer: jest.fn(),
  endStroke: jest.fn(),
  setFlowMode: jest.fn(),
  setFlowDirection: jest.fn(),
};

const mockManager = {
  validateColorCycleBrush: jest.fn(() => true),
  initColorCycleForLayer: jest.fn(() => true),
  setActiveState: jest.fn(),
  getLayerColorCycleBrush: jest.fn(() => mockBrush),
  getBrush: jest.fn(() => mockBrush),
  removeColorCycleBrush: jest.fn(),
  createBrush: jest.fn(() => mockBrush),
  deleteBrush: jest.fn(),
  cleanupInactive: jest.fn(),
  cleanupAll: jest.fn(),
  transferColorCycleBrush: jest.fn(),
  cleanupOrphanedBrushes: jest.fn(),
  setCanvasImplementation: jest.fn(),
};

jest.mock('../colorCycleBrushManager', () => ({
  __esModule: true as const,
  getColorCycleBrushManager: () => mockManager,
  setLayerIdGetter: jest.fn(),
  setColorCycleStoreStateGetter: jest.fn(),
}));

// Import store after mocks are registered.
import { useAppStore } from '@/stores/useAppStore';

const createNormalLayerInput = (name: string): Omit<Layer, 'id' | 'order'> => ({
  name,
  visible: true,
  opacity: 1,
  blendMode: 'source-over' as const,
  locked: false,
  transparencyLocked: false,
  imageData: new ImageData(32, 32),
  framebuffer: makeCanvas(),
  alignment: createDefaultLayerAlignment(),
  layerType: 'normal' as const,
});

const createColorCycleLayerInput = (name: string): Omit<Layer, 'id' | 'order'> => ({
  ...createNormalLayerInput(name),
  layerType: 'color-cycle' as const,
  colorCycleData: {
    gradient: [
      { position: 0, color: '#112233' },
      { position: 1, color: '#445566' },
    ],
    isAnimating: false,
  },
});

const createSourceCanvas = (width: number, height: number) => {
  const imageData = new ImageData(width, height);
  imageData.data.fill(180);
  const ctx = {
    getImageData: jest.fn(() => imageData),
  } as unknown as CanvasRenderingContext2D;

  const canvas = {
    width,
    height,
    getContext: jest.fn(() => ctx),
  } as unknown as HTMLCanvasElement;

  return { canvas, ctx, imageData };
};

beforeEach(() => {
  Object.values(mockBrush).forEach((fn) => {
    if (typeof fn === 'function') {
      (fn as jest.Mock).mockReset();
    }
  });
  Object.values(mockManager).forEach((fn) => {
    if (typeof fn === 'function') {
      (fn as jest.Mock).mockReset();
    }
  });

  mockManager.getBrush.mockReturnValue(mockBrush);
  mockManager.getLayerColorCycleBrush.mockReturnValue(mockBrush);
  mockManager.createBrush.mockReturnValue(mockBrush);
  mockManager.initColorCycleForLayer.mockReturnValue(true);

  useAppStore.setState((state) => ({
    layers: [],
    activeLayerId: null,
    selectedLayerIds: [],
    referenceLayerId: null,
    layersNeedRecomposition: false,
    project: state.project
      ? {
          ...state.project,
          width: 256,
          height: 256,
        }
      : state.project,
  }));
});

describe('layers slice integration', () => {
  it('auto-selects and highlights a newly added layer', () => {
    const store = useAppStore.getState();
    const newLayerId = store.addLayer(createNormalLayerInput('Layer 1'));

    const nextState = useAppStore.getState();
    expect(nextState.activeLayerId).toBe(newLayerId);
    expect(nextState.selectedLayerIds).toEqual([newLayerId]);
    expect(nextState.layers).toHaveLength(1);
    expect(nextState.layers[0].id).toBe(newLayerId);
  });

  it('initializes color-cycle layer resources via the manager', () => {
    mockManager.getBrush.mockReset();
    mockManager.getBrush.mockReturnValue(mockBrush);
    mockBrush.setSpeed.mockClear();

    const store = useAppStore.getState();
    const newLayerId = store.addLayer(createColorCycleLayerInput('CC Layer'));

    expect(mockManager.initColorCycleForLayer).toHaveBeenCalledWith(newLayerId, 256, 256, undefined);
    expect(mockManager.getBrush).toHaveBeenCalledWith(newLayerId);
  });

  it('hydrates an existing color-cycle brush without reinitializing', () => {
    const store = useAppStore.getState();
    const newLayerId = store.addLayer(createColorCycleLayerInput('Hydrate CC Layer'));

    // Simulate a persistence restore where the brush instance needs to be rebound.
    useAppStore.setState((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === newLayerId
          ? {
              ...layer,
              colorCycleData: {
                ...(layer.colorCycleData as NonNullable<Layer['colorCycleData']>),
                colorCycleBrush: undefined,
              },
            }
          : layer
      ),
    }));

    mockManager.initColorCycleForLayer.mockClear();
    mockManager.getBrush.mockReturnValue(mockBrush);

    useAppStore.getState().initColorCycleForLayer(newLayerId, 256, 256);

    const updatedLayer = useAppStore.getState().layers.find((candidate) => candidate.id === newLayerId);
    expect(updatedLayer?.colorCycleData?.colorCycleBrush).toBe(mockBrush);
    expect(mockManager.initColorCycleForLayer).not.toHaveBeenCalled();
  });

  it('recomputes alignment offsets and flags recomposition when alignment changes', () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer(createNormalLayerInput('Alignment Layer'));

    const targetAlignment = {
      ...createDefaultLayerAlignment(),
      positioning: 'auto' as const,
      offsetPercent: { x: 25, y: 50 },
    };

    useAppStore.getState().updateLayerAlignment(layerId, targetAlignment);

    const nextState = useAppStore.getState();
    const layer = nextState.layers.find((candidate) => candidate.id === layerId);
    expect(nextState.layersNeedRecomposition).toBe(true);
    expect(layer?.alignment.offsetPercent).toEqual({ x: 25, y: 50 });
    expect(layer?.alignment.offsetPx).toEqual({ x: 64, y: 128 });
  });

  it('duplicates a regular layer and focuses the copy', () => {
    const store = useAppStore.getState();
    const originalId = store.addLayer(createNormalLayerInput('Layer 1'));

    const duplicatedId = useAppStore.getState().duplicateLayer(originalId);
    expect(duplicatedId).toBeTruthy();

    const nextState = useAppStore.getState();
    expect(nextState.layers).toHaveLength(2);
    const originalIndex = nextState.layers.findIndex((layer) => layer.id === originalId);
    const duplicateIndex = nextState.layers.findIndex((layer) => layer.id === duplicatedId);
    expect(duplicateIndex).toBe(originalIndex + 1);

    const originalLayer = nextState.layers.find((layer) => layer.id === originalId)!;
    const duplicatedLayer = nextState.layers.find((layer) => layer.id === duplicatedId)!;
    expect(duplicatedLayer.name).toBe('Layer 1 Copy');
    expect(duplicatedLayer.imageData).not.toBe(originalLayer.imageData);
    expect(duplicatedLayer.framebuffer).not.toBe(originalLayer.framebuffer);
    expect(nextState.activeLayerId).toBe(duplicatedId);
    expect(nextState.selectedLayerIds).toEqual([duplicatedId]);
  });

  it('duplicates color-cycle layers and reinitializes brush resources', () => {
    const store = useAppStore.getState();
    const ccLayerInput = createColorCycleLayerInput('CC Layer 1');
    ccLayerInput.colorCycleData = {
      ...ccLayerInput.colorCycleData,
      canvas: makeCanvas(),
    };
    const originalId = store.addLayer(ccLayerInput);

    mockManager.initColorCycleForLayer.mockClear();
    mockManager.createBrush.mockClear();
    mockBrush.setTargetCanvas.mockClear();

    const duplicatedId = useAppStore.getState().duplicateLayer(originalId);
    expect(duplicatedId).toBeTruthy();

    expect(mockManager.createBrush).toHaveBeenCalledWith(
      duplicatedId,
      32,
      32,
      expect.any(Uint8Array)
    );
    expect(mockManager.initColorCycleForLayer).not.toHaveBeenCalled();
    expect(mockBrush.setTargetCanvas).toHaveBeenCalled();

    const nextState = useAppStore.getState();
    const duplicateLayer = nextState.layers.find((layer) => layer.id === duplicatedId);
    const sourceLayer = nextState.layers.find((layer) => layer.id === originalId);
    expect(duplicateLayer?.colorCycleData?.gradient).toEqual(sourceLayer?.colorCycleData?.gradient);
    expect(duplicateLayer?.colorCycleData?.colorCycleBrush).toBeUndefined();
    expect(duplicateLayer?.imageData).toBeNull();
    expect(duplicateLayer?.framebuffer).not.toBe(sourceLayer?.framebuffer);
  });

  it('preserves bitmap data when legacy layers have stale colorCycleData without canvases', () => {
    const store = useAppStore.getState();
    const legacyLayer: Layer = {
      ...createColorCycleLayerInput('Legacy CC'),
      layerType: 'normal',
    } as Layer;
    const legacyId = store.addLayer(legacyLayer as unknown as Omit<Layer, 'id' | 'order'>);

    const duplicatedId = useAppStore.getState().duplicateLayer(legacyId);
    expect(duplicatedId).toBeTruthy();

    const nextState = useAppStore.getState();
    const duplicateLayer = nextState.layers.find((layer) => layer.id === duplicatedId);
    expect(duplicateLayer?.layerType).toBe('normal');
    expect(duplicateLayer?.imageData).not.toBeNull();
    expect(duplicateLayer?.colorCycleData).toBeUndefined();
  });

  it('falls back to CC init when duplicated layer has no canvas to adopt', () => {
    const store = useAppStore.getState();
    const ccLayerInput = createColorCycleLayerInput('Canvasless CC');
    ccLayerInput.colorCycleData = {
      ...ccLayerInput.colorCycleData,
      canvas: undefined,
    };
    const originalId = store.addLayer(ccLayerInput);
    useAppStore.setState((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === originalId && layer.colorCycleData
          ? {
              ...layer,
              colorCycleData: {
                ...layer.colorCycleData,
                canvas: undefined,
              },
            }
          : layer
      ),
    }));

    mockManager.initColorCycleForLayer.mockClear();
    mockManager.createBrush.mockClear();

    useAppStore.getState().duplicateLayer(originalId);

    expect(mockManager.initColorCycleForLayer).toHaveBeenCalled();
    expect(mockManager.createBrush).not.toHaveBeenCalled();
  });

  it('captures canvas updates into the active layer and marks recomposition', async () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer(createNormalLayerInput('Capture Layer'));
    const { canvas: sourceCanvas, ctx } = createSourceCanvas(32, 32);

    await useAppStore.getState().captureCanvasToActiveLayer(sourceCanvas);

    const nextState = useAppStore.getState();
    const targetLayer = nextState.layers.find((candidate) => candidate.id === layerId);
    expect(nextState.layersNeedRecomposition).toBe(true);
    expect(targetLayer?.imageData?.width).toBe(32);
    expect(ctx.getImageData).toHaveBeenCalledWith(0, 0, 32, 32);
  });

  it('captures a canvas into a specific layer even when inactive', async () => {
    const store = useAppStore.getState();
    store.addLayer(createNormalLayerInput('Primary Layer'));
    const targetLayerId = store.addLayer(createNormalLayerInput('Second Layer'));
    const { canvas } = createSourceCanvas(16, 16);

    await useAppStore.getState().captureCanvasToLayer(canvas, targetLayerId);

    const nextState = useAppStore.getState();
    const targetLayer = nextState.layers.find((candidate) => candidate.id === targetLayerId);
    expect(nextState.layersNeedRecomposition).toBe(true);
    expect(targetLayer?.imageData?.width).toBe(16);
    expect(targetLayer?.imageData?.height).toBe(16);
  });
});
