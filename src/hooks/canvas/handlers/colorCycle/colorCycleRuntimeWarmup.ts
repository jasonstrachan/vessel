import { getAppStoreState } from '@/stores/appStoreAccess';
import {
  hasColorCycleEditableRuntimeSource,
  resolveColorCycleRuntimeSourcePolicy,
} from '@/lib/colorCycle/runtimeSourcePolicy';
import type { Layer } from '@/types';

type WarmupReason = 'stroke-start' | 'shape-start' | 'shape-finalize';

type FeedbackFn = (message: string) => void;

const warmupByLayerId = new Map<string, Promise<boolean>>();

export const hasColorCycleCanonicalEditSource = (layer: Layer | null | undefined): boolean =>
  hasColorCycleEditableRuntimeSource(layer);

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

  const state = getAppStoreState();
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

  const sourcePolicy = resolveColorCycleRuntimeSourcePolicy(layer);
  if (!sourcePolicy.hasEditableSource) {
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
      const nextState = getAppStoreState();
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
