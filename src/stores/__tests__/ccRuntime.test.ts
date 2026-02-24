import type { Layer } from '@/types';

const startRuntime = jest.fn();

const mockUseAppStore = {
  getState: jest.fn(() => ({
    colorCycleRuntimeHandlers: {
      start: startRuntime
    }
  }))
};

const hiddenBrush = {
  isPlaying: jest.fn(() => true),
  stopAnimation: jest.fn(),
  startAnimation: jest.fn(),
  setFlowMode: jest.fn(),
  setFlowDirection: jest.fn()
};

const visibleBrush = {
  isPlaying: jest.fn(() => false),
  stopAnimation: jest.fn(),
  startAnimation: jest.fn(),
  setFlowMode: jest.fn(),
  setFlowDirection: jest.fn()
};

const mockManager = {
  getBrush: jest.fn((layerId: string) => {
    if (layerId === 'hidden-layer') {
      return hiddenBrush;
    }
    if (layerId === 'visible-layer') {
      return visibleBrush;
    }
    return null;
  })
};

jest.mock('@/stores/useAppStore', () => ({
  __esModule: true as const,
  useAppStore: mockUseAppStore
}));

jest.mock('@/stores/colorCycleBrushManager', () => ({
  __esModule: true as const,
  getColorCycleBrushManager: () => mockManager
}));

import { syncCCRuntimes } from '@/stores/ccRuntime';

const makeLayer = (overrides: Partial<Layer>): Layer =>
  ({
    id: 'layer',
    name: 'Layer',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    layerType: 'color-cycle',
    colorCycleData: {
      isAnimating: false
    },
    ...overrides
  }) as Layer;

describe('syncCCRuntimes visibility behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stops hidden layer brushes and skips animation start wiring for hidden layers', () => {
    const hiddenLayer = makeLayer({
      id: 'hidden-layer',
      visible: false,
      colorCycleData: {
        isAnimating: true
      } as NonNullable<Layer['colorCycleData']>
    });

    const visibleLayer = makeLayer({
      id: 'visible-layer',
      visible: true,
      colorCycleData: {
        isAnimating: true
      } as NonNullable<Layer['colorCycleData']>
    });

    syncCCRuntimes([hiddenLayer, visibleLayer], 'test');

    expect(hiddenBrush.stopAnimation).toHaveBeenCalledTimes(1);
    expect(hiddenBrush.startAnimation).not.toHaveBeenCalled();
    expect(visibleBrush.startAnimation).toHaveBeenCalledTimes(1);
    expect(startRuntime).toHaveBeenCalledTimes(1);
  });
});
