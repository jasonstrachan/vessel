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
});
