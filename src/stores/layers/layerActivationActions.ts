import type { StateCreator } from 'zustand';

import { getColorCycleLegacyLayerBufferByteLength } from '@/lib/colorCycle/document';
import { syncPlaybackColorCycleLayers } from '@/stores/ccRuntime';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import {
  getColorCycleHydrationState,
  updateLayerColorCycleHydrationState,
} from '@/stores/layerHydration';
import {
  hasWarmableColorCycleRuntimeSource as hasWarmableRuntimeSource,
  isDocumentColdColorCycleLayer as isDocumentColdLayer,
} from '@/stores/layers/layerColorCycleRuntimePolicy';
import type {
  EnsureColorCycleLayerRuntimeTarget,
  LayersSlice,
} from '@/stores/layers/layersSliceTypes';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { logError, recordBreadcrumb } from '@/utils/debug';
import { createDevDebugOverlayLogger } from '@/utils/dev/debugOverlayStore';

type StoreSet = Parameters<StateCreator<AppState, [], [], AppState>>[0];
type StoreGet = Parameters<StateCreator<AppState, [], [], AppState>>[1];
type LayerActivationActions = Pick<LayersSlice, 'setActiveLayer'>;

export interface LayerActivationActionDeps {
  set: StoreSet;
  get: StoreGet;
  colorCycleBrushManager: ColorCycleBrushManager;
  scheduleDeferredColorCycleRestore: (
    layerId: string,
    target: EnsureColorCycleLayerRuntimeTarget,
  ) => Promise<void>;
}

const layerActivationDebug = createDevDebugOverlayLogger('layer-activation');

export const recordLayerActivationProbe = (event: string, data: unknown): void => {
  recordBreadcrumb('layer-activation', { event, data });
  layerActivationDebug.log(event, data);
};

export const summarizeLayerForActivationDebug = (
  layer: Layer | undefined | null,
): Record<string, unknown> | null => {
  if (!layer) {
    return null;
  }
  const colorCycleData = layer.colorCycleData;
  const canvas = colorCycleData?.canvas as HTMLCanvasElement | undefined;
  return {
    id: layer.id,
    name: layer.name,
    type: layer.layerType,
    visible: layer.visible,
    order: layer.order,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    hydration: getColorCycleHydrationState(colorCycleData),
    hasCcCanvas: Boolean(canvas),
    ccCanvasSize: canvas ? `${canvas.width}x${canvas.height}` : null,
    hasCcCanvasImageData: Boolean(colorCycleData?.canvasImageData),
    ccImageDataSize: colorCycleData?.canvasImageData
      ? `${colorCycleData.canvasImageData.width}x${colorCycleData.canvasImageData.height}`
      : null,
    gradientIdBytes: getColorCycleLegacyLayerBufferByteLength(colorCycleData, 'gradientIdBuffer') || null,
    gradientDefIdBytes: getColorCycleLegacyLayerBufferByteLength(colorCycleData, 'gradientDefIdBuffer') || null,
    brushStateLayers: Array.isArray((colorCycleData?.brushState as { layers?: unknown[] } | undefined)?.layers)
      ? (colorCycleData?.brushState as { layers: unknown[] }).layers.length
      : null,
  };
};

export const recordLayerActivationRestoreFailure = (
  layerId: string,
  error: unknown,
): void => {
  layerActivationDebug.warn('deferred-restore-failed', { layerId, error });
  logError('[layers] Deferred color-cycle restore failed', { layerId, error });
};

