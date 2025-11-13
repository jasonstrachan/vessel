import { featureFlags } from '@/config/featureFlags';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import { defaultBrushSettings } from '@/presets/brushPresets';
import type { BrushSettings, Layer } from '@/types';
import type { AppState } from '@/stores/useAppStore';
import {
  createColorCycleBrushRegistry,
  type ColorCycleBrushManager,
  type ColorCycleBrushRegistryDeps
} from './colorCycleBrushRegistry';

type IntervalHandle = ReturnType<typeof setInterval> | number;

type StoreSlice = Pick<AppState, 'tools' | 'layers'>;

let storeStateGetter: (() => StoreSlice) | null = null;

let getValidLayerIds: (() => Set<string>) | null = null;

let globalManager: ColorCycleBrushManager | null = null;

type BrushManagerRuntime = {
  cleanupInactiveTimer: IntervalHandle | null;
  cleanupOrphanedTimer: IntervalHandle | null;
  featureFlagHandler: EventListener | null;
  beforeUnloadHandler: EventListener | null;
};

type VesselGlobal = typeof globalThis & {
  __vesselColorCycleRuntime?: BrushManagerRuntime;
};

const getRuntime = (): BrushManagerRuntime => {
  const scope = globalThis as VesselGlobal;
  if (!scope.__vesselColorCycleRuntime) {
    scope.__vesselColorCycleRuntime = {
      cleanupInactiveTimer: null,
      cleanupOrphanedTimer: null,
      featureFlagHandler: null,
      beforeUnloadHandler: null,
    };
  }
  return scope.__vesselColorCycleRuntime;
};

const runtime = getRuntime();

const getBrushSettings = (): BrushSettings => {
  return storeStateGetter?.().tools.brushSettings ?? defaultBrushSettings;
};

const getLayers = (): Layer[] => {
  return storeStateGetter?.().layers ?? [];
};

const createCanvasSurface = (width: number, height: number): HTMLCanvasElement => {
  if (typeof document === 'undefined') {
    throw new Error('[ColorCycleBrushManager] document is unavailable to create canvas surfaces');
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return canvas;
};

const buildRegistry = (): ColorCycleBrushManager => {
  const deps: ColorCycleBrushRegistryDeps = {
    getBrushSettings,
    getLayers,
    createCanvas: createCanvasSurface,
    getBrushClass: getColorCycleBrushCanvas2D,
    shouldForceCanvas2D: () => featureFlags.useCanvas2DColorCycle,
    now: () => Date.now()
  };
  return createColorCycleBrushRegistry(deps);
};

export function setColorCycleStoreStateGetter(getter: () => StoreSlice): void {
  storeStateGetter = getter;
}

export function setLayerIdGetter(getter: () => Set<string>): void {
  getValidLayerIds = getter;
}

const stopPeriodicMaintenance = (): void => {
  if (runtime.cleanupInactiveTimer) {
    clearInterval(runtime.cleanupInactiveTimer);
    runtime.cleanupInactiveTimer = null;
  }
  if (runtime.cleanupOrphanedTimer) {
    clearInterval(runtime.cleanupOrphanedTimer);
    runtime.cleanupOrphanedTimer = null;
  }
};

const startPeriodicMaintenance = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  stopPeriodicMaintenance();
  runtime.cleanupInactiveTimer = window.setInterval(() => {
    globalManager?.cleanupInactive(60000);
  }, 30000);

  runtime.cleanupOrphanedTimer = window.setInterval(() => {
    if (globalManager && getValidLayerIds) {
      const validIds = getValidLayerIds();
      globalManager.cleanupOrphanedBrushes(validIds);
    }
  }, 60000);
};

const registerFeatureFlagListener = (): void => {
  if (typeof window === 'undefined' || runtime.featureFlagHandler) {
    return;
  }

  const handler: EventListener = (event: Event) => {
    const detail = (event as CustomEvent<{ key?: string; value?: boolean }>).detail;
    if (detail?.key === 'useCanvas2DColorCycle' && typeof detail.value === 'boolean') {
      globalManager?.setCanvasImplementation(detail.value);
    }
  };

  window.addEventListener('vessel:featureFlagChange', handler);
  runtime.featureFlagHandler = handler;
};

const unregisterFeatureFlagListener = (): void => {
  if (typeof window === 'undefined' || !runtime.featureFlagHandler) {
    return;
  }
  window.removeEventListener('vessel:featureFlagChange', runtime.featureFlagHandler);
  runtime.featureFlagHandler = null;
};

const registerBeforeUnloadHandler = (): void => {
  if (typeof window === 'undefined' || runtime.beforeUnloadHandler) {
    return;
  }

  const handler: EventListener = () => {
    disposeColorCycleBrushManager();
  };

  window.addEventListener('beforeunload', handler);
  runtime.beforeUnloadHandler = handler;
};

const unregisterBeforeUnloadHandler = (): void => {
  if (typeof window === 'undefined' || !runtime.beforeUnloadHandler) {
    return;
  }
  window.removeEventListener('beforeunload', runtime.beforeUnloadHandler);
  runtime.beforeUnloadHandler = null;
};

stopPeriodicMaintenance();
unregisterFeatureFlagListener();
unregisterBeforeUnloadHandler();

export function createColorCycleBrushManager(): ColorCycleBrushManager {
  return buildRegistry();
}

export function getColorCycleBrushManager(): ColorCycleBrushManager {
  if (!globalManager) {
    globalManager = createColorCycleBrushManager();
    if (typeof window !== 'undefined') {
      startPeriodicMaintenance();
      registerFeatureFlagListener();
      registerBeforeUnloadHandler();
    }
  }
  return globalManager;
}

export function disposeColorCycleBrushManager(): void {
  stopPeriodicMaintenance();
  unregisterFeatureFlagListener();
  unregisterBeforeUnloadHandler();
  globalManager?.cleanupAll();
  globalManager = null;
}

export type { ColorCycleBrushManager, ColorCycleBrushImplementation };
type ColorCycleBrushCanvas2DConstructor = typeof import('@/hooks/brushEngine/ColorCycleBrushCanvas2D').ColorCycleBrushCanvas2D;
let ColorCycleBrushCanvas2DImpl: ColorCycleBrushCanvas2DConstructor | null = null;

const getColorCycleBrushCanvas2D = (): ColorCycleBrushCanvas2DConstructor => {
  if (!ColorCycleBrushCanvas2DImpl) {
    const colorCycleModule = require('@/hooks/brushEngine/ColorCycleBrushCanvas2D') as typeof import('@/hooks/brushEngine/ColorCycleBrushCanvas2D');
    ColorCycleBrushCanvas2DImpl = colorCycleModule.ColorCycleBrushCanvas2D;
  }
  return ColorCycleBrushCanvas2DImpl;
};
