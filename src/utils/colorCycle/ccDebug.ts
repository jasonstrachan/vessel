// ---- CC DEBUG TOGGLE & HELPERS ----

type CCLogFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    __CC_DEBUG__?: boolean;
    ccLog?: CCLogFn;
    ccWarn?: CCLogFn;
  }
}

const readLocalStorageFlag = (key: string): boolean => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

const resolveDebugOn = (): boolean => {
  const scope = globalThis as { CC_DEBUG?: { on?: boolean } };
  if (scope.CC_DEBUG?.on === true) {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  if (window.__CC_DEBUG__) {
    return true;
  }

  return readLocalStorageFlag('ccDebug');
};

const resolveVerboseOn = (): boolean => {
  const scope = globalThis as { CC_DEBUG?: { verbose?: boolean } };
  if (scope.CC_DEBUG?.verbose === true) {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  if ((window as Window & { __CC_DEBUG_VERBOSE__?: boolean }).__CC_DEBUG_VERBOSE__ === true) {
    return true;
  }

  const localVerbose = readLocalStorageFlag('ccDebugVerbose');
  return localVerbose;
};

export const ccDebugOn = (): boolean => {
  const debugOn = resolveDebugOn();
  if (!debugOn) {
    return false;
  }

  return true;
};

export const ccDebugVerboseOn = (): boolean => {
  const debugOn = resolveDebugOn();
  if (!debugOn) {
    return false;
  }

  return resolveVerboseOn();
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
// verbose:  localStorage.setItem('ccDebugVerbose','1'); window.__CC_DEBUG_VERBOSE__=true;
// disable:  localStorage.removeItem('ccDebug'); localStorage.removeItem('ccDebugVerbose');
//           window.__CC_DEBUG__=false; window.__CC_DEBUG_VERBOSE__=false;

export type { CCLogFn };
