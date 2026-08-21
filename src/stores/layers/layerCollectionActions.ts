import type { StateCreator } from 'zustand';

import type { LayerStructureSnapshot } from '@/history/deltas/layerStructureDelta';
import {
  clearSequentialLayerRendererAll,
  clearSequentialLayerRendererLayer,
} from '@/lib/sequential/SequentialLayerRenderer';
import { recordSequentialAppendPerf } from '@/lib/sequential/SequentialPerfCounters';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type {
  CommitLayerStructureHistoryOptions,
  LayerHistorySnapshotOptions,
} from '@/stores/helpers/layerStructureHistory';
import {
  getInsertionIndexAboveActiveLayer,
  insertLayerAtIndex,
  normalizeLayerOrder,
} from '@/stores/layers/layerCrudService';
import {
  sanitizeHiddenLayerGroupIds,
  sanitizeLayerGroups,
} from '@/stores/layers/layerGroupService';
import type { LayersSlice } from '@/stores/layers/layersSliceTypes';
import { appendSequentialLayerEventsToLayers } from '@/stores/layers/sequentialLayerEvents';
import type { AppState } from '@/stores/useAppStore';
import type { Layer, Project } from '@/types';
import {
  logCCMutation,
  summarizeColorCycleLayer,
} from '@/utils/colorCycle/ccMutationAudit';
import {
  __DEV__,
  logError,
  recordBreadcrumb,
} from '@/utils/debug';
import {
  cloneLayerAlignment,
  dedupeLayerIds,
  normalizeLayers,
} from '@/utils/layoutDefaults';

type StoreSet = Parameters<StateCreator<AppState, [], [], AppState>>[0];
type StoreGet = Parameters<StateCreator<AppState, [], [], AppState>>[1];

type LayerCollectionActions = Pick<
  LayersSlice,
  | 'setLayers'
  | 'addLayer'
  | 'removeLayer'
  | 'removeLayers'
  | 'appendSequentialLayerEvent'
  | 'appendSequentialLayerEvents'
  | 'setLayersVisibility'
  | 'toggleLayersVisibility'
  | 'setSelectedLayerIds'
  | 'setReferenceLayer'
>;

export interface LayerCollectionActionDeps {
  set: StoreSet;
  get: StoreGet;
  colorCycleBrushManager: ColorCycleBrushManager;
  syncPercentOffsetsFromPixels: (layers: Layer[], project: Project | null) => Layer[];
  trackLayerChanges: (...args: unknown[]) => void;
  captureLayerStructureSnapshot: (
    state: AppState,
    options: LayerHistorySnapshotOptions,
  ) => LayerStructureSnapshot;
  commitLayerStructureHistory: (options: CommitLayerStructureHistoryOptions) => void;
  createLayerTransferCanvas: (
    width: number,
    height: number,
  ) => HTMLCanvasElement | OffscreenCanvas | null;
  hasValidFramebuffer: (
    framebuffer: HTMLCanvasElement | OffscreenCanvas | null | undefined,
  ) => framebuffer is HTMLCanvasElement | OffscreenCanvas;
  pruneGroupVisibilitySnapshots: (validGroupIds: Set<string>) => void;
  scheduleSlotRebuild: (reason: string) => void;
}