export const createLayerActivationActions = ({
  set,
  get,
  colorCycleBrushManager,
  scheduleDeferredColorCycleRestore,
}: LayerActivationActionDeps): LayerActivationActions => {
  const hasWarmableColorCycleRuntimeSource = (
    layer: Layer | null | undefined,
  ): boolean => hasWarmableRuntimeSource(colorCycleBrushManager, layer);
  const isDocumentColdColorCycleLayer = (
    layer: Layer | null | undefined,
  ): boolean => isDocumentColdLayer(colorCycleBrushManager, layer);

  return {
  setActiveLayer: (id, opts) => {
    const state = get();
    const layer = id ? state.layers.find(l => l.id === id) : null;
    if (id && !layer) {
      logError('setActiveLayer: Invalid layer ID', id);
      return;
    }

    // Fast path: avoid rerunning selection/runtime work when nothing changes.
    if (!opts?.forceLifecycle && state.activeLayerId === id) {
      if (opts?.preserveSelection) {
        if (id ? state.selectedLayerIds.includes(id) : state.selectedLayerIds.length === 0) {
          return;
        }
      } else if (
        id
          ? state.selectedLayerIds.length === 1 && state.selectedLayerIds[0] === id
          : state.selectedLayerIds.length === 0
      ) {
        return;
      }
    }
    // quiet

    // When switching away from a color-cycle layer, mark it as inactive
    const currentActiveLayer = opts?.previousActiveLayer !== undefined
      ? opts.previousActiveLayer
      : state.layers.find(l => l.id === state.activeLayerId);
    if (currentActiveLayer?.layerType === 'color-cycle' && currentActiveLayer.id !== id) {
      try {
        // Mark the old layer's brush as inactive
        if (colorCycleBrushManager) {
          if (currentActiveLayer.id) {
            try {
              colorCycleBrushManager.setActiveState(currentActiveLayer.id, false);
            } catch (e) {
              logError('CC cleanup error (non-fatal): setActiveState', e);
              if (opts?.forceLifecycle) {
                throw e;
              }
            }
            // End any active strokes
            try {
              const oldBrush = colorCycleBrushManager.getLayerActivationBrush(currentActiveLayer.id);
              oldBrush?.endStroke?.(currentActiveLayer.id);
            } catch (e) {
              logError('CC cleanup error (non-fatal): endStroke', e);
              if (opts?.forceLifecycle) {
                throw e;
              }
            }
          }
        }
      } catch (error) {
        if (opts?.forceLifecycle) {
          throw error;
        }
      }
      // quiet
    }

    // If switching to a color-cycle layer in BRUSH context, validate/reinit brush resources.
    // Skip entirely when the Recolor tool is active so we don't override recolor mode.
    const baseSelection = (() => {
      if (!id) {
        return [];
      }
      if (opts?.preserveSelection) {
        return state.selectedLayerIds.includes(id)
          ? state.selectedLayerIds
          : [...state.selectedLayerIds, id];
      }
      return [id];
    })();

    if (id && layer?.layerType === 'color-cycle' && state.tools.currentTool !== 'recolor') {
      const isColdRuntimeLayer = isDocumentColdColorCycleLayer(layer);
      const shouldRestoreDeferredRuntime = Boolean(
        isColdRuntimeLayer && (
          layer.colorCycleData?.deferredRuntimeRestore ||
          hasWarmableColorCycleRuntimeSource(layer)
        ),
      );
      recordLayerActivationProbe('set-active-cc-enter', {
        target: summarizeLayerForActivationDebug(layer),
        previous: summarizeLayerForActivationDebug(currentActiveLayer),
        selectedLayerIds: state.selectedLayerIds,
        isDeferredRuntimeRestore: shouldRestoreDeferredRuntime,
        isColdRuntimeLayer,
        hasManagerBrush: colorCycleBrushManager.validateColorCycleBrush(id),
      });
      // Validate and reinitialize if needed
      if (!isColdRuntimeLayer && !colorCycleBrushManager.validateColorCycleBrush(id)) {

        const width = state.project?.width || 1024;
        const height = state.project?.height || 1024;
        // Note: gradient is in { position, color }[] format, but initColorCycleForLayer expects Uint8Array
        try {
          const initialized = colorCycleBrushManager.initColorCycleForLayer(
          id,
          width,
          height,
          undefined
        );
          if (!initialized && opts?.forceLifecycle) {
            throw new Error(`Failed to initialize color-cycle runtime for active layer ${id}`);
          }
        } catch (e) {
          logError('Error re-initializing color cycle brush on setActiveLayer', e);
          if (opts?.forceLifecycle) {
            throw e;
          }
        }
        // quiet
      }

      // Mark as active
      try {
        colorCycleBrushManager.setActiveState(id, true);
      } catch (e) {
        logError('Color cycle setActiveState error', e);
        if (opts?.forceLifecycle) {
          throw e;
        }
      }

      // Ensure brush tracks the active layer before runtime sync
      if (!isColdRuntimeLayer) {
        try {
        const colorCycleBrush = colorCycleBrushManager.getLayerActivationBrush(id);
        colorCycleBrush?.setActiveLayer?.(id);
        } catch (error) {
          if (opts?.forceLifecycle) {
            throw error;
          }
        }
      }

      if (shouldRestoreDeferredRuntime) {
        recordLayerActivationProbe('deferred-restore-scheduled', {
          target: summarizeLayerForActivationDebug(layer),
        });
        void scheduleDeferredColorCycleRestore(id, 'active');
      }

      // Remember the user's current brush context so we can restore it when leaving CC layers
      let savedRegularTool = state.tools.lastRegularTool;
      let savedBrushShape = state.tools.lastRegularBrushShape;
      if (state.tools.currentTool === 'brush' || state.tools.currentTool === 'eraser') {
        savedRegularTool = state.tools.currentTool;
        savedBrushShape = state.tools.brushSettings.brushShape;
      }

      const resolvedFlowMode = 'forward' as const;
      const shouldUpdateBrushSettings =
        state.tools.brushSettings.customBrushColorCycle !== true ||
        state.tools.brushSettings.colorCycleFlowMode !== resolvedFlowMode;

      let nextBrushSettings = state.tools.brushSettings;
      if (shouldUpdateBrushSettings) {
        nextBrushSettings = {
          ...state.tools.brushSettings,
          customBrushColorCycle: true,
          colorCycleFlowMode: resolvedFlowMode,
        };
      }

      const shouldUpdateToolMemory =
        savedRegularTool !== state.tools.lastRegularTool ||
        savedBrushShape !== state.tools.lastRegularBrushShape ||
        state.tools.lastColorCycleShapeMode !== state.tools.shapeMode;

      const nextTools =
        shouldUpdateBrushSettings || shouldUpdateToolMemory
          ? {
              ...state.tools,
              lastRegularTool: savedRegularTool,
              lastRegularBrushShape: savedBrushShape,
              lastColorCycleShapeMode: state.tools.shapeMode,
              brushSettings: nextBrushSettings
            }
          : state.tools;

      const result = {
        activeLayerId: id,
        selectedLayerIds: baseSelection,
        tools: nextTools,
        layers: state.layers.map((candidate) => {
          if (candidate.id === id && candidate.layerType === 'color-cycle') {
            return isColdRuntimeLayer
              ? candidate
              : updateLayerColorCycleHydrationState(candidate, 'active');
          }
          if (
            candidate.id === state.activeLayerId &&
            candidate.id !== id &&
            candidate.layerType === 'color-cycle' &&
            getColorCycleHydrationState(candidate.colorCycleData) === 'active'
          ) {
            return updateLayerColorCycleHydrationState(candidate, 'warm');
          }
          return candidate;
        }),
      };

      try {
        syncPlaybackColorCycleLayers([layer], 'setActiveLayer');
        recordLayerActivationProbe('set-active-sync-complete', {
          target: summarizeLayerForActivationDebug(layer),
          reason: 'setActiveLayer',
        });
      } catch (error) {
        logError('[setActiveLayer] Failed to sync CC runtime', error);
        layerActivationDebug.warn('set-active-sync-failed', {
          target: summarizeLayerForActivationDebug(layer),
          error: error instanceof Error ? error.message : String(error),
        });
        if (opts?.forceLifecycle) {
          throw error;
        }
      }

      set(result);
      return;
    }

    // When switching to a regular layer from color cycle, restore last regular tool
    const baseBrushSettings = {
      ...state.tools.brushSettings,
      customBrushColorCycle: false
    };

    let nextTools = {
      ...state.tools,
      brushSettings: baseBrushSettings
    };
    const wasOnColorCycle = currentActiveLayer?.layerType === 'color-cycle';
    const isRegularPaintTool =
      state.tools.currentTool === 'brush' || state.tools.currentTool === 'eraser';
    // Restore regular paint context without replacing tools such as Selection.
    if (wasOnColorCycle && layer && layer.layerType === 'normal' && isRegularPaintTool) {
      // Restore the last regular tool and brush shape
      const lastTool = state.tools.lastRegularTool ?? 'brush';
      const lastShape = state.tools.lastRegularBrushShape ?? state.tools.brushSettings.brushShape;

      nextTools = {
        ...nextTools,
        currentTool: lastTool,
        brushSettings: {
          ...baseBrushSettings,
          brushShape: lastShape
        }
      };
    }

    const result = {
      activeLayerId: id,
      selectedLayerIds: baseSelection,
      tools: nextTools,
      layers: state.layers.map((candidate) => (
        candidate.id === state.activeLayerId &&
        candidate.id !== id &&
        candidate.layerType === 'color-cycle' &&
        getColorCycleHydrationState(candidate.colorCycleData) === 'active'
          ? updateLayerColorCycleHydrationState(candidate, 'warm')
          : candidate
      )),
    };

    // Debug checks removed - the race condition has been fixed

      set(result);
    },
  };
};
