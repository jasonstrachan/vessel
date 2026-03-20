import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';
import { compositeBitmapManager } from '@/lib/performance/CompositeBitmapManager';

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
    layerGroups: [],
    hiddenLayerGroupIds: [],
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

  it('applies color-cycle erase mask before compositing color-cycle layer canvas', () => {
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

    const layerCanvasCtx = {
      save: jest.fn(),
      restore: jest.fn(),
      drawImage: jest.fn(),
      globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    const layerCanvas = {
      width: 64,
      height: 64,
      getContext: jest.fn(() => layerCanvasCtx),
    } as unknown as HTMLCanvasElement;
    const eraseMaskCanvas = {
      width: 64,
      height: 64,
      getContext: jest.fn(),
    } as unknown as HTMLCanvasElement;

    const store = useAppStore.getState();
    store.addLayer({
      ...createColorCycleLayerInput('CC Layer'),
      layerType: 'color-cycle',
      colorCycleData: {
        gradient: [{ position: 0, color: '#000' }, { position: 1, color: '#fff' }],
        isAnimating: false,
        mode: 'recolor',
        canvas: layerCanvas,
        eraseMask: eraseMaskCanvas,
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

    useAppStore.getState().compositeLayersToCanvas(targetCanvas);

    expect(layerCanvasCtx.save).toHaveBeenCalledTimes(1);
    expect(layerCanvasCtx.drawImage).toHaveBeenCalledWith(eraseMaskCanvas, 0, 0);
    expect(layerCanvasCtx.restore).toHaveBeenCalledTimes(1);
    expect(targetCtx.drawImage).toHaveBeenCalledWith(layerCanvas, 0, 0);
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
