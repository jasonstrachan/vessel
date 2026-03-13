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

  it('hydrates stored time smear on startup', async () => {
    loadSequentialSettingsMock.mockReturnValue({ timeSmear: 12.5 });

    const { useAppStore } = await import('@/stores/useAppStore');
    expect(useAppStore.getState().sequentialRecord.timeSmear).toBe(12.5);
  });

  it('persists time smear updates', async () => {
    loadSequentialSettingsMock.mockReturnValue(null);

    const { useAppStore } = await import('@/stores/useAppStore');
    useAppStore.getState().setTimeSmear(22.25);

    jest.advanceTimersByTime(300);
    expect(saveSequentialSettingsMock).toHaveBeenCalledWith({ timeSmear: 22.25 });
  });
});
