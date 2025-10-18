import { useAppStore } from '@/stores/useAppStore';

type ScopedConsole = typeof console;

const resolveConsole = (): ScopedConsole => console;

export const CC_DEBUG: { on: boolean } = (() => {
  const globalScope = globalThis as Record<string, unknown>;
  if (!globalScope.CC_DEBUG) {
    globalScope.CC_DEBUG = { on: true };
  }
  return globalScope.CC_DEBUG as { on: boolean };
})();

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
