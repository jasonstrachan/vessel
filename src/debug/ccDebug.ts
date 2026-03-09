import { useAppStore } from '@/stores/useAppStore';

type ScopedConsole = typeof console;
type CCDebugState = { on: boolean; verbose: boolean; timing: boolean };

const resolveConsole = (): ScopedConsole => console;

const resolveInitialDebugState = (): boolean => false;

const resolveInitialVerboseState = (): boolean => false;

const resolveInitialTimingState = (): boolean => false;

export const CC_DEBUG: CCDebugState = (() => {
  const globalScope = globalThis as Record<string, unknown>;
  if (!globalScope.CC_DEBUG) {
    globalScope.CC_DEBUG = {
      on: resolveInitialDebugState(),
      verbose: resolveInitialVerboseState(),
      timing: resolveInitialTimingState(),
    } satisfies CCDebugState;
  }
  return globalScope.CC_DEBUG as CCDebugState;
})();

const persistDebugPreference = (enabled: boolean) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (enabled) {
      window.localStorage.setItem('ccDebug', '1');
    } else {
      window.localStorage.removeItem('ccDebug');
    }
  } catch {}
};

const persistVerbosePreference = (enabled: boolean) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (enabled) {
      window.localStorage.setItem('ccDebugVerbose', '1');
    } else {
      window.localStorage.removeItem('ccDebugVerbose');
    }
  } catch {}
};

const persistTimingPreference = (enabled: boolean) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (enabled) {
      window.localStorage.setItem('ccDebugTiming', '1');
    } else {
      window.localStorage.removeItem('ccDebugTiming');
    }
  } catch {}
};

if (typeof window !== 'undefined') {
  try {
    Object.defineProperty(window, '__CC_DEBUG__', {
      configurable: true,
      get() {
        return CC_DEBUG.on;
      },
      set(value: unknown) {
        CC_DEBUG.on = Boolean(value);
        persistDebugPreference(CC_DEBUG.on);
      }
    });
  } catch {
    window.__CC_DEBUG__ = CC_DEBUG.on;
  }

  try {
    Object.defineProperty(window, '__CC_DEBUG_VERBOSE__', {
      configurable: true,
      get() {
        return CC_DEBUG.verbose;
      },
      set(value: unknown) {
        CC_DEBUG.verbose = Boolean(value);
        persistVerbosePreference(CC_DEBUG.verbose);
      }
    });
  } catch {
    (window as Window & { __CC_DEBUG_VERBOSE__?: boolean }).__CC_DEBUG_VERBOSE__ = CC_DEBUG.verbose;
  }

  try {
    Object.defineProperty(window, '__CC_DEBUG_TIMING__', {
      configurable: true,
      get() {
        return CC_DEBUG.timing;
      },
      set(value: unknown) {
        CC_DEBUG.timing = Boolean(value);
        persistTimingPreference(CC_DEBUG.timing);
      }
    });
  } catch {
    (window as Window & { __CC_DEBUG_TIMING__?: boolean }).__CC_DEBUG_TIMING__ = CC_DEBUG.timing;
  }

  ((window as unknown) as Record<string, unknown>).CC_DEBUG = CC_DEBUG;
  (window as Window & {
    __CC_RUN_SLOT_GC__?: (reason?: string) => void;
  }).__CC_RUN_SLOT_GC__ = (reason = 'manual') => {
    try {
      useAppStore.getState().runColorCycleSlotRebuild?.(`manual:${reason}`);
    } catch (error) {
      console.warn('[CC] manual slot GC failed', error);
    }
  };
}

export function ccLog(message: string, data?: unknown) {
  void message;
  void data;
}

export function ccGroup(message: string, data?: unknown) {
  void message;
  void data;
}

export function ccGroupEnd() {}

export function dumpLayerFlags() {
  void resolveConsole;
  void useAppStore;
}

export function ccAssert(condition: boolean, message: string, info?: unknown) {
  if (condition) {
    return;
  }
  if (!CC_DEBUG.on || !CC_DEBUG.verbose) {
    return;
  }
  resolveConsole().warn(`[CC][ASSERT FAIL] ${message}`, info ?? '');
}
