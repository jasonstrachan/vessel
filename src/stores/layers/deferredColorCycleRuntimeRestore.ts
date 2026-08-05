import type { Layer } from '@/types';
import { cloneColorCycleLayerDocumentBaseline } from '@/lib/colorCycle/document/ColorCycleLayerDocument';
import { hasColorCycleWarmableRuntimeSource } from '@/lib/colorCycle/runtimeSourcePolicy';
import { syncPlaybackColorCycleLayers } from '@/stores/ccRuntime';
import {
  createColorCycleBrushManager,
  type ColorCycleBrushManager,
  type ColorCycleBrushRuntimeHost,
} from '@/stores/colorCycleBrushManager';
import {
  updateLayerColorCycleHydrationState,
  updateWarmingColorCycleLayerIds,
} from '@/stores/layerHydration';
import { logError } from '@/utils/debug';
import type { AppState } from '@/stores/useAppStore';

type SetAppState = (
  updater: (state: AppState) => AppState | Partial<AppState>,
) => void;

type RestoreCompletionDetails = {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  markActive: boolean;
  shouldPublishActive: boolean;
  restored: boolean;
  restoredHydration: 'cold' | 'warm' | 'active';
};

type DeferredColorCycleRuntimeRestoreOptions = {
  getState: () => AppState;
  setState: SetAppState;
  colorCycleBrushManager: ColorCycleBrushManager;
  summarizeLayer: (layer: Layer | null | undefined) => Record<string, unknown> | null;
  recordRestoreComplete: (details: RestoreCompletionDetails) => void;
  recordRestoreFailure: (layerId: string, error: unknown) => void;
};

type RestoredColorCycleBrush = ColorCycleBrushRuntimeHost & {
  setLayerId?: (layerId: string) => void;
};

const preserveDeferredRestoreSurface = (
  currentLayer: Layer,
  restoredLayer: Layer,
): Layer => {
  if (
    currentLayer.layerType !== 'color-cycle' ||
    restoredLayer.layerType !== 'color-cycle' ||
    !currentLayer.colorCycleData ||
    !restoredLayer.colorCycleData
  ) {
    return restoredLayer;
  }

  return {
    ...restoredLayer,
    colorCycleData: {
      ...restoredLayer.colorCycleData,
      canvasImageData:
        restoredLayer.colorCycleData.canvasImageData ??
        currentLayer.colorCycleData.canvasImageData,
    },
  };
};

