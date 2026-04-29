import type { Layer } from '@/types';
import { __DEV__, logError, recordBreadcrumb, debugLog, debugWarn } from '@/utils/debug';

type AuditSeverity = 'info' | 'warn' | 'error';

export type CCMutationSnapshot = {
  layerId: string;
  layerType: Layer['layerType'] | 'serialized' | 'missing';
  hasColorCycleData: boolean;
  hasContent: boolean;
  hasCanvas: boolean;
  canvasSize: string | null;
  hasImageData: boolean;
  imageDataSize: string | null;
  gradientDefBufferBytes: number;
  gradientIdBufferBytes: number;
  gradientDefStoreCount: number;
  slotPaletteCount: number;
  paintSlot: number | null;
  visible: boolean | null;
  opacity: number | null;
};

type CCMutationEntry = {
  t: number;
  event: string;
  severity: AuditSeverity;
  layerId: string;
  reason?: string;
  details?: Record<string, unknown>;
  before?: CCMutationSnapshot | null;
  after?: CCMutationSnapshot | null;
  href?: string | null;
  stack?: string | null;
};

export type ScalarBufferSummary = {
  byteLength: number;
  nonZeroCount: number;
  firstNonZeroIndex: number | null;
  lastNonZeroIndex: number | null;
  checksum: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  samples: Array<{
    index: number;
    x: number;
    y: number;
    value: number;
  }>;
};

type CCMutationAuditWindow = Window & {
  __VESSEL_CC_MUTATION_LOG__?: CCMutationEntry[];
  __VESSEL_GET_CC_MUTATION_LOG__?: () => CCMutationEntry[];
};

const LOG_PREFIX = '[CC-MUTATION]';
const STORAGE_KEY = 'VESSEL_CC_MUTATION_LOG';
const MAX_MEMORY_ENTRIES = 500;
const MAX_PERSISTED_ENTRIES = 2000;
const isTestEnv = (): boolean => process.env.NODE_ENV === 'test';
const getAuditWindow = (): CCMutationAuditWindow | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  return window as CCMutationAuditWindow;
};

const installMutationLogHelper = (): void => {
  const auditWindow = getAuditWindow();
  if (!auditWindow) {
    return;
  }
  auditWindow.__VESSEL_GET_CC_MUTATION_LOG__ = getPersistedCCMutationLog;
};

const getByteLength = (value: ArrayBufferLike | null | undefined): number =>
  value?.byteLength ?? 0;

const getCanvasSize = (
  canvas: HTMLCanvasElement | OffscreenCanvas | null | undefined
): string | null => {
  if (!canvas) {
    return null;
  }
  return `${canvas.width}x${canvas.height}`;
};

export const summarizeColorCycleLayer = (
  layer: Layer | null | undefined
): CCMutationSnapshot | null => {
  if (!layer) {
    return null;
  }

  const colorCycleData = layer.layerType === 'color-cycle' ? layer.colorCycleData : undefined;
  return {
    layerId: layer.id,
    layerType: layer.layerType,
    hasColorCycleData: Boolean(colorCycleData),
    hasContent: Boolean(colorCycleData?.hasContent),
    hasCanvas: Boolean(colorCycleData?.canvas),
    canvasSize: getCanvasSize(colorCycleData?.canvas),
    hasImageData: Boolean(layer.imageData),
    imageDataSize: layer.imageData ? `${layer.imageData.width}x${layer.imageData.height}` : null,
    gradientDefBufferBytes: getByteLength(colorCycleData?.gradientDefIdBuffer),
    gradientIdBufferBytes: getByteLength(colorCycleData?.gradientIdBuffer),
    gradientDefStoreCount: colorCycleData?.gradientDefStore?.length ?? 0,
    slotPaletteCount: colorCycleData?.slotPalettes?.length ?? 0,
    paintSlot:
      typeof colorCycleData?.paintSlot === 'number' ? colorCycleData.paintSlot : null,
    visible: layer.visible,
    opacity: layer.opacity,
  };
};

export const summarizeSerializedColorCycleLayer = (params: {
  layerId: string;
  hasContent?: boolean;
  gradientDefBufferBytes?: number;
  gradientIdBufferBytes?: number;
  gradientDefStoreCount?: number;
  slotPaletteCount?: number;
}): CCMutationSnapshot => ({
  layerId: params.layerId,
  layerType: 'serialized',
  hasColorCycleData: true,
  hasContent: Boolean(params.hasContent),
  hasCanvas: false,
  canvasSize: null,
  hasImageData: false,
  imageDataSize: null,
  gradientDefBufferBytes: params.gradientDefBufferBytes ?? 0,
  gradientIdBufferBytes: params.gradientIdBufferBytes ?? 0,
  gradientDefStoreCount: params.gradientDefStoreCount ?? 0,
  slotPaletteCount: params.slotPaletteCount ?? 0,
  paintSlot: null,
  visible: null,
  opacity: null,
});

