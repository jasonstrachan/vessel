import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';

type WarmupReason = 'stroke-start' | 'shape-start' | 'shape-finalize';

type FeedbackFn = (message: string) => void;

const warmupByLayerId = new Map<string, Promise<boolean>>();

const getLayerDocumentState = (layer: Layer | null | undefined): {
  hasContent?: boolean;
  paintRef?: unknown;
  gradientIdRef?: unknown;
  gradientDefIdRef?: unknown;
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

export const hasColorCycleCanonicalEditSource = (layer: Layer | null | undefined): boolean => {
  if (!layer || layer.layerType !== 'color-cycle') {
    return false;
  }
  const data = layer.colorCycleData;
  const documentState = getLayerDocumentState(layer);
  if (
    documentState?.hasContent === true ||
    hasBufferLikePayload(documentState?.paintRef) ||
    hasBufferLikePayload(documentState?.gradientIdRef) ||
    hasBufferLikePayload(documentState?.gradientDefIdRef)
  ) {
    return true;
  }
  if (
    hasBufferLikePayload(data?.gradientIdBuffer) ||
    hasBufferLikePayload(data?.gradientDefIdBuffer)
  ) {
    return true;
  }
  const brushState = data?.brushState as {
    layers?: Array<{
      strokeData?: {
        hasContent?: boolean;
        paintBuffer?: unknown;
        gradientIdBuffer?: unknown;
        gradientDefIdBuffer?: unknown;
      };
    }>;
  } | null | undefined;
  return Boolean(brushState?.layers?.some((snapshot) => (
    snapshot.strokeData?.hasContent === true ||
    hasBufferLikePayload(snapshot.strokeData?.paintBuffer) ||
    hasBufferLikePayload(snapshot.strokeData?.gradientIdBuffer) ||
    hasBufferLikePayload(snapshot.strokeData?.gradientDefIdBuffer)
  )));
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
