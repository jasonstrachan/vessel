import { createColorCycleBrushManager, disposeColorCycleBrushManager, getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { refreshLayerCCSurface } from '@/hooks/useBrushEngineSimplified';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';

type MockBrush = ReturnType<typeof createMockBrush>;

const createdBrushes: MockBrush[] = [];

function createMockBrush() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  return {
    setGradientBands: jest.fn(),
    setBandSpacing: jest.fn(),
    setBrushSize: jest.fn(),
    setPressureEnabled: jest.fn(),
    setMinPressure: jest.fn(),
    setMaxPressure: jest.fn(),
    setDitherEnabled: jest.fn(),
    setDitherPixelSize: jest.fn(),
    setStampDitherEnabled: jest.fn(),
    setStampDitherPixelSize: jest.fn(),
    setLayerId: jest.fn(),
    setTargetCanvas: jest.fn(),
    setSpeed: jest.fn(),
    setFlowMode: jest.fn(),
    setFlowDirection: jest.fn(),
    setUseCanvas2D: jest.fn(),
    isUsingWebGL: jest.fn(() => false),
    getCanvas: jest.fn(() => canvas),
    cleanup: jest.fn(),
  };
}

jest.mock('@/hooks/brushEngine/ColorCycleBrushCanvas2D', () => {
  return {
    ColorCycleBrushCanvas2D: jest.fn(() => {
      const brush = createMockBrush();
      createdBrushes.push(brush);
      return brush;
    }),
  };
});

const mockUpdateLayer = jest.fn();
const mockLayer = ({
  id: 'layer-a',
  name: 'Layer A',
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'source-over',
  imageData: null,
  layerType: 'color-cycle',
  colorCycleData: {
    brushSpeed: 1,
    flowMode: 'forward',
  },
} as unknown) as Layer;

const mockStoreState = {
  layers: [mockLayer],
  updateLayer: mockUpdateLayer,
} as unknown as AppState;

jest.mock('@/stores/useAppStore', () => {
  const actual = jest.requireActual('@/stores/useAppStore');
  const useAppStore = ((selector?: (state: AppState) => unknown) => {
    if (typeof selector === 'function') {
      return selector(mockStoreState);
    }
    return mockStoreState;
  }) as typeof actual.useAppStore;

  useAppStore.getState = () => mockStoreState;
  useAppStore.setState = jest.fn();
  useAppStore.subscribe = jest.fn(() => () => {});

  return {
    ...actual,
    useAppStore,
    selectEffectiveColorCyclePlaying: jest.fn(() => false),
  };
});

describe('colorCycleBrushManager integration', () => {
  beforeEach(() => {
    createdBrushes.length = 0;
    mockUpdateLayer.mockClear();
  });

  afterEach(() => {
    disposeColorCycleBrushManager();
  });

  it('initializes and retrieves brushes per layer', () => {
    const manager = createColorCycleBrushManager();
    expect(manager.initColorCycleForLayer('layer-1', 64, 64)).toBe(true);
    expect(manager.getBrush('layer-1')).toBeDefined();
    expect(createdBrushes).toHaveLength(1);
  });

  it('transfers brushes between layers and updates metadata', () => {
    const manager = createColorCycleBrushManager();
    manager.initColorCycleForLayer('layer-1', 32, 32);

    const transferred = manager.transferColorCycleBrush('layer-1', 'layer-2');
    expect(transferred).toBe(true);
    expect(manager.getBrush('layer-1')).toBeUndefined();
    expect(manager.getBrush('layer-2')).toBeDefined();
  });

  it('cleans up inactive brushes using configured thresholds', () => {
    const manager = createColorCycleBrushManager();
    manager.initColorCycleForLayer('layer-1', 16, 16);

    const metadata = manager.brushMetadata.get('layer-1');
    expect(metadata).toBeDefined();
    if (metadata) {
      metadata.lastUsed = Date.now() - 120_000;
      metadata.isActive = false;
    }

    manager.cleanupInactive(60_000);
    expect(manager.getBrush('layer-1')).toBeUndefined();
  });

  it('responds to feature-flag events by toggling canvas implementation', () => {
    const manager = getColorCycleBrushManager();
    manager.initColorCycleForLayer('layer-flag', 8, 8);
    const brush = manager.getBrush('layer-flag') as MockBrush;

    window.dispatchEvent(new CustomEvent('vessel:featureFlagChange', {
      detail: { key: 'useCanvas2DColorCycle', value: true },
    }));

    expect(brush.setUseCanvas2D).toHaveBeenCalledWith(true);
  });
});

describe('refreshLayerCCSurface', () => {
  beforeEach(() => {
    mockUpdateLayer.mockClear();
  });

  it('updates stored layer canvas when brush surface changes', () => {
    const newCanvas = document.createElement('canvas');
    const brush = {
      getCanvas: () => newCanvas,
    } as unknown as Parameters<typeof refreshLayerCCSurface>[0];

    const result = refreshLayerCCSurface(brush, 'layer-a');

    expect(result).toBe(newCanvas);
    expect(mockUpdateLayer).toHaveBeenCalledWith('layer-a', expect.objectContaining({
      colorCycleData: expect.objectContaining({ canvas: newCanvas }),
    }));
  });
});
