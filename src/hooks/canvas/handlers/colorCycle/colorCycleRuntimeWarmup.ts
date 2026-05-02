import { useAppStore } from '@/stores/useAppStore';
import { captureColorCyclePersistenceSnapshot } from '@/lib/colorCycle/persistence';
import type { ColorCycleBufferRef } from '@/lib/colorCycle/persistence';
import { validatePersistenceDocumentState } from '@/lib/colorCycle/persistence/colorCyclePersistenceValidation';
import type { Layer } from '@/types';

type WarmupReason = 'stroke-start' | 'shape-start' | 'shape-finalize';

type FeedbackFn = (message: string) => void;

const warmupByLayerId = new Map<string, Promise<boolean>>();

const getLayerDocumentState = (layer: Layer | null | undefined): {
  hasContent?: boolean;
  paintRef?: unknown;
  gradientIdRef?: unknown;
  gradientDefIdRef?: unknown;
  speedRef?: unknown;
  flowRef?: unknown;
  phaseRef?: unknown;
} | null => {
  const state = (layer as unknown as { state?: unknown } | null | undefined)?.state;
  if (!state || typeof state !== 'object') {
    return null;
  }
  return state as {
    hasContent?: boolean;
    paintRef?: unknown;
    gradientIdRef?: unknown;
    gradientDefIdRef?: unknown;
    speedRef?: unknown;
    flowRef?: unknown;
    phaseRef?: unknown;
  };
};

const hasBufferLikePayload = (value: unknown): boolean => {
  if (value instanceof ArrayBuffer) {
    return value.byteLength > 0;
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength > 0;
  }
  return typeof value === 'string' && value.length > 0;
};

const toColorCycleBufferRef = (value: unknown): ColorCycleBufferRef | undefined => (
  hasBufferLikePayload(value) && (value instanceof ArrayBuffer || typeof value === 'string')
    ? value
    : undefined
);

export const hasColorCycleCanonicalEditSource = (layer: Layer | null | undefined): boolean => {
  if (!layer || layer.layerType !== 'color-cycle') {
    return false;
  }
  const data = layer.colorCycleData;
  const documentState = getLayerDocumentState(layer);
  const width = Math.max(1, Math.floor(
    data?.canvasWidth ??
    data?.canvas?.width ??
    layer.imageData?.width ??
    layer.framebuffer?.width ??
    1,
  ));
  const height = Math.max(1, Math.floor(
    data?.canvasHeight ??
    data?.canvas?.height ??
    layer.imageData?.height ??
    layer.framebuffer?.height ??
    1,
  ));

  if (
    documentState &&
    validatePersistenceDocumentState({
      layerId: layer.id,
      width,
      height,
      paintBuffer: toColorCycleBufferRef(documentState.paintRef),
      gradientIdBuffer: toColorCycleBufferRef(documentState.gradientIdRef),
      gradientDefIdBuffer: toColorCycleBufferRef(documentState.gradientDefIdRef),
      speedBuffer: toColorCycleBufferRef(documentState.speedRef),
      flowBuffer: toColorCycleBufferRef(documentState.flowRef),
      phaseBuffer: toColorCycleBufferRef(documentState.phaseRef),
      hasContent: Boolean(documentState.hasContent),
      sources: {
        brushStateSnapshot: false,
        topLevelBuffers: false,
        legacyStateRefs: true,
      },
    }, {
      requirePaint: true,
      source: 'deferred-archive',
    }).ok
  ) {
    return true;
  }

  const snapshot = captureColorCyclePersistenceSnapshot(layer, {
    projectWidth: width,
    projectHeight: height,
    requirePaint: true,
    mode: 'diagnostic',
    runtimeBrush: data?.colorCycleBrush as { getFullState?: () => unknown; serialize?: () => unknown } | undefined,
  });
  if (snapshot.ok) {
    return true;
  }

  return false;
};

const isColdOrMissingEditableRuntime = (layer: Layer, hasBrush: boolean): boolean => (
  layer.colorCycleData?.deferredRuntimeRestore === true ||
  layer.colorCycleData?.runtimeHydrationState === 'cold' ||
  (!hasBrush && hasColorCycleCanonicalEditSource(layer))
);

export const startColorCycleRuntimeWarmupForEdit = ({
  layerId,
  reason,
  feedback,
}: {
  layerId: string | null | undefined;
  reason: WarmupReason;
  feedback?: FeedbackFn | null;
}): boolean => {
  if (!layerId) {
    return false;
  }

  const state = useAppStore.getState();
  const layer = state.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return false;
  }

  const getLayerColorCycleBrush = (state as {
    getLayerColorCycleBrush?: (id: string) => unknown;
  }).getLayerColorCycleBrush;
  const hasBrush = Boolean(getLayerColorCycleBrush?.(layerId));
  if (!isColdOrMissingEditableRuntime(layer, hasBrush)) {
    return false;
  }

  if (!hasColorCycleCanonicalEditSource(layer)) {
    feedback?.('This color-cycle layer is preview-only and cannot be edited');
    return true;
  }

  feedback?.('Preparing color-cycle layer... 0%');
  let settled = false;
  const progressTimer = globalThis.setTimeout(() => {
    if (!settled) {
      feedback?.('Preparing color-cycle layer... 56%');
    }
  }, 120);

  const existing = warmupByLayerId.get(layerId);
  const promise = existing ?? state.ensureColorCycleLayerRuntime(layerId, { target: 'active' });
  warmupByLayerId.set(layerId, promise);
  void promise
    .then((ok) => {
      settled = true;
      globalThis.clearTimeout(progressTimer);
      if (warmupByLayerId.get(layerId) === promise) {
        warmupByLayerId.delete(layerId);
      }
      const nextState = useAppStore.getState();
      const nextLayer = nextState.layers.find((candidate) => candidate.id === layerId);
      const nextGetLayerColorCycleBrush = (nextState as {
        getLayerColorCycleBrush?: (id: string) => unknown;
      }).getLayerColorCycleBrush;
      const ready = ok && Boolean(nextLayer && nextGetLayerColorCycleBrush?.(layerId));
      feedback?.(ready
        ? 'Color-cycle layer ready'
        : 'This color-cycle layer is preview-only and cannot be edited');
    })
    .catch(() => {
      settled = true;
      globalThis.clearTimeout(progressTimer);
      if (warmupByLayerId.get(layerId) === promise) {
        warmupByLayerId.delete(layerId);
      }
      feedback?.('This color-cycle layer is preview-only and cannot be edited');
    });

  void reason;
  return true;
};
