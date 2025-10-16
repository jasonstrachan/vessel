import { useAppStore } from '@/stores/useAppStore';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import type {
  HistoryDirection,
  HistoryEntry,
  HistoryRehydrationTargets,
  HistoryWorkerScope,
} from './actionTypes';

const isClient = typeof window !== 'undefined';

const ensurePositiveDimension = (value: number | undefined, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return Math.floor(Math.max(1, fallback));
};

const rehydrateColorCycleRuntime = async (
  layerIds: Iterable<string> | null,
): Promise<void> => {
  if (!isClient) {
    return;
  }

  const manager = getColorCycleBrushManager();
  const store = useAppStore.getState();
  const requested = layerIds ? new Set(layerIds) : null;

  const targetLayers = store.layers.filter((layer) => {
    if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      return false;
    }
    if (!requested || requested.size === 0) {
      return true;
    }
    return requested.has(layer.id);
  });

  if (targetLayers.length === 0) {
    return;
  }

  let flaggedForRecomposition = false;

  for (const layer of targetLayers) {
    const colorState = layer.colorCycleData;
    if (!colorState) {
      continue;
    }

    const hasValidBrush = manager.validateColorCycleBrush(layer.id);
    if (!hasValidBrush) {
      const canvasWidth = ensurePositiveDimension(
        colorState.canvas?.width ?? layer.imageData?.width,
        store.project?.width ?? 1024,
      );
      const canvasHeight = ensurePositiveDimension(
        colorState.canvas?.height ?? layer.imageData?.height,
        store.project?.height ?? 1024,
      );
      try {
        const initialized = manager.initColorCycleForLayer(
          layer.id,
          canvasWidth,
          canvasHeight,
          undefined,
        );
        if (!initialized) {
          continue;
        }
        flaggedForRecomposition = true;
      } catch {
        continue;
      }
    }

    if (colorState.canvas && colorState.canvasImageData) {
      try {
        const ctx = colorState.canvas.getContext('2d', {
          willReadFrequently: true,
        } as CanvasRenderingContext2DSettings);
        ctx?.putImageData(colorState.canvasImageData, 0, 0);
      } catch {
        // ignore canvas restoration failures – bitmap delta will still update layer imageData
      }
    }

    if (colorState.mode === 'recolor') {
      try {
        await RecolorManager.getInstance().processLayer(layer);
        flaggedForRecomposition = true;
      } catch {
        // swallow recolor failures to avoid blocking undo/redo
      }
    }
  }

  if (flaggedForRecomposition) {
    useAppStore.setState({ layersNeedRecomposition: true });
  }
};

const rehydrateWorkerScope = async (scope: HistoryWorkerScope): Promise<void> => {
  switch (scope) {
    case 'color-cycle-gradient': {
      if (!isClient) {
        return;
      }
      // Touch the recolor manager so gradient workers spin up lazily when needed.
      try {
        void RecolorManager.getInstance();
      } catch {
        // ignore warm-up failures
      }
      break;
    }
    default:
      break;
  }
};

export const createRehydrationTargets = (): HistoryRehydrationTargets => ({
  layerIds: new Set<string>(),
  colorCycleLayerIds: new Set<string>(),
  workerScopes: new Set<HistoryWorkerScope>(),
});

export const rehydrateEntryResources = async (
  entry: HistoryEntry,
  direction: HistoryDirection,
  targets: HistoryRehydrationTargets,
): Promise<void> => {
  // Use explicit layer hints when provided; fall back to a full sweep for legacy snapshots.
  const shouldSweepColorCycle =
    targets.colorCycleLayerIds.size === 0 &&
    entry.deltas.some((delta) => delta._tag === 'legacy-canvas-snapshot');

  if (targets.colorCycleLayerIds.size > 0 || shouldSweepColorCycle) {
    await rehydrateColorCycleRuntime(
      shouldSweepColorCycle ? null : targets.colorCycleLayerIds,
    );
  }

  if (targets.workerScopes.size > 0) {
    for (const scope of targets.workerScopes) {
      await rehydrateWorkerScope(scope);
    }
  }

  if (targets.layerIds.size > 0) {
    // Mark bitmap updates so downstream renderers refresh composite buffers.
    useAppStore.setState({ layersNeedRecomposition: true });
  }

  // Canvas/view transforms are handled directly by their deltas; no extra work required here.
  void direction; // appease unused parameter lint in case of future additions
};
