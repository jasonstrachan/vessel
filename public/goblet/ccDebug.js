// ---- CC DEBUG TOGGLE & HELPERS ----

const readLocalStorageFlag = () => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return false;
  }
  try {
    return window.localStorage.getItem('ccDebug') === '1';
  } catch {
    return false;
  }
};

export const ccDebugOn = () => {
  if (typeof window === 'undefined') {
    return false;
  }
  if (window.__CC_DEBUG__) {
    return true;
  }
  return readLocalStorageFlag();
};

export const ccLog = (...args) => {
  if (ccDebugOn()) {
    console.log('[CC]', ...args);
  }
};

export const ccWarn = (...args) => {
  if (ccDebugOn()) {
    console.warn('[CC]', ...args);
  }
};

export const ccSample = (arr, n = 8) => {
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
