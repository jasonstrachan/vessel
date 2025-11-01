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
  setLayerIdGetter: jest.fn(),
  setColorCycleStoreStateGetter: jest.fn()
}));

// Import after mocks are in place
import { useAppStore } from '@/stores/useAppStore';

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

  it('adopts per-layer flow mode when activating a color cycle layer', () => {
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

    expect(useAppStore.getState().tools.brushSettings.colorCycleFlowMode).toBe('pingpong');
  });

  it('persists per-layer flow mode updates via updateLayer', () => {
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
    expect(updatedLayer?.colorCycleData?.flowMode).toBe('reverse');
  });
});
