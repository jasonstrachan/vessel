import { useAppStore } from '@/stores/useAppStore';
import { getPersistedCCMutationLog } from '@/utils/colorCycle/ccMutationAudit';
import { appendCCDebugOverlayEntry } from '@/utils/colorCycle/ccDebugOverlayStore';
import { isDevDebugOverlayEnabled } from '@/utils/dev/debugOverlayStore';

type ScopedConsole = typeof console;
type CCDebugState = { on: boolean; verbose: boolean; timing: boolean };
export const CC_DEBUG_STATE_EVENT = 'cc-debug-state-change';

type ActiveCCLayerDiagnostic = {
  href: string | null;
  activeLayerId: string | null;
  layerCount: number;
  layerType: string | null;
  visible: boolean | null;
  opacity: number | null;
  hasColorCycleData: boolean;
  hasContent: boolean | null;
  hasCanvas: boolean;
  canvasSize: string | null;
  hasImageData: boolean;
  imageDataSize: string | null;
  paintRef: unknown;
  gradientIdRef: unknown;
  gradientDefIdRef: unknown;
  speedRef: unknown;
  flowRef: unknown;
  phaseRef: unknown;
};

type CCDiagnosticsDump = {
  activeLayer: ActiveCCLayerDiagnostic;
  colorCycleLayers: ActiveCCLayerDiagnostic[];
  mutationLog: unknown[];
  storageKeys: string[];
};

declare global {
  interface Window {
    __CC_DEBUG__?: boolean;
    __CC_DEBUG_VERBOSE__?: boolean;
    __CC_DEBUG_TIMING__?: boolean;
    CC_DEBUG?: CCDebugState;
    __CC_RUN_SLOT_GC__?: (reason?: string) => void;
    __VESSEL_GET_ACTIVE_CC_LAYER_DIAGNOSTIC__?: () => ActiveCCLayerDiagnostic;
    __VESSEL_DUMP_CC_DIAGNOSTICS__?: () => CCDiagnosticsDump;
  }
}

const resolveConsole = (): ScopedConsole => console;

const emitCcDebugStateChange = () => {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(CC_DEBUG_STATE_EVENT));
};

const readLocalStorageFlag = (key: string): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

const resolveInitialDebugState = (): boolean => readLocalStorageFlag('ccDebug');

const resolveInitialVerboseState = (): boolean => readLocalStorageFlag('ccDebugVerbose');

const resolveInitialTimingState = (): boolean => readLocalStorageFlag('ccDebugTiming');

const emitDebugPreferenceChange = () => {
  if (typeof window === 'undefined') {
    return;
  }
  emitCcDebugStateChange();
};

const getActiveCCLayerDiagnostic = (): ActiveCCLayerDiagnostic => {
  const state = useAppStore.getState();
  const layer = state.layers.find((entry) => entry.id === state.activeLayerId) ?? null;
  return getLayerDiagnostic(layer);
};

const getLayerDiagnostic = (
  layer: ReturnType<typeof useAppStore.getState>['layers'][number] | null,
): ActiveCCLayerDiagnostic => {
  const state = useAppStore.getState();
  const cc = layer?.layerType === 'color-cycle' ? layer.colorCycleData : null;
  const ccRecord = (cc ?? {}) as Record<string, unknown>;

  return {
    href: typeof window !== 'undefined' ? window.location.href : null,
    activeLayerId: state.activeLayerId ?? null,
    layerCount: state.layers.length,
    layerType: layer?.layerType ?? null,
    visible: layer?.visible ?? null,
    opacity: layer?.opacity ?? null,
    hasColorCycleData: Boolean(cc),
    hasContent: cc?.hasContent ?? null,
    hasCanvas: Boolean(cc?.canvas),
    canvasSize: cc?.canvas ? `${cc.canvas.width}x${cc.canvas.height}` : null,
    hasImageData: Boolean(layer?.imageData),
    imageDataSize: layer?.imageData ? `${layer.imageData.width}x${layer.imageData.height}` : null,
    paintRef: ccRecord.paintRef ?? null,
    gradientIdRef: ccRecord.gradientIdRef ?? null,
    gradientDefIdRef: ccRecord.gradientDefIdRef ?? null,
    speedRef: ccRecord.speedRef ?? null,
    flowRef: ccRecord.flowRef ?? null,
    phaseRef: ccRecord.phaseRef ?? null,
  };
};

const dumpCCDiagnostics = (): CCDiagnosticsDump => {
  const state = useAppStore.getState();
  const storageKeys = (() => {
    if (typeof window === 'undefined') {
      return [];
    }
    try {
      return Object.keys(window.localStorage)
        .filter((key) => /VESSEL|CC|TB/i.test(key))
        .sort();
    } catch {
      return [];
    }
  })();

  return {
    activeLayer: getActiveCCLayerDiagnostic(),
    colorCycleLayers: state.layers
      .filter((layer) => layer.layerType === 'color-cycle')
      .map((layer) => getLayerDiagnostic(layer)),
    mutationLog: getPersistedCCMutationLog(),
    storageKeys,
  };
};

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

  emitDebugPreferenceChange();
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

  emitCcDebugStateChange();
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

  emitCcDebugStateChange();
};

if (typeof window !== 'undefined') {
  emitDebugPreferenceChange();

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
  window.__VESSEL_GET_ACTIVE_CC_LAYER_DIAGNOSTIC__ = getActiveCCLayerDiagnostic;
  window.__VESSEL_DUMP_CC_DIAGNOSTICS__ = dumpCCDiagnostics;
}

export function ccLog(message: string, data?: unknown) {
  if (!CC_DEBUG.on || !isDevDebugOverlayEnabled()) {
    return;
  }
  resolveConsole().log('[CC]', message, data ?? '');
  appendCCDebugOverlayEntry('log', message, data);
}

export function ccWarn(message: string, data?: unknown) {
  if (!CC_DEBUG.on || !isDevDebugOverlayEnabled()) {
    return;
  }
  resolveConsole().warn('[CC]', message, data ?? '');
  appendCCDebugOverlayEntry('warn', message, data);
}

export function ccGroup(message: string, data?: unknown) {
  if (!CC_DEBUG.on || !isDevDebugOverlayEnabled()) {
    return;
  }
  resolveConsole().log('[CC][GROUP]', message, data ?? '');
  appendCCDebugOverlayEntry('group', message, data);
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
  if (!CC_DEBUG.on || !CC_DEBUG.verbose || !isDevDebugOverlayEnabled()) {
    return;
  }
  resolveConsole().warn(`[CC][ASSERT FAIL] ${message}`, info ?? '');
  appendCCDebugOverlayEntry('assert', message, info);
}

export const ccDebugOn = (): boolean => CC_DEBUG.on;

export const ccDebugVerboseOn = (): boolean => CC_DEBUG.on && CC_DEBUG.verbose;

export const ccDebugTimingOn = (): boolean => CC_DEBUG.on && CC_DEBUG.timing;
