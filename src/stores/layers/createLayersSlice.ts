import type { StateCreator } from 'zustand';

import type { AppState } from '@/stores/useAppStore';
import { createDeferredColorCycleRuntimeRestoreScheduler } from '@/stores/layers/deferredColorCycleRuntimeRestore';
import {
  createLayerGroupFromSelectionAction,
  moveLayersToGroupAction,
  removeLayerGroupAction,
  renameLayerGroupAction,
  setLayerGroupVisibilityAction,
  type LayerGroupActionDeps,
} from '@/stores/layers/layerGroupActions';
import { type CompositeMode } from '@/stores/layers/layerCanvasCapture';
import {
  captureCanvasToActiveLayerAction,
  captureCanvasToLayerAction,
  type LayerCaptureActionDeps,
} from '@/stores/layers/layerCaptureActions';
import {
  createLayerActivationActions,
  recordLayerActivationProbe,
  recordLayerActivationRestoreFailure,
  summarizeLayerForActivationDebug,
} from '@/stores/layers/layerActivationActions';
import { createLayerCollectionActions } from '@/stores/layers/layerCollectionActions';
import { createLayerColorCycleEditActions } from '@/stores/layers/layerColorCycleEditActions';
import { createLayerColorCycleLifecycleActions } from '@/stores/layers/layerColorCycleLifecycleActions';
import { createLayerColorCycleSlotActions } from '@/stores/layers/layerColorCycleSlotActions';
import { buildCanonicalBrushStateFromSnapshot } from '@/stores/layers/layerColorCycleSnapshotState';
import { createLayerCompositeActions } from '@/stores/layers/layerCompositeActions';
import { createLayerDuplicateActions } from '@/stores/layers/layerDuplicateActions';
import {
  mergeLayersAction,
  type LayerMergeActionDeps,
} from '@/stores/layers/layerMergeAction';
import { createLayerOrderingActions } from '@/stores/layers/layerOrderingActions';
import { createLayerUpdateActions } from '@/stores/layers/layerUpdateActions';
import type {
  LayersSlice,
  LayersSliceOptions,
} from '@/stores/layers/layersSliceTypes';

export type {
  CompositeLayersToCanvasOptions,
  CompositeSegment,
  LayersSlice,
  LayersSliceOptions,
  MarkCompositeSegmentsDirtyOptions,
  RenderStaticCompositeOptions,
  SetActiveLayerOptions,
  UpdateLayerOptions,
} from '@/stores/layers/layersSliceTypes';

