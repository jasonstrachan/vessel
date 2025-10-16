const COLOR_CYCLE_DEBUG_STORAGE_KEY = 'ccDebug';
const DEFAULT_COLOR_CYCLE_DEBUG = process.env.NEXT_PUBLIC_CC_DEBUG === '1';

type ColorCycleDebugGlobal = typeof globalThis & {
  __COLOR_CYCLE_DEBUG?: boolean;
  __CC_DEBUG__?: boolean;
  __setColorCycleDebug?: (enabled: boolean) => void;
  localStorage?: Storage;
};

const getGlobal = (): ColorCycleDebugGlobal | null => {
  if (typeof globalThis === 'undefined') return null;
  return globalThis as ColorCycleDebugGlobal;
};

const readStoredValue = (globalObj: ColorCycleDebugGlobal): boolean | null => {
  try {
    const stored = globalObj.localStorage?.getItem(COLOR_CYCLE_DEBUG_STORAGE_KEY);
    if (stored == null) return null;
    return stored === '1';
  } catch {
    return null;
  }
};

const writeStoredValue = (globalObj: ColorCycleDebugGlobal, enabled: boolean) => {
  try {
    globalObj.localStorage?.setItem(COLOR_CYCLE_DEBUG_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // storage access may fail silently in private mode or SSR
  }
};

const initialize = (): void => {
  const globalObj = getGlobal();
  if (!globalObj) return;

  if (typeof globalObj.__COLOR_CYCLE_DEBUG !== 'boolean') {
    if (typeof globalObj.__CC_DEBUG__ === 'boolean') {
      globalObj.__COLOR_CYCLE_DEBUG = globalObj.__CC_DEBUG__;
    }
    const stored = readStoredValue(globalObj);
    globalObj.__COLOR_CYCLE_DEBUG = stored ?? DEFAULT_COLOR_CYCLE_DEBUG;
  }

  if (!globalObj.__setColorCycleDebug) {
    globalObj.__setColorCycleDebug = (enabled: boolean) => {
      globalObj.__COLOR_CYCLE_DEBUG = enabled;
      globalObj.__CC_DEBUG__ = enabled;
      writeStoredValue(globalObj, enabled);
      // eslint-disable-next-line no-console
      console.info('[ColorCycleDebug]', `Color cycle debug ${enabled ? 'enabled' : 'disabled'}`);
    };
  }
};

initialize();

export const setColorCycleDebug = (enabled: boolean): void => {
  const globalObj = getGlobal();
  if (!globalObj) return;
  globalObj.__COLOR_CYCLE_DEBUG = enabled;
  globalObj.__CC_DEBUG__ = enabled;
  writeStoredValue(globalObj, enabled);
};

export const isColorCycleDebugEnabled = (): boolean => {
  const globalObj = getGlobal();
  if (!globalObj) return DEFAULT_COLOR_CYCLE_DEBUG;
  if (typeof globalObj.__COLOR_CYCLE_DEBUG === 'boolean') {
    return globalObj.__COLOR_CYCLE_DEBUG;
  }
  if (typeof globalObj.__CC_DEBUG__ === 'boolean') {
    globalObj.__COLOR_CYCLE_DEBUG = globalObj.__CC_DEBUG__;
    return globalObj.__COLOR_CYCLE_DEBUG;
  }
  const stored = readStoredValue(globalObj);
  const resolved = stored ?? DEFAULT_COLOR_CYCLE_DEBUG;
  globalObj.__COLOR_CYCLE_DEBUG = resolved;
  globalObj.__CC_DEBUG__ = resolved;
  return resolved;
};

export const colorCycleDebug = (label: string, ...args: unknown[]): void => {
  if (!isColorCycleDebugEnabled()) return;
  if (args.length > 0) {
    // eslint-disable-next-line no-console
    console.debug(label, ...args);
  } else {
    // eslint-disable-next-line no-console
    console.debug(label);
  }
};
