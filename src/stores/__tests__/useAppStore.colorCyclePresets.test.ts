import { colorCycleShapeBrushPreset, colorCycleStrokeBrushPreset, defaultBrushPreset } from '@/presets/brushPresets';
import { BrushShape, type BrushSettings } from '@/types';
import { createDefaultPalette } from '@/utils/layoutDefaults';

const mockManager = {
  validateColorCycleBrush: jest.fn(() => true),
  initColorCycleForLayer: jest.fn(),
  setActiveState: jest.fn(),
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

// Import after mocks are registered so the store picks up the fakes
import { useAppStore } from '@/stores/useAppStore';

describe('useAppStore color cycle brush presets', () => {
  const customGradient = [
    { position: 0, color: '#112233' },
    { position: 1, color: '#abcdef' }
  ];

  beforeEach(() => {
    (Object.values(mockManager) as jest.Mock[]).forEach(mockFn => mockFn.mockClear());
    useAppStore.setState(state => ({
      ...state,
      brushSpecificSettings: {},
      palette: createDefaultPalette(),
      currentBrushPreset: colorCycleStrokeBrushPreset,
      activeBrushComponents: colorCycleStrokeBrushPreset.components,
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: BrushShape.COLOR_CYCLE,
          colorCycleGradient: undefined,
          colorCycleGradientVersion: undefined
        }
      }
    }));
  });

  it('reuses the active gradient when switching between color cycle presets', () => {
    const store = useAppStore.getState();
    store.setBrushPreset(colorCycleStrokeBrushPreset);
    store.rememberColorCycleGradient({
      stops: customGradient,
      seamProfile: 'hard',
      name: 'Custom',
    });

    store.setBrushPreset(colorCycleShapeBrushPreset);

    expect(useAppStore.getState().tools.brushSettings.colorCycleGradient).toEqual(customGradient);
  });

  it('restores the saved gradient after visiting a non color cycle preset', () => {
    const store = useAppStore.getState();
    store.setBrushPreset(colorCycleStrokeBrushPreset);
    store.rememberColorCycleGradient({
      stops: customGradient,
      seamProfile: 'hard',
      name: 'Custom',
    });

    store.setBrushPreset(defaultBrushPreset);
    store.setBrushPreset(colorCycleShapeBrushPreset);

    expect(useAppStore.getState().tools.brushSettings.colorCycleGradient).toEqual(customGradient);
  });

  it('preserves picked motion while returning to a CC fill preset', () => {
    const store = useAppStore.getState();
    store.setBrushPreset(colorCycleStrokeBrushPreset);
    store.rememberColorCycleGradient({
      stops: customGradient,
      runtimeStops: customGradient,
      seamProfile: 'hard',
      motion: { phaseByte: 91, speedByte: 17, flowByte: 2 },
    });

    store.setBrushPreset(defaultBrushPreset);
    store.setBrushPreset(colorCycleShapeBrushPreset);

    expect(useAppStore.getState().tools.brushSettings.colorCycleSampledMotion).toEqual({
      phaseByte: 91,
      speedByte: 17,
      flowByte: 2,
    });
  });

  it('clears picked motion when the gradient is explicitly edited', () => {
    const store = useAppStore.getState();
    store.rememberColorCycleGradient({
      stops: customGradient,
      runtimeStops: customGradient,
      seamProfile: 'hard',
      motion: { phaseByte: 91, speedByte: 17, flowByte: 2 },
    });

    store.setBrushSettings({
      colorCycleGradient: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
    });

    expect(useAppStore.getState().tools.brushSettings.colorCycleSampledMotion).toBeUndefined();
  });

  it('updates brush settings with the selected flow mode', () => {
    const store = useAppStore.getState();
    store.setBrushSettings({ colorCycleFlowMode: 'pingpong' });

    expect(useAppStore.getState().tools.brushSettings.colorCycleFlowMode).toBe('forward');
  });

  it('reuses one shared CC dither selection across color cycle presets', () => {
    const store = useAppStore.getState();
    store.setBrushPreset(colorCycleStrokeBrushPreset);
    store.setBrushSettings({
      ditherAlgorithm: 'pattern',
      patternStyle: 'crosshatch',
    });

    store.setBrushPreset(defaultBrushPreset);
    store.setBrushSettings({
      ditherAlgorithm: 'bayer',
      patternStyle: 'dots',
    });
    store.setBrushPreset(colorCycleShapeBrushPreset);

    const active = useAppStore.getState().tools.brushSettings;
    expect(active.ditherAlgorithm).toBe('pattern');
    expect(active.patternStyle).toBe('crosshatch');
  });

  it('normalizes legacy flow forward flags into the new flow mode', () => {
    const store = useAppStore.getState();
    store.setBrushSettings({ colorCycleFlowForward: false } as unknown as Partial<BrushSettings>);

    expect(useAppStore.getState().tools.brushSettings.colorCycleFlowMode).toBe('forward');
  });
});
