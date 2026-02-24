import { setSharedColorCycleGradient } from '@/utils/colorCycleGradients';

const applyGradientEditMock = jest.fn();

const storeState = {
  activeLayerId: 'layer-1',
  tools: {
    brushSettings: {
      colorCycleUseForegroundGradient: true,
    },
    eraserSettings: {
      brushShape: 'round',
    },
  },
  setBrushSettings: jest.fn(),
  setEraserSettings: jest.fn(),
};

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: {
    getState: () => storeState,
  },
}));

jest.mock('@/hooks/brushEngine/ccGradientController', () => ({
  applyGradientEdit: (...args: unknown[]) => applyGradientEditMock(...args),
}));

describe('setSharedColorCycleGradient', () => {
  beforeEach(() => {
    storeState.tools.brushSettings = {
      colorCycleUseForegroundGradient: true,
    };
    storeState.setBrushSettings.mockClear();
    storeState.setBrushSettings.mockImplementation((updates: Record<string, unknown>) => {
      storeState.tools.brushSettings = {
        ...storeState.tools.brushSettings,
        ...updates,
      };
    });
    storeState.setEraserSettings.mockClear();
    applyGradientEditMock.mockClear();
  });

  it('forces manual gradient mode and applies edits even when FG mode was active', () => {
    const stops = [
      { position: 0, color: '#112233' },
      { position: 1, color: '#abcdef' },
    ];

    setSharedColorCycleGradient(stops, { fork: true });

    expect(storeState.setBrushSettings).toHaveBeenCalledWith({
      colorCycleGradient: stops,
      ccGradientSource: 'manual',
      colorCycleUseForegroundGradient: false,
      autoSampleGradient: false,
      autoSampleGradientRealtime: false,
    });
    expect(applyGradientEditMock).toHaveBeenCalledWith({
      stops,
      layerId: 'layer-1',
      intent: 'commitFuture',
    });
  });
});