export const summarizeScalarBuffer = (
  buffer: Uint8Array | Uint16Array,
  width: number,
  height: number,
): ScalarBufferSummary => {
  let checksum = 0x811c9dc5;
  let nonZeroCount = 0;
  let firstNonZeroIndex: number | null = null;
  let lastNonZeroIndex: number | null = null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const samples: ScalarBufferSummary['samples'] = [];

  for (let index = 0; index < buffer.length; index += 1) {
    const value = buffer[index] ?? 0;
    checksum ^= value;
    checksum = Math.imul(checksum, 0x01000193);
    if (value === 0) {
      continue;
    }

    const x = width > 0 ? index % width : 0;
    const y = width > 0 ? Math.floor(index / width) : 0;
    nonZeroCount += 1;
    firstNonZeroIndex ??= index;
    lastNonZeroIndex = index;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (samples.length < 16) {
      samples.push({ index, x, y, value });
    }
  }

  return {
    byteLength: buffer.byteLength,
    nonZeroCount,
    firstNonZeroIndex,
    lastNonZeroIndex,
    checksum: (checksum >>> 0).toString(16).padStart(8, '0'),
    bounds: nonZeroCount > 0
      ? {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        }
      : null,
    samples,
  };
};

const persistEntry = (entry: CCMutationEntry): void => {
  const auditWindow = getAuditWindow();
  if (!auditWindow) {
    return;
  }
  if (!Array.isArray(auditWindow.__VESSEL_CC_MUTATION_LOG__)) {
    auditWindow.__VESSEL_CC_MUTATION_LOG__ = [];
  }
  auditWindow.__VESSEL_CC_MUTATION_LOG__.push(entry);
  if (auditWindow.__VESSEL_CC_MUTATION_LOG__.length > MAX_MEMORY_ENTRIES) {
    auditWindow.__VESSEL_CC_MUTATION_LOG__.splice(
      0,
      auditWindow.__VESSEL_CC_MUTATION_LOG__.length - MAX_MEMORY_ENTRIES
    );
  }
  installMutationLogHelper();

  try {
    const parsed = JSON.parse(auditWindow.localStorage.getItem(STORAGE_KEY) || '[]');
    const persisted: CCMutationEntry[] = Array.isArray(parsed) ? parsed : [];
    persisted.push(entry);
    if (persisted.length > MAX_PERSISTED_ENTRIES) {
      persisted.splice(0, persisted.length - MAX_PERSISTED_ENTRIES);
    }
    auditWindow.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    try {
      auditWindow.localStorage.setItem(STORAGE_KEY, JSON.stringify([entry]));
    } catch {}
  }
};

export const getPersistedCCMutationLog = (): CCMutationEntry[] => {
  const auditWindow = getAuditWindow();
  if (!auditWindow) {
    return [];
  }
  installMutationLogHelper();
  try {
    const raw = auditWindow.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return Array.isArray(auditWindow.__VESSEL_CC_MUTATION_LOG__)
        ? [...auditWindow.__VESSEL_CC_MUTATION_LOG__]
        : [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as CCMutationEntry[] : [];
  } catch {
    return Array.isArray(auditWindow.__VESSEL_CC_MUTATION_LOG__)
      ? [...auditWindow.__VESSEL_CC_MUTATION_LOG__]
      : [];
  }
};

export const logCCMutation = ({
  event,
  layerId,
  reason,
  details,
  before,
  after,
  severity = 'warn',
}: {
  event: string;
  layerId: string;
  reason?: string;
  details?: Record<string, unknown>;
  before?: CCMutationSnapshot | null;
  after?: CCMutationSnapshot | null;
  severity?: AuditSeverity;
}): void => {
  installMutationLogHelper();
  const shouldPersist = __DEV__ || severity === 'error' || transitionLooksDestructive(before ?? null, after ?? null);
  const entry: CCMutationEntry = {
    t: Date.now(),
    event,
    severity,
    layerId,
    reason,
    details,
    before: before ?? null,
    after: after ?? null,
    href: getAuditWindow()?.location?.href ?? null,
    stack: shouldPersist ? new Error(`${LOG_PREFIX} ${event}`).stack ?? null : null,
  };

  if (shouldPersist) {
    persistEntry(entry);
  }
  recordBreadcrumb('cc-mutation', entry);

  if (!__DEV__) {
    return;
  }

  if (isTestEnv()) {
    return;
  }

  const payload = {
    layerId,
    reason,
    details,
    before,
    after,
  };

  if (severity === 'error') {
    logError(LOG_PREFIX, event, payload);
    return;
  }
  if (severity === 'info') {
    debugLog('raw-console', LOG_PREFIX, event, payload);
    return;
  }
  debugWarn('raw-console', LOG_PREFIX, event, payload);
};

const transitionLooksDestructive = (
  before: CCMutationSnapshot | null,
  after: CCMutationSnapshot | null
): boolean => {
  if (!before) {
    return false;
  }
  if (!after) {
    return before.hasColorCycleData || before.hasContent || before.hasCanvas;
  }
  return (
    (before.hasContent && !after.hasContent) ||
    (before.hasCanvas && !after.hasCanvas) ||
    (before.hasColorCycleData && !after.hasColorCycleData) ||
    (before.gradientDefBufferBytes > 0 && after.gradientDefBufferBytes === 0) ||
    (before.gradientDefStoreCount > 0 && after.gradientDefStoreCount === 0) ||
    before.layerType !== after.layerType
  );
};

export const auditColorCycleLayerTransition = ({
  event,
  layerId,
  before,
  after,
  reason,
  details,
}: {
  event: string;
  layerId: string;
  before: CCMutationSnapshot | null;
  after: CCMutationSnapshot | null;
  reason?: string;
  details?: Record<string, unknown>;
}): void => {
  if (!transitionLooksDestructive(before, after)) {
    return;
  }
  logCCMutation({
    event,
    layerId,
    reason,
    details,
    before,
    after,
    severity: 'warn',
  });
};

installMutationLogHelper();
