import type { Layer } from '@/types';
import { __DEV__, logError, recordBreadcrumb } from '@/utils/debug';

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
};

type CCMutationAuditWindow = Window & {
  __VESSEL_CC_MUTATION_LOG__?: CCMutationEntry[];
};

const LOG_PREFIX = '[CC-MUTATION]';
const MAX_ENTRIES = 200;
const isTestEnv = (): boolean => process.env.NODE_ENV === 'test';
const getAuditWindow = (): CCMutationAuditWindow | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  return window as CCMutationAuditWindow;
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

const persistEntry = (entry: CCMutationEntry): void => {
  const auditWindow = getAuditWindow();
  if (!auditWindow) {
    return;
  }
  if (!Array.isArray(auditWindow.__VESSEL_CC_MUTATION_LOG__)) {
    auditWindow.__VESSEL_CC_MUTATION_LOG__ = [];
  }
  auditWindow.__VESSEL_CC_MUTATION_LOG__.push(entry);
  if (auditWindow.__VESSEL_CC_MUTATION_LOG__.length > MAX_ENTRIES) {
    auditWindow.__VESSEL_CC_MUTATION_LOG__.splice(
      0,
      auditWindow.__VESSEL_CC_MUTATION_LOG__.length - MAX_ENTRIES
    );
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
  const entry: CCMutationEntry = {
    t: Date.now(),
    event,
    severity,
    layerId,
    reason,
    details,
    before: before ?? null,
    after: after ?? null,
  };

  if (!__DEV__) {
    return;
  }

  persistEntry(entry);
  recordBreadcrumb('cc-mutation', entry);

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
    console.info(LOG_PREFIX, event, payload);
    return;
  }
  console.warn(LOG_PREFIX, event, payload);
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
