import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';

type ScopedConsole = typeof console;
type CCDebugState = { on: boolean; verbose: boolean; timing: boolean };

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

const resolveInitialVerboseState = (): boolean => {
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_CC_DEBUG_VERBOSE === '1') {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  if ((window as Window & { __CC_DEBUG_VERBOSE__?: boolean }).__CC_DEBUG_VERBOSE__ === true) {
    return true;
  }

  try {
    return window.localStorage.getItem('ccDebugVerbose') === '1';
  } catch {
    return false;
  }
};

const resolveInitialTimingState = (): boolean => {
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_CC_DEBUG_TIMING === '1') {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  if ((window as Window & { __CC_DEBUG_TIMING__?: boolean }).__CC_DEBUG_TIMING__ === true) {
    return true;
  }

  try {
    return window.localStorage.getItem('ccDebugTiming') === '1';
  } catch {
    return false;
  }
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

let sequence = 0;

const timestamp = () => {
  const source = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const rounded = (source % 100000).toFixed(1);
  return rounded.padStart(8, ' ');
};

export function ccLog(message: string, data?: unknown) {
  if (!CC_DEBUG.on || !CC_DEBUG.verbose) {
    return;
  }
  const logger = resolveConsole();
  logger.log(`[CC${String(++sequence).padStart(4, '0')}] ${timestamp()} ${message}`, data ?? '');
}

export function ccGroup(message: string, data?: unknown) {
  if (!CC_DEBUG.on || !CC_DEBUG.verbose) {
    return;
  }
  const logger = resolveConsole();
  logger.groupCollapsed(`[CC] ${timestamp()} ${message}`);
  if (data !== undefined) {
    logger.log(data);
  }
}

export function ccGroupEnd() {
  if (!CC_DEBUG.on || !CC_DEBUG.verbose) {
    return;
  }
  const logger = resolveConsole();
  logger.groupEnd();
}

export function dumpLayerFlags() {
  if (!CC_DEBUG.on || !CC_DEBUG.verbose) {
    return;
  }
  const state = useAppStore.getState();
  const desiredPlaying = state.colorCyclePlayback?.desiredPlaying ?? false;
  const suspendDepth = state.colorCyclePlayback?.suspendDepth ?? 0;
  const effectivePlaying = desiredPlaying && suspendDepth === 0;

  const rows = state.layers.map((layer) => {
    const reason = resolveLayerAnimationReason(layer, {
      desiredPlaying,
      suspendDepth,
      effectivePlaying
    });
    return {
      id: layer.id.slice(-6),
      name: layer.name,
      type: layer.layerType,
      mode: layer.colorCycleData?.mode,
      visible: layer.visible,
      isAnimating: layer.colorCycleData?.isAnimating ?? null,
      recolorPlaying: layer.colorCycleData?.recolorSettings?.animation?.isPlaying ?? null,
      status: reason.status,
      reason: reason.reason
    };
  });

  try {
    resolveConsole().table(rows);
  } catch {
    resolveConsole().log(rows);
  }
}

type LayerPlaybackState = {
  desiredPlaying: boolean;
  suspendDepth: number;
  effectivePlaying: boolean;
};

type LayerAnimationReason = {
  status: 'animating' | 'static';
  reason: string;
};

const resolveLayerAnimationReason = (
  layer: Layer,
  playback: LayerPlaybackState
): LayerAnimationReason => {
  if (layer.layerType !== 'color-cycle') {
    return { status: 'static', reason: 'not-color-cycle' };
  }

  if (layer.visible === false) {
    return { status: 'static', reason: 'layer-hidden' };
  }

  const data = layer.colorCycleData;
  if (!data) {
    return { status: 'static', reason: 'missing-colorCycleData' };
  }

  if (data.mode === 'recolor') {
    const recolorPlaying = data.recolorSettings?.animation?.isPlaying === true;
    if (!recolorPlaying) {
      return { status: 'static', reason: 'recolor-animation-off' };
    }
    if (!playback.effectivePlaying) {
      if (playback.suspendDepth > 0) {
        return { status: 'static', reason: 'global-suspended' };
      }
      if (!playback.desiredPlaying) {
        return { status: 'static', reason: 'global-paused' };
      }
      return { status: 'static', reason: 'global-not-effective' };
    }
    return { status: 'animating', reason: 'recolor-playing' };
  }

  if (data.isAnimating === false) {
    return { status: 'static', reason: 'layer-isAnimating-false' };
  }

  if (playback.suspendDepth > 0) {
    return { status: 'static', reason: 'global-suspended' };
  }

  if (!playback.desiredPlaying) {
    return { status: 'static', reason: 'global-paused' };
  }

  if (!playback.effectivePlaying) {
    return { status: 'static', reason: 'global-not-effective' };
  }

  return { status: 'animating', reason: 'brush-playing' };
};

export function ccAssert(condition: boolean, message: string, info?: unknown) {
  if (condition) {
    return;
  }
  if (!CC_DEBUG.on || !CC_DEBUG.verbose) {
    return;
  }
  resolveConsole().warn(`[CC][ASSERT FAIL] ${message}`, info ?? '');
}
