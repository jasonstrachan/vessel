// ---- CC DEBUG TOGGLE & HELPERS ----

type CCLogFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    __CC_DEBUG__?: boolean;
    ccLog?: CCLogFn;
    ccWarn?: CCLogFn;
  }
}

const readLocalStorageFlag = (): boolean => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem('ccDebug') === '1';
  } catch {
    return false;
  }
};

export const ccDebugOn = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  if (window.__CC_DEBUG__) {
    return true;
  }

  return readLocalStorageFlag();
};

export const ccLog: CCLogFn = (...args) => {
  if (ccDebugOn()) {
    console.log('[CC]', ...args);
  }
};

export const ccWarn: CCLogFn = (...args) => {
  if (ccDebugOn()) {
    console.warn('[CC]', ...args);
  }
};

export const ccSample = (arr: ArrayLike<number> | undefined, n = 8): number[] | null => {
  if (!arr) {
    return null;
  }

  try {
    return Array.prototype.slice.call(arr, 0, n);
  } catch {
    return null;
  }
};

if (typeof window !== 'undefined') {
  window.ccLog = ccLog;
  window.ccWarn = ccWarn;
}

// enable:   localStorage.setItem('ccDebug','1'); window.__CC_DEBUG__=true;
// disable:  localStorage.removeItem('ccDebug'); window.__CC_DEBUG__=false;

export type { CCLogFn };