export const createLayersSlice = (
  options: LayersSliceOptions,
): StateCreator<AppState, [], [], LayersSlice> =>
  (set, get) => {
    const {
      syncPercentOffsetsFromPixels,
      trackLayerChanges,
      colorCycleBrushManager,
      captureLayerStructureSnapshot,
      commitLayerStructureHistory,
      getVesselWindow,
    } = options;

    const scheduleDeferredColorCycleRestore = createDeferredColorCycleRuntimeRestoreScheduler({
      getState: get,
      setState: set,
      colorCycleBrushManager,
      summarizeLayer: summarizeLayerForActivationDebug,
      recordRestoreComplete: (details) => {
        recordLayerActivationProbe('deferred-restore-complete', details);
      },
      recordRestoreFailure: recordLayerActivationRestoreFailure,
    });
    const layerActivationActions = createLayerActivationActions({
      set,
      get,
      colorCycleBrushManager,
      scheduleDeferredColorCycleRestore,
    });
    const layerColorCycleLifecycleActions = createLayerColorCycleLifecycleActions({
      set,
      get,
      colorCycleBrushManager,
      syncPercentOffsetsFromPixels,
      trackLayerChanges,
      scheduleDeferredColorCycleRestore,
    });
    const layerColorCycleSlotActions = createLayerColorCycleSlotActions({
      set,
      get,
      syncPercentOffsetsFromPixels,
    });

    const groupVisibilitySnapshotByGroupId = new Map<string, Map<string, boolean>>();
    const pruneGroupVisibilitySnapshots = (validGroupIds: Set<string>) => {
      groupVisibilitySnapshotByGroupId.forEach((_, existingGroupId) => {
        if (!validGroupIds.has(existingGroupId)) {
          groupVisibilitySnapshotByGroupId.delete(existingGroupId);
        }
      });
    };
    const layerGroupActionDeps: LayerGroupActionDeps = {
      set,
      get,
      captureLayerStructureSnapshot,
      commitLayerStructureHistory,
      getGroupVisibilitySnapshot: (groupId) => groupVisibilitySnapshotByGroupId.get(groupId),
      setGroupVisibilitySnapshot: (groupId, snapshot) => {
        groupVisibilitySnapshotByGroupId.set(groupId, snapshot);
      },
      pruneGroupVisibilitySnapshots,
    };
    const createLayerTransferCanvas = (width: number, height: number) => {
      if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(width, height);
      }
      if (typeof document === 'undefined') {
        return null;
      }
      const layerCanvas = document.createElement('canvas');
      layerCanvas.width = width;
      layerCanvas.height = height;
      return layerCanvas;
    };

    const hasValidFramebuffer = (
      framebuffer: HTMLCanvasElement | OffscreenCanvas | null | undefined,
    ): framebuffer is HTMLCanvasElement | OffscreenCanvas =>
      Boolean(
        framebuffer &&
          Number.isFinite(framebuffer.width) &&
          framebuffer.width > 0 &&
          Number.isFinite(framebuffer.height) &&
          framebuffer.height > 0,
      );
    const layerCaptureActionDeps: LayerCaptureActionDeps = {
      set,
      get,
      syncPercentOffsetsFromPixels,
      createLayerTransferCanvas,
      hasValidFramebuffer,
    };
    const layerMergeActionDeps: LayerMergeActionDeps = {
      set,
      get,
      colorCycleBrushManager,
      captureLayerStructureSnapshot,
      commitLayerStructureHistory,
      createLayerTransferCanvas,
      hasValidFramebuffer,
      syncPercentOffsetsFromPixels,
      buildCanonicalBrushStateFromSnapshot,
      pruneGroupVisibilitySnapshots,
      scheduleSlotRebuild: layerColorCycleSlotActions.scheduleColorCycleSlotRebuild,
    };
    const layerCompositeActions = createLayerCompositeActions({
      set,
      get,
      colorCycleBrushManager,
      createLayerTransferCanvas,
      hasValidFramebuffer,
    });
    const layerDuplicateActions = createLayerDuplicateActions({
      set,
      get,
      colorCycleBrushManager,
      captureLayerStructureSnapshot,
      commitLayerStructureHistory,
      syncPercentOffsetsFromPixels,
      trackLayerChanges,
    });
    const layerOrderingActions = createLayerOrderingActions({
      set,
      get,
      syncPercentOffsetsFromPixels,
      captureLayerStructureSnapshot,
      commitLayerStructureHistory,
    });
    const layerUpdateActions = createLayerUpdateActions({
      set,
      get,
      syncPercentOffsetsFromPixels,
      trackLayerChanges,
      getVesselWindow,
    });
    const layerCollectionActions = createLayerCollectionActions({
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
      scheduleSlotRebuild: layerColorCycleSlotActions.scheduleColorCycleSlotRebuild,
    });
    const layerColorCycleEditActions = createLayerColorCycleEditActions({
      set,
      get,
      colorCycleBrushManager,
      captureLayerStructureSnapshot,
      commitLayerStructureHistory,
      createLayerTransferCanvas,
      hasValidFramebuffer,
      scheduleSlotRebuild: layerColorCycleSlotActions.scheduleColorCycleSlotRebuild,
    });

    return {
      layers: [],
      layerGroups: [],
      hiddenLayerGroupIds: [],
      layersNeedRecomposition: false,
      staticCompositeVersion: 0,
      compositeSegmentsVersion: 0,
      compositeSegments: [],
      pendingCompositeDirtyBatches: [],
      currentOffscreenCanvas: null,
      currentCompositeBitmap: null,
      ...layerCompositeActions,
      ...layerCollectionActions,
      activeLayerId: null,
      selectedLayerIds: [],
      warmingColorCycleLayerIds: [],
      referenceLayerId: null,
      currentLayer: 0,
      ...layerDuplicateActions,
      ...layerUpdateActions,
      ...layerColorCycleSlotActions,
      createLayerGroupFromSelection: (layerIds) =>
        createLayerGroupFromSelectionAction(layerIds, layerGroupActionDeps),
      moveLayersToGroup: (layerIds, groupId, destinationIndex) => {
        moveLayersToGroupAction(layerIds, groupId, destinationIndex, layerGroupActionDeps);
      },
      removeLayerGroup: (groupId) => {
        removeLayerGroupAction(groupId, layerGroupActionDeps);
      },
      renameLayerGroup: (groupId, name) => {
        renameLayerGroupAction(groupId, name, layerGroupActionDeps);
      },
      setLayerGroupVisibility: (groupId, visible) => {
        setLayerGroupVisibilityAction(groupId, visible, layerGroupActionDeps);
      },
      mergeLayers: (layerIds) => mergeLayersAction(layerIds, layerMergeActionDeps),
      ...layerActivationActions,
      ...layerOrderingActions,
      ...layerColorCycleLifecycleActions,
      captureCanvasToActiveLayer: async (sourceCanvas, roi, options?: { mode?: CompositeMode }) => {
        await captureCanvasToActiveLayerAction(sourceCanvas, roi, options, layerCaptureActionDeps);
      },
      captureCanvasToLayer: async (sourceCanvas, targetLayerId) => {
        await captureCanvasToLayerAction(sourceCanvas, targetLayerId, layerCaptureActionDeps);
      },
      ...layerColorCycleEditActions,
    };
  };
