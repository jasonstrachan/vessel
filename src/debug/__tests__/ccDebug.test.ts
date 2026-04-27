describe('ccDebug overlay bridge', () => {
  beforeEach(() => {
    jest.resetModules();
    window.localStorage.clear();
    window.__DEV_DEBUG_OVERLAY__ = false;
  });

  it('does not change the dev debug overlay preference when CC debug is turned on', async () => {
    await import('@/debug/ccDebug');

    expect(window.__DEV_DEBUG_OVERLAY__).toBe(false);

    window.__CC_DEBUG__ = true;

    expect(window.__DEV_DEBUG_OVERLAY__).toBe(false);
    expect(window.localStorage.getItem('devDebugOverlay')).toBeNull();
    expect(window.localStorage.getItem('ccDebug')).toBe('1');
  });

  it('does not change the dev debug overlay preference when CC debug is turned off', async () => {
    await import('@/debug/ccDebug');

    window.__DEV_DEBUG_OVERLAY__ = true;
    window.localStorage.setItem('devDebugOverlay', '1');
    window.__CC_DEBUG__ = true;
    expect(window.__DEV_DEBUG_OVERLAY__).toBe(true);
    expect(window.localStorage.getItem('devDebugOverlay')).toBe('1');

    window.__CC_DEBUG__ = false;

    expect(window.__DEV_DEBUG_OVERLAY__).toBe(true);
    expect(window.localStorage.getItem('devDebugOverlay')).toBe('1');
    expect(window.localStorage.getItem('ccDebug')).toBeNull();
  });

  it('does not write console or overlay logs when the dev overlay is off', async () => {
    const { ccLog } = await import('@/debug/ccDebug');
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    window.__CC_DEBUG__ = true;
    window.__DEV_DEBUG_OVERLAY__ = false;
    window.localStorage.removeItem('devDebugOverlay');

    ccLog('hidden overlay log');

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(window.__DEV_DEBUG_OVERLAY_ENTRIES__ ?? []).toEqual([]);

    consoleLogSpy.mockRestore();
  });
});