export const createDeferredColorCycleRuntimeRestoreScheduler = ({
  getState,
  setState,
  colorCycleBrushManager,
  summarizeLayer,
  recordRestoreComplete,
  recordRestoreFailure,
}: DeferredColorCycleRuntimeRestoreOptions) => {
  const restoresByLayerId = new Map<
    string,
    { project: AppState['project']; promise: Promise<void> }
  >();
  const setWarming = (layerId: string, isWarming: boolean): void => {
    setState((state) => ({
      warmingColorCycleLayerIds: updateWarmingColorCycleLayerIds(
        state.warmingColorCycleLayerIds,
        layerId,
        isWarming,
      ),
    }));
  };
  const getManagedDocument = (layerId: string) => colorCycleBrushManager.getDocument(layerId);
  const hasWarmableSource = (layer: Layer): boolean => (
    hasColorCycleWarmableRuntimeSource(layer, {
      document: getManagedDocument(layer.id),
    })
  );

  return (
    layerId: string,
    target: 'warm' | 'active',
  ): Promise<void> => {
    const sourceProject = getState().project;
    const existingRestore = restoresByLayerId.get(layerId);
    if (existingRestore?.project === sourceProject) {
      return existingRestore.promise;
    }

    const markActive = target === 'active';
    setWarming(layerId, true);
    const restorePromise = import('@/utils/projectIO')
      .then(async ({ restoreColorCycleBrushes }) => {
        const latestState = getState();
        if (latestState.project !== sourceProject) {
          return;
        }
        const latestLayer = latestState.layers.find((candidate) => candidate.id === layerId);
        if (
          !latestLayer ||
          latestLayer.layerType !== 'color-cycle' ||
          !latestLayer.colorCycleData ||
          (
            !latestLayer.colorCycleData.deferredRuntimeRestore &&
            !hasWarmableSource(latestLayer)
          )
        ) {
          return;
        }

        const restoreManager = createColorCycleBrushManager();
        const sourceDocument = getManagedDocument(layerId);
        if (sourceDocument) {
          restoreManager.registerDocument(
            layerId,
            cloneColorCycleLayerDocumentBaseline(sourceDocument),
          );
        }

        let restoredLayer: Layer | undefined;
        try {
          [restoredLayer] = await restoreColorCycleBrushes([latestLayer], {
            lazy: false,
            activeLayerId: layerId,
            colorCycleBrushManager: restoreManager,
          });
        } catch (error) {
          restoreManager.cleanupAll();
          throw error;
        }
        if (!restoredLayer) {
          restoreManager.cleanupAll();
          throw new Error(`Deferred color-cycle restore returned no layer for ${layerId}`);
        }

        const completionState = getState();
        const currentLayer = completionState.layers.find(
          (candidate) => candidate.id === layerId,
        );
        if (
          completionState.project !== sourceProject ||
          !currentLayer ||
          currentLayer.layerType !== 'color-cycle' ||
          !currentLayer.colorCycleData
        ) {
          restoreManager.cleanupAll();
          return;
        }

        const publishLayer = preserveDeferredRestoreSurface(currentLayer, restoredLayer);
        const restoredBrush = publishLayer.colorCycleData?.colorCycleBrush;
        const shouldPublishActive = completionState.activeLayerId === layerId;
        const restoredHydration = restoredBrush
          ? (shouldPublishActive ? 'active' : 'warm')
          : 'cold';
        recordRestoreComplete({
          before: summarizeLayer(latestLayer),
          after: summarizeLayer(publishLayer),
          markActive,
          shouldPublishActive,
          restored: Boolean(restoredBrush),
          restoredHydration,
        });

        setState((current) => ({
          layers: current.layers.map((candidate) => {
            if (candidate.id !== layerId) {
              return candidate;
            }
            const hydrationForCurrentSelection = restoredBrush
              ? (current.activeLayerId === layerId ? 'active' : 'warm')
              : 'cold';
            const nextLayer = updateLayerColorCycleHydrationState(
              publishLayer,
              hydrationForCurrentSelection,
            );
            if (!restoredBrush && nextLayer.colorCycleData) {
              return {
                ...nextLayer,
                colorCycleData: {
                  ...nextLayer.colorCycleData,
                  deferredRuntimeRestore: Boolean(
                    nextLayer.colorCycleData.deferredRuntimeRestore ||
                    hasWarmableSource(nextLayer)
                  ),
                },
              };
            }
            return nextLayer;
          }),
        }));

        const brush = restoredBrush as RestoredColorCycleBrush | undefined;
        if (brush) {
          const shouldRegisterActive = getState().activeLayerId === layerId;
          colorCycleBrushManager.registerRestoredBrush(layerId, brush, {
            width: publishLayer.colorCycleData?.canvas?.width ?? latestState.project?.width ?? 0,
            height: publishLayer.colorCycleData?.canvas?.height ?? latestState.project?.height ?? 0,
            isActive: shouldRegisterActive,
          });
          try {
            brush.setLayerId?.(layerId);
          } catch {
            // Runtime owner registration remains authoritative.
          }
          try {
            colorCycleBrushManager.setActiveState(layerId, shouldRegisterActive);
          } catch {
            // Runtime owner registration remains authoritative.
          }
        } else {
          restoreManager.cleanupAll();
        }

        try {
          syncPlaybackColorCycleLayers([publishLayer], 'deferred-restore');
        } catch (error) {
          logError('[layers] Failed to sync CC runtime after deferred restore', error);
        }
      })
      .catch((error) => {
        recordRestoreFailure(layerId, error);
      })
      .finally(() => {
        if (restoresByLayerId.get(layerId)?.promise === restorePromise) {
          restoresByLayerId.delete(layerId);
          setWarming(layerId, false);
        }
      });

    restoresByLayerId.set(layerId, { project: sourceProject, promise: restorePromise });
    return restorePromise;
  };
};
