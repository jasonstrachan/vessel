import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';
import type { ColorCycleBrushLayerSnapshot } from '@/lib/colorCycle/document/brushPersistenceAdapter';
import { ColorCycleLayerDocument } from '@/lib/colorCycle/document/ColorCycleLayerDocument';
import type { CompositeSegment } from '@/stores/slices/layersSlice';
import {
  getDerivedSurfaceBuiltFromVersion,
  markDerivedSurfaceBuiltFromVersion,
} from '@/lib/colorCycle/document/derivedSurfaceMetadata';
import type { ColorCycleLayerDocumentState } from '@/lib/colorCycle/documentState';
import { compositeBitmapManager } from '@/lib/performance/CompositeBitmapManager';
import historyManager from '@/history/historyService';
import { mergeColorCycleLayerPayloads } from '@/stores/layers/colorCycleLayerTransforms';

const makeCanvas = () => {
  const ctx = {
    clearRect: jest.fn(),
    putImageData: jest.fn(),
    drawImage: jest.fn(),
    fillRect: jest.fn(),
    getImageData: jest.fn(() => new ImageData(32, 32)),
    save: jest.fn(),
    restore: jest.fn(),
  } as unknown as CanvasRenderingContext2D;

  return {
    width: 32,
    height: 32,
    getContext: jest.fn(() => ctx),
  } as unknown as HTMLCanvasElement;
};

const mockBrush = {
  getCanvas: jest.fn(() => makeCanvas()),
  getColorCycleLayerDocument: jest.fn((layerId: string) => documentRegistry.get(layerId)),
  getLayerSnapshot: jest.fn(),
  setSpeed: jest.fn(),
  setTargetCanvas: jest.fn(),
  updateColorCycleTexture: jest.fn(),
  renderDirectToCanvas: jest.fn(),
  setActiveLayer: jest.fn(),
  setLayerId: jest.fn(),
  endStroke: jest.fn(),
  setFlowMode: jest.fn(),
  setFlowDirection: jest.fn(),
  isPlaying: jest.fn(() => false),
  startAnimation: jest.fn(),
  stopAnimation: jest.fn(),
  updateAnimation: jest.fn(),
  isUsingWebGL: jest.fn(() => false),
};
const mockApplyLayerSnapshot = jest.fn();

const attachLegacyColorCycleTopLevelBuffersForTest = (
  data: NonNullable<Layer['colorCycleData']>,
  buffers: import('@/lib/colorCycle/document/legacyTopLevelBuffers').LegacyColorCycleTopLevelBuffers,
) => {
  const { attachLegacyColorCycleTopLevelBuffers } = jest.requireActual(
    '@/lib/colorCycle/document/legacyTopLevelBuffers',
  ) as typeof import('@/lib/colorCycle/document/legacyTopLevelBuffers');
  return attachLegacyColorCycleTopLevelBuffers(data, buffers);
};

const clearMockBrushPersistenceMeta = () => {
  const { clearColorCycleBrushPersistenceLayerMetaForOwner } = jest.requireActual(
    '@/lib/colorCycle/document/brushPersistenceAdapter',
  ) as typeof import('@/lib/colorCycle/document/brushPersistenceAdapter');
  clearColorCycleBrushPersistenceLayerMetaForOwner(mockBrush);
};

const readMockBrushPersistenceMeta = (layerId: string) => {
  const { mergeColorCycleBrushPersistenceLayerMetaForOwner } = jest.requireActual(
    '@/lib/colorCycle/document/brushPersistenceAdapter',
  ) as typeof import('@/lib/colorCycle/document/brushPersistenceAdapter');
  return mergeColorCycleBrushPersistenceLayerMetaForOwner(mockBrush, layerId, null);
};

const registerMockBrushLayerSnapshotRuntime = () => {
  const { registerColorCycleBrushLayerSnapshotRuntime } = jest.requireActual(
    '@/lib/colorCycle/document/brushPersistenceAdapter',
  ) as typeof import('@/lib/colorCycle/document/brushPersistenceAdapter');
  registerColorCycleBrushLayerSnapshotRuntime(mockBrush, {
    apply: mockApplyLayerSnapshot,
  });
};

const brushRegistry = new Map<string, typeof mockBrush>();
const documentRegistry = new Map<string, ColorCycleLayerDocument>();

const makeDocumentState = (
  layerId: string,
  width = 32,
  height = 32,
): ColorCycleLayerDocumentState => {
  const pixels = width * height;
  return {
    layerId,
    width,
    height,
    paintBuffer: new Uint8Array(pixels).fill(1).buffer,
    gradientIdBuffer: new Uint8Array(pixels).buffer,
    gradientDefIdBuffer: new Uint16Array(pixels).buffer,
    speedBuffer: new Uint8Array(pixels).fill(1).buffer,
    flowBuffer: new Uint8Array(pixels).fill(1).buffer,
    phaseBuffer: new Uint8Array(pixels).buffer,
    hasContent: true,
    sources: {
      brushStateSnapshot: false,
      topLevelBuffers: false,
      legacyStateRefs: false,
    },
  };
};

const mockManager = {
  validateColorCycleBrush: jest.fn(() => true),
  initColorCycleForLayer: jest.fn((layerId: string) => {
    brushRegistry.set(layerId, mockBrush);
    return true;
  }),
  setActiveState: jest.fn(),
  getBrush: jest.fn((layerId: string) => brushRegistry.get(layerId) ?? null),
  getPlaybackBrush: jest.fn((layerId: string) => brushRegistry.get(layerId) ?? null),
  getSurfaceBrush: jest.fn((layerId: string) => brushRegistry.get(layerId) ?? null),
  getGradientApplyBrush: jest.fn((layerId: string) => brushRegistry.get(layerId) ?? null),
  getShapeFillBrush: jest.fn((layerId: string) => brushRegistry.get(layerId) ?? null),
  getHistoryBrush: jest.fn((layerId: string) => brushRegistry.get(layerId) ?? null),
  getSerializedStateBrush: jest.fn((layerId: string) => brushRegistry.get(layerId) ?? null),
  getLayerActivationBrush: jest.fn((layerId: string) => brushRegistry.get(layerId) ?? null),
  getCropBrush: jest.fn((layerId: string) => brushRegistry.get(layerId) ?? null),
  getCommitBrush: jest.fn((layerId: string) => brushRegistry.get(layerId) ?? null),
  getSpeedSettingsBrush: jest.fn((layerId: string) => brushRegistry.get(layerId) ?? null),
  hasBrush: jest.fn((layerId: string) => brushRegistry.has(layerId)),
  removeColorCycleBrush: jest.fn(),
  createBrush: jest.fn((layerId: string) => {
    brushRegistry.set(layerId, mockBrush);
    return mockBrush;
  }),
  registerRestoredBrush: jest.fn((layerId: string, brush: typeof mockBrush) => {
    brushRegistry.set(layerId, brush);
  }),
  applySettingsToBrushes: jest.fn(),
  deleteBrush: jest.fn(),
  cleanupInactive: jest.fn(),
  cleanupAll: jest.fn(),
  transferColorCycleBrush: jest.fn(),
  cleanupOrphanedBrushes: jest.fn(),
  setCanvasImplementation: jest.fn(),
  getDocument: jest.fn((layerId: string) => documentRegistry.get(layerId)),
  registerDocument: jest.fn(),
  ensureDocument: jest.fn((layerId: string, width: number, height: number) => {
    const existing = documentRegistry.get(layerId);
    if (existing) {
      return existing;
    }
    const document = new ColorCycleLayerDocument(makeDocumentState(layerId, width, height));
    documentRegistry.set(layerId, document);
    return document;
  }),
  brushes: brushRegistry,
  documents: documentRegistry,
  brushMetadata: new Map(),
  activeResources: new Set<string>(),
};

const mockCreateColorCycleBrushManager = jest.fn(() => ({
  ...mockManager,
  registerDocument: jest.fn(),
  cleanupAll: jest.fn(),
}));

jest.mock('../colorCycleBrushManager', () => ({
  __esModule: true as const,
  createColorCycleBrushManager: () => mockCreateColorCycleBrushManager(),
  getColorCycleBrushManager: () => mockManager,
  getColorCycleStoreState: () => null,
  setLayerIdGetter: jest.fn(),
  setColorCycleStoreStateGetter: jest.fn(),
}));

jest.mock('@/utils/projectIO', () => {
  const actual = jest.requireActual('@/utils/projectIO');
  return {
    __esModule: true as const,
    ...actual,
    restoreColorCycleBrushes: jest.fn(actual.restoreColorCycleBrushes),
  };
});

// Import store after mocks are registered.
import { useAppStore } from '@/stores/useAppStore';

const { restoreColorCycleBrushes } = jest.requireMock('@/utils/projectIO') as {
  restoreColorCycleBrushes: jest.Mock;
};

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

const createSinglePixelSourceCanvas = (width: number, height: number, x: number, y: number) => {
  const imageData = new ImageData(width, height);
  const index = (y * width + x) * 4;
  imageData.data[index] = 255;
  imageData.data[index + 3] = 255;
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

const createFilledDomCanvas = (width: number, height: number, color: string): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Expected 2D context for test canvas');
  }
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas;
};

