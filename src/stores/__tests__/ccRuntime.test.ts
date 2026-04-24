import type { Layer } from '@/types';

const startRuntime = jest.fn();

const mockUseAppStore = {
  getState: jest.fn<unknown, []>(() => ({
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

const replacementBrush = {
  isPlaying: jest.fn(() => false),
  stopAnimation: jest.fn(),
  startAnimation: jest.fn(),
  setFlowMode: jest.fn(),
  setFlowDirection: jest.fn()
};

let brushMap: Record<string, typeof hiddenBrush | typeof visibleBrush | typeof replacementBrush | null> = {
  'hidden-layer': hiddenBrush,
  'visible-layer': visibleBrush,
};

const mockManager = {
  getBrush: jest.fn((layerId: string) => {
    return brushMap[layerId] ?? null;
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

import { resetCCRuntimesForTests, syncCCRuntimes } from '@/stores/ccRuntime';

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
    resetCCRuntimesForTests();
    mockUseAppStore.getState.mockReturnValue({
      colorCyclePlayback: {
        desiredPlaying: true,
        suspendDepth: 0,
      },
      colorCycleRuntimeHandlers: {
        start: startRuntime,
      },
    });
    brushMap = {
      'hidden-layer': hiddenBrush,
      'visible-layer': visibleBrush,
    };
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

  it('restarts animation when a layer gets a fresh brush instance with the same id', () => {
    const visibleLayer = makeLayer({
      id: 'visible-layer',
      visible: true,
      colorCycleData: {
        isAnimating: true
      } as NonNullable<Layer['colorCycleData']>
    });

    syncCCRuntimes([visibleLayer], 'initial');

    brushMap['visible-layer'] = replacementBrush;

    syncCCRuntimes([visibleLayer], 'brush-replaced');

    expect(visibleBrush.startAnimation).toHaveBeenCalledTimes(1);
    expect(replacementBrush.startAnimation).toHaveBeenCalledTimes(1);
    expect(startRuntime).toHaveBeenCalledTimes(2);
  });

  it('does not start cc-runtime while global playback is paused even if a layer flag is stale', () => {
    mockUseAppStore.getState.mockReturnValue({
      colorCyclePlayback: {
        desiredPlaying: false,
        suspendDepth: 0,
      },
      colorCycleRuntimeHandlers: {
        start: startRuntime,
      },
    });

    const visibleLayer = makeLayer({
      id: 'visible-layer',
      visible: true,
      colorCycleData: {
        isAnimating: true,
      } as NonNullable<Layer['colorCycleData']>,
    });

    syncCCRuntimes([visibleLayer], 'paused-global-playback');

    expect(visibleBrush.startAnimation).not.toHaveBeenCalled();
    expect(visibleBrush.stopAnimation).not.toHaveBeenCalled();
    expect(startRuntime).not.toHaveBeenCalled();
  });
});
