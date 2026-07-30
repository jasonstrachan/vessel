import type { StateCreator } from 'zustand';

import { requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import type { LayerStructureSnapshot } from '@/history/deltas/layerStructureDelta';
import {
  applyColorCycleBrushLayerSnapshotToRuntime,
  cloneColorCycleBrushLayerSnapshot,
  createColorCycleBrushPersistenceLayerMetaFromLayerData,
  readColorCycleBrushLayerSnapshotFromRuntime,
  setColorCycleBrushPersistenceLayerMeta,
  type ColorCycleBrushLayerSnapshot,
  type ColorCycleBrushLayerSnapshotRuntimeReader,
  type ColorCycleBrushLayerSnapshotRuntimeWriter,
} from '@/lib/colorCycle/document';
import {
  clearSequentialLayerRendererLayer,
  getSequentialLayerRenderCanvas,
} from '@/lib/sequential/SequentialLayerRenderer';
import { syncPlaybackColorCycleLayers } from '@/stores/ccRuntime';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type {
  CommitLayerStructureHistoryOptions,
  LayerHistorySnapshotOptions,
} from '@/stores/helpers/layerStructureHistory';
import {
  mergeColorCycleLayerPayloads,
  type ColorCycleLayerMergeSource,
} from '@/stores/layers/colorCycleLayerTransforms';
import {
  sanitizeHiddenLayerGroupIds,
  sanitizeLayerGroups,
} from '@/stores/layers/layerGroupService';
import type { AppState } from '@/stores/useAppStore';
import type { Layer, Project } from '@/types';
import { cloneLayerAlignment } from '@/utils/layoutDefaults';
import { logError } from '@/utils/debug';

type StoreSet = Parameters<StateCreator<AppState, [], [], AppState>>[0];
type StoreGet = Parameters<StateCreator<AppState, [], [], AppState>>[1];

type ColorCycleSnapshotBrush = ColorCycleBrushLayerSnapshotRuntimeReader
  & ColorCycleBrushLayerSnapshotRuntimeWriter
  & {
    getCanvas?: () => HTMLCanvasElement | null;
    setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
    updateColorCycleTexture?: () => void;
    renderDirectToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void;
  };

type LegacyColorCycleBrushField = NonNullable<
  NonNullable<Layer['colorCycleData']>['colorCycleBrush']
>;

export interface LayerMergeActionDeps {
  set: StoreSet;
  get: StoreGet;
  colorCycleBrushManager: ColorCycleBrushManager;
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
  syncPercentOffsetsFromPixels: (layers: Layer[], project: Project | null) => Layer[];
  buildCanonicalBrushStateFromSnapshot: (
    layer: Layer,
    layerId: string,
    snapshot: ColorCycleBrushLayerSnapshot,
    existingBrushState: unknown,
  ) => unknown;
  pruneGroupVisibilitySnapshots: (validGroupIds: Set<string>) => void;
  scheduleSlotRebuild: (reason: string) => void;
}

export const mergeLayersAction = (
  layerIds: string[],
  deps: LayerMergeActionDeps,
): string | null => {
  const {
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
    scheduleSlotRebuild,
  } = deps;
  const stateBeforeMerge = get();
  const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeMerge, {
    actionType: 'layer-merge',
    description: 'Merge layers',
  });

  let mergedLayerId: string | null = null;
  let mergedColorCycleSnapshot: ColorCycleBrushLayerSnapshot | null = null;

  set((state) => {
    if (!state.project) {
      return state;
    }

    const uniqueIds = Array.from(new Set(layerIds));
    const layersToMerge = state.layers.filter((layer) => uniqueIds.includes(layer.id));

    if (layersToMerge.length < 2) {
      return state;
    }

    const sortedByOrder = [...layersToMerge].sort((a, b) => a.order - b.order);
    const shouldMergeColorCycle = sortedByOrder.every(
      (layer) => layer.layerType === 'color-cycle' && Boolean(layer.colorCycleData),
    );
    const sourceGroupIds = Array.from(
      new Set(
        layersToMerge
          .map((layer) => layer.groupId)
          .filter(
            (groupId): groupId is string =>
              typeof groupId === 'string' && groupId.length > 0,
          ),
      ),
    );
    const mergedGroupId = sourceGroupIds.length === 1 ? sourceGroupIds[0] : undefined;
    const sequentialFrameIndex = state.sequentialRecord.currentFrame;
    const anchorOrder = (() => {
      const anchorId = uniqueIds[0];
      const anchorLayer = state.layers.find((layer) => layer.id === anchorId);
      return anchorLayer?.order ?? sortedByOrder[0]?.order ?? 0;
    })();
    const projectWidth = state.project.width || 1;
    const projectHeight = state.project.height || 1;
    const mergeCanvas = createLayerTransferCanvas(projectWidth, projectHeight);
    if (!mergeCanvas) {
      return state;
    }

    const ctx = mergeCanvas.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings,
    ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

    if (!ctx) {
      return state;
    }

    ctx.clearRect(0, 0, projectWidth, projectHeight);

    const ensureCanvasFromImageData = (imageData: ImageData | null | undefined) => {
      if (!imageData) {
        return null;
      }
      const tempCanvas = createLayerTransferCanvas(imageData.width, imageData.height);
      if (!tempCanvas) {
        return null;
      }
      const tempCtx = tempCanvas.getContext(
        '2d',
        { willReadFrequently: true } as CanvasRenderingContext2DSettings,
      ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      tempCtx?.putImageData(imageData, 0, 0);
      return tempCanvas;
    };

    const readCanvasImageData = (
      canvas: HTMLCanvasElement | OffscreenCanvas | null,
    ): ImageData | null => {
      if (!canvas) {
        return null;
      }
      try {
        const canvasContext = canvas.getContext(
          '2d',
          { willReadFrequently: true } as CanvasRenderingContext2DSettings,
        ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        return canvasContext?.getImageData(0, 0, canvas.width, canvas.height) ?? null;
      } catch {
        return null;
      }
    };

    const colorCycleMergeSources: ColorCycleLayerMergeSource[] = [];

    const drawLayerOntoMergeCanvas = (layer: Layer) => {
      ctx.globalCompositeOperation = layer.blendMode;
      ctx.globalAlpha = layer.opacity ?? 1;

      if (layer.layerType === 'color-cycle') {
        const brush = colorCycleBrushManager.getSurfaceBrush(layer.id);
        const sourceCanvas =
          (layer.colorCycleData?.canvas as HTMLCanvasElement | OffscreenCanvas | undefined) ??
          (hasValidFramebuffer(layer.framebuffer) ? layer.framebuffer : null);
        let hasFreshColorCycleRender = false;

        if (brush && sourceCanvas && typeof brush.renderDirectToCanvas === 'function') {
          try {
            brush.renderDirectToCanvas(sourceCanvas as HTMLCanvasElement, layer.id);
            hasFreshColorCycleRender = true;
          } catch (error) {
            logError('[mergeLayers] Failed to render CC layer before merge', error);
          }
        }

        const ccCanvas =
          sourceCanvas ??
          ensureCanvasFromImageData(layer.colorCycleData?.canvasImageData) ??
          ensureCanvasFromImageData(layer.imageData);

        if (shouldMergeColorCycle && hasFreshColorCycleRender) {
          const runtimeSnapshot = cloneColorCycleBrushLayerSnapshot(
            readColorCycleBrushLayerSnapshotFromRuntime(
              colorCycleBrushManager.getSerializedStateBrush(layer.id),
              layer.id,
            ),
          );
          const runtimeSnapshotMatchesProject =
            runtimeSnapshot?.paintBuffer.byteLength === projectWidth * projectHeight;
          const canvasImageData = readCanvasImageData(ccCanvas);
          const renderedImageData =
            canvasImageData?.width === projectWidth && canvasImageData.height === projectHeight
              ? canvasImageData
              : null;
          if (runtimeSnapshotMatchesProject && runtimeSnapshot && renderedImageData) {
            colorCycleMergeSources.push({
              layer,
              snapshot: runtimeSnapshot,
              renderedImageData,
            });
          }
        }

        if (ccCanvas) {
          try {
            ctx.drawImage(
              ccCanvas as CanvasImageSource,
              0,
              0,
              projectWidth,
              projectHeight,
            );
          } catch (error) {
            logError('[mergeLayers] Failed to draw CC layer', error);
          }
        }
        return;
      }

      if (layer.layerType === 'sequential' && layer.sequentialData) {
        const sequentialCanvas = getSequentialLayerRenderCanvas({
          layer,
          width: projectWidth,
          height: projectHeight,
          frameIndex: sequentialFrameIndex,
        });
        if (sequentialCanvas) {
          try {
            ctx.drawImage(
              sequentialCanvas as CanvasImageSource,
              0,
              0,
              projectWidth,
              projectHeight,
            );
          } catch (error) {
            logError('[mergeLayers] Failed to draw sequential layer', error);
          }
        }
        return;
      }

      const sourceCanvas =
        ensureCanvasFromImageData(layer.imageData) ||
        (hasValidFramebuffer(layer.framebuffer) ? layer.framebuffer : null);

      if (sourceCanvas) {
        try {
          ctx.drawImage(
            sourceCanvas as CanvasImageSource,
            0,
            0,
            projectWidth,
            projectHeight,
          );
        } catch (error) {
          logError('[mergeLayers] Failed to draw normal layer', error);
        }
      }
    };

    sortedByOrder.forEach(drawLayerOntoMergeCanvas);

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    let mergedImageData: ImageData | null = null;
    try {
      mergedImageData = ctx.getImageData(0, 0, projectWidth, projectHeight);
    } catch (error) {
      logError('[mergeLayers] Failed to read merged imageData', error);
    }

    const topLayer = sortedByOrder[sortedByOrder.length - 1];
    const mergedName =
      sortedByOrder.length === 2
        ? `${sortedByOrder[1].name} + ${sortedByOrder[0].name}`
        : `Merged ${sortedByOrder.length} layers`;
    const candidateMergedLayerId = `layer-${Date.now()}-${Math.random()}`;
    const colorCycleMergeResult = shouldMergeColorCycle
      ? mergeColorCycleLayerPayloads({
          sources: colorCycleMergeSources,
          targetLayerId: candidateMergedLayerId,
          width: projectWidth,
          height: projectHeight,
        })
      : null;

    if (shouldMergeColorCycle && !colorCycleMergeResult) {
      logError('[mergeLayers] Color-cycle payload merge preflight failed');
      return state;
    }

    mergedLayerId = colorCycleMergeResult?.layer.id ?? candidateMergedLayerId;
    let mergedLayer: Layer = {
      id: mergedLayerId,
      name: mergedName,
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: mergedImageData,
      framebuffer: mergeCanvas,
      alignment: cloneLayerAlignment(topLayer.alignment),
      groupId: mergedGroupId,
      layerType: 'normal',
      version: (topLayer.version ?? 0) + 1,
    };

    if (colorCycleMergeResult) {
      const targetLayer = colorCycleMergeResult.layer;
      let targetBrush = colorCycleBrushManager.getHistoryBrush(
        mergedLayerId,
      ) as ColorCycleSnapshotBrush | null;
      if (!targetBrush) {
        colorCycleBrushManager.initColorCycleForLayer(
          mergedLayerId,
          projectWidth,
          projectHeight,
        );
        targetBrush = colorCycleBrushManager.getHistoryBrush(
          mergedLayerId,
        ) as ColorCycleSnapshotBrush | null;
      }
      const targetCanvas = targetBrush?.getCanvas?.() ?? null;
      const targetRuntimeMeta = createColorCycleBrushPersistenceLayerMetaFromLayerData(
        targetLayer.colorCycleData,
      );
      if (
        !targetBrush ||
        !targetCanvas ||
        !targetRuntimeMeta ||
        !targetBrush.renderDirectToCanvas
      ) {
        colorCycleBrushManager.removeColorCycleBrush(mergedLayerId);
        mergedLayerId = null;
        logError('[mergeLayers] Failed to initialize merged color-cycle runtime');
        return state;
      }

      setColorCycleBrushPersistenceLayerMeta(targetBrush, mergedLayerId, targetRuntimeMeta);
      try {
        const applied = applyColorCycleBrushLayerSnapshotToRuntime(
          targetBrush,
          mergedLayerId,
          colorCycleMergeResult.snapshot,
          undefined,
          'merge-color-cycle-layers',
        );
        if (!applied) {
          throw new Error('Merged color-cycle snapshot runtime is unavailable');
        }
        targetBrush.setTargetCanvas?.(targetCanvas);
        targetBrush.updateColorCycleTexture?.();
        targetBrush.renderDirectToCanvas(targetCanvas, mergedLayerId);
      } catch (error) {
        colorCycleBrushManager.removeColorCycleBrush(mergedLayerId);
        mergedLayerId = null;
        logError('[mergeLayers] Failed to publish merged color-cycle payload', error);
        return state;
      }

      const mergedColorCycleData: NonNullable<Layer['colorCycleData']> = {
        ...(targetLayer.colorCycleData ?? {}),
        canvas: targetCanvas,
        canvasImageData: mergedImageData ?? targetLayer.colorCycleData?.canvasImageData,
        colorCycleBrush: targetBrush as LegacyColorCycleBrushField,
        hasContent: colorCycleMergeResult.snapshot.hasContent,
      };
      const layerWithMergedMetadata: Layer = {
        ...targetLayer,
        colorCycleData: mergedColorCycleData,
      };
      mergedColorCycleData.brushState = buildCanonicalBrushStateFromSnapshot(
        layerWithMergedMetadata,
        mergedLayerId,
        colorCycleMergeResult.snapshot,
        targetLayer.colorCycleData?.brushState,
      ) as NonNullable<Layer['colorCycleData']>['brushState'];
      mergedLayer = {
        ...layerWithMergedMetadata,
        name: mergedName,
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        locked: false,
        transparencyLocked: false,
        order: 0,
        imageData: mergedImageData,
        framebuffer: targetCanvas,
        alignment: cloneLayerAlignment(topLayer.alignment),
        groupId: mergedGroupId,
        layerType: 'color-cycle',
        version: (topLayer.version ?? 0) + 1,
      };
      mergedColorCycleSnapshot = colorCycleMergeResult.snapshot;
    }

    const remainingLayers = state.layers.filter((layer) => !uniqueIds.includes(layer.id));
    const insertionIndex = (() => {
      const index = remainingLayers.findIndex((layer) => layer.order >= anchorOrder);
      return index === -1 ? remainingLayers.length : index;
    })();
    remainingLayers.splice(insertionIndex, 0, mergedLayer);

    const normalizedLayers = remainingLayers.map((layer, index) => ({
      ...layer,
      order: index,
    }));
    const syncedLayers = syncPercentOffsetsFromPixels(
      normalizedLayers,
      state.project ?? null,
    );
    const nextLayerGroups = sanitizeLayerGroups(syncedLayers, state.layerGroups);
    const nextHiddenLayerGroupIds = sanitizeHiddenLayerGroupIds(
      state.hiddenLayerGroupIds,
      nextLayerGroups,
    );

    const nextReferenceLayerId =
      state.referenceLayerId && uniqueIds.includes(state.referenceLayerId)
        ? null
        : state.referenceLayerId;

    return {
      layers: syncedLayers,
      layerGroups: nextLayerGroups,
      hiddenLayerGroupIds: nextHiddenLayerGroupIds,
      activeLayerId: mergedLayerId,
      selectedLayerIds: [mergedLayerId],
      referenceLayerId: nextReferenceLayerId,
      layersNeedRecomposition: true,
    };
  });

  if (!mergedLayerId) {
    return null;
  }

  for (const sourceLayerId of layerIds) {
    clearSequentialLayerRendererLayer(sourceLayerId);
    if (sourceLayerId !== mergedLayerId) {
      colorCycleBrushManager.removeColorCycleBrush(sourceLayerId);
    }
  }

  if (mergedColorCycleSnapshot) {
    const mergedLayer = get().layers.find((layer) => layer.id === mergedLayerId);
    if (mergedLayer?.layerType === 'color-cycle') {
      syncPlaybackColorCycleLayers([mergedLayer], 'merge-color-cycle-layers');
      requestGradientApply(mergedLayer.id, 'merge-color-cycle-layers');
    }
  }

  const stateAfterMerge = get();
  const afterSnapshot = captureLayerStructureSnapshot(stateAfterMerge, {
    actionType: 'layer-merge',
    description: 'Merge layers',
    activeLayerId: mergedLayerId,
    previousSnapshot: beforeSnapshot,
  });

  commitLayerStructureHistory({
    set,
    beforeSnapshot,
    afterSnapshot,
    label: 'Merge layers',
    metadata: { sourceLayerIds: layerIds, mergedLayerId },
  });
  pruneGroupVisibilitySnapshots(new Set(get().layerGroups.map((group) => group.id)));
  get().markAllCompositeSegmentsDirty();
  scheduleSlotRebuild('merge-layers');

  return mergedLayerId;
};
