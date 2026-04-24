import { debugLog } from '@/utils/debug';
const PRES_RES_STORAGE_KEY = 'vessel.debug.presRes';

type PresResWindow = Window & {
  __presResDebug?: unknown;
  __setPresResDebug?: (enabled: boolean) => void;
};

const getPresResWindow = (): PresResWindow | undefined => {
  return typeof window === 'undefined' ? undefined : (window as PresResWindow);
};

export const isPresResDebugEnabled = (): boolean => {
  const w = getPresResWindow();
  if (!w) {
    return false;
  }

  const flag = w.__presResDebug;
  if (typeof flag === 'number') {
    return flag > 0;
  }
  if (typeof flag === 'boolean') {
    return flag;
  }

  try {
    return w.localStorage.getItem(PRES_RES_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

export const ensurePresResDebugBridge = (): void => {
  const w = getPresResWindow();
  if (!w || typeof w.__setPresResDebug === 'function') {
    return;
  }

  w.__setPresResDebug = (enabled: boolean) => {
    w.__presResDebug = enabled;
    try {
      w.localStorage.setItem(PRES_RES_STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      // Ignore storage failures in restricted modes.
    }
    debugLog('raw-console', '[PresRes]', 'debug flag updated', enabled);
  };

  try {
    if (typeof w.__presResDebug !== 'boolean') {
      const stored = w.localStorage.getItem(PRES_RES_STORAGE_KEY);
      if (stored != null) {
        w.__presResDebug = stored === '1';
      }
    }
  } catch {
    // Ignore storage failures in restricted modes.
  }
};
