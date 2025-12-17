const loadMock = jest.fn();
const saveMock = jest.fn();

describe('global brush persistence', () => {
  beforeEach(() => {
    jest.resetModules();
    loadMock.mockReset();
    saveMock.mockReset();
    jest.doMock('@/utils/brushSettingsStorage', () => ({
      loadGlobalBrushSettings: loadMock,
      saveGlobalBrushSettings: saveMock,
    }));
  });

  it('hydrates stored brush metadata on startup', async () => {
    loadMock.mockReturnValue({
      globalBrushSize: 24,
      brushSpecificSettings: {
        'pixel-brush': { ditherEnabled: true },
      },
      lastBrushId: 'pixel-brush',
      pressureSettings: { enabled: false, min: 25, max: 300 },
    });

    const { useAppStore } = await import('@/stores/useAppStore');
    const state = useAppStore.getState();

    expect(loadMock).toHaveBeenCalled();
    expect(state.globalBrushSize).toBe(24);
    expect(state.brushSpecificSettings['pixel-brush']?.ditherEnabled).toBe(true);
    expect(state.tools.brushSettings.ditherEnabled).toBe(true);
    expect(state.currentBrushPreset?.id).toBe('pixel-brush');
    expect(state.pressureSettings).toEqual({ enabled: false, min: 25, max: 300 });
    expect(state.tools.brushSettings.minPressure).toBe(25);
    expect(state.tools.brushSettings.maxPressure).toBe(300);
  });

  it('saves when brush-specific settings change', async () => {
    loadMock.mockReturnValue(null);

    const { useAppStore } = await import('@/stores/useAppStore');
    const store = useAppStore.getState();
    store.saveBrushSettings('pixel-brush', { spacing: 9 });

    expect(saveMock).toHaveBeenCalled();
  });

  it('persists and restores sampling prefs for the resampler brush', async () => {
    loadMock.mockReturnValue({
      brushSpecificSettings: {
        'resampler-brush': { continuousSampling: false, resampleInterval: 3 },
      },
    });

    const { resamplerBrushPreset } = await import('@/presets/brushPresets');
    const { useAppStore } = await import('@/stores/useAppStore');
    const store = useAppStore.getState();

    // Hydration should keep the stored toggle values
    expect(store.brushSpecificSettings['resampler-brush']?.continuousSampling).toBe(false);

    // Selecting the brush should apply the stored values to active settings
    store.setBrushPreset(resamplerBrushPreset);
    const afterPreset = useAppStore.getState().tools.brushSettings;
    expect(afterPreset.continuousSampling).toBe(false);
    expect(afterPreset.resampleInterval).toBe(3);

    // Changing the toggle should write back to persistence payload
    store.setBrushSettings({ continuousSampling: true, resampleInterval: 2 });
    const payload = saveMock.mock.calls.at(-1)?.[0];
    expect(payload?.brushSpecificSettings?.['resampler-brush']).toEqual(
      expect.objectContaining({ continuousSampling: true, resampleInterval: 2 })
    );
  });

  it('remembers polygon sampling toggle per brush', async () => {
    loadMock.mockReturnValue({
      brushSpecificSettings: {
        'polygon-gradient-brush': { polygonSampleColors: false },
      },
    });

    const { polygonGradientBrushPreset } = await import('@/presets/brushPresets');
    const { useAppStore } = await import('@/stores/useAppStore');
    const store = useAppStore.getState();

    // Hydration keeps stored toggle
    expect(store.brushSpecificSettings['polygon-gradient-brush']?.polygonSampleColors).toBe(false);

    // Selecting preset should apply stored off state
    store.setBrushPreset(polygonGradientBrushPreset);
    const active = useAppStore.getState().tools.brushSettings;
    expect(active.polygonSampleColors).toBe(false);

    // Changing it back on should persist
    store.setBrushSettings({ polygonSampleColors: true });
    const payload = saveMock.mock.calls.at(-1)?.[0];
    expect(payload?.brushSpecificSettings?.['polygon-gradient-brush']).toEqual(
      expect.objectContaining({ polygonSampleColors: true })
    );
  });

  it('persists dither gradient sampling settings per brush', async () => {
    loadMock.mockReturnValue({
      brushSpecificSettings: {
        'dither-gradient-brush': {
          ditherGradSampleEnabled: true,
          ditherGradStops: ['#111111', '#222222', '#333333'],
          trans: 1,
        },
      },
    });

    const { ditherGradientBrushPreset } = await import('@/presets/brushPresets');
    const { useAppStore } = await import('@/stores/useAppStore');
    const store = useAppStore.getState();

    expect(store.brushSpecificSettings['dither-gradient-brush']?.ditherGradSampleEnabled).toBe(true);

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
    const payload = saveMock.mock.calls.at(-1)?.[0];
    expect(payload?.brushSpecificSettings?.['dither-gradient-brush']).toEqual(
      expect.objectContaining({
        ditherGradSampleEnabled: false,
        ditherGradStops: ['#aaaaaa', '#bbbbbb'],
        trans: 0,
      })
    );
  });

  it('persists last used brush id', async () => {
    loadMock.mockReturnValue(null);

    const { pixelBrushPreset, roundSquare6Preset } = await import('@/presets/brushPresets');
    const { useAppStore } = await import('@/stores/useAppStore');
    const store = useAppStore.getState();

    // initial set to pixel brush (already default) then switch
    store.setBrushPreset(roundSquare6Preset);
    const payload = saveMock.mock.calls.at(-1)?.[0];
    expect(payload?.lastBrushId).toBe(roundSquare6Preset.id);

    // switching back should update
    store.setBrushPreset(pixelBrushPreset);
    const updated = saveMock.mock.calls.at(-1)?.[0];
    expect(updated?.lastBrushId).toBe(pixelBrushPreset.id);
  });

  it('persists global pressure settings separately from brush-specific overrides', async () => {
    loadMock.mockReturnValue(null);
    const { useAppStore } = await import('@/stores/useAppStore');
    const store = useAppStore.getState();

    store.setPressureSettings({ enabled: true, min: 15, max: 220 });

    const payload = saveMock.mock.calls.at(-1)?.[0];
    expect(payload?.pressureSettings).toEqual({ enabled: true, min: 15, max: 220 });
    expect(payload?.brushSpecificSettings).toBeDefined();
  });
});
