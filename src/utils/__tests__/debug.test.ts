import {
  getLastCrashReport,
  getLastHangReport,
  persistCrashReport,
  persistHangReport,
} from '../debug';

describe('debug crash report persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns null and clears malformed persisted crash reports', () => {
    window.localStorage.setItem('TB_LAST_CRASH', JSON.stringify({}));

    expect(getLastCrashReport()).toBeNull();
    expect(window.localStorage.getItem('TB_LAST_CRASH')).toBeNull();
  });

  it('round-trips valid persisted crash reports', () => {
    const report = persistCrashReport({
      type: 'error',
      message: 'boom',
      stack: 'Error: boom',
      breadcrumbs: [{ t: 1, scope: 'test', data: { ok: true } }],
      t: 123,
      href: 'https://example.test/vessel',
      userAgent: 'jest',
    });

    expect(report).not.toBeNull();
    expect(getLastCrashReport()).toEqual({
      t: 123,
      type: 'error',
      href: 'https://example.test/vessel',
      message: 'boom',
      stack: 'Error: boom',
      userAgent: 'jest',
      breadcrumbs: [{ t: 1, scope: 'test', data: { ok: true } }],
    });
  });

  it('returns null and clears malformed persisted hang reports', () => {
    window.localStorage.setItem('TB_LAST_HANG', JSON.stringify({}));

    expect(getLastHangReport()).toBeNull();
    expect(window.localStorage.getItem('TB_LAST_HANG')).toBeNull();
  });

  it('round-trips valid persisted hang reports', () => {
    const report = persistHangReport({
      message: 'ui locked up before clean exit',
      breadcrumbs: [{ t: 2, scope: 'test-hang', data: { active: true } }],
      t: 456,
      href: 'https://example.test/vessel',
      userAgent: 'jest',
      visibilityState: 'visible',
      sessionId: 'session-1',
      lastBeatAt: 400,
      gapMs: 3200,
    });

    expect(report).not.toBeNull();
    expect(getLastHangReport()).toEqual({
      t: 456,
      type: 'hang',
      href: 'https://example.test/vessel',
      message: 'ui locked up before clean exit',
      userAgent: 'jest',
      visibilityState: 'visible',
      sessionId: 'session-1',
      lastBeatAt: 400,
      gapMs: 3200,
      breadcrumbs: [{ t: 2, scope: 'test-hang', data: { active: true } }],
    });
  });
});
