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
    });

    const { useAppStore } = await import('@/stores/useAppStore');
    const state = useAppStore.getState();

    expect(loadMock).toHaveBeenCalled();
    expect(state.globalBrushSize).toBe(24);
    expect(state.brushSpecificSettings['pixel-brush']?.ditherEnabled).toBe(true);
    expect(state.tools.brushSettings.ditherEnabled).toBe(true);
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
});
