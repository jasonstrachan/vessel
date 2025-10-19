import { useAppStore } from '@/stores/useAppStore';

type ScopedConsole = typeof console;

const resolveConsole = (): ScopedConsole => console;

const resolveInitialDebugState = (): boolean => {
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_CC_DEBUG === '1') {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  if (window.__CC_DEBUG__ === true) {
    return true;
  }

  try {
    return window.localStorage.getItem('ccDebug') === '1';
  } catch {
    return false;
  }
};

export const CC_DEBUG: { on: boolean } = (() => {
  const globalScope = globalThis as Record<string, unknown>;
  if (!globalScope.CC_DEBUG) {
    globalScope.CC_DEBUG = { on: resolveInitialDebugState() };
  }
  return globalScope.CC_DEBUG as { on: boolean };
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

  ((window as unknown) as Record<string, unknown>).CC_DEBUG = CC_DEBUG;
}

let sequence = 0;

const timestamp = () => {
  const source = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const rounded = (source % 100000).toFixed(1);
  return rounded.padStart(8, ' ');
};

export function ccLog(message: string, data?: unknown) {
  if (!CC_DEBUG.on) {
    return;
  }
  const logger = resolveConsole();
  logger.log(`[CC${String(++sequence).padStart(4, '0')}] ${timestamp()} ${message}`, data ?? '');
}

export function ccGroup(message: string, data?: unknown) {
  if (!CC_DEBUG.on) {
    return;
  }
  const logger = resolveConsole();
  logger.groupCollapsed(`[CC] ${timestamp()} ${message}`);
  if (data !== undefined) {
    logger.log(data);
  }
}

export function ccGroupEnd() {
  if (!CC_DEBUG.on) {
    return;
  }
  const logger = resolveConsole();
  logger.groupEnd();
}

export function dumpLayerFlags() {
  if (!CC_DEBUG.on) {
    return;
  }
  const state = useAppStore.getState();
  const rows = state.layers.map(layer => ({
    id: layer.id.slice(-6),
    name: layer.name,
    type: layer.layerType,
    mode: layer.colorCycleData?.mode,
    visible: layer.visible,
    isAnimating: layer.colorCycleData?.isAnimating ?? null,
    recolorPlaying: layer.colorCycleData?.recolorSettings?.animation?.isPlaying ?? null
  }));

  try {
    resolveConsole().table(rows);
  } catch {
    resolveConsole().log(rows);
  }
}

export function ccAssert(condition: boolean, message: string, info?: unknown) {
  if (condition) {
    return;
  }
  resolveConsole().warn(`[CC][ASSERT FAIL] ${message}`, info ?? '');
}
