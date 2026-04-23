import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';

const mockBrush = {
  setActiveLayer: jest.fn(),
  setGradient: jest.fn(),
  endStroke: jest.fn()
};

const mockManager = {
  validateColorCycleBrush: jest.fn(() => true),
  initColorCycleForLayer: jest.fn(),
  setActiveState: jest.fn(),
  getLayerColorCycleBrush: jest.fn(() => mockBrush),
  getBrush: jest.fn(() => null),
  removeColorCycleBrush: jest.fn(),
  createBrush: jest.fn(),
  deleteBrush: jest.fn(),
  cleanupInactive: jest.fn(),
  cleanupAll: jest.fn(),
  transferColorCycleBrush: jest.fn(),
  cleanupOrphanedBrushes: jest.fn()
};

jest.mock('../colorCycleBrushManager', () => ({
  __esModule: true as const,
  getColorCycleBrushManager: () => mockManager,
  getColorCycleStoreState: () => null,
  setLayerIdGetter: jest.fn(),
  setColorCycleStoreStateGetter: jest.fn()
}));

jest.mock('../ccRuntime', () => ({
  __esModule: true as const,
  syncCCRuntimes: jest.fn(),
}));

// Import after mocks are in place
import { syncCCRuntimes } from '@/stores/ccRuntime';
import { useAppStore } from '@/stores/useAppStore';

const syncCCRuntimesMock = syncCCRuntimes as jest.Mock;

const cloneStops = (stops: ReadonlyArray<{ position: number; color: string }>) =>
  stops.map(stop => ({ ...stop }));

describe('useAppStore color cycle layer selection', () => {
  const layerGradient = [
    { position: 0, color: '#112233' },
    { position: 1, color: '#445566' }
  ] as const;

  const makeColorCycleLayer = (
    id: string,
    overrides: Partial<NonNullable<Layer['colorCycleData']>> = {}
  ): Layer => {
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    canvas.height = 10;

    return {
      id,
      name: 'Color Cycle Layer',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        gradient: cloneStops(layerGradient),
        isAnimating: false,
        ...overrides
      }
    };
  };

  beforeEach(() => {
    mockBrush.setActiveLayer.mockClear();
    mockBrush.setGradient.mockClear();
    mockBrush.endStroke.mockClear();
    (Object.values(mockManager) as jest.Mock[]).forEach(mockFn => {
      mockFn.mockClear();
    });

    syncCCRuntimesMock.mockClear();

    useAppStore.setState(state => ({
      layers: [],
      activeLayerId: null,
      selectedLayerIds: [],
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          colorCycleGradient: cloneStops([
            { position: 0, color: '#000000' },
            { position: 1, color: '#ffffff' }
          ])
        }
      }
    }));
  });

  it('synchronizes brush gradient with the selected color cycle layer', () => {
    const layer = makeColorCycleLayer('layer-cc');

    useAppStore.setState(state => ({
      layers: [layer],
      project: state.project
        ? {
            ...state.project,
            layers: [layer]
          }
        : state.project
    }));

    useAppStore.getState().setActiveLayer(layer.id);

    const gradient = useAppStore.getState().tools.brushSettings.colorCycleGradient;
    expect(gradient).toEqual(layerGradient);
    expect(gradient).not.toBe(layerGradient);
    expect(gradient?.[0]).not.toBe(layerGradient[0]);
  });

  it('forces forward-only flow when activating a color cycle layer', () => {
    const layer = makeColorCycleLayer('layer-flow', { flowMode: 'pingpong' });

    useAppStore.setState(state => ({
      layers: [layer],
      project: state.project
        ? {
            ...state.project,
            layers: [layer]
          }
        : state.project,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          colorCycleFlowMode: 'forward'
        }
      }
    }));

    useAppStore.getState().setActiveLayer(layer.id);

    expect(useAppStore.getState().tools.brushSettings.colorCycleFlowMode).toBe('forward');
  });

  it('normalizes per-layer flow mode updates to forward-only', () => {
    const layer = makeColorCycleLayer('layer-update');

    useAppStore.setState(state => ({
      layers: [layer],
      project: state.project
        ? {
            ...state.project,
            layers: [layer]
          }
        : state.project
    }));

    useAppStore.getState().updateLayer(layer.id, {
      colorCycleData: {
        flowMode: 'reverse'
      }
    });

    const updatedLayer = useAppStore.getState().layers.find(l => l.id === layer.id);
    expect(updatedLayer?.colorCycleData?.flowMode).toBe('forward');
  });

  it('skips runtime sync when skipColorCycleSync is true', () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer(makeColorCycleLayer('layer-skip-sync'));

    syncCCRuntimesMock.mockClear();

    store.updateLayer(
      layerId,
      {
        colorCycleData: {
          brushSpeed: 0.42,
        },
      },
      { skipColorCycleSync: true }
    );

    expect(syncCCRuntimesMock).not.toHaveBeenCalled();
  });

  it('syncs runtime when skipColorCycleSync is not provided', () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer(makeColorCycleLayer('layer-allow-sync'));

    syncCCRuntimesMock.mockClear();

    store.updateLayer(layerId, {
      colorCycleData: {
        flowMode: 'reverse',
      },
    });

    expect(syncCCRuntimesMock).toHaveBeenCalled();
  });

  it('preserves slot palettes when colorCycleData update includes undefined fields', () => {
    const store = useAppStore.getState();
    const layerId = store.addLayer(
      makeColorCycleLayer('layer-preserve-slots', {
        gradientDefs: [{ id: 'g0', currentSlot: 7 }],
        slotPalettes: [{ slot: 7, stops: cloneStops(layerGradient) }],
        activeGradientId: 'g0',
        paintSlot: 7,
      })
    );

    store.updateLayer(layerId, {
      colorCycleData: {
        eraseMask: document.createElement('canvas'),
        gradientDefs: undefined,
        slotPalettes: undefined,
        gradient: undefined,
      } as unknown as NonNullable<Layer['colorCycleData']>,
    });

    const updatedLayer = useAppStore.getState().layers.find((layer) => layer.id === layerId);
    expect(updatedLayer?.colorCycleData?.gradientDefs).toEqual([{ id: 'g0', currentSlot: 7 }]);
    expect(updatedLayer?.colorCycleData?.slotPalettes).toEqual([
      { slot: 7, stops: cloneStops(layerGradient) },
    ]);
    expect(updatedLayer?.colorCycleData?.paintSlot).toBe(7);
    expect(updatedLayer?.colorCycleData?.gradient).toEqual(cloneStops(layerGradient));
  });
});
