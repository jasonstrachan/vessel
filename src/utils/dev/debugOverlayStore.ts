export type DevDebugOverlayLevel = 'log' | 'warn' | 'group' | 'assert';

export type DevDebugOverlayEntry = {
  id: number;
  ts: number;
  source: string;
  level: DevDebugOverlayLevel;
  message: string;
  data?: string;
};

declare global {
  interface Window {
    __DEV_DEBUG_OVERLAY_ENTRIES__?: DevDebugOverlayEntry[];
    __DEV_DEBUG_OVERLAY__?: boolean;
    __DEV_DEBUG_OVERLAY_MINIMIZED__?: boolean;
  }
}

const MAX_DEV_DEBUG_OVERLAY_ENTRIES = 120;
export const DEV_DEBUG_OVERLAY_EVENT = 'dev-debug-overlay-update';
const DEV_DEBUG_OVERLAY_MINIMIZED_KEY = 'devDebugOverlayMinimized';

let nextEntryId = 1;

const safeStringify = (value: unknown): string | undefined => {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const appendDevDebugOverlayEntry = ({
  source,
  level,
  message,
  data,
}: {
  source: string;
  level: DevDebugOverlayLevel;
  message: string;
  data?: unknown;
}): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const entries = window.__DEV_DEBUG_OVERLAY_ENTRIES__ ?? [];
  entries.push({
    id: nextEntryId++,
    ts: Date.now(),
    source,
    level,
    message,
    data: safeStringify(data),
  });
  if (entries.length > MAX_DEV_DEBUG_OVERLAY_ENTRIES) {
    entries.splice(0, entries.length - MAX_DEV_DEBUG_OVERLAY_ENTRIES);
  }
  window.__DEV_DEBUG_OVERLAY_ENTRIES__ = entries;
  window.dispatchEvent(new CustomEvent(DEV_DEBUG_OVERLAY_EVENT));
};

export const createDevDebugOverlayLogger = (source: string) => ({
  log: (message: string, data?: unknown) =>
    appendDevDebugOverlayEntry({ source, level: 'log', message, data }),
  warn: (message: string, data?: unknown) =>
    appendDevDebugOverlayEntry({ source, level: 'warn', message, data }),
  group: (message: string, data?: unknown) =>
    appendDevDebugOverlayEntry({ source, level: 'group', message, data }),
  assert: (message: string, data?: unknown) =>
    appendDevDebugOverlayEntry({ source, level: 'assert', message, data }),
});

export const readDevDebugOverlayEntries = (): DevDebugOverlayEntry[] => {
  if (typeof window === 'undefined') {
    return [];
  }
  return [...(window.__DEV_DEBUG_OVERLAY_ENTRIES__ ?? [])];
};

export const clearDevDebugOverlayEntries = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.__DEV_DEBUG_OVERLAY_ENTRIES__ = [];
  window.dispatchEvent(new CustomEvent(DEV_DEBUG_OVERLAY_EVENT));
};

export const isDevDebugOverlayEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  if (window.__DEV_DEBUG_OVERLAY__ === true) {
    return true;
  }

  try {
    return window.localStorage.getItem('devDebugOverlay') === '1';
  } catch {
    return false;
  }
};

export const setDevDebugOverlayEnabled = (enabled: boolean): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.__DEV_DEBUG_OVERLAY__ = enabled;
  try {
    if (enabled) {
      window.localStorage.setItem('devDebugOverlay', '1');
    } else {
      window.localStorage.removeItem('devDebugOverlay');
    }
  } catch {}
  window.dispatchEvent(new CustomEvent(DEV_DEBUG_OVERLAY_EVENT));
};

export const isDevDebugOverlayMinimized = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  if (window.__DEV_DEBUG_OVERLAY_MINIMIZED__ === true) {
    return true;
  }

  try {
    return window.localStorage.getItem(DEV_DEBUG_OVERLAY_MINIMIZED_KEY) === '1';
  } catch {
    return false;
  }
};

export const setDevDebugOverlayMinimized = (minimized: boolean): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.__DEV_DEBUG_OVERLAY_MINIMIZED__ = minimized;
  try {
    if (minimized) {
      window.localStorage.setItem(DEV_DEBUG_OVERLAY_MINIMIZED_KEY, '1');
    } else {
      window.localStorage.removeItem(DEV_DEBUG_OVERLAY_MINIMIZED_KEY);
    }
  } catch {}
  window.dispatchEvent(new CustomEvent(DEV_DEBUG_OVERLAY_EVENT));
};