beforeEach(() => {
  Object.values(mockBrush).forEach((fn) => {
    if (typeof fn === 'function') {
      (fn as jest.Mock).mockReset();
    }
  });
  mockApplyLayerSnapshot.mockReset();
  registerMockBrushLayerSnapshotRuntime();
  Object.values(mockManager).forEach((fn) => {
    if (typeof fn === 'function') {
      (fn as jest.Mock).mockReset();
    }
  });

  brushRegistry.clear();
  mockCreateColorCycleBrushManager.mockClear();
  documentRegistry.clear();
  mockManager.brushMetadata.clear();
  mockManager.activeResources.clear();
  mockManager.getBrush.mockImplementation((layerId: string) => brushRegistry.get(layerId) ?? null);
  mockManager.getPlaybackBrush.mockImplementation((layerId: string) => brushRegistry.get(layerId) ?? null);
  mockManager.getSurfaceBrush.mockImplementation((layerId: string) => brushRegistry.get(layerId) ?? null);
  mockManager.getGradientApplyBrush.mockImplementation((layerId: string) => brushRegistry.get(layerId) ?? null);
  mockManager.getShapeFillBrush.mockImplementation((layerId: string) => brushRegistry.get(layerId) ?? null);
  mockManager.getHistoryBrush.mockImplementation((layerId: string) => brushRegistry.get(layerId) ?? null);
  mockManager.getSerializedStateBrush.mockImplementation((layerId: string) => brushRegistry.get(layerId) ?? null);
  mockManager.getLayerActivationBrush.mockImplementation((layerId: string) => brushRegistry.get(layerId) ?? null);
  mockManager.getCropBrush.mockImplementation((layerId: string) => brushRegistry.get(layerId) ?? null);
  mockManager.getCommitBrush.mockImplementation((layerId: string) => brushRegistry.get(layerId) ?? null);
  mockManager.getSpeedSettingsBrush.mockImplementation((layerId: string) => brushRegistry.get(layerId) ?? null);
  mockManager.registerRestoredBrush.mockImplementation((layerId: string, brush: typeof mockBrush) => {
    brushRegistry.set(layerId, brush);
  });
  mockManager.getDocument.mockImplementation((layerId: string) => documentRegistry.get(layerId));
  mockBrush.getCanvas.mockImplementation(() => makeCanvas());
  mockBrush.getColorCycleLayerDocument.mockImplementation((layerId: string) => documentRegistry.get(layerId));
  mockManager.ensureDocument.mockImplementation((layerId: string, width: number, height: number) => {
    const existing = documentRegistry.get(layerId);
    if (existing) {
      return existing;
    }
    const document = new ColorCycleLayerDocument(makeDocumentState(layerId, width, height));
    documentRegistry.set(layerId, document);
    return document;
  });
  mockManager.createBrush.mockImplementation((layerId: string) => {
    brushRegistry.set(layerId, mockBrush);
    return mockBrush;
  });
  mockManager.initColorCycleForLayer.mockImplementation((layerId: string) => {
    brushRegistry.set(layerId, mockBrush);
    return true;
  });
  clearMockBrushPersistenceMeta();
  (restoreColorCycleBrushes as jest.Mock).mockReset();
  (restoreColorCycleBrushes as jest.Mock).mockImplementation(async (layers: Layer[]) => layers);
  historyManager.clear();

  useAppStore.setState((state) => ({
    layers: [],
    layerGroups: [],
    hiddenLayerGroupIds: [],
    activeLayerId: null,
    selectedLayerIds: [],
    warmingColorCycleLayerIds: [],
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
    mockManager.getSpeedSettingsBrush.mockReset();
    mockManager.getSpeedSettingsBrush.mockReturnValue(mockBrush);
    mockBrush.setSpeed.mockClear();

    const store = useAppStore.getState();
    const newLayerId = store.addLayer(createColorCycleLayerInput('CC Layer'));

    expect(mockManager.initColorCycleForLayer).toHaveBeenCalledWith(newLayerId, 256, 256, undefined);
    expect(mockManager.getSpeedSettingsBrush).toHaveBeenCalledWith(newLayerId);
  });

  it('blocks store updates from downgrading a color-cycle layer to normal', () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer(createColorCycleLayerInput('Protected CC Layer'));

    const before = useAppStore.getState().layers.find((layer) => layer.id === layerId);
    expect(before?.layerType).toBe('color-cycle');
    expect(before?.colorCycleData).toBeDefined();

    store.updateLayer(layerId, { layerType: 'normal' });

    const after = useAppStore.getState().layers.find((layer) => layer.id === layerId);
    expect(after?.layerType).toBe('color-cycle');
    expect(after?.colorCycleData).toBeDefined();
  });

  it('blocks store updates from clearing colorCycleData on a color-cycle layer', () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer(createColorCycleLayerInput('Protected CC Payload'));

    const before = useAppStore.getState().layers.find((layer) => layer.id === layerId);
    expect(before?.colorCycleData?.gradient).toEqual([
      { position: 0, color: '#112233' },
      { position: 1, color: '#445566' },
    ]);

    store.updateLayer(layerId, { colorCycleData: undefined });

    const after = useAppStore.getState().layers.find((layer) => layer.id === layerId);
    expect(after?.layerType).toBe('color-cycle');
    expect(after?.colorCycleData?.gradient).toEqual(before?.colorCycleData?.gradient);
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
    mockManager.getSurfaceBrush.mockReturnValue(mockBrush);

    useAppStore.getState().initColorCycleForLayer(newLayerId, 256, 256);

    const updatedLayer = useAppStore.getState().layers.find((candidate) => candidate.id === newLayerId);
    expect(updatedLayer?.colorCycleData?.colorCycleBrush).toBeUndefined();
    expect(updatedLayer?.colorCycleData?.eraseMask).toBeUndefined();
    expect(mockManager.getSurfaceBrush).toHaveBeenCalledWith(newLayerId);
    expect(mockManager.initColorCycleForLayer).not.toHaveBeenCalled();
  });

  it('clears stale static-preview repair status when reinitializing a color-cycle layer', () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer({
      ...createColorCycleLayerInput('Repair Status CC Layer'),
      colorCycleData: {
        ...createColorCycleLayerInput('Repair Status CC Layer').colorCycleData,
        repairStatus: {
          ok: false,
          reason: 'missing-paint-buffer',
          notes: ['Imported as static preview only'],
        },
      },
    });

    mockManager.getSurfaceBrush.mockReset();
    mockManager.getSurfaceBrush.mockReturnValue(mockBrush);

    useAppStore.getState().initColorCycleForLayer(layerId, 256, 256);

    const updatedLayer = useAppStore.getState().layers.find((candidate) => candidate.id === layerId);
    expect(updatedLayer?.colorCycleData?.colorCycleBrush).toBeUndefined();
    expect(updatedLayer?.colorCycleData?.repairStatus).toBeUndefined();
  });

  it('warms deferred color-cycle layers on brush lookup using the active target when selected', async () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer({
      ...createColorCycleLayerInput('Deferred CC Layer'),
      colorCycleData: {
        ...createColorCycleLayerInput('Deferred CC Layer').colorCycleData,
        deferredRuntimeRestore: true,
        runtimeHydrationState: 'cold',
        colorCycleBrush: undefined,
        canvas: makeCanvas(),
      },
    });

    brushRegistry.delete(layerId);
    (restoreColorCycleBrushes as jest.Mock).mockImplementationOnce(async (layers: Layer[]) => {
      brushRegistry.set(layerId, mockBrush);
      return layers.map((layer) =>
        layer.id === layerId
          ? {
              ...layer,
              colorCycleData: {
                ...(layer.colorCycleData as NonNullable<Layer['colorCycleData']>),
                deferredRuntimeRestore: false,
                runtimeHydrationState: 'active',
                colorCycleBrush: mockBrush,
                canvas: makeCanvas(),
              },
            }
          : layer,
      );
    });

    const firstBrush = mockManager.getBrush(layerId);
    expect(firstBrush).toBeNull();

    let warmedLayer = useAppStore.getState().layers.find((candidate) => candidate.id === layerId);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (warmedLayer?.colorCycleData?.deferredRuntimeRestore === false) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      warmedLayer = useAppStore.getState().layers.find((candidate) => candidate.id === layerId);
    }

    expect(restoreColorCycleBrushes).toHaveBeenCalledWith(
      [expect.objectContaining({ id: layerId })],
      expect.objectContaining({
        lazy: false,
        activeLayerId: layerId,
        colorCycleBrushManager: expect.any(Object),
      }),
    );
    expect(warmedLayer?.colorCycleData?.deferredRuntimeRestore).toBe(false);
    expect(warmedLayer?.colorCycleData?.runtimeHydrationState).toBe('active');
    expect(mockManager.getBrush(layerId)).toBe(mockBrush);
  });

  it('does not eagerly reinitialize deferred color-cycle layers on activation', async () => {
    const store = useAppStore.getState();
    const snapshotImageData = new ImageData(32, 32);
    snapshotImageData.data[3] = 255;
    markDerivedSurfaceBuiltFromVersion(snapshotImageData, 7);
    const restoredCanvasCtx = {
      clearRect: jest.fn(),
      putImageData: jest.fn(),
      drawImage: jest.fn(),
      getImageData: jest.fn(() => new ImageData(32, 32)),
    } as unknown as CanvasRenderingContext2D;
    const restoredCanvas = {
      width: 32,
      height: 32,
      getContext: jest.fn(() => restoredCanvasCtx),
    } as unknown as HTMLCanvasElement;
    const layerId = store.addLayer({
      ...createColorCycleLayerInput('Deferred Active CC Layer'),
      colorCycleData: {
        ...createColorCycleLayerInput('Deferred Active CC Layer').colorCycleData,
        deferredRuntimeRestore: true,
        runtimeHydrationState: 'cold',
        colorCycleBrush: undefined,
        canvas: makeCanvas(),
        canvasImageData: snapshotImageData,
      },
    });

    brushRegistry.delete(layerId);
    mockManager.validateColorCycleBrush.mockReturnValueOnce(false);
    mockManager.initColorCycleForLayer.mockClear();

    (restoreColorCycleBrushes as jest.Mock).mockImplementationOnce(async (layers: Layer[]) =>
      layers.map((layer) =>
        layer.id === layerId
          ? {
              ...layer,
              colorCycleData: {
                ...(layer.colorCycleData as NonNullable<Layer['colorCycleData']>),
                deferredRuntimeRestore: false,
                runtimeHydrationState: 'active',
                colorCycleBrush: mockBrush,
                canvas: restoredCanvas,
                canvasImageData: undefined,
              },
            }
          : layer,
      ),
    );

    useAppStore.getState().setActiveLayer(layerId);

    let warmedLayer = useAppStore.getState().layers.find((candidate) => candidate.id === layerId);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (warmedLayer?.colorCycleData?.deferredRuntimeRestore === false) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      warmedLayer = useAppStore.getState().layers.find((candidate) => candidate.id === layerId);
    }

    expect(mockManager.initColorCycleForLayer).not.toHaveBeenCalled();
    expect(restoreColorCycleBrushes).toHaveBeenCalledWith(
      [expect.objectContaining({ id: layerId })],
      expect.objectContaining({
        lazy: false,
        activeLayerId: layerId,
        colorCycleBrushManager: expect.any(Object),
      }),
    );
    expect(warmedLayer?.colorCycleData?.deferredRuntimeRestore).toBe(false);
    expect(warmedLayer?.colorCycleData?.runtimeHydrationState).toBe('active');
    expect(warmedLayer?.colorCycleData?.canvasImageData).toBe(snapshotImageData);
    expect(getDerivedSurfaceBuiltFromVersion(warmedLayer?.colorCycleData?.canvasImageData)).toBe(7);
    expect(restoredCanvasCtx.putImageData).not.toHaveBeenCalled();
  });

  it('does not publish a deferred restore as active after the user selects another layer', async () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer({
      ...createColorCycleLayerInput('Deferred Race CC Layer'),
      colorCycleData: {
        ...createColorCycleLayerInput('Deferred Race CC Layer').colorCycleData,
        deferredRuntimeRestore: true,
        runtimeHydrationState: 'cold',
        colorCycleBrush: undefined,
        canvas: makeCanvas(),
      },
    });
    const normalLayerId = store.addLayer(createNormalLayerInput('Normal Layer'));

    (restoreColorCycleBrushes as jest.Mock).mockImplementationOnce((layers: Layer[]) =>
      new Promise<Layer[]>((resolve) => {
        setTimeout(() => {
          resolve(layers.map((layer) =>
            layer.id === layerId
              ? {
                  ...layer,
                  colorCycleData: {
                    ...(layer.colorCycleData as NonNullable<Layer['colorCycleData']>),
                    deferredRuntimeRestore: false,
                    runtimeHydrationState: 'active',
                    colorCycleBrush: mockBrush as unknown as NonNullable<Layer['colorCycleData']>['colorCycleBrush'],
                    canvas: makeCanvas(),
                  },
                }
              : layer,
          ));
        }, 0);
      })
    );

    useAppStore.getState().setActiveLayer(layerId);
    useAppStore.getState().setActiveLayer(normalLayerId);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const raceLayer = useAppStore.getState().layers.find((candidate) => candidate.id === layerId);
      if (raceLayer?.colorCycleData?.deferredRuntimeRestore === false) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const raceLayer = useAppStore.getState().layers.find((candidate) => candidate.id === layerId);
    expect(useAppStore.getState().activeLayerId).toBe(normalLayerId);
    expect(raceLayer?.colorCycleData?.runtimeHydrationState).toBe('warm');
    expect(mockManager.setActiveState).toHaveBeenLastCalledWith(layerId, false);
  });

  it('ensures a deferred color-cycle layer runtime explicitly', async () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer({
      ...createColorCycleLayerInput('Deferred Ensure CC Layer'),
      colorCycleData: {
        ...createColorCycleLayerInput('Deferred Ensure CC Layer').colorCycleData,
        deferredRuntimeRestore: true,
        runtimeHydrationState: 'cold',
        colorCycleBrush: undefined,
        canvas: makeCanvas(),
      },
    });

    brushRegistry.delete(layerId);
    const sourceLayer = useAppStore.getState().layers.find((layer) => layer.id === layerId)!;
    let resolveRestore!: (layers: Layer[]) => void;
    const restoreResult = new Promise<Layer[]>((resolve) => {
      resolveRestore = resolve;
    });
    (restoreColorCycleBrushes as jest.Mock).mockReturnValueOnce(restoreResult);

    const ensurePromise = useAppStore.getState().ensureColorCycleLayerRuntime(layerId, {
      target: 'active',
    });
    expect(useAppStore.getState().warmingColorCycleLayerIds).toContain(layerId);

    brushRegistry.set(layerId, mockBrush);
    resolveRestore([{
      ...sourceLayer,
      colorCycleData: {
        ...(sourceLayer.colorCycleData as NonNullable<Layer['colorCycleData']>),
        deferredRuntimeRestore: false,
        runtimeHydrationState: 'active',
        colorCycleBrush: mockBrush,
        canvas: makeCanvas(),
      },
    }]);
    const ensured = await ensurePromise;

    const warmedLayer = useAppStore.getState().layers.find((candidate) => candidate.id === layerId);
    expect(ensured).toBe(true);
    expect(restoreColorCycleBrushes).toHaveBeenCalledWith(
      [expect.objectContaining({ id: layerId })],
      expect.objectContaining({
        lazy: false,
        activeLayerId: layerId,
        colorCycleBrushManager: expect.any(Object),
      }),
    );
    expect(warmedLayer?.colorCycleData?.deferredRuntimeRestore).toBe(false);
    expect(warmedLayer?.colorCycleData?.runtimeHydrationState).toBe('active');
    expect(mockManager.getBrush(layerId)).toBe(mockBrush);
    expect(useAppStore.getState().warmingColorCycleLayerIds).not.toContain(layerId);
  });

  it('does not publish or clear warming state from an older project restore with the same layer id', async () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer({
      ...createColorCycleLayerInput('Old Project CC Layer'),
      colorCycleData: {
        ...createColorCycleLayerInput('Old Project CC Layer').colorCycleData,
        deferredRuntimeRestore: true,
        runtimeHydrationState: 'cold',
        colorCycleBrush: undefined,
        canvas: makeCanvas(),
      },
    });

    brushRegistry.delete(layerId);
    const oldLayer = useAppStore.getState().layers.find((layer) => layer.id === layerId)!;
    let resolveOldRestore!: (layers: Layer[]) => void;
    let resolveNewRestore!: (layers: Layer[]) => void;
    (restoreColorCycleBrushes as jest.Mock)
      .mockReturnValueOnce(new Promise<Layer[]>((resolve) => {
        resolveOldRestore = resolve;
      }))
      .mockReturnValueOnce(new Promise<Layer[]>((resolve) => {
        resolveNewRestore = resolve;
      }));

    const oldEnsure = useAppStore.getState().ensureColorCycleLayerRuntime(layerId, {
      target: 'active',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const newLayer: Layer = {
      ...oldLayer,
      name: 'New Project CC Layer',
      colorCycleData: {
        ...(oldLayer.colorCycleData as NonNullable<Layer['colorCycleData']>),
        deferredRuntimeRestore: true,
        runtimeHydrationState: 'cold',
        colorCycleBrush: undefined,
        canvas: makeCanvas(),
      },
    };
    useAppStore.setState((state) => ({
      project: state.project ? { ...state.project, name: 'Replacement project' } : state.project,
      layers: [newLayer],
      activeLayerId: layerId,
      selectedLayerIds: [layerId],
    }));

    const newEnsure = useAppStore.getState().ensureColorCycleLayerRuntime(layerId, {
      target: 'active',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(restoreColorCycleBrushes).toHaveBeenCalledTimes(2);

    resolveOldRestore([{
      ...oldLayer,
      name: 'Stale restored layer',
      colorCycleData: {
        ...(oldLayer.colorCycleData as NonNullable<Layer['colorCycleData']>),
        deferredRuntimeRestore: false,
        runtimeHydrationState: 'active',
        colorCycleBrush: mockBrush,
        canvas: makeCanvas(),
      },
    }]);
    expect(await oldEnsure).toBe(false);
    expect(useAppStore.getState().warmingColorCycleLayerIds).toContain(layerId);
    expect(useAppStore.getState().layers[0].name).toBe('New Project CC Layer');
    expect(mockManager.registerRestoredBrush).not.toHaveBeenCalled();

    brushRegistry.set(layerId, mockBrush);
    resolveNewRestore([{
      ...newLayer,
      colorCycleData: {
        ...(newLayer.colorCycleData as NonNullable<Layer['colorCycleData']>),
        deferredRuntimeRestore: false,
        runtimeHydrationState: 'active',
        colorCycleBrush: mockBrush,
        canvas: makeCanvas(),
      },
    }]);
    expect(await newEnsure).toBe(true);
    expect(useAppStore.getState().layers[0].name).toBe('New Project CC Layer');
    expect(useAppStore.getState().warmingColorCycleLayerIds).not.toContain(layerId);
    expect(mockManager.registerRestoredBrush).toHaveBeenCalledTimes(1);
  });

  it('keeps a deferred color-cycle layer cold when explicit runtime ensure fails', async () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer({
      ...createColorCycleLayerInput('Deferred Failed Ensure CC Layer'),
      colorCycleData: {
        ...createColorCycleLayerInput('Deferred Failed Ensure CC Layer').colorCycleData,
        deferredRuntimeRestore: true,
        runtimeHydrationState: 'cold',
        colorCycleBrush: undefined,
        canvas: makeCanvas(),
      },
    });

    brushRegistry.delete(layerId);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (restoreColorCycleBrushes as jest.Mock).mockRejectedValueOnce(new Error('restore failed'));

    let ensured = false;
    try {
      ensured = await useAppStore.getState().ensureColorCycleLayerRuntime(layerId, {
        target: 'active',
      });
    } finally {
      errorSpy.mockRestore();
    }

    const layer = useAppStore.getState().layers.find((candidate) => candidate.id === layerId);
    expect(ensured).toBe(false);
    expect(restoreColorCycleBrushes).toHaveBeenCalledWith(
      [expect.objectContaining({ id: layerId })],
      expect.objectContaining({
        lazy: false,
        activeLayerId: layerId,
        colorCycleBrushManager: expect.any(Object),
      }),
    );
    expect(layer?.colorCycleData?.deferredRuntimeRestore).toBe(true);
    expect(layer?.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(brushRegistry.has(layerId)).toBe(false);
  });

  it('keeps a recoverable color-cycle layer cold and retryable when restore returns no runtime brush', async () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer({
      ...createColorCycleLayerInput('Deferred No Brush Ensure CC Layer'),
      colorCycleData: {
        ...createColorCycleLayerInput('Deferred No Brush Ensure CC Layer').colorCycleData,
        deferredRuntimeRestore: true,
        runtimeHydrationState: 'cold',
        colorCycleBrush: undefined,
        canvas: makeCanvas(),
      },
    });

    brushRegistry.delete(layerId);
    documentRegistry.set(layerId, new ColorCycleLayerDocument(makeDocumentState(layerId)));
    (restoreColorCycleBrushes as jest.Mock).mockImplementationOnce(async (layers: Layer[]) =>
      layers.map((layer) =>
        layer.id === layerId
          ? {
              ...layer,
              colorCycleData: {
                ...(layer.colorCycleData as NonNullable<Layer['colorCycleData']>),
                deferredRuntimeRestore: false,
                runtimeHydrationState: 'cold',
                colorCycleBrush: undefined,
                canvas: makeCanvas(),
              },
            }
          : layer,
      ),
    );
    (restoreColorCycleBrushes as jest.Mock).mockImplementationOnce(async (layers: Layer[]) => {
      brushRegistry.set(layerId, mockBrush);
      return layers.map((layer) =>
        layer.id === layerId
          ? {
              ...layer,
              colorCycleData: {
                ...(layer.colorCycleData as NonNullable<Layer['colorCycleData']>),
                deferredRuntimeRestore: false,
                runtimeHydrationState: 'active',
                colorCycleBrush: mockBrush,
                canvas: makeCanvas(),
              },
            }
          : layer,
      );
    });

    const ensured = await useAppStore.getState().ensureColorCycleLayerRuntime(layerId, {
      target: 'active',
    });

    const layer = useAppStore.getState().layers.find((candidate) => candidate.id === layerId);
    expect(ensured).toBe(false);
    expect(restoreColorCycleBrushes).toHaveBeenCalledWith(
      [expect.objectContaining({ id: layerId })],
      expect.objectContaining({
        lazy: false,
        activeLayerId: layerId,
        colorCycleBrushManager: expect.any(Object),
      }),
    );
    expect(layer?.colorCycleData?.deferredRuntimeRestore).toBe(true);
    expect(layer?.colorCycleData?.runtimeHydrationState).toBe('cold');
    expect(layer?.colorCycleData?.colorCycleBrush).toBeUndefined();
    expect(brushRegistry.has(layerId)).toBe(false);

    expect(mockManager.getBrush(layerId)).toBeNull();

    const retriedEnsure = await useAppStore.getState().ensureColorCycleLayerRuntime(layerId, {
      target: 'active',
    });
    const afterRetryLayer = useAppStore.getState().layers.find((candidate) => candidate.id === layerId);
    expect(retriedEnsure).toBe(true);
    expect(afterRetryLayer?.colorCycleData?.runtimeHydrationState).toBe('active');
    expect(afterRetryLayer?.colorCycleData?.deferredRuntimeRestore).toBe(false);
    expect(restoreColorCycleBrushes).toHaveBeenCalledTimes(2);
    expect(brushRegistry.has(layerId)).toBe(true);
  });

  it('restores a missing runtime brush for warm archive-backed color-cycle layers', async () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer({
      ...createColorCycleLayerInput('Warm Missing Runtime CC Layer'),
      colorCycleData: attachLegacyColorCycleTopLevelBuffersForTest({
        ...createColorCycleLayerInput('Warm Missing Runtime CC Layer').colorCycleData,
        deferredRuntimeRestore: false,
        runtimeHydrationState: 'warm',
        colorCycleBrush: undefined,
        canvas: makeCanvas(),
      }, {
        gradientIdBuffer: new Uint8Array(32 * 32).buffer,
        gradientDefIdBuffer: new Uint16Array(32 * 32).buffer,
      }),
    });

    brushRegistry.delete(layerId);
    documentRegistry.set(layerId, new ColorCycleLayerDocument(makeDocumentState(layerId)));
    mockManager.initColorCycleForLayer.mockClear();
    (restoreColorCycleBrushes as jest.Mock).mockImplementationOnce(async (layers: Layer[]) =>
      layers.map((layer) =>
        layer.id === layerId
          ? {
              ...layer,
              colorCycleData: {
                ...(layer.colorCycleData as NonNullable<Layer['colorCycleData']>),
                deferredRuntimeRestore: false,
                runtimeHydrationState: 'active',
                colorCycleBrush: mockBrush,
                canvas: makeCanvas(),
              },
            }
          : layer,
      ),
    );

    const ensured = await useAppStore.getState().ensureColorCycleLayerRuntime(layerId, {
      target: 'active',
    });

    expect(ensured).toBe(true);
    expect(restoreColorCycleBrushes).toHaveBeenCalledWith(
      [expect.objectContaining({ id: layerId })],
      expect.objectContaining({
        lazy: false,
        activeLayerId: layerId,
        colorCycleBrushManager: expect.any(Object),
      }),
    );
    expect(mockManager.getBrush(layerId)).toBe(mockBrush);
    expect(mockManager.initColorCycleForLayer).not.toHaveBeenCalled();
  });

  it('rebuilds slot usage from canonical gradientDefIdBuffer state', () => {
    const colorCycleLayer: Layer = {
      id: 'layer-slot-gc',
      name: 'Slot GC Layer',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: null,
      framebuffer: makeCanvas(),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      version: 1,
      colorCycleData: attachLegacyColorCycleTopLevelBuffersForTest({
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        isAnimating: false,
        gradientDefs: [],
        slotPalettes: [
          {
            slot: 7,
            stops: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
          },
          {
            slot: 9,
            stops: [
              { position: 0, color: '#ff0000' },
              { position: 1, color: '#00ff00' },
            ],
          },
        ],
        gradientDefStore: [
          {
            id: 1,
            kind: 'linear',
            stops: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
            hash: 'linear:one',
            source: 'manual',
            createdAtMs: 0,
            slot: 7,
          },
          {
            id: 2,
            kind: 'linear',
            stops: [
              { position: 0, color: '#ff0000' },
              { position: 1, color: '#00ff00' },
            ],
            hash: 'linear:two',
            source: 'manual',
            createdAtMs: 0,
          },
        ],
      }, {
        gradientDefIdBuffer: new Uint16Array([2, 2, 0, 0]).buffer,
      }),
    };

    useAppStore.setState((state) => ({
      ...state,
      project: state.project
        ? {
            ...state.project,
            width: 2,
            height: 2,
          }
        : state.project,
      layers: [colorCycleLayer],
      activeLayerId: colorCycleLayer.id,
      selectedLayerIds: [colorCycleLayer.id],
    }));

    useAppStore.getState().runColorCycleSlotRebuild('test-canonical-buffer');

    const updatedLayer = useAppStore.getState().layers.find((layer) => layer.id === colorCycleLayer.id);
    const updatedDefs = updatedLayer?.colorCycleData?.gradientDefStore ?? [];
    const updatedDef1 = updatedDefs.find((entry) => entry.id === 1);
    const updatedDef2 = updatedDefs.find((entry) => entry.id === 2);
    const paletteSlots = (updatedLayer?.colorCycleData?.slotPalettes ?? []).map((entry) => entry.slot);

    expect(updatedDef1?.slot).toBeUndefined();
    expect(typeof updatedDef2?.slot).toBe('number');
    expect(paletteSlots).not.toContain(7);
    expect(paletteSlots).toContain(updatedDef2?.slot);
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

  it('sets visibility for a selected layer subset', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const layerC = store.addLayer(createNormalLayerInput('Layer C'));

    useAppStore.getState().setLayersVisibility([layerA, layerC], false);

    const nextState = useAppStore.getState();
    const nextLayerA = nextState.layers.find((layer) => layer.id === layerA);
    const nextLayerB = nextState.layers.find((layer) => layer.id === layerB);
    const nextLayerC = nextState.layers.find((layer) => layer.id === layerC);

    expect(nextLayerA?.visible).toBe(false);
    expect(nextLayerB?.visible).toBe(true);
    expect(nextLayerC?.visible).toBe(false);
    expect(nextState.layersNeedRecomposition).toBe(true);
  });

  it('toggles visibility only for targeted layers', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const layerC = store.addLayer(createNormalLayerInput('Layer C'));

    useAppStore.getState().setLayersVisibility([layerA], false);
    useAppStore.getState().toggleLayersVisibility([layerA, layerB]);

    const nextState = useAppStore.getState();
    const nextLayerA = nextState.layers.find((layer) => layer.id === layerA);
    const nextLayerB = nextState.layers.find((layer) => layer.id === layerB);
    const nextLayerC = nextState.layers.find((layer) => layer.id === layerC);

    expect(nextLayerA?.visible).toBe(true);
    expect(nextLayerB?.visible).toBe(false);
    expect(nextLayerC?.visible).toBe(true);
    expect(nextState.layersNeedRecomposition).toBe(true);
  });

  it('does not create undo history entries for layer visibility changes', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const layerC = store.addLayer(createNormalLayerInput('Layer C'));
    const groupId = useAppStore.getState().createLayerGroupFromSelection([layerA, layerB]);

    historyManager.clear();

    useAppStore.getState().setLayersVisibility([layerA], false);
    expect(historyManager.entries()).toHaveLength(0);

    useAppStore.getState().toggleLayersVisibility([layerA, layerB]);
    expect(historyManager.entries()).toHaveLength(0);

    useAppStore.getState().setLayerGroupVisibility(groupId as string, false);
    expect(historyManager.entries()).toHaveLength(0);

    useAppStore.getState().setLayerGroupVisibility(groupId as string, true);
    expect(historyManager.entries()).toHaveLength(0);

    const nextState = useAppStore.getState();
    expect(nextState.layers.find((layer) => layer.id === layerA)?.visible).toBe(true);
    expect(nextState.layers.find((layer) => layer.id === layerB)?.visible).toBe(false);
    expect(nextState.layers.find((layer) => layer.id === layerC)?.visible).toBe(true);
  });

  it('ignores unknown and duplicate ids when setting visibility', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const layerC = store.addLayer(createNormalLayerInput('Layer C'));

    useAppStore.getState().setLayersVisibility([layerA, layerA, 'missing-layer-id'], false);

    const nextState = useAppStore.getState();
    const nextLayerA = nextState.layers.find((layer) => layer.id === layerA);
    const nextLayerB = nextState.layers.find((layer) => layer.id === layerB);
    const nextLayerC = nextState.layers.find((layer) => layer.id === layerC);

    expect(nextLayerA?.visible).toBe(false);
    expect(nextLayerB?.visible).toBe(true);
    expect(nextLayerC?.visible).toBe(true);
    expect(nextState.layersNeedRecomposition).toBe(true);
  });

  it('ignores unknown and duplicate ids when toggling visibility', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const layerC = store.addLayer(createNormalLayerInput('Layer C'));

    useAppStore.getState().toggleLayersVisibility([layerB, layerB, 'missing-layer-id']);

    const nextState = useAppStore.getState();
    const nextLayerA = nextState.layers.find((layer) => layer.id === layerA);
    const nextLayerB = nextState.layers.find((layer) => layer.id === layerB);
    const nextLayerC = nextState.layers.find((layer) => layer.id === layerC);

    expect(nextLayerA?.visible).toBe(true);
    expect(nextLayerB?.visible).toBe(false);
    expect(nextLayerC?.visible).toBe(true);
    expect(nextState.layersNeedRecomposition).toBe(true);
  });

  it('does not change state when setting visibility with only unknown ids', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const layerC = store.addLayer(createNormalLayerInput('Layer C'));

    useAppStore.setState({ layersNeedRecomposition: false });
    useAppStore.getState().setLayersVisibility(['missing-layer-id'], false);

    const nextState = useAppStore.getState();
    const nextLayerA = nextState.layers.find((layer) => layer.id === layerA);
    const nextLayerB = nextState.layers.find((layer) => layer.id === layerB);
    const nextLayerC = nextState.layers.find((layer) => layer.id === layerC);

    expect(nextLayerA?.visible).toBe(true);
    expect(nextLayerB?.visible).toBe(true);
    expect(nextLayerC?.visible).toBe(true);
    expect(nextState.layersNeedRecomposition).toBe(false);
  });

  it('does not change state when setting visibility to an already-matching value', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const layerC = store.addLayer(createNormalLayerInput('Layer C'));

    useAppStore.setState({ layersNeedRecomposition: false });
    useAppStore.getState().setLayersVisibility([layerA, layerC], true);

    const nextState = useAppStore.getState();
    const nextLayerA = nextState.layers.find((layer) => layer.id === layerA);
    const nextLayerB = nextState.layers.find((layer) => layer.id === layerB);
    const nextLayerC = nextState.layers.find((layer) => layer.id === layerC);

    expect(nextLayerA?.visible).toBe(true);
    expect(nextLayerB?.visible).toBe(true);
    expect(nextLayerC?.visible).toBe(true);
    expect(nextState.layersNeedRecomposition).toBe(false);
  });

  it('does not change state when toggling visibility with only unknown ids', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const layerC = store.addLayer(createNormalLayerInput('Layer C'));

    useAppStore.setState({ layersNeedRecomposition: false });
    useAppStore.getState().toggleLayersVisibility(['missing-layer-id']);

    const nextState = useAppStore.getState();
    const nextLayerA = nextState.layers.find((layer) => layer.id === layerA);
    const nextLayerB = nextState.layers.find((layer) => layer.id === layerB);
    const nextLayerC = nextState.layers.find((layer) => layer.id === layerC);

    expect(nextLayerA?.visible).toBe(true);
    expect(nextLayerB?.visible).toBe(true);
    expect(nextLayerC?.visible).toBe(true);
    expect(nextState.layersNeedRecomposition).toBe(false);
  });

  it('does not change state when visibility helpers receive empty target lists', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const layerC = store.addLayer(createNormalLayerInput('Layer C'));

    useAppStore.setState({ layersNeedRecomposition: false });
    useAppStore.getState().setLayersVisibility([], false);
    useAppStore.getState().toggleLayersVisibility([]);

    const nextState = useAppStore.getState();
    const nextLayerA = nextState.layers.find((layer) => layer.id === layerA);
    const nextLayerB = nextState.layers.find((layer) => layer.id === layerB);
    const nextLayerC = nextState.layers.find((layer) => layer.id === layerC);

    expect(nextLayerA?.visible).toBe(true);
    expect(nextLayerB?.visible).toBe(true);
    expect(nextLayerC?.visible).toBe(true);
    expect(nextState.layersNeedRecomposition).toBe(false);
  });

  it('updates only the first matching layer when duplicate ids exist', () => {
    const sharedId = 'duplicate-layer-id';
    const firstLayer: Layer = {
      ...createNormalLayerInput('Layer A'),
      id: sharedId,
      order: 0,
    };
    const secondLayer: Layer = {
      ...createNormalLayerInput('Layer B'),
      id: sharedId,
      order: 1,
    };

    useAppStore.setState((state) => ({
      ...state,
      layers: [firstLayer, secondLayer],
      activeLayerId: sharedId,
      selectedLayerIds: [sharedId],
      layersNeedRecomposition: false,
    }));

    useAppStore.getState().updateLayer(sharedId, { visible: false });

    const nextState = useAppStore.getState();
    expect(nextState.layers[0]?.visible).toBe(false);
    expect(nextState.layers[1]?.visible).toBe(true);
    expect(nextState.layersNeedRecomposition).toBe(true);
  });

  it('creates, renames, and removes a layer group', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const layerC = store.addLayer(createNormalLayerInput('Layer C'));

    const groupId = useAppStore.getState().createLayerGroupFromSelection([layerA, layerB]);
    expect(groupId).toBeTruthy();

    useAppStore.getState().renameLayerGroup(groupId as string, 'Foreground');

    let nextState = useAppStore.getState();
    expect(nextState.layerGroups).toEqual([{ id: groupId, name: 'Foreground' }]);
    expect(nextState.layers.find((layer) => layer.id === layerA)?.groupId).toBe(groupId);
    expect(nextState.layers.find((layer) => layer.id === layerB)?.groupId).toBe(groupId);
    expect(nextState.layers.find((layer) => layer.id === layerC)?.groupId).toBeUndefined();

    useAppStore.getState().removeLayerGroup(groupId as string);
    nextState = useAppStore.getState();

    expect(nextState.layerGroups).toEqual([]);
    expect(nextState.layers.find((layer) => layer.id === layerA)?.groupId).toBeUndefined();
    expect(nextState.layers.find((layer) => layer.id === layerB)?.groupId).toBeUndefined();
  });

  it('creates and updates an ordered Interlace group with undoable settings', async () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Pose A'));
    store.addLayer(createNormalLayerInput('Between'));
    const layerB = store.addLayer(createColorCycleLayerInput('Pose B'));

    historyManager.clear();
    const groupId = useAppStore.getState().createInterlaceGroupFromSelection([layerA, layerB]);

    expect(groupId).toBeTruthy();
    let nextState = useAppStore.getState();
    expect(nextState.layers.filter((layer) => layer.groupId === groupId).map((layer) => layer.id)).toEqual([
      layerA,
      layerB,
    ]);
    expect(nextState.layerGroups[0]).toMatchObject({
      id: groupId,
      kind: 'interlace',
      interlace: { cellSize: 10, dominance: 0.92, direction: 'right' },
    });
    expect(historyManager.entries()).toHaveLength(1);

    useAppStore.getState().updateInterlaceGroup(groupId as string, {
      cellSize: 18,
      direction: 'left',
      motionMode: 'travel',
      patternPreset: 'sierra-travel',
    });
    expect(useAppStore.getState().layerGroups[0].interlace).toMatchObject({
      cellSize: 18,
      direction: 'left',
      motionMode: 'travel',
      patternPreset: 'sierra-travel',
    });
    expect(historyManager.entries()).toHaveLength(2);

    await historyManager.undo();
    nextState = useAppStore.getState();
    expect(nextState.layerGroups[0].interlace).toMatchObject({
      cellSize: 10,
      direction: 'right',
      motionMode: 'fixed',
      patternPreset: 'classic',
    });
  });

  it('previews Interlace settings live and commits the drag as one undo entry', async () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Pose A'));
    const layerB = store.addLayer(createNormalLayerInput('Pose B'));
    const groupId = store.createInterlaceGroupFromSelection([layerA, layerB]) as string;
    const initialSettings = useAppStore.getState().layerGroups[0].interlace;
    expect(initialSettings).toBeDefined();

    historyManager.clear();
    useAppStore.getState().updateInterlaceGroup(
      groupId,
      { cellSize: 14 },
      { recordHistory: false },
    );
    useAppStore.getState().updateInterlaceGroup(
      groupId,
      { cellSize: 18 },
      { recordHistory: false },
    );

    expect(useAppStore.getState().layerGroups[0].interlace?.cellSize).toBe(18);
    expect(historyManager.entries()).toHaveLength(0);

    useAppStore.getState().updateInterlaceGroup(
      groupId,
      { cellSize: 18 },
      { previousSettings: initialSettings },
    );
    expect(historyManager.entries()).toHaveLength(1);

    await historyManager.undo();
    expect(useAppStore.getState().layerGroups[0].interlace?.cellSize).toBe(10);
  });

  it('rejects sequential layers and selections with fewer than two Interlace sources', () => {
    const store = useAppStore.getState();
    const normal = store.addLayer(createNormalLayerInput('Pose'));

    expect(useAppStore.getState().createInterlaceGroupFromSelection([normal])).toBeNull();
    expect(useAppStore.getState().layerGroups).toEqual([]);
  });

  it('moves layer order and group membership in one history entry', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const layerC = store.addLayer(createNormalLayerInput('Layer C'));
    const groupId = useAppStore.getState().createLayerGroupFromSelection([layerA, layerB]);
    expect(groupId).toBeTruthy();

    historyManager.clear();
    useAppStore.getState().moveLayersToGroup([layerC], groupId as string, 2);

    let nextState = useAppStore.getState();
    expect(nextState.layers.map((layer) => layer.id)).toEqual([layerA, layerB, layerC]);
    expect(nextState.layers.find((layer) => layer.id === layerC)?.groupId).toBe(groupId);
    expect(historyManager.entries()).toHaveLength(1);
    expect(historyManager.entries()[0]).toMatchObject({
      action: 'layer-structure',
      label: 'Move layers into group',
      meta: {
        operation: 'move-layers-to-group',
        groupId,
        layerIds: [layerC],
      },
    });

    useAppStore.getState().moveLayersToGroup([layerC], undefined, 3);

    nextState = useAppStore.getState();
    expect(nextState.layers.map((layer) => layer.id)).toEqual([layerA, layerB, layerC]);
    expect(nextState.layers.find((layer) => layer.id === layerC)?.groupId).toBeUndefined();
    expect(historyManager.entries()).toHaveLength(2);
    expect(historyManager.entries()[1]?.label).toBe('Move layers out of group');
  });

  it('prunes an empty group when its final layer is dragged out', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    store.addLayer(createNormalLayerInput('Layer B'));
    const groupId = useAppStore.getState().createLayerGroupFromSelection([layerA]);
    expect(groupId).toBeTruthy();
    useAppStore.getState().setLayerGroupVisibility(groupId as string, false);
    expect(useAppStore.getState().hiddenLayerGroupIds).toContain(groupId);

    useAppStore.getState().moveLayersToGroup([layerA], undefined, 1);

    const nextState = useAppStore.getState();
    expect(nextState.layers.find((layer) => layer.id === layerA)?.groupId).toBeUndefined();
    expect(nextState.layerGroups).toEqual([]);
    expect(nextState.hiddenLayerGroupIds).toEqual([]);
  });

  it('preserves individual visibility when layers move into and out of a hidden group', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const groupId = useAppStore.getState().createLayerGroupFromSelection([layerA]);
    expect(groupId).toBeTruthy();
    useAppStore.getState().setLayerGroupVisibility(groupId as string, false);

    useAppStore.getState().moveLayersToGroup([layerB], groupId as string, 1);
    let nextState = useAppStore.getState();
    expect(nextState.layers.find((layer) => layer.id === layerB)?.visible).toBe(false);

    useAppStore.getState().moveLayersToGroup([layerA], undefined, 1);
    nextState = useAppStore.getState();
    expect(nextState.layers.find((layer) => layer.id === layerA)?.visible).toBe(true);
    expect(nextState.layers.find((layer) => layer.id === layerB)?.visible).toBe(false);

    useAppStore.getState().setLayerGroupVisibility(groupId as string, true);
    nextState = useAppStore.getState();
    expect(nextState.layers.find((layer) => layer.id === layerA)?.visible).toBe(true);
    expect(nextState.layers.find((layer) => layer.id === layerB)?.visible).toBe(true);
  });

  it('restores hidden-group visibility after undoing a layer drag out', async () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const groupId = useAppStore.getState().createLayerGroupFromSelection([layerA, layerB]);
    expect(groupId).toBeTruthy();
    useAppStore.getState().setLayerGroupVisibility(groupId as string, false);

    historyManager.clear();
    useAppStore.getState().moveLayersToGroup([layerA], undefined, 1);
    expect(useAppStore.getState().layers.find((layer) => layer.id === layerA)?.visible).toBe(true);

    await historyManager.undo();
    useAppStore.getState().setLayerGroupVisibility(groupId as string, true);

    const nextState = useAppStore.getState();
    expect(nextState.layers.find((layer) => layer.id === layerA)?.groupId).toBe(groupId);
    expect(nextState.layers.find((layer) => layer.id === layerA)?.visible).toBe(true);
    expect(nextState.layers.find((layer) => layer.id === layerB)?.visible).toBe(true);
  });

  it('restores previous per-layer visibility when showing a hidden group', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const layerC = store.addLayer(createNormalLayerInput('Layer C'));

    const groupId = useAppStore.getState().createLayerGroupFromSelection([layerA, layerB]);
    expect(groupId).toBeTruthy();

    useAppStore.getState().setLayersVisibility([layerB], false);

    useAppStore.getState().setLayerGroupVisibility(groupId as string, false);
    let nextState = useAppStore.getState();

    expect(nextState.layers.find((layer) => layer.id === layerA)?.visible).toBe(false);
    expect(nextState.layers.find((layer) => layer.id === layerB)?.visible).toBe(false);
    expect(nextState.layers.find((layer) => layer.id === layerC)?.visible).toBe(true);
    expect(nextState.hiddenLayerGroupIds).toContain(groupId);

    useAppStore.getState().setLayerGroupVisibility(groupId as string, true);
    nextState = useAppStore.getState();

    expect(nextState.layers.find((layer) => layer.id === layerA)?.visible).toBe(true);
    expect(nextState.layers.find((layer) => layer.id === layerB)?.visible).toBe(false);
    expect(nextState.layers.find((layer) => layer.id === layerC)?.visible).toBe(true);
    expect(nextState.hiddenLayerGroupIds).not.toContain(groupId);
  });

  it('keeps group membership stable across reorder and duplicate', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    store.addLayer(createNormalLayerInput('Layer C'));

    const groupId = useAppStore.getState().createLayerGroupFromSelection([layerA, layerB]);
    expect(groupId).toBeTruthy();

    const beforeReorder = useAppStore.getState();
    const sourceIndex = beforeReorder.layers.findIndex((layer) => layer.id === layerA);
    const destinationIndex = beforeReorder.layers.findIndex((layer) => layer.id === layerB);
    useAppStore.getState().reorderLayers(sourceIndex, destinationIndex);

    const duplicatedId = useAppStore.getState().duplicateLayer(layerA);
    expect(duplicatedId).toBeTruthy();

    const nextState = useAppStore.getState();
    expect(nextState.layers.find((layer) => layer.id === layerA)?.groupId).toBe(groupId);
    expect(nextState.layers.find((layer) => layer.id === layerB)?.groupId).toBe(groupId);
    expect(nextState.layers.find((layer) => layer.id === duplicatedId)?.groupId).toBe(groupId);
    expect(nextState.layerGroups).toEqual([
      expect.objectContaining({ id: groupId })
    ]);
  });

  it('reorders a grouped layer block above another group', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const layerC = store.addLayer(createNormalLayerInput('Layer C'));
    const layerD = store.addLayer(createNormalLayerInput('Layer D'));

    const groupOne = useAppStore.getState().createLayerGroupFromSelection([layerA, layerB]);
    const groupTwo = useAppStore.getState().createLayerGroupFromSelection([layerC, layerD]);
    expect(groupOne).toBeTruthy();
    expect(groupTwo).toBeTruthy();

    const before = useAppStore.getState();
    const targetTopIndex = Math.max(
      ...before.layers
        .map((layer, index) => ({ layer, index }))
        .filter(({ layer }) => layer.groupId === groupTwo)
        .map(({ index }) => index)
    );

    useAppStore.getState().reorderLayerBlock([layerA, layerB], targetTopIndex + 1);

    const nextState = useAppStore.getState();
    const visibleIds = nextState.layers.slice().reverse().map((layer) => layer.id);
    expect(visibleIds.slice(0, 2)).toEqual([layerB, layerA]);
    expect(visibleIds.slice(2, 4)).toEqual([layerD, layerC]);
  });

  it('treats reorderLayerBlock as a no-op for unknown layer ids', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const beforeIds = useAppStore.getState().layers.map((layer) => layer.id);

    useAppStore.getState().reorderLayerBlock(['layer-missing'], 1);

    const nextIds = useAppStore.getState().layers.map((layer) => layer.id);
    expect(nextIds).toEqual(beforeIds);
    expect(nextIds).toEqual([layerA, layerB]);
  });

  it('dedupes repeated ids when reordering a layer block', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const layerC = store.addLayer(createNormalLayerInput('Layer C'));

    useAppStore.getState().reorderLayerBlock([layerA, layerA, layerB], 3);

    const nextIds = useAppStore.getState().layers.map((layer) => layer.id);
    expect(nextIds).toEqual([layerC, layerA, layerB]);
  });

  it('prunes empty groups on remove and keeps shared-group merge membership', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));

    const groupId = useAppStore.getState().createLayerGroupFromSelection([layerA, layerB]);
    expect(groupId).toBeTruthy();

    useAppStore.getState().removeLayer(layerA);
    expect(useAppStore.getState().layerGroups).toEqual([
      expect.objectContaining({ id: groupId })
    ]);

    useAppStore.getState().removeLayer(layerB);
    expect(useAppStore.getState().layerGroups).toEqual([]);

    const left = useAppStore.getState().addLayer(createNormalLayerInput('Left'));
    const right = useAppStore.getState().addLayer(createNormalLayerInput('Right'));
    const mergeGroupId = useAppStore.getState().createLayerGroupFromSelection([left, right]);
    expect(mergeGroupId).toBeTruthy();

    const mergedId = useAppStore.getState().mergeLayers([left, right]);
    expect(mergedId).toBeTruthy();
    expect(useAppStore.getState().layers.find((layer) => layer.id === mergedId)?.groupId).toBe(mergeGroupId);

    const alpha = useAppStore.getState().addLayer(createNormalLayerInput('Alpha'));
    const beta = useAppStore.getState().addLayer(createNormalLayerInput('Beta'));
    const gamma = useAppStore.getState().addLayer(createNormalLayerInput('Gamma'));
    const groupOne = useAppStore.getState().createLayerGroupFromSelection([alpha]);
    const groupTwo = useAppStore.getState().createLayerGroupFromSelection([beta]);
    expect(groupOne).toBeTruthy();
    expect(groupTwo).toBeTruthy();

    const mixedMergedId = useAppStore.getState().mergeLayers([alpha, beta, gamma]);
    expect(mixedMergedId).toBeTruthy();
    expect(useAppStore.getState().layers.find((layer) => layer.id === mixedMergedId)?.groupId).toBeUndefined();
  });

  it('removes multiple selected layers while preserving a valid active selection', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const layerC = store.addLayer(createNormalLayerInput('Layer C'));

    useAppStore.getState().setSelectedLayerIds([layerA, layerC]);
    useAppStore.getState().setActiveLayer(layerC, { preserveSelection: true });

    useAppStore.getState().removeLayers([layerA, layerC]);

    const nextState = useAppStore.getState();
    expect(nextState.layers.map((layer) => layer.id)).toEqual([layerB]);
    expect(nextState.activeLayerId).toBe(layerB);
    expect(nextState.selectedLayerIds).toEqual([layerB]);
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

  it('duplicates multiple selected layers and selects the duplicated block', () => {
    const store = useAppStore.getState();
    const layerA = store.addLayer(createNormalLayerInput('Layer A'));
    const layerB = store.addLayer(createNormalLayerInput('Layer B'));
    const layerC = store.addLayer(createNormalLayerInput('Layer C'));

    const duplicatedIds = useAppStore.getState().duplicateLayers([layerA, layerC]);

    expect(duplicatedIds).toHaveLength(2);

    const nextState = useAppStore.getState();
    expect(nextState.selectedLayerIds).toEqual(duplicatedIds);
    expect(nextState.activeLayerId).toBe(duplicatedIds[duplicatedIds.length - 1]);

    const nextIds = nextState.layers.map((layer) => layer.id);
    expect(nextIds).toEqual([layerA, duplicatedIds[0], layerB, layerC, duplicatedIds[1]]);
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
    mockApplyLayerSnapshot.mockClear();
    mockBrush.updateColorCycleTexture.mockClear();
    mockBrush.renderDirectToCanvas.mockClear();
    const sourcePaintBuffer = Uint8Array.from([0, 12, 0, 44]).buffer;
    const sourceGradientIdBuffer = Uint8Array.from([0, 3, 0, 7]).buffer;
    const sourceGradientDefIdBuffer = Uint16Array.from([0, 5, 0, 9]).buffer;
    const sourceSpeedBuffer = Uint8Array.from([0, 88, 0, 99]).buffer;
    const sourceFlowBuffer = Uint8Array.from([0, 1, 0, 2]).buffer;
    const sourcePhaseBuffer = Uint8Array.from([0, 64, 0, 128]).buffer;
    documentRegistry.set(originalId, new ColorCycleLayerDocument({
      ...makeDocumentState(originalId, 2, 2),
      paintBuffer: sourcePaintBuffer,
      gradientIdBuffer: sourceGradientIdBuffer,
      gradientDefIdBuffer: sourceGradientDefIdBuffer,
      speedBuffer: sourceSpeedBuffer,
      flowBuffer: sourceFlowBuffer,
      phaseBuffer: sourcePhaseBuffer,
      hasContent: true,
    }));

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
    expect(mockApplyLayerSnapshot).toHaveBeenCalledWith(
      duplicatedId,
      expect.objectContaining({
        paintBuffer: expect.any(ArrayBuffer),
        gradientIdBuffer: expect.any(ArrayBuffer),
        gradientDefIdBuffer: expect.any(ArrayBuffer),
        speedBuffer: expect.any(ArrayBuffer),
        flowBuffer: expect.any(ArrayBuffer),
        phaseBuffer: expect.any(ArrayBuffer),
        hasContent: true,
        strokeCounter: 0,
      })
    );
    const appliedSnapshot = mockApplyLayerSnapshot.mock.calls[0]?.[1];
    expect(Array.from(new Uint8Array(appliedSnapshot.paintBuffer))).toEqual([0, 12, 0, 44]);
    expect(Array.from(new Uint8Array(appliedSnapshot.gradientIdBuffer))).toEqual([0, 3, 0, 7]);
    expect(Array.from(new Uint16Array(appliedSnapshot.gradientDefIdBuffer))).toEqual([0, 5, 0, 9]);
    expect(Array.from(new Uint8Array(appliedSnapshot.speedBuffer))).toEqual([0, 88, 0, 99]);
    expect(Array.from(new Uint8Array(appliedSnapshot.flowBuffer))).toEqual([0, 1, 0, 2]);
    expect(Array.from(new Uint8Array(appliedSnapshot.phaseBuffer))).toEqual([0, 64, 0, 128]);
    expect(appliedSnapshot.paintBuffer).not.toBe(sourcePaintBuffer);
    expect(mockBrush.updateColorCycleTexture).toHaveBeenCalled();
    expect(mockBrush.renderDirectToCanvas).toHaveBeenCalledWith(expect.anything(), duplicatedId);

    const nextState = useAppStore.getState();
    const duplicateLayer = nextState.layers.find((layer) => layer.id === duplicatedId);
    const sourceLayer = nextState.layers.find((layer) => layer.id === originalId);
    expect(duplicateLayer?.colorCycleData?.gradient).toEqual(sourceLayer?.colorCycleData?.gradient);
    expect(duplicateLayer?.colorCycleData?.colorCycleBrush).toBe(mockBrush);
    expect(duplicateLayer?.colorCycleData?.hasContent).toBe(true);
    const duplicateBrushState = duplicateLayer?.colorCycleData?.brushState as {
      canonicalPaint?: boolean;
      layers?: Array<{
        layerId?: string;
        canonicalPaint?: boolean;
        strokeData?: {
          paintBuffer?: ArrayBuffer;
          gradientIdBuffer?: ArrayBuffer;
          gradientDefIdBuffer?: ArrayBuffer;
          speedBuffer?: ArrayBuffer;
          flowBuffer?: ArrayBuffer;
          phaseBuffer?: ArrayBuffer;
          hasContent?: boolean;
        };
      }>;
    } | undefined;
    const duplicateStrokeData = duplicateBrushState?.layers?.[0]?.strokeData;
    expect(Array.from(new Uint8Array(duplicateStrokeData?.gradientIdBuffer ?? new ArrayBuffer(0))))
      .toEqual([0, 3, 0, 7]);
    expect(Array.from(new Uint16Array(duplicateStrokeData?.gradientDefIdBuffer ?? new ArrayBuffer(0))))
      .toEqual([0, 5, 0, 9]);
    const duplicateSnapshot = duplicateBrushState?.layers?.find((snapshot) => snapshot.layerId === duplicatedId);
    expect(duplicateBrushState?.canonicalPaint).toBe(true);
    expect(duplicateSnapshot?.canonicalPaint).toBe(true);
    expect(Array.from(new Uint8Array(duplicateSnapshot?.strokeData?.paintBuffer ?? new ArrayBuffer(0))))
      .toEqual([0, 12, 0, 44]);
    expect(Array.from(new Uint8Array(duplicateSnapshot?.strokeData?.gradientIdBuffer ?? new ArrayBuffer(0))))
      .toEqual([0, 3, 0, 7]);
    expect(Array.from(new Uint16Array(duplicateSnapshot?.strokeData?.gradientDefIdBuffer ?? new ArrayBuffer(0))))
      .toEqual([0, 5, 0, 9]);
    expect(Array.from(new Uint8Array(duplicateSnapshot?.strokeData?.speedBuffer ?? new ArrayBuffer(0))))
      .toEqual([0, 88, 0, 99]);
    expect(Array.from(new Uint8Array(duplicateSnapshot?.strokeData?.flowBuffer ?? new ArrayBuffer(0))))
      .toEqual([0, 1, 0, 2]);
    expect(Array.from(new Uint8Array(duplicateSnapshot?.strokeData?.phaseBuffer ?? new ArrayBuffer(0))))
      .toEqual([0, 64, 0, 128]);
    expect(duplicateSnapshot?.strokeData?.hasContent).toBe(true);
    expect(duplicateLayer?.imageData).not.toBeNull();
    expect(duplicateLayer?.framebuffer).not.toBe(sourceLayer?.framebuffer);
  });

  it('remaps persisted color-cycle brushState snapshots when duplicating cold layers', () => {
    const store = useAppStore.getState();
    const ccLayerInput = createColorCycleLayerInput('Cold CC Layer');
    const originalId = store.addLayer(ccLayerInput);
    const persistedPaintBuffer = Uint8Array.from([1, 2, 3, 4]).buffer;
    const persistedGradientIdBuffer = Uint8Array.from([4, 3, 2, 1]).buffer;

    useAppStore.setState((state) => ({
      layers: state.layers.map((layer) => (
        layer.id === originalId && layer.layerType === 'color-cycle'
          ? {
              ...layer,
              colorCycleData: {
                ...(layer.colorCycleData ?? {}),
                brushState: {
                  cycleSpeed: 0.25,
                  layers: [
                    {
                      layerId: originalId,
                      strokeData: {
                        paintBuffer: persistedPaintBuffer,
                        gradientIdBuffer: persistedGradientIdBuffer,
                        hasContent: true,
                        strokeCounter: 4,
                      },
                    },
                  ],
                },
              },
            }
          : layer
      )),
    }));

    const duplicatedId = useAppStore.getState().duplicateLayer(originalId);
    expect(duplicatedId).toBeTruthy();

    const duplicateLayer = useAppStore.getState().layers.find((layer) => layer.id === duplicatedId);
    const duplicateBrushState = duplicateLayer?.colorCycleData?.brushState as {
      layers?: Array<{
        layerId?: string;
        strokeData?: {
          paintBuffer?: ArrayBuffer;
          gradientIdBuffer?: ArrayBuffer;
          hasContent?: boolean;
          strokeCounter?: number;
        };
      }>;
    } | undefined;
    const duplicateSnapshot = duplicateBrushState?.layers?.[0];

    expect(duplicateSnapshot?.layerId).toBe(duplicatedId);
    expect(duplicateSnapshot?.strokeData?.paintBuffer).not.toBe(persistedPaintBuffer);
    expect(duplicateSnapshot?.strokeData?.gradientIdBuffer).not.toBe(persistedGradientIdBuffer);
    expect(Array.from(new Uint8Array(duplicateSnapshot?.strokeData?.paintBuffer ?? new ArrayBuffer(0))))
      .toEqual([1, 2, 3, 4]);
    expect(Array.from(new Uint8Array(duplicateSnapshot?.strokeData?.gradientIdBuffer ?? new ArrayBuffer(0))))
      .toEqual([4, 3, 2, 1]);
    expect(duplicateSnapshot?.strokeData?.hasContent).toBe(true);
    expect(duplicateSnapshot?.strokeData?.strokeCounter).toBe(4);
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

  it('refreshes auto alignment offsets when capturing changed active-layer bounds', async () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer({
      ...createNormalLayerInput('Auto Capture Layer'),
      alignment: {
        ...createDefaultLayerAlignment(),
        positioning: 'auto',
        fit: 'contain',
        offsetPercent: { x: 0, y: 0 },
        offsetPx: { x: 0, y: 0 },
      },
    });
    const { canvas: sourceCanvas } = createSinglePixelSourceCanvas(32, 32, 16, 8);

    await useAppStore.getState().captureCanvasToActiveLayer(sourceCanvas);

    const nextState = useAppStore.getState();
    const targetLayer = nextState.layers.find((candidate) => candidate.id === layerId);
    expect(targetLayer?.alignment.offsetPercent).toBeDefined();
    expect(targetLayer?.alignment.offsetPx).toBeDefined();
    expect(targetLayer?.alignment.offsetPercent).not.toEqual({ x: 0, y: 0 });
    expect(targetLayer?.alignment.offsetPx).not.toEqual({ x: 0, y: 0 });
    expect(targetLayer?.alignment.offsetPx).toEqual({
      x: Math.round(((targetLayer?.alignment.offsetPercent?.x ?? 0) / 100) * 256),
      y: Math.round(((targetLayer?.alignment.offsetPercent?.y ?? 0) / 100) * 256),
    });
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

  it('merges selected layers into a single normal layer and focuses it', () => {
    const createElementSpy = jest.spyOn(document, 'createElement');
    const realCreateElement = document.createElement.bind(document);
    createElementSpy.mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        return makeCanvas() as unknown as HTMLCanvasElement;
      }
      return realCreateElement(tagName);
    });

    useAppStore.setState((state) => ({
      project: state.project ?? {
        id: 'proj-merge',
        name: 'Merge Test',
        width: 256,
        height: 256,
        layers: [],
        backgroundColor: 'transparent',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
    }));

    const store = useAppStore.getState();
    const bottomId = store.addLayer(createNormalLayerInput('Bottom'));
    const topId = store.addLayer(createNormalLayerInput('Top'));

    const mergedId = useAppStore.getState().mergeLayers([bottomId, topId]);
    createElementSpy.mockRestore();

    const nextState = useAppStore.getState();
    expect(mergedId).toBeTruthy();
    expect(nextState.layers).toHaveLength(1);
    const mergedLayer = nextState.layers[0];
    expect(mergedLayer?.id).toBe(mergedId);
    expect(mergedLayer?.layerType).toBe('normal');
    expect(nextState.activeLayerId).toBe(mergedId);
    expect(nextState.selectedLayerIds).toEqual([mergedId]);
    expect(nextState.referenceLayerId).toBeNull();
  });

  it('merges color-cycle layers without flattening their canonical payloads', () => {
    const makeRenderedImage = (paintedPixel: number) => {
      const imageData = new ImageData(2, 1);
      imageData.data[paintedPixel * 4 + 3] = 255;
      return imageData;
    };
    const makeRenderedCanvas = (imageData: ImageData) => ({
      width: imageData.width,
      height: imageData.height,
      getContext: jest.fn(() => ({
        getImageData: jest.fn(() => imageData),
      })),
    }) as unknown as HTMLCanvasElement;

    useAppStore.setState((state) => ({
      project: state.project
        ? { ...state.project, width: 2, height: 1 }
        : state.project,
    }));

    const bottomId = useAppStore.getState().addLayer({
      ...createColorCycleLayerInput('Bottom CC'),
      imageData: makeRenderedImage(0),
      colorCycleData: {
        ...createColorCycleLayerInput('Bottom CC').colorCycleData,
        canvas: makeRenderedCanvas(makeRenderedImage(0)),
        slotPalettes: [{
          slot: 1,
          stops: [
            { position: 0, color: '#ff0000' },
            { position: 1, color: '#880000' },
          ],
        }],
        gradientDefStore: [{
          id: 1,
          kind: 'linear',
          hash: 'bottom-red',
          source: 'manual',
          createdAtMs: 1,
          slot: 1,
          stops: [
            { position: 0, color: '#ff0000' },
            { position: 1, color: '#880000' },
          ],
        }],
      },
    });
    const topId = useAppStore.getState().addLayer({
      ...createColorCycleLayerInput('Top CC'),
      imageData: makeRenderedImage(1),
      colorCycleData: {
        ...createColorCycleLayerInput('Top CC').colorCycleData,
        canvas: makeRenderedCanvas(makeRenderedImage(1)),
        slotPalettes: [{
          slot: 1,
          stops: [
            { position: 0, color: '#0000ff' },
            { position: 1, color: '#000088' },
          ],
        }],
        gradientDefStore: [{
          id: 1,
          kind: 'linear',
          hash: 'top-blue',
          source: 'manual',
          createdAtMs: 2,
          slot: 1,
          stops: [
            { position: 0, color: '#0000ff' },
            { position: 1, color: '#000088' },
          ],
        }],
      },
    });

    documentRegistry.set(bottomId, new ColorCycleLayerDocument({
      ...makeDocumentState(bottomId, 2, 1),
      paintBuffer: Uint8Array.from([10, 0]).buffer,
      gradientIdBuffer: Uint8Array.from([1, 1]).buffer,
      gradientDefIdBuffer: Uint16Array.from([1, 1]).buffer,
    }));
    documentRegistry.set(topId, new ColorCycleLayerDocument({
      ...makeDocumentState(topId, 2, 1),
      paintBuffer: Uint8Array.from([0, 20]).buffer,
      gradientIdBuffer: Uint8Array.from([1, 1]).buffer,
      gradientDefIdBuffer: Uint16Array.from([1, 1]).buffer,
    }));
    brushRegistry.set(bottomId, mockBrush);
    brushRegistry.set(topId, mockBrush);
    mockApplyLayerSnapshot.mockClear();
    mockApplyLayerSnapshot.mockImplementationOnce((layerId, snapshot) => {
      const runtimeMeta = readMockBrushPersistenceMeta(layerId);
      const document = new ColorCycleLayerDocument({
        ...makeDocumentState(layerId, 2, 1),
        ...snapshot,
        slotPalettes: runtimeMeta?.slotPalettes,
        gradientDefs: runtimeMeta?.gradientDefs,
        gradientDefStore: runtimeMeta?.gradientDefStore,
        paintSlot: runtimeMeta?.paintSlot,
        fgActiveSlot: runtimeMeta?.fgActiveSlot,
        activeGradientId: runtimeMeta?.activeGradientId,
      });
      documentRegistry.set(layerId, document);
    });

    const mergedId = useAppStore.getState().mergeLayers([bottomId, topId]);

    expect(mergedId).not.toBeNull();
    expect(mergedId).not.toBe(bottomId);
    expect(mergedId).not.toBe(topId);
    const mergedLayer = useAppStore.getState().layers.find((layer) => layer.id === mergedId);
    expect(mergedLayer?.layerType).toBe('color-cycle');
    expect(mergedLayer?.colorCycleData?.brushState).toBeDefined();
    expect(mergedLayer?.colorCycleData?.slotPalettes).toHaveLength(2);
    expect(mergedLayer?.colorCycleData?.gradientDefStore).toHaveLength(2);
    expect(mockApplyLayerSnapshot).toHaveBeenCalledWith(
      mergedId,
      expect.objectContaining({
        hasContent: true,
        speedSourceVersion: 2,
      }),
      undefined,
      'merge-color-cycle-layers',
      undefined,
    );
    const appliedSnapshot = mockApplyLayerSnapshot.mock.calls[0]?.[1];
    expect(Array.from(new Uint8Array(appliedSnapshot.paintBuffer))).toEqual([10, 20]);
    expect(Array.from(new Uint8Array(appliedSnapshot.gradientIdBuffer))).toEqual([1, 0]);
    expect(Array.from(new Uint16Array(appliedSnapshot.gradientDefIdBuffer))).toEqual([1, 2]);
    expect(documentRegistry.get(mergedId as string)?.read().snapshot.gradientDefStore).toHaveLength(2);
    expect(mockManager.removeColorCycleBrush).toHaveBeenCalledWith(topId);
    expect(mockManager.removeColorCycleBrush).toHaveBeenCalledWith(bottomId);
  });

  it('blocks a canonical CC merge when painted pixels overlap despite an opaque sampled frame', () => {
    const createLayer = (id: string, order: number, color: string): Layer => ({
      ...createColorCycleLayerInput(id),
      id,
      order,
      colorCycleData: {
        ...createColorCycleLayerInput(id).colorCycleData,
        slotPalettes: [{
          slot: 1,
          stops: [
            { position: 0, color },
            { position: 1, color: 'rgba(0, 0, 0, 0)' },
          ],
        }],
        gradientDefStore: [{
          id: 1,
          kind: 'linear',
          hash: `${id}-gradient`,
          source: 'manual',
          createdAtMs: 1,
          slot: 1,
          stops: [
            { position: 0, color },
            { position: 1, color: 'rgba(0, 0, 0, 0)' },
          ],
        }],
      },
    });
    const createSnapshot = (): ColorCycleBrushLayerSnapshot => ({
      paintBuffer: Uint8Array.from([1]).buffer,
      gradientIdBuffer: Uint8Array.from([1]).buffer,
      gradientDefIdBuffer: Uint16Array.from([1]).buffer,
      speedBuffer: Uint8Array.from([1]).buffer,
      flowBuffer: Uint8Array.from([1]).buffer,
      phaseBuffer: Uint8Array.from([0]).buffer,
      hasContent: true,
      strokeCounter: 1,
    });
    const opaqueFrame = new ImageData(1, 1);
    opaqueFrame.data[3] = 255;

    expect(mergeColorCycleLayerPayloads({
      sources: [
        { layer: createLayer('bottom', 0, '#ff0000'), snapshot: createSnapshot(), renderedImageData: opaqueFrame },
        { layer: createLayer('top', 1, '#0000ff'), snapshot: createSnapshot(), renderedImageData: opaqueFrame },
      ],
      targetLayerId: 'merged',
      width: 1,
      height: 1,
    })).toBeNull();
  });

  it('blocks a canonical CC merge when a colliding palette cannot be remapped losslessly', () => {
    const palettes = Array.from({ length: 256 }, (_, slot) => ({
      slot,
      stops: [
        { position: 0, color: `rgb(${slot}, 0, 0)` },
        { position: 1, color: `rgb(${slot}, 0, 0)` },
      ],
    }));
    const createLayer = (
      id: string,
      order: number,
      slotPalettes: NonNullable<NonNullable<Layer['colorCycleData']>['slotPalettes']>,
    ): Layer => ({
      ...createColorCycleLayerInput(id),
      id,
      order,
      colorCycleData: {
        ...createColorCycleLayerInput(id).colorCycleData,
        slotPalettes,
        gradientDefStore: [],
      },
    });
    const createSnapshot = (paint: number[]): ColorCycleBrushLayerSnapshot => ({
      paintBuffer: Uint8Array.from(paint).buffer,
      gradientIdBuffer: Uint8Array.from([0, 0]).buffer,
      gradientDefIdBuffer: Uint16Array.from([0, 0]).buffer,
      speedBuffer: Uint8Array.from([1, 1]).buffer,
      flowBuffer: Uint8Array.from([1, 1]).buffer,
      phaseBuffer: Uint8Array.from([0, 0]).buffer,
      hasContent: true,
      strokeCounter: 1,
    });
    const renderedBottom = new ImageData(2, 1);
    renderedBottom.data[3] = 255;
    const renderedTop = new ImageData(2, 1);
    renderedTop.data[7] = 255;

    expect(mergeColorCycleLayerPayloads({
      sources: [
        {
          layer: createLayer('bottom', 0, palettes),
          snapshot: createSnapshot([1, 0]),
          renderedImageData: renderedBottom,
        },
        {
          layer: createLayer('top', 1, [{
            slot: 0,
            stops: [
              { position: 0, color: '#0000ff' },
              { position: 1, color: '#000088' },
            ],
          }]),
          snapshot: createSnapshot([0, 1]),
          renderedImageData: renderedTop,
        },
      ],
      targetLayerId: 'merged',
      width: 2,
      height: 1,
    })).toBeNull();
  });

  it('blocks a canonical CC merge when layer playback states differ', () => {
    const createLayer = (
      id: string,
      order: number,
      isAnimating: boolean,
    ): Layer => ({
      ...createColorCycleLayerInput(id),
      id,
      order,
      colorCycleData: {
        ...createColorCycleLayerInput(id).colorCycleData,
        isAnimating,
        slotPalettes: [{
          slot: 1,
          stops: [
            { position: 0, color: '#ff0000' },
            { position: 1, color: '#880000' },
          ],
        }],
        gradientDefStore: [],
      },
    });
    const createSnapshot = (paint: number[]): ColorCycleBrushLayerSnapshot => ({
      paintBuffer: Uint8Array.from(paint).buffer,
      gradientIdBuffer: Uint8Array.from([1, 1]).buffer,
      gradientDefIdBuffer: Uint16Array.from([0, 0]).buffer,
      speedBuffer: Uint8Array.from([1, 1]).buffer,
      flowBuffer: Uint8Array.from([1, 1]).buffer,
      phaseBuffer: Uint8Array.from([0, 0]).buffer,
      hasContent: true,
      strokeCounter: 1,
    });
    const renderedBottom = new ImageData(2, 1);
    renderedBottom.data[3] = 255;
    const renderedTop = new ImageData(2, 1);
    renderedTop.data[7] = 255;

    expect(mergeColorCycleLayerPayloads({
      sources: [
        {
          layer: createLayer('paused-bottom', 0, false),
          snapshot: createSnapshot([1, 0]),
          renderedImageData: renderedBottom,
        },
        {
          layer: createLayer('playing-top', 1, true),
          snapshot: createSnapshot([0, 1]),
          renderedImageData: renderedTop,
        },
      ],
      targetLayerId: 'merged',
      width: 2,
      height: 1,
    })).toBeNull();
  });

  it('keeps source CC layers when fresh rendered pixels cannot be read', () => {
    const stalePreview = new ImageData(1, 1);
    stalePreview.data[3] = 255;
    const unreadableCanvas = () => ({
      width: 1,
      height: 1,
      getContext: jest.fn(() => ({
        getImageData: jest.fn(() => {
          throw new Error('canvas readback failed');
        }),
      })),
    }) as unknown as HTMLCanvasElement;
    useAppStore.setState((state) => ({
      project: state.project
        ? { ...state.project, width: 1, height: 1 }
        : state.project,
    }));

    const bottomId = useAppStore.getState().addLayer({
      ...createColorCycleLayerInput('Bottom unreadable CC'),
      imageData: stalePreview,
      colorCycleData: {
        ...createColorCycleLayerInput('Bottom unreadable CC').colorCycleData,
        canvas: unreadableCanvas(),
        canvasImageData: stalePreview,
      },
    });
    const topId = useAppStore.getState().addLayer({
      ...createColorCycleLayerInput('Top unreadable CC'),
      imageData: stalePreview,
      colorCycleData: {
        ...createColorCycleLayerInput('Top unreadable CC').colorCycleData,
        canvas: unreadableCanvas(),
        canvasImageData: stalePreview,
      },
    });
    documentRegistry.set(bottomId, new ColorCycleLayerDocument(makeDocumentState(bottomId, 1, 1)));
    documentRegistry.set(topId, new ColorCycleLayerDocument(makeDocumentState(topId, 1, 1)));
    brushRegistry.set(bottomId, mockBrush);
    brushRegistry.set(topId, mockBrush);
    mockApplyLayerSnapshot.mockClear();

    const mergedId = useAppStore.getState().mergeLayers([bottomId, topId]);

    expect(mergedId).toBeNull();
    expect(useAppStore.getState().layers.map((layer) => layer.id)).toEqual([bottomId, topId]);
    expect(mockApplyLayerSnapshot).not.toHaveBeenCalled();
    expect(mockManager.removeColorCycleBrush).not.toHaveBeenCalled();
  });

  it.each(([
    ['fractional layer opacity', (layer: Layer) => ({ ...layer, opacity: 0.5 }), 255, undefined],
    ['non-source-over blending', (layer: Layer) => ({ ...layer, blendMode: 'multiply' }), 255, undefined],
    ['hidden layers', (layer: Layer) => ({ ...layer, visible: false }), 255, undefined],
    ['partial pixel alpha', (layer: Layer) => layer, 128, undefined],
    ['missing canonical buffers', (layer: Layer) => layer, 255, (
      snapshot: ColorCycleBrushLayerSnapshot,
    ) => ({ ...snapshot, speedBuffer: undefined })],
    ['active masks', (layer: Layer) => {
      const eraseMask = makeCanvas();
      const eraseMaskImage = new ImageData(32, 32);
      eraseMaskImage.data[3] = 255;
      (eraseMask.getContext('2d')?.getImageData as jest.Mock).mockReturnValue(eraseMaskImage);
      return {
        ...layer,
        colorCycleData: {
          ...layer.colorCycleData,
          eraseMask,
          eraseMaskVersion: 1,
        },
      };
    }, 255, undefined],
  ] satisfies Array<[
    string,
    (layer: Layer) => Layer,
    number,
    ((snapshot: ColorCycleBrushLayerSnapshot) => ColorCycleBrushLayerSnapshot) | undefined,
  ]>))(
    'blocks canonical CC merge for %s',
    (_caseName, configureTopLayer, topAlpha, configureTopSnapshot) => {
      const createLayer = (id: string, order: number): Layer => ({
        ...createColorCycleLayerInput(id),
        id,
        order,
      });
      const createSnapshot = (): ColorCycleBrushLayerSnapshot => ({
        paintBuffer: Uint8Array.from([1]).buffer,
        gradientIdBuffer: Uint8Array.from([1]).buffer,
        gradientDefIdBuffer: Uint16Array.from([1]).buffer,
        speedBuffer: Uint8Array.from([1]).buffer,
        flowBuffer: Uint8Array.from([1]).buffer,
        phaseBuffer: Uint8Array.from([1]).buffer,
        hasContent: true,
        strokeCounter: 1,
      });
      const createRenderedImage = (alpha: number) => {
        const imageData = new ImageData(1, 1);
        imageData.data[3] = alpha;
        return imageData;
      };
      const bottomLayer = createLayer('bottom-cc', 0);
      const topLayer = configureTopLayer(createLayer('top-cc', 1));

      expect(mergeColorCycleLayerPayloads({
        sources: [
          {
            layer: bottomLayer,
            snapshot: createSnapshot(),
            renderedImageData: createRenderedImage(255),
          },
          {
            layer: topLayer,
            snapshot: configureTopSnapshot?.(createSnapshot()) ?? createSnapshot(),
            renderedImageData: createRenderedImage(topAlpha),
          },
        ],
        targetLayerId: bottomLayer.id,
        width: 1,
        height: 1,
      })).toBeNull();
    },
  );

  it('converts a color-cycle layer to a regular layer with rendered pixels', () => {
    const createElementSpy = jest.spyOn(document, 'createElement');
    const realCreateElement = document.createElement.bind(document);
    createElementSpy.mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        return makeCanvas() as unknown as HTMLCanvasElement;
      }
      return realCreateElement(tagName);
    });

    const layerId = useAppStore.getState().addLayer(createColorCycleLayerInput('Convertible CC'));
    brushRegistry.set(layerId, mockBrush);

    const converted = useAppStore.getState().convertColorCycleLayerToNormal(layerId);
    createElementSpy.mockRestore();

    const convertedLayer = useAppStore.getState().layers.find((layer) => layer.id === layerId);
    expect(converted).toBe(true);
    expect(convertedLayer?.layerType).toBe('normal');
    expect(convertedLayer?.colorCycleData).toBeUndefined();
    expect(convertedLayer?.imageData).toBeInstanceOf(ImageData);
    expect(mockManager.removeColorCycleBrush).toHaveBeenCalledWith(layerId);
  });

  it('bakes active color-cycle masks into the converted regular bitmap', () => {
    const sourceCanvas = makeCanvas();
    const eraseMask = makeCanvas();
    const softEdgeMask = makeCanvas();
    const layerInput = createColorCycleLayerInput('Masked CC');
    const layerId = useAppStore.getState().addLayer({
      ...layerInput,
      framebuffer: sourceCanvas,
      colorCycleData: {
        ...layerInput.colorCycleData,
        canvas: sourceCanvas,
        eraseMask,
        softEdgeMask,
        softEdgeMaskEnabled: true,
      },
    });
    brushRegistry.set(layerId, mockBrush);

    const maskedCanvas = makeCanvas();
    const regularCanvas = makeCanvas();
    const createdCanvases = [maskedCanvas, regularCanvas];
    const createElementSpy = jest.spyOn(document, 'createElement');
    const realCreateElement = document.createElement.bind(document);
    createElementSpy.mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        return createdCanvases.shift() as HTMLCanvasElement;
      }
      return realCreateElement(tagName);
    });

    const converted = useAppStore.getState().convertColorCycleLayerToNormal(layerId);
    createElementSpy.mockRestore();

    const maskedContext = maskedCanvas.getContext('2d') as CanvasRenderingContext2D;
    const regularContext = regularCanvas.getContext('2d') as CanvasRenderingContext2D;
    const project = useAppStore.getState().project;
    expect(converted).toBe(true);
    expect(maskedContext.drawImage).toHaveBeenCalledWith(sourceCanvas, 0, 0);
    expect(maskedContext.drawImage).toHaveBeenCalledWith(eraseMask, 0, 0);
    expect(maskedContext.drawImage).toHaveBeenCalledWith(softEdgeMask, 0, 0);
    expect(regularContext.drawImage).toHaveBeenCalledWith(
      maskedCanvas,
      0,
      0,
      project?.width,
      project?.height,
    );
  });

  it('bakes persisted color-cycle mask image data into the converted regular bitmap', () => {
    const sourceCanvas = makeCanvas();
    const eraseMaskImageData = new ImageData(32, 32);
    const softEdgeMaskImageData = new ImageData(32, 32);
    eraseMaskImageData.data[3] = 255;
    softEdgeMaskImageData.data[3] = 255;
    const layerInput = createColorCycleLayerInput('Persisted Mask CC');
    const layerId = useAppStore.getState().addLayer({
      ...layerInput,
      framebuffer: sourceCanvas,
      colorCycleData: {
        ...layerInput.colorCycleData,
        canvas: sourceCanvas,
        eraseMaskImageData,
        softEdgeMaskImageData,
        softEdgeMaskEnabled: true,
      },
    });
    brushRegistry.set(layerId, mockBrush);

    const materializedEraseMask = makeCanvas();
    const materializedSoftEdgeMask = makeCanvas();
    const maskedCanvas = makeCanvas();
    const regularCanvas = makeCanvas();
    const createdCanvases = [
      materializedEraseMask,
      materializedSoftEdgeMask,
      maskedCanvas,
      regularCanvas,
    ];
    const createElementSpy = jest.spyOn(document, 'createElement');
    const realCreateElement = document.createElement.bind(document);
    createElementSpy.mockImplementation((tagName: string) => {
      if (tagName === 'canvas') {
        return createdCanvases.shift() as HTMLCanvasElement;
      }
      return realCreateElement(tagName);
    });

    const converted = useAppStore.getState().convertColorCycleLayerToNormal(layerId);
    createElementSpy.mockRestore();

    const materializedEraseContext = materializedEraseMask.getContext('2d') as CanvasRenderingContext2D;
    const materializedSoftEdgeContext = materializedSoftEdgeMask.getContext('2d') as CanvasRenderingContext2D;
    const maskedContext = maskedCanvas.getContext('2d') as CanvasRenderingContext2D;
    expect(converted).toBe(true);
    expect(materializedEraseContext.putImageData).toHaveBeenCalledWith(eraseMaskImageData, 0, 0);
    expect(materializedSoftEdgeContext.putImageData).toHaveBeenCalledWith(softEdgeMaskImageData, 0, 0);
    expect(maskedContext.drawImage).toHaveBeenCalledWith(materializedEraseMask, 0, 0);
    expect(maskedContext.drawImage).toHaveBeenCalledWith(materializedSoftEdgeMask, 0, 0);
  });

  it('keeps the CC payload when an active mask cannot be baked', () => {
    const sourceCanvas = makeCanvas();
    const eraseMask = makeCanvas();
    const layerInput = createColorCycleLayerInput('Mask Failure CC');
    const layerId = useAppStore.getState().addLayer({
      ...layerInput,
      framebuffer: sourceCanvas,
      colorCycleData: {
        ...layerInput.colorCycleData,
        canvas: sourceCanvas,
        eraseMask,
      },
    });
    brushRegistry.set(layerId, mockBrush);

    const maskedCanvas = makeCanvas();
    const maskedContext = maskedCanvas.getContext('2d') as CanvasRenderingContext2D;
    (maskedContext.drawImage as jest.Mock).mockImplementation((source: CanvasImageSource) => {
      if (source === eraseMask) {
        throw new Error('mask draw failed');
      }
    });
    const createElementSpy = jest.spyOn(document, 'createElement');
    const realCreateElement = document.createElement.bind(document);
    createElementSpy.mockImplementation((tagName: string) => (
      tagName === 'canvas'
        ? maskedCanvas as HTMLCanvasElement
        : realCreateElement(tagName)
    ));

    const converted = useAppStore.getState().convertColorCycleLayerToNormal(layerId);
    createElementSpy.mockRestore();

    const sourceLayer = useAppStore.getState().layers.find((layer) => layer.id === layerId);
    expect(converted).toBe(false);
    expect(sourceLayer?.layerType).toBe('color-cycle');
    expect(sourceLayer?.colorCycleData).toBeDefined();
    expect(mockManager.removeColorCycleBrush).not.toHaveBeenCalledWith(layerId);
  });

  it('keeps the CC payload when conversion cannot render a fresh frame', () => {
    const layerId = useAppStore.getState().addLayer(createColorCycleLayerInput('Render Failure CC'));
    brushRegistry.set(layerId, mockBrush);
    mockBrush.renderDirectToCanvas.mockImplementationOnce(() => {
      throw new Error('WebGL context lost');
    });

    const converted = useAppStore.getState().convertColorCycleLayerToNormal(layerId);

    const sourceLayer = useAppStore.getState().layers.find((layer) => layer.id === layerId);
    expect(converted).toBe(false);
    expect(sourceLayer?.layerType).toBe('color-cycle');
    expect(sourceLayer?.colorCycleData).toBeDefined();
    expect(mockManager.removeColorCycleBrush).not.toHaveBeenCalledWith(layerId);
  });

  it('composites visible normal layers from framebuffer when imageData is missing', () => {
    useAppStore.setState((state) => ({
      project: state.project ?? {
        id: 'proj-composite',
        name: 'Composite Test',
        width: 64,
        height: 64,
        layers: [],
        backgroundColor: 'transparent',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
    }));

    const framebuffer = makeCanvas();
    const store = useAppStore.getState();
    store.addLayer({
      ...createNormalLayerInput('Framebuffer Layer'),
      imageData: null,
      framebuffer,
    });

    const ctx = {
      clearRect: jest.fn(),
      fillRect: jest.fn(),
      drawImage: jest.fn(),
    } as unknown as CanvasRenderingContext2D;
    const targetCanvas = {
      width: 64,
      height: 64,
      getContext: jest.fn(() => ctx),
    } as unknown as HTMLCanvasElement;

    useAppStore.getState().compositeLayersToCanvas(targetCanvas);

    expect(ctx.drawImage).toHaveBeenCalledWith(framebuffer, 0, 0);
  });

  it('marks only static composite segments touched by dirty batches before compositing', () => {
    const layerA: Layer = {
      ...createNormalLayerInput('Static A'),
      id: 'layer-a',
      order: 0,
    };
    const layerB: Layer = {
      ...createNormalLayerInput('Static B'),
      id: 'layer-b',
      order: 1,
    };
    const staticCanvasA = makeCanvas();
    const staticCanvasB = makeCanvas();
    const compositeSegments: CompositeSegment[] = [
      {
        kind: 'static',
        id: 'static-a',
        layerIds: ['layer-a'],
        includeBackground: false,
        orderRange: { start: 0, end: 0 },
        canvas: staticCanvasA,
        bitmap: null,
        dirty: false,
      },
      {
        kind: 'static',
        id: 'static-b',
        layerIds: ['layer-b'],
        includeBackground: false,
        orderRange: { start: 1, end: 1 },
        canvas: staticCanvasB,
        bitmap: null,
        dirty: false,
      },
    ];

    useAppStore.setState({
      project: {
        id: 'proj-dirty-batch-composite',
        name: 'Dirty Batch Composite',
        width: 32,
        height: 32,
        layers: [layerA, layerB],
        backgroundColor: 'transparent',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
      layers: [layerA, layerB],
      compositeSegments,
    });

    const ctx = {
      clearRect: jest.fn(),
      drawImage: jest.fn(),
      fillRect: jest.fn(),
      getImageData: jest.fn(() => new ImageData(32, 32)),
      putImageData: jest.fn(),
      imageSmoothingEnabled: true,
    } as unknown as CanvasRenderingContext2D;
    const targetCanvas = {
      width: 32,
      height: 32,
      getContext: jest.fn(() => ctx),
    } as unknown as HTMLCanvasElement;

    expect(useAppStore.getState().compositeLayersToCanvasSync(targetCanvas, {
      dirtyBatches: [{
        layerId: 'layer-b',
        version: 4,
        rects: [{ x: 1, y: 2, width: 3, height: 4 }],
      }],
    })).toBe(true);

    const [segmentA, segmentB] = useAppStore.getState().compositeSegments;
    expect(segmentA).toMatchObject({
      kind: 'static',
      id: 'static-a',
      dirty: false,
    });
    expect(segmentB).toMatchObject({
      kind: 'static',
      id: 'static-b',
      dirty: true,
    });
  });

  it('applies color-cycle masks on a scratch canvas without mutating the source layer canvas', () => {
    useAppStore.setState((state) => ({
      project: state.project ?? {
        id: 'proj-cc-mask-composite',
        name: 'CC Mask Composite',
        width: 64,
        height: 64,
        layers: [],
        backgroundColor: 'transparent',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
    }));

    const sourceCtx = {
      save: jest.fn(),
      restore: jest.fn(),
      drawImage: jest.fn(),
    } as unknown as CanvasRenderingContext2D;
    const layerCanvas = {
      width: 64,
      height: 64,
      getContext: jest.fn(() => sourceCtx),
    } as unknown as HTMLCanvasElement;
    const softEdgeMaskCanvas = {
      width: 64,
      height: 64,
      getContext: jest.fn(),
    } as unknown as HTMLCanvasElement;
    const scratchCtx = {
      clearRect: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      drawImage: jest.fn(),
      globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    const scratchCanvas = {
      width: 64,
      height: 64,
      getContext: jest.fn(() => scratchCtx),
    } as unknown as HTMLCanvasElement;
    const createElement = document.createElement.bind(document);
    const createElementSpy = jest
      .spyOn(document, 'createElement')
      .mockImplementation((tagName: string, options?: ElementCreationOptions) => (
        tagName === 'canvas'
          ? scratchCanvas
          : createElement(tagName, options)
      ));

    const store = useAppStore.getState();
    store.addLayer({
      ...createColorCycleLayerInput('CC Layer'),
      layerType: 'color-cycle',
      colorCycleData: {
        gradient: [{ position: 0, color: '#000' }, { position: 1, color: '#fff' }],
        isAnimating: false,
        mode: 'recolor',
        canvas: layerCanvas,
        softEdgeMask: softEdgeMaskCanvas,
      },
    });

    const targetCtx = {
      clearRect: jest.fn(),
      fillRect: jest.fn(),
      drawImage: jest.fn(),
      globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
      globalAlpha: 1,
      imageSmoothingEnabled: true,
    } as unknown as CanvasRenderingContext2D;
    const targetCanvas = {
      width: 64,
      height: 64,
      getContext: jest.fn(() => targetCtx),
    } as unknown as HTMLCanvasElement;
    expect(useAppStore.getState().compositeLayersToCanvasSync(targetCanvas)).toBe(true);
    expect(useAppStore.getState().compositeLayersToCanvasSync(targetCanvas)).toBe(true);

    expect(sourceCtx.save).not.toHaveBeenCalled();
    expect(sourceCtx.drawImage).not.toHaveBeenCalled();
    expect(scratchCtx.drawImage).toHaveBeenCalledWith(layerCanvas, 0, 0);
    expect(scratchCtx.drawImage).toHaveBeenCalledWith(softEdgeMaskCanvas, 0, 0);
    expect(targetCtx.drawImage).toHaveBeenCalledWith(scratchCanvas, 0, 0);
    expect(targetCtx.drawImage).not.toHaveBeenCalledWith(layerCanvas, 0, 0);

    createElementSpy.mockRestore();
  });

  it('clears baked color-cycle soft-edge mask fields instead of merging undefined patches', () => {
    const store = useAppStore.getState();
    const softEdgeMask = makeCanvas();
    const layerId = store.addLayer({
      ...createColorCycleLayerInput('CC Soft Edge Clear'),
      colorCycleData: {
        ...createColorCycleLayerInput('CC Soft Edge Clear').colorCycleData,
        softEdgeMask,
        softEdgeMaskImageData: new ImageData(32, 32),
        softEdgeMaskEnabled: false,
        softEdgeMaskVersion: 4,
      },
    });

    useAppStore.getState().clearColorCycleSoftEdgeMask(layerId);

    const layer = useAppStore.getState().layers.find((candidate) => candidate.id === layerId);
    expect(layer?.colorCycleData?.softEdgeMask).toBeUndefined();
    expect(layer?.colorCycleData?.softEdgeMaskImageData).toBeUndefined();
    expect(layer?.colorCycleData?.softEdgeMaskEnabled).toBeUndefined();
    expect(layer?.colorCycleData?.softEdgeMaskVersion).toBe(5);
    expect(useAppStore.getState().layersNeedRecomposition).toBe(true);
  });

  it('toggles baked color-cycle soft-edge masks without deleting the baked mask', () => {
    const store = useAppStore.getState();
    const softEdgeMask = makeCanvas();
    const layerId = store.addLayer({
      ...createColorCycleLayerInput('CC Soft Edge Toggle'),
      colorCycleData: {
        ...createColorCycleLayerInput('CC Soft Edge Toggle').colorCycleData,
        softEdgeMask,
        softEdgeMaskImageData: new ImageData(32, 32),
        softEdgeMaskEnabled: true,
        softEdgeMaskVersion: 8,
      },
    });

    useAppStore.getState().setColorCycleSoftEdgeMaskEnabled(layerId, false);

    let layer = useAppStore.getState().layers.find((candidate) => candidate.id === layerId);
    expect(layer?.colorCycleData?.softEdgeMask).toBe(softEdgeMask);
    expect(layer?.colorCycleData?.softEdgeMaskImageData).toBeInstanceOf(ImageData);
    expect(layer?.colorCycleData?.softEdgeMaskEnabled).toBe(false);
    expect(layer?.colorCycleData?.softEdgeMaskVersion).toBe(9);

    useAppStore.getState().setColorCycleSoftEdgeMaskEnabled(layerId, true);

    layer = useAppStore.getState().layers.find((candidate) => candidate.id === layerId);
    expect(layer?.colorCycleData?.softEdgeMask).toBe(softEdgeMask);
    expect(layer?.colorCycleData?.softEdgeMaskEnabled).toBe(true);
    expect(layer?.colorCycleData?.softEdgeMaskVersion).toBe(10);
  });

  it('keeps disabled color-cycle soft-edge masks disabled when refreshing mask settings', async () => {
    const store = useAppStore.getState();
    const { canvas } = createSourceCanvas(32, 32);
    const softEdgeMask = makeCanvas();
    const layerId = store.addLayer({
      ...createColorCycleLayerInput('CC Soft Edge Disabled Refresh'),
      colorCycleData: {
        ...createColorCycleLayerInput('CC Soft Edge Disabled Refresh').colorCycleData,
        canvas,
        canvasWidth: 32,
        canvasHeight: 32,
        softEdgeMask,
        softEdgeMaskImageData: new ImageData(32, 32),
        softEdgeMaskEnabled: false,
        softEdgeMaskVersion: 3,
      },
    });

    await useAppStore.getState().applyColorCycleSoftEdgeMask(layerId, 8, 2, 'sierra-lite');

    const layer = useAppStore.getState().layers.find((candidate) => candidate.id === layerId);
    expect(layer?.colorCycleData?.softEdgeMask).not.toBe(softEdgeMask);
    expect(layer?.colorCycleData?.softEdgeMaskImageData).toBeInstanceOf(ImageData);
    expect(layer?.colorCycleData?.softEdgeMaskEnabled).toBe(false);
    expect(layer?.colorCycleData?.softEdgeMaskVersion).toBe(4);
  });

  it('respects interleaved layer ordering across normal and color-cycle layers during composite', () => {
    useAppStore.setState((state) => ({
      project: state.project ?? {
        id: 'proj-ordering-composite',
        name: 'Ordering Composite',
        width: 4,
        height: 4,
        layers: [],
        backgroundColor: 'transparent',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
    }));

    const bottomFramebuffer = createFilledDomCanvas(4, 4, '#0000ff');
    const middleColorCycleCanvas = createFilledDomCanvas(4, 4, '#ff0000');
    const topFramebuffer = createFilledDomCanvas(4, 4, '#00ff00');

    const store = useAppStore.getState();
    store.addLayer({
      ...createNormalLayerInput('Bottom Normal'),
      imageData: null,
      framebuffer: bottomFramebuffer,
    });
    store.addLayer({
      ...createColorCycleLayerInput('Middle CC'),
      imageData: null,
      framebuffer: middleColorCycleCanvas,
      colorCycleData: {
        gradient: [{ position: 0, color: '#000' }, { position: 1, color: '#fff' }],
        isAnimating: false,
        mode: 'recolor',
        canvas: middleColorCycleCanvas,
      },
    });
    store.addLayer({
      ...createNormalLayerInput('Top Normal'),
      imageData: null,
      framebuffer: topFramebuffer,
    });

    const targetCanvas = document.createElement('canvas');
    targetCanvas.width = 4;
    targetCanvas.height = 4;
    const targetCtx = targetCanvas.getContext('2d', { willReadFrequently: true });
    if (!targetCtx) {
      throw new Error('Expected target canvas context');
    }
    const drawImageSpy = jest.spyOn(targetCtx, 'drawImage');

    const didComposite = useAppStore.getState().compositeLayersToCanvasSync(targetCanvas);
    expect(didComposite).toBe(true);
    expect(drawImageSpy.mock.calls.map((call) => call[0])).toEqual([
      bottomFramebuffer,
      middleColorCycleCanvas,
      topFramebuffer,
    ]);
  });

  it('ignores stale async composite bitmap results from older renders', async () => {
    useAppStore.setState((state) => ({
      project: state.project ?? {
        id: 'proj-async-composite',
        name: 'Async Composite',
        width: 64,
        height: 64,
        layers: [],
        backgroundColor: 'transparent',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
      },
    }));

    useAppStore.getState().addLayer(createNormalLayerInput('Layer 1'));

    const targetCtx = {
      clearRect: jest.fn(),
      fillRect: jest.fn(),
      drawImage: jest.fn(),
      globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
      globalAlpha: 1,
      imageSmoothingEnabled: true,
      save: jest.fn(),
      restore: jest.fn(),
      setTransform: jest.fn(),
    } as unknown as CanvasRenderingContext2D;
    const targetCanvas = {
      width: 64,
      height: 64,
      getContext: jest.fn(() => targetCtx),
    } as unknown as HTMLCanvasElement;

    const firstBitmap = { close: jest.fn() } as unknown as ImageBitmap;
    const secondBitmap = { close: jest.fn() } as unknown as ImageBitmap;
    let resolveFirst: (bitmap: ImageBitmap) => void = () => {
      throw new Error('expected first async composite resolver');
    };
    let resolveSecond: (bitmap: ImageBitmap) => void = () => {
      throw new Error('expected second async composite resolver');
    };

    const isSupportedSpy = jest
      .spyOn(compositeBitmapManager, 'isSupported')
      .mockReturnValue(true);
    const renderSpy = jest
      .spyOn(compositeBitmapManager, 'render')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve as (bitmap: ImageBitmap) => void;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve as (bitmap: ImageBitmap) => void;
          })
      );

    useAppStore.getState().compositeLayersToCanvas(targetCanvas);
    useAppStore.getState().compositeLayersToCanvas(targetCanvas);

    resolveSecond(secondBitmap);
    await Promise.resolve();
    await Promise.resolve();
    expect(useAppStore.getState().currentCompositeBitmap).toBe(secondBitmap);

    resolveFirst(firstBitmap);
    await Promise.resolve();
    await Promise.resolve();
    expect(useAppStore.getState().currentCompositeBitmap).toBe(secondBitmap);

    renderSpy.mockRestore();
    isSupportedSpy.mockRestore();
  });
});
