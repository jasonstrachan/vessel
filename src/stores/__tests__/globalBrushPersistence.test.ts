export {};

const loadMock = jest.fn();
const saveMock = jest.fn();

describe('global brush persistence', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    loadMock.mockReset();
    saveMock.mockReset();
    jest.doMock('@/utils/brushSettingsStorage', () => ({
      loadGlobalBrushSettings: loadMock,
      saveGlobalBrushSettings: saveMock,
    }));
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('hydrates stored brush metadata on startup', async () => {
    loadMock.mockReturnValue({
      globalBrushSize: 24,
      brushSpecificSettings: {
        'pixel-square': { ditherEnabled: true },
      },
      ccBrushDitherSelection: {
        ditherAlgorithm: 'pattern',
        patternStyle: 'crosshatch',
      },
      lastBrushId: 'pixel-square',
      pressureSettings: { enabled: false, min: 25, max: 300 },
    });

    const { useAppStore } = await import('@/stores/useAppStore');
    const state = useAppStore.getState();

    expect(loadMock).toHaveBeenCalled();
    expect(state.globalBrushSize).toBe(24);
    expect(state.brushSpecificSettings['pixel-square']?.ditherEnabled).toBe(true);
    expect(state.ccBrushDitherSelection).toEqual({
      ditherAlgorithm: 'pattern',
      patternStyle: 'crosshatch',
    });
    expect(state.tools.brushSettings.ditherEnabled).toBe(true);
    expect(state.currentBrushPreset?.id).toBe('pixel-square');
    expect(state.pressureSettings).toEqual({ enabled: false, min: 25, max: 300 });
    expect(state.tools.brushSettings.minPressure).toBe(25);
    expect(state.tools.brushSettings.maxPressure).toBe(300);
  });

  it('restores dashed brush settings on startup and persists later changes', async () => {
    loadMock.mockReturnValue({
      brushSpecificSettings: {
        'pixel-square': {
          dashedEnabled: true,
          dashLength: 7,
          dashGap: 5,
        },
      },
      lastBrushId: 'pixel-square',
    });

    const { useAppStore } = await import('@/stores/useAppStore');
    const store = useAppStore.getState();

    expect(store.tools.brushSettings.dashedEnabled).toBe(true);
    expect(store.tools.brushSettings.dashLength).toBe(7);
    expect(store.tools.brushSettings.dashGap).toBe(5);

    store.setBrushSettings({
      dashedEnabled: false,
      dashLength: 4,
      dashGap: 2,
    });

    jest.advanceTimersByTime(300);
    const payload = saveMock.mock.calls.at(-1)?.[0];
    expect(payload?.brushSpecificSettings?.['pixel-square']).toEqual(
      expect.objectContaining({
        dashedEnabled: false,
        dashLength: 4,
        dashGap: 2,
      })
    );
  });

  it('saves when brush-specific settings change', async () => {
    loadMock.mockReturnValue(null);

    const { useAppStore } = await import('@/stores/useAppStore');
    const store = useAppStore.getState();
    store.saveBrushSettings('pixel-square', { spacing: 9 });

    jest.advanceTimersByTime(300);
    expect(saveMock).toHaveBeenCalled();
  });

  it('persists and restores sampling prefs for the resampler brush', async () => {
    loadMock.mockReturnValue({
      brushSpecificSettings: {
        'resampler': { continuousSampling: false, resampleInterval: 3 },
      },
    });

    const { resamplerBrushPreset } = await import('@/presets/brushPresets');
    const { useAppStore } = await import('@/stores/useAppStore');
    const store = useAppStore.getState();

    // Hydration should keep the stored toggle values
    expect(store.brushSpecificSettings['resampler']?.continuousSampling).toBe(false);

    // Selecting the brush should apply the stored values to active settings
    store.setBrushPreset(resamplerBrushPreset);
    const afterPreset = useAppStore.getState().tools.brushSettings;
    expect(afterPreset.continuousSampling).toBe(false);
    expect(afterPreset.resampleInterval).toBe(3);

    // Changing the toggle should write back to persistence payload
    store.setBrushSettings({ continuousSampling: true, resampleInterval: 2 });
    jest.advanceTimersByTime(300);
    const payload = saveMock.mock.calls.at(-1)?.[0];
    expect(payload?.brushSpecificSettings?.['resampler']).toEqual(
      expect.objectContaining({ continuousSampling: true, resampleInterval: 2 })
    );
  });

  it('restores per-brush shape mode for mosaic', async () => {
    loadMock.mockReturnValue({
      shapeModeByBrush: { mosaic: true },
      lastBrushId: 'mosaic',
    });

    const { useAppStore } = await import('@/stores/useAppStore');
    const state = useAppStore.getState();

    expect(state.shapeModeByBrush?.mosaic).toBe(true);
    expect(state.currentBrushPreset?.id).toBe('mosaic');
    expect(state.tools.shapeMode).toBe(true);
  });

  it('remembers polygon sampling toggle per brush', async () => {
    loadMock.mockReturnValue({
      brushSpecificSettings: {
        'shape-gradient': { polygonSampleColors: false },
      },
    });

    const { polygonGradientBrushPreset } = await import('@/presets/brushPresets');
    const { useAppStore } = await import('@/stores/useAppStore');
    const store = useAppStore.getState();

    // Hydration keeps stored toggle
    expect(store.brushSpecificSettings['shape-gradient']?.polygonSampleColors).toBe(false);

    // Selecting preset should apply stored off state
    store.setBrushPreset(polygonGradientBrushPreset);
    const active = useAppStore.getState().tools.brushSettings;
    expect(active.polygonSampleColors).toBe(false);

    // Changing it back on should persist
    store.setBrushSettings({ polygonSampleColors: true });
    jest.advanceTimersByTime(300);
    const payload = saveMock.mock.calls.at(-1)?.[0];
    expect(payload?.brushSpecificSettings?.['shape-gradient']).toEqual(
      expect.objectContaining({ polygonSampleColors: true })
    );
  });

  it('persists dither gradient sampling settings per brush', async () => {
    loadMock.mockReturnValue({
      brushSpecificSettings: {
        'dither-grad': {
          ditherGradSampleEnabled: true,
          ditherGradStops: ['#111111', '#222222', '#333333'],
          trans: 1,
        },
      },
    });

    const { ditherGradientBrushPreset } = await import('@/presets/brushPresets');
    const { useAppStore } = await import('@/stores/useAppStore');
    const store = useAppStore.getState();

    expect(store.brushSpecificSettings['dither-grad']?.ditherGradSampleEnabled).toBe(true);

    store.setBrushPreset(ditherGradientBrushPreset);
    const active = useAppStore.getState().tools.brushSettings;
    expect(active.ditherGradSampleEnabled).toBe(true);
    expect(active.ditherGradStops).toEqual(['#111111', '#222222', '#333333']);
    expect(active.trans).toBe(1);

    store.setBrushSettings({
      ditherGradSampleEnabled: false,
      ditherGradStops: ['#aaaaaa', '#bbbbbb'],
      trans: 0,
    });
    jest.advanceTimersByTime(300);
    const payload = saveMock.mock.calls.at(-1)?.[0];
    expect(payload?.brushSpecificSettings?.['dither-grad']).toEqual(
      expect.objectContaining({
        ditherGradSampleEnabled: false,
        ditherGradStops: ['#aaaaaa', '#bbbbbb'],
        trans: 0,
      })
    );
  });

  it('persists color cycle stroke settings per brush', async () => {
    loadMock.mockReturnValue({
      brushSpecificSettings: {
        'color-cycle-stroke': {
          colorCycleStampDitherEnabled: true,
          colorCycleStampDitherPixelSize: 6,
          colorCycleStampDitherPressureLinked: true,
          colorCycleStampDitherBgFill: false,
          colorCycleFlowMode: 'pingpong',
          colorCycleStampShape: 'triangle',
        },
      },
    });

    const { colorCycleStrokeBrushPreset } = await import('@/presets/brushPresets');
    const { useAppStore } = await import('@/stores/useAppStore');
    const store = useAppStore.getState();

    store.setBrushPreset(colorCycleStrokeBrushPreset);
    const active = useAppStore.getState().tools.brushSettings;
    expect(active.colorCycleStampDitherEnabled).toBe(true);
    expect(active.colorCycleStampDitherPixelSize).toBe(6);
    expect(active.colorCycleStampDitherPressureLinked).toBe(true);
    expect(active.colorCycleStampDitherBgFill).toBe(false);
    expect(active.colorCycleFlowMode).toBe('forward');
    expect(active.colorCycleStampShape).toBe('triangle');

    store.setBrushSettings({
      colorCycleStampDitherEnabled: false,
      colorCycleStampDitherPixelSize: 4,
      colorCycleStampDitherPressureLinked: false,
      colorCycleStampDitherBgFill: true,
      colorCycleFlowMode: 'reverse',
      colorCycleSpeed: 0.25,
      gradientBands: 16,
      colorCycleStampShape: 'square',
    });
    jest.advanceTimersByTime(300);
    const payload = saveMock.mock.calls.at(-1)?.[0];
    expect(payload?.brushSpecificSettings?.['color-cycle-stroke']).toEqual(
      expect.objectContaining({
        colorCycleStampDitherEnabled: false,
        colorCycleStampDitherPixelSize: 4,
        colorCycleStampDitherPressureLinked: false,
        colorCycleStampDitherBgFill: true,
        colorCycleFlowMode: 'forward',
        colorCycleSpeed: 0.25,
        gradientBands: 16,
        colorCycleStampShape: 'square',
      })
    );
  });

  it('persists shared CC dither selection without saving it per brush', async () => {
    loadMock.mockReturnValue(null);

    const { colorCycleStrokeBrushPreset } = await import('@/presets/brushPresets');
    const { useAppStore } = await import('@/stores/useAppStore');
    const store = useAppStore.getState();

    store.setBrushPreset(colorCycleStrokeBrushPreset);
    store.setBrushSettings({
      ditherAlgorithm: 'pattern',
      patternStyle: 'crosshatch',
    });

    jest.advanceTimersByTime(300);
    const payload = saveMock.mock.calls.at(-1)?.[0];
    expect(payload?.ccBrushDitherSelection).toEqual({
      ditherAlgorithm: 'pattern',
      patternStyle: 'crosshatch',
    });
    expect(payload?.brushSpecificSettings?.['color-cycle-stroke']?.ditherAlgorithm).toBeUndefined();
    expect(payload?.brushSpecificSettings?.['color-cycle-stroke']?.patternStyle).toBeUndefined();
  });

  it('persists last used brush id', async () => {
    loadMock.mockReturnValue(null);

    const { pixelBrushPreset, roundSquare6Preset } = await import('@/presets/brushPresets');
    const { useAppStore } = await import('@/stores/useAppStore');
    const store = useAppStore.getState();

    // initial set to pixel brush (already default) then switch
    store.setBrushPreset(roundSquare6Preset);
    jest.advanceTimersByTime(300);
    const payload = saveMock.mock.calls.at(-1)?.[0];
    expect(payload?.lastBrushId).toBe(roundSquare6Preset.id);

    // switching back should update
    store.setBrushPreset(pixelBrushPreset);
    jest.advanceTimersByTime(300);
    const updated = saveMock.mock.calls.at(-1)?.[0];
    expect(updated?.lastBrushId).toBe(pixelBrushPreset.id);
  });

  it('persists global pressure settings separately from brush-specific overrides', async () => {
    loadMock.mockReturnValue(null);
    const { useAppStore } = await import('@/stores/useAppStore');
    const store = useAppStore.getState();

    store.setPressureSettings({ enabled: true, min: 15, max: 220 });

    jest.advanceTimersByTime(300);
    const payload = saveMock.mock.calls.at(-1)?.[0];
    expect(payload?.pressureSettings).toEqual({ enabled: true, min: 15, max: 220 });
    expect(payload?.brushSpecificSettings).toBeDefined();
  });
});
