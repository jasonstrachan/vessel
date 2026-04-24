import {
  appendDevDebugOverlayEntry,
  clearDevDebugOverlayEntries,
  createDevDebugOverlayLogger,
  DEV_DEBUG_OVERLAY_EVENT,
  isDevDebugOverlayEnabled,
  readDevDebugOverlayEntries,
  setDevDebugOverlayEnabled,
} from '@/utils/dev/debugOverlayStore';

describe('debugOverlayStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.__DEV_DEBUG_OVERLAY__ = false;
    clearDevDebugOverlayEntries();
  });

  it('persists the enabled flag via localStorage', () => {
    expect(isDevDebugOverlayEnabled()).toBe(false);

    setDevDebugOverlayEnabled(true);
    expect(isDevDebugOverlayEnabled()).toBe(true);
    expect(window.localStorage.getItem('devDebugOverlay')).toBe('1');

    setDevDebugOverlayEnabled(false);
    expect(isDevDebugOverlayEnabled()).toBe(false);
    expect(window.localStorage.getItem('devDebugOverlay')).toBeNull();
  });

  it('appends and clears overlay entries while enabled', () => {
    setDevDebugOverlayEnabled(true);

    appendDevDebugOverlayEntry({
      source: 'selection',
      level: 'log',
      message: 'selection updated',
      data: { x: 1, y: 2 },
    });

    const entries = readDevDebugOverlayEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        source: 'selection',
        level: 'log',
        message: 'selection updated',
        data: JSON.stringify({ x: 1, y: 2 }),
      }),
    );

    clearDevDebugOverlayEntries();
    expect(readDevDebugOverlayEntries()).toEqual([]);
  });

  it('does not append overlay entries while disabled', () => {
    appendDevDebugOverlayEntry({
      source: 'selection',
      level: 'log',
      message: 'selection updated',
    });

    expect(readDevDebugOverlayEntries()).toEqual([]);
  });

  it('creates scoped logger helpers', () => {
    setDevDebugOverlayEnabled(true);

    const logger = createDevDebugOverlayLogger('export');

    logger.warn('fallback encoder', { format: 'gif' });
    logger.group('export batch');

    const entries = readDevDebugOverlayEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        source: 'export',
        level: 'warn',
        message: 'fallback encoder',
      }),
    );
    expect(entries[1]).toEqual(
      expect.objectContaining({
        source: 'export',
        level: 'group',
        message: 'export batch',
      }),
    );
  });

  it('dispatches overlay update events when entries change', () => {
    setDevDebugOverlayEnabled(true);

    const listener = jest.fn();
    window.addEventListener(DEV_DEBUG_OVERLAY_EVENT, listener);

    appendDevDebugOverlayEntry({
      source: 'perf',
      level: 'log',
      message: 'frame',
    });

    expect(listener).toHaveBeenCalled();
    window.removeEventListener(DEV_DEBUG_OVERLAY_EVENT, listener);
  });
});
