describe('ccDebug overlay bridge', () => {
  beforeEach(() => {
    jest.resetModules();
    window.localStorage.clear();
    window.__DEV_DEBUG_OVERLAY__ = false;
  });

  it('enables the dev debug overlay when CC debug is turned on', async () => {
    await import('@/debug/ccDebug');

    expect(window.__DEV_DEBUG_OVERLAY__).toBe(false);

    window.__CC_DEBUG__ = true;

    expect(window.__DEV_DEBUG_OVERLAY__).toBe(true);
    expect(window.localStorage.getItem('devDebugOverlay')).toBe('1');
  });

  it('disables the dev debug overlay when CC debug is turned off', async () => {
    await import('@/debug/ccDebug');

    window.__CC_DEBUG__ = true;
    expect(window.__DEV_DEBUG_OVERLAY__).toBe(true);
    expect(window.localStorage.getItem('devDebugOverlay')).toBe('1');

    window.__CC_DEBUG__ = false;

    expect(window.__DEV_DEBUG_OVERLAY__).toBe(false);
    expect(window.localStorage.getItem('devDebugOverlay')).toBeNull();
  });
});