export const createLayerCollectionActions = ({
  set,
  get,
  colorCycleBrushManager,
  syncPercentOffsetsFromPixels,
  trackLayerChanges,
  captureLayerStructureSnapshot,
  commitLayerStructureHistory,
  createLayerTransferCanvas,
  hasValidFramebuffer,
  pruneGroupVisibilitySnapshots,
  scheduleSlotRebuild,
}: LayerCollectionActionDeps): LayerCollectionActions => ({
      setLayers: (incomingLayers) => {
        clearSequentialLayerRendererAll();
        set((state) => {
          const normalized = dedupeLayerIds(
            normalizeLayers(
              incomingLayers.map((layer, index) => ({
                ...layer,
                order: index,
                alignment: cloneLayerAlignment(layer.alignment),
              })),
            ),
          );

          trackLayerChanges('setLayers', normalized);
          const syncedLayers = syncPercentOffsetsFromPixels(normalized, state.project ?? null);
          const hydratedLayers = syncedLayers.map((layer) => {
            if (layer.layerType === 'color-cycle') {
              return layer;
            }

            if (hasValidFramebuffer(layer.framebuffer)) {
              return layer;
            }

            const sourceImage = layer.imageData ?? null;
            const fallbackWidth = sourceImage?.width ?? state.project?.width ?? 1;
            const fallbackHeight = sourceImage?.height ?? state.project?.height ?? 1;
            const nextFramebuffer = createLayerTransferCanvas(fallbackWidth, fallbackHeight);

            if (nextFramebuffer && sourceImage) {
              const fbCtx = nextFramebuffer.getContext(
                '2d',
                { willReadFrequently: true } as CanvasRenderingContext2DSettings,
              ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
              try {
                fbCtx?.putImageData(sourceImage, 0, 0);
              } catch {
                // ignore hydration failures; merged imageData will still draw correctly
              }
            }

            return {
              ...layer,
              framebuffer: nextFramebuffer ?? layer.framebuffer ?? null,
            };
          });
          const sanitizedGroups = sanitizeLayerGroups(hydratedLayers, state.layerGroups);
          const validGroupIds = new Set(sanitizedGroups.map((group) => group.id));
          const groupedLayers = hydratedLayers.map((layer) => {
            if (!layer.groupId || validGroupIds.has(layer.groupId)) {
              return layer;
            }
            return { ...layer, groupId: undefined };
          });
          const validLayerIds = new Set(groupedLayers.map((layer) => layer.id));
          const nextReferenceLayerId = state.referenceLayerId && validLayerIds.has(state.referenceLayerId)
            ? state.referenceLayerId
            : null;
          const currentSource = state.project?.referenceSamplingSource ?? { kind: 'canvas' as const };
          const nextSource = currentSource.kind === 'layer' && !validLayerIds.has(currentSource.layerId)
            ? { kind: 'canvas' as const }
            : currentSource;

          return {
            layers: groupedLayers,
            layerGroups: sanitizedGroups,
            hiddenLayerGroupIds: sanitizeHiddenLayerGroupIds(state.hiddenLayerGroupIds, sanitizedGroups),
            referenceLayerId: nextReferenceLayerId,
            colorPickerPreferReferenceLayer: nextSource.kind !== 'canvas',
            project: state.project
              ? {
                  ...state.project,
                  referenceLayerId: nextReferenceLayerId,
                  referenceSamplingSource: nextSource,
                }
              : state.project,
          };
        });
        pruneGroupVisibilitySnapshots(new Set(get().layerGroups.map((group) => group.id)));
        get().markAllCompositeSegmentsDirty();
      },
  addLayer: (layer) => {
    if (__DEV__) {
      // quiet
    }
    recordBreadcrumb('layers', { event: 'store-addLayer-enter', incomingType: layer?.layerType });
    const stateBeforeAdd = get();
    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeAdd, {
      actionType: 'layer-add',
      description: 'Add layer',
    });

    const newLayerId = `layer-${Date.now()}-${Math.random()}`;
    // quiet

    set((state) => {
      // quiet
      // CRITICAL CHECK: Verify existing layers are not mutated
      const existingLayersSnapshot = state.layers.map(l => ({
        id: l.id,
        type: l.layerType,
        hasCC: !!l.colorCycleData
      }));

      const resolvedLayerType = layer.layerType || (
        (logError('CRITICAL: Layer missing layerType!', {
          layerId: newLayerId?.substring(0, 20),
          hasColorCycleData: !!layer.colorCycleData,
          fallbackToNormal: true
        }),
        'normal')
      );

      const newLayer = {
        ...layer,
        id: newLayerId,
        // Temporary order; will be normalized after insertion
        order: 0,
        alignment: cloneLayerAlignment(layer.alignment),
        transparencyLocked: layer.transparencyLocked === true,
        // CRITICAL: Preserve layerType EXACTLY - DO NOT convert CC layers to normal!
        layerType: resolvedLayerType,
        sequentialData: resolvedLayerType === 'sequential'
          ? {
              frameCount: layer.sequentialData?.frameCount ?? 24,
              fps: layer.sequentialData?.fps ?? 24,
              durationMs:
                layer.sequentialData?.durationMs ??
                Math.round(((layer.sequentialData?.frameCount ?? 24) * 1000) / (layer.sequentialData?.fps ?? 24)),
              events: layer.sequentialData?.events ?? [],
            }
          : layer.sequentialData
      };

      // Insert the new layer directly ABOVE the currently active layer
      // Fallback: if no active layer, append to top of stack
      const insertedIndex = getInsertionIndexAboveActiveLayer(state.layers, state.activeLayerId);
      const newLayers = insertLayerAtIndex(state.layers, newLayer, insertedIndex);

      // Normalize order values to match visual/composite order (ascending = bottom -> top)
      const updatedLayers = normalizeLayerOrder(newLayers);
      recordBreadcrumb('layers', { event: 'store-addLayer-updated', total: updatedLayers.length, insertedIndex });
      // quiet

      // Initialize ColorCycleBrush for color-cycle layers
      if (newLayer.layerType === 'color-cycle' && state.project) {
        const width = state.project.width || 1024;
        const height = state.project.height || 1024;
        // quiet

        // Use enhanced manager method for initialization
        // Note: gradient is in { position, color }[] format, but initColorCycleForLayer expects Uint8Array
        // Pass undefined to use default gradient
        const success = colorCycleBrushManager.initColorCycleForLayer(
          newLayerId,
          width,
          height,
          undefined
        );

        if (!success) {
          logError('Failed to initialize ColorCycleBrush for new layer', { layerId: newLayerId });
        } else {
          // Pre-create the animator to avoid lag on first paint
          const brush = colorCycleBrushManager.getSpeedSettingsBrush(newLayerId);
          if (brush) {
            // Apply the default speed to keep the animator ready before first paint.
            if (brush.applySettings) {
              brush.applySettings({ cycleSpeed: 1.0 });
            } else {
              brush.setSpeed?.(1.0);
            }
            // quiet
          }
        }
      }

      // VERIFY: Check if any existing layer lost its type
      // IMPORTANT: Compare by stable id, not by array index, because we inserted a new
      // layer and normalized order which shifts indices. Index-based comparison would
      // falsely report a mutation at and after the insertion point.
      existingLayersSnapshot.forEach((original) => {
        const updated = updatedLayers.find(l => l.id === original.id);
        if (!updated) {
          // Should never happen; log once for diagnostics without throwing
          logError('Layer missing after addLayer id lookup', {
            layerId: original.id.substring(0, 20),
            originalType: original.type
          });
          return;
        }
        if (original.type !== updated.layerType) {
          logError('Layer type mutation detected in addLayer', {
            layerId: original.id.substring(0, 20),
            originalType: original.type,
            newType: updated.layerType,
            wasCC: original.hasCC,
            isCC: !!updated.colorCycleData
          });
        }
      });

      const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);

      return {
        layers: syncedLayers
      };
    });

    // Ensure the newly created layer becomes the active selection.
    try {
      const storeState = get();
      if (storeState.setActiveLayer) {
        if (storeState.activeLayerId !== newLayerId) {
          storeState.setActiveLayer(newLayerId);
        } else if (!storeState.selectedLayerIds.includes(newLayerId) && storeState.setSelectedLayerIds) {
          storeState.setSelectedLayerIds([newLayerId]);
        }
      }
    } catch (error) {
      logError('addLayer: failed to auto-select new layer', error);
      set(() => ({
        activeLayerId: newLayerId,
        selectedLayerIds: [newLayerId]
      }));
    }

    const stateAfterAdd = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterAdd, {
      actionType: 'layer-add',
      description: 'Add layer',
      activeLayerId: newLayerId,
      previousSnapshot: beforeSnapshot,
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Add layer',
      metadata: { layerId: newLayerId, operation: 'add' },
    });
    get().markAllCompositeSegmentsDirty();

    return newLayerId;
  },
  removeLayer: (id) => {
    clearSequentialLayerRendererLayer(id);
    const stateBeforeRemove = get();
    const removedLayerBefore = stateBeforeRemove.layers.find((layer) => layer.id === id) ?? null;
    const removedLayerSummary = summarizeColorCycleLayer(removedLayerBefore);
    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeRemove, {
      actionType: 'layer-remove',
      description: 'Remove layer',
    });

    set((state) => {
      // Use enhanced manager method for cleanup
      colorCycleBrushManager.removeColorCycleBrush(id);

      const updatedLayers = state.layers.filter(l => l.id !== id);
      const newActiveLayerId = state.activeLayerId === id ?
        updatedLayers.find(l => l.id !== id)?.id || null :
        state.activeLayerId;

      const filteredSelection = state.selectedLayerIds.filter(selectedId => {
        if (selectedId === id) {
          return false;
        }
        return updatedLayers.some(layer => layer.id === selectedId);
      });
      const nextSelection = filteredSelection.length > 0
        ? filteredSelection
        : (newActiveLayerId ? [newActiveLayerId] : []);

      trackLayerChanges('removeLayer RETURN', updatedLayers);
      const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);
      const nextLayerGroups = sanitizeLayerGroups(syncedLayers, state.layerGroups);
      const nextHiddenLayerGroupIds = sanitizeHiddenLayerGroupIds(state.hiddenLayerGroupIds, nextLayerGroups);
      const nextReferenceLayerId = state.referenceLayerId === id ? null : state.referenceLayerId;
      const currentSource = state.project?.referenceSamplingSource ?? { kind: 'canvas' as const };
      const nextSource = currentSource.kind === 'layer' && currentSource.layerId === id
        ? { kind: 'canvas' as const }
        : currentSource;
    return {
      layers: syncedLayers,
      layerGroups: nextLayerGroups,
      hiddenLayerGroupIds: nextHiddenLayerGroupIds,
      activeLayerId: newActiveLayerId,
      selectedLayerIds: nextSelection,
      referenceLayerId: nextReferenceLayerId,
      colorPickerPreferReferenceLayer: nextSource.kind !== 'canvas',
      project: state.project
        ? {
            ...state.project,
            referenceLayerId: nextReferenceLayerId,
            referenceSamplingSource: nextSource,
            txtShapes: state.project.txtShapes?.filter((shape) => shape.layerId !== id) ?? [],
            uiShapes: state.project.uiShapes?.filter((shape) => shape.layerId !== id) ?? [],
            updatedAt: new Date(),
          }
        : state.project,
    };
    });

    const stateAfterRemove = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterRemove, {
      actionType: 'layer-remove',
      description: 'Remove layer',
      previousSnapshot: beforeSnapshot,
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Remove layer',
      metadata: { layerId: id, operation: 'remove' },
    });
    pruneGroupVisibilitySnapshots(new Set(get().layerGroups.map((group) => group.id)));
    get().markAllCompositeSegmentsDirty();
    scheduleSlotRebuild('remove-layer');
    if (removedLayerSummary?.hasColorCycleData || removedLayerSummary?.layerType === 'color-cycle') {
      logCCMutation({
        event: 'layer-remove',
        layerId: id,
        reason: 'removeLayer',
        before: removedLayerSummary,
        after: null,
        details: {
          activeLayerIdBefore: stateBeforeRemove.activeLayerId,
          selectedLayerCountBefore: stateBeforeRemove.selectedLayerIds.length,
        },
      });
    }
  },
  removeLayers: (layerIds) => {
    const state = get();
    const validIds = layerIds.filter((layerId, index) => (
      layerId &&
      layerIds.indexOf(layerId) === index &&
      state.layers.some((layer) => layer.id === layerId)
    ));

    if (validIds.length === 0 || validIds.length >= state.layers.length) {
      return;
    }

    validIds.forEach((layerId) => {
      if (get().layers.length > 1) {
        get().removeLayer(layerId);
      }
    });
  },
  appendSequentialLayerEvent: (layerId, event, metadata) => {
    get().appendSequentialLayerEvents(layerId, [event], metadata);
  },
  appendSequentialLayerEvents: (layerId, events, metadata) => {
    if (events.length === 0) {
      return;
    }
    const appendStartMs =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    let didAppend = false;
    set((state) => {
      const result = appendSequentialLayerEventsToLayers(
        state.layers,
        layerId,
        events,
        metadata
      );
      if (!result.didAppend) {
        return state;
      }

      didAppend = true;

      return {
        layers: result.layers,
        layersNeedRecomposition: state.layersNeedRecomposition,
      };
    });
    if (!didAppend) {
      return;
    }
    get().markCompositeSegmentsDirtyByLayerIds([layerId]);
    const appendDurationMs =
      (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()) - appendStartMs;
    recordSequentialAppendPerf({
      events: events.length,
      durationMs: appendDurationMs,
    });
  },
  setLayersVisibility: (layerIds, visible) => {
    const uniqueIds = Array.from(new Set(layerIds));
    if (uniqueIds.length === 0) {
      return;
    }

    const stateBeforeChange = get();
    const targetIds = uniqueIds.filter((id) => stateBeforeChange.layers.some((layer) => layer.id === id));
    if (targetIds.length === 0) {
      return;
    }

    let didChange = false;
    set((state) => {
      const targetIdSet = new Set(targetIds);
      const nextLayers = state.layers.map((layer) => {
        if (!targetIdSet.has(layer.id) || layer.visible === visible) {
          return layer;
        }
        didChange = true;
        return { ...layer, visible };
      });

      if (!didChange) {
        return state;
      }

      return {
        layers: nextLayers,
        layersNeedRecomposition: true,
      };
    });

    if (!didChange) {
      return;
    }
    get().markAllCompositeSegmentsDirty();
  },
  toggleLayersVisibility: (layerIds) => {
    const uniqueIds = Array.from(new Set(layerIds));
    if (uniqueIds.length === 0) {
      return;
    }

    const stateBeforeChange = get();
    const targetIds = uniqueIds.filter((id) => stateBeforeChange.layers.some((layer) => layer.id === id));
    if (targetIds.length === 0) {
      return;
    }

    let didChange = false;
    set((state) => {
      const targetIdSet = new Set(targetIds);
      const nextLayers = state.layers.map((layer) => {
        if (!targetIdSet.has(layer.id)) {
          return layer;
        }
        didChange = true;
        return { ...layer, visible: !layer.visible };
      });

      if (!didChange) {
        return state;
      }

      return {
        layers: nextLayers,
        layersNeedRecomposition: true,
      };
    });

    if (!didChange) {
      return;
    }
    get().markAllCompositeSegmentsDirty();
  },
  setSelectedLayerIds: (layerIds) => set((state) => {
    const validIds = layerIds.filter((layerId, index, list) => {
      return list.indexOf(layerId) === index && state.layers.some(layer => layer.id === layerId);
    });

    return {
      selectedLayerIds: validIds
    };
  }),
  setReferenceLayer: (id) => {
    let didChange = false;
    set((state) => {
      const isValid = !id || state.layers.some((layer) => layer.id === id);
      const nextReferenceLayerId = isValid ? id ?? null : null;
      const currentSource = state.project?.referenceSamplingSource ?? { kind: 'canvas' as const };
      const nextSource = nextReferenceLayerId
        ? { kind: 'layer' as const, layerId: nextReferenceLayerId }
        : currentSource.kind === 'layer'
          ? { kind: 'canvas' as const }
          : currentSource;
      didChange =
        state.referenceLayerId !== nextReferenceLayerId
        || JSON.stringify(currentSource) !== JSON.stringify(nextSource);
      if (!didChange) return state;
      return {
        referenceLayerId: nextReferenceLayerId,
        colorPickerPreferReferenceLayer: nextSource.kind !== 'canvas',
        project: state.project
          ? {
              ...state.project,
              referenceLayerId: nextReferenceLayerId,
              referenceSamplingSource: nextSource,
              updatedAt: new Date(),
            }
          : state.project,
      };
    });
    if (didChange) get().markAutosaveDirty('project-change');
  },
});
