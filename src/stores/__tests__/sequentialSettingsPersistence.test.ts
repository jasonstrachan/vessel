export {};

const loadSequentialSettingsMock = jest.fn();
const saveSequentialSettingsMock = jest.fn();

describe('sequential settings persistence', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    loadSequentialSettingsMock.mockReset();
    saveSequentialSettingsMock.mockReset();
    jest.doMock('@/utils/sequentialSettingsStorage', () => ({
      loadSequentialSettings: loadSequentialSettingsMock,
      saveSequentialSettings: saveSequentialSettingsMock,
    }));
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('hydrates stored temporal controls on startup', async () => {
    loadSequentialSettingsMock.mockReturnValue({
      timeSmear: 12.5,
      temporalSpreadFrames: 4,
      trailFalloff: 0.35,
      burstFrames: 3,
      gapFrames: 2,
    });

    const { useAppStore } = await import('@/stores/useAppStore');
    expect(useAppStore.getState().sequentialRecord).toEqual(expect.objectContaining({
      timeSmear: 12.5,
      temporalSpreadFrames: 4,
      trailFalloff: 0.35,
      burstFrames: 3,
      gapFrames: 2,
    }));
  });

  it('persists temporal control updates as one settings snapshot', async () => {
    loadSequentialSettingsMock.mockReturnValue(null);

    const { useAppStore } = await import('@/stores/useAppStore');
    useAppStore.getState().setTemporalSpreadFrames(5);
    useAppStore.getState().setSequentialTrailFalloff(0.4);
    useAppStore.getState().setSequentialBurstFrames(3);
    useAppStore.getState().setSequentialGapFrames(2);

    jest.advanceTimersByTime(300);
    expect(saveSequentialSettingsMock).toHaveBeenLastCalledWith({
      timeSmear: 40,
      temporalSpreadFrames: 5,
      trailFalloff: 0.4,
      burstFrames: 3,
      gapFrames: 2,
    });
  });
});
