import { getLastCrashReport, persistCrashReport } from '../debug';

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
});
