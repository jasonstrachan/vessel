import type { StateCreator } from 'zustand';

import {
  applyColorCycleBrushLayerSnapshotToRuntime,
  cloneColorCycleBrushLayerSnapshot,
  cloneColorCycleBrushStateForLayerDuplicate,
  readColorCycleBrushLayerSnapshotFromRuntime,
  type ColorCycleBrushLayerSnapshotRuntimeReader,
  type ColorCycleBrushLayerSnapshotRuntimeWriter,
} from '@/lib/colorCycle/document';
import { cloneAdjustmentLayerData } from '@/lib/adjustmentLayers';
import type { LayerStructureSnapshot } from '@/history/deltas/layerStructureDelta';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type {
  CommitLayerStructureHistoryOptions,
  LayerHistorySnapshotOptions,
} from '@/stores/helpers/layerStructureHistory';
import {
  cloneCanvasLike,
  cloneImageData,
  createCanvas,
} from '@/stores/layers/layerCloneService';
import {
  DEFAULT_CC_GRADIENT,
  cloneColorCycleData,
  resolveActiveGradientStops,
  gradientStopsToUint8Array,
} from '@/stores/layers/layerColorCycleState';
import { buildCanonicalBrushStateFromSnapshot } from '@/stores/layers/layerColorCycleSnapshotState';
import {
  generateDuplicateLayerName,
  insertLayerAtIndex,
  normalizeLayerOrder,
} from '@/stores/layers/layerCrudService';
import type { LayersSlice } from '@/stores/layers/layersSliceTypes';
import type { AppState } from '@/stores/useAppStore';
import type { Layer, Project } from '@/types';
import { logError, recordBreadcrumb } from '@/utils/debug';
import { cloneLayerAlignment } from '@/utils/layoutDefaults';

type StoreSet = Parameters<StateCreator<AppState, [], [], AppState>>[0];
type StoreGet = Parameters<StateCreator<AppState, [], [], AppState>>[1];

type ColorCycleSnapshotBrush = ColorCycleBrushLayerSnapshotRuntimeReader
  & ColorCycleBrushLayerSnapshotRuntimeWriter
  & {
    getCanvas?: () => HTMLCanvasElement | null;
    setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
    updateColorCycleTexture?: () => void;
    renderDirectToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void;
    render?: (forceFullOpacity?: boolean) => void;
  };

type LegacyColorCycleBrushField = NonNullable<
  NonNullable<Layer['colorCycleData']>['colorCycleBrush']
>;

type LayerDuplicateActions = Pick<LayersSlice, 'duplicateLayer' | 'duplicateLayers'>;

export interface LayerDuplicateActionDeps {
  set: StoreSet;
  get: StoreGet;
  colorCycleBrushManager: ColorCycleBrushManager;
  captureLayerStructureSnapshot: (
    state: AppState,
    options: LayerHistorySnapshotOptions,
  ) => LayerStructureSnapshot;
  commitLayerStructureHistory: (options: CommitLayerStructureHistoryOptions) => void;
  syncPercentOffsetsFromPixels: (layers: Layer[], project: Project | null) => Layer[];
  trackLayerChanges: (...args: unknown[]) => void;
}

export const createLayerDuplicateActions = ({
  set,
  get,
  colorCycleBrushManager,
  captureLayerStructureSnapshot,
  commitLayerStructureHistory,
  syncPercentOffsetsFromPixels,
  trackLayerChanges,
}: LayerDuplicateActionDeps): LayerDuplicateActions => ({
  duplicateLayer: (layerId) => {
    const stateBeforeDuplicate = get();
    const targetLayer = stateBeforeDuplicate.layers.find((layer) => layer.id === layerId);
    if (!targetLayer) {
      return null;
    }

    recordBreadcrumb('layers', { event: 'store-duplicateLayer-enter', sourceLayerId: layerId });

    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeDuplicate, {
      actionType: 'layer-duplicate',
      description: 'Duplicate layer',
    });

    const newLayerId = `layer-${Date.now()}-${Math.random()}`;
    const inheritsColorCycleType = targetLayer.layerType === 'color-cycle';
    const hasCanvasBackedCC = inheritsColorCycleType && Boolean(targetLayer.colorCycleData?.canvas);
    const treatAsColorCycle = inheritsColorCycleType || Boolean(targetLayer.colorCycleData?.canvas);
    const duplicateName = generateDuplicateLayerName(targetLayer.name, stateBeforeDuplicate.layers);
    const shouldClonePixels = !hasCanvasBackedCC;
    const clonedImageData = shouldClonePixels ? cloneImageData(targetLayer.imageData) : null;
    const clonedFramebuffer = shouldClonePixels
      ? cloneCanvasLike(targetLayer.framebuffer, clonedImageData)
      : (targetLayer.framebuffer
          ? createCanvas(targetLayer.framebuffer.width, targetLayer.framebuffer.height, { forceDom: true })
          : createCanvas(1, 1, { forceDom: true })) || targetLayer.framebuffer;
    const duplicateColorCycleData = treatAsColorCycle
      ? cloneColorCycleData(targetLayer.colorCycleData, { stripSurfaces: false })
      : undefined;
    if (duplicateColorCycleData && targetLayer.colorCycleData?.brushState) {
      duplicateColorCycleData.brushState = cloneColorCycleBrushStateForLayerDuplicate(
        targetLayer.colorCycleData.brushState,
        layerId,
        newLayerId
      ) as NonNullable<Layer['colorCycleData']>['brushState'];
    }
    const sourceColorCycleBrush = targetLayer.layerType === 'color-cycle'
      ? colorCycleBrushManager.getSerializedStateBrush(layerId)
      : null;
    const sourceColorCycleSnapshot = cloneColorCycleBrushLayerSnapshot(
      readColorCycleBrushLayerSnapshotFromRuntime(sourceColorCycleBrush, layerId)
    );

    // Debug logging removed after verification

    set((state) => {
      const insertionIndex = state.layers.findIndex((layer) => layer.id === layerId);
      const targetIndex = insertionIndex >= 0 ? insertionIndex + 1 : state.layers.length;

      const newLayer: Layer = {
        ...targetLayer,
        id: newLayerId,
        name: duplicateName,
        imageData: clonedImageData,
        framebuffer: clonedFramebuffer || targetLayer.framebuffer,
        alignment: cloneLayerAlignment(targetLayer.alignment),
        colorCycleData: duplicateColorCycleData,
        adjustmentData: cloneAdjustmentLayerData(targetLayer.adjustmentData),
        layerType: treatAsColorCycle ? 'color-cycle' : targetLayer.layerType,
        order: 0,
        transparencyLocked: targetLayer.transparencyLocked === true,
        version: targetLayer.version,
      };

      const updatedLayers = insertLayerAtIndex(state.layers, newLayer, targetIndex);
      const normalizedLayers = normalizeLayerOrder(updatedLayers);
      trackLayerChanges('duplicateLayer RETURN', normalizedLayers);
      const syncedLayers = syncPercentOffsetsFromPixels(normalizedLayers, state.project ?? null);
      const duplicatedAt = Date.now();
      const duplicatedTxtShapes = state.project?.txtShapes
        ?.filter((shape) => shape.layerId === layerId)
        .map((shape, index) => ({
          ...shape,
          colorRanges: shape.colorRanges?.map((range) => ({ ...range })),
          id: `txt-${duplicatedAt}-${index}-${Math.random()}`,
          layerId: newLayerId,
          regionPath: shape.regionPath?.map((point) => ({ ...point })),
          selections: shape.selections.map((selection) => ({ ...selection })),
          selectionTreatments: shape.selectionTreatments?.map((range) => ({ ...range })),
          createdAt: duplicatedAt,
          updatedAt: duplicatedAt,
        })) ?? [];
      const duplicatedUiShapes = state.project?.uiShapes
        ?.filter((shape) => shape.layerId === layerId)
        .map((shape, index) => ({
          ...shape,
          id: `ui-shape-${duplicatedAt}-${index}-${Math.random()}`,
          layerId: newLayerId,
          palette: { ...shape.palette },
          regionPath: shape.regionPath?.map((point) => ({ ...point })),
          componentKinds: [...shape.componentKinds],
          components: shape.components.map((component, componentIndex) => ({
            ...component,
            id: `ui-component-${duplicatedAt}-${componentIndex}-${Math.random()}`,
            canonicalState: { ...component.canonicalState },
            animation: component.animation ? { ...component.animation } : undefined,
          })),
          createdAt: duplicatedAt,
          updatedAt: duplicatedAt,
        })) ?? [];

      return {
        layers: syncedLayers,
        activeLayerId: newLayerId,
        selectedLayerIds: [newLayerId],
        project: state.project
          ? {
              ...state.project,
              txtShapes: [...(state.project.txtShapes ?? []), ...duplicatedTxtShapes],
              uiShapes: [...(state.project.uiShapes ?? []), ...duplicatedUiShapes],
              updatedAt: new Date(),
            }
          : state.project,
      };
    });

    const project = stateBeforeDuplicate.project;
    const stateAfterInsert = get();
    const duplicatedLayer = stateAfterInsert.layers.find((layer) => layer.id === newLayerId);

    if (targetLayer.layerType === 'color-cycle') {
      const adoptedCanvas = duplicatedLayer?.colorCycleData?.canvas as HTMLCanvasElement | undefined;
      if (adoptedCanvas) {
        try {
          const width = adoptedCanvas.width || project?.width || 1024;
          const height = adoptedCanvas.height || project?.height || 1024;
          const gradientStops =
            resolveActiveGradientStops(duplicatedLayer?.colorCycleData) ?? DEFAULT_CC_GRADIENT;
          const gradientArray = gradientStopsToUint8Array(gradientStops);
          colorCycleBrushManager.createBrush(
            newLayerId,
            width,
            height,
            gradientArray
          );
          const brush = colorCycleBrushManager.getHistoryBrush(newLayerId) as ColorCycleSnapshotBrush | null;
          brush?.setTargetCanvas?.(adoptedCanvas);
          if (brush && sourceColorCycleSnapshot) {
            applyColorCycleBrushLayerSnapshotToRuntime(brush, newLayerId, sourceColorCycleSnapshot);
            brush.updateColorCycleTexture?.();
            brush.renderDirectToCanvas?.(adoptedCanvas, newLayerId);
            brush.render?.(false);
            const ctx = adoptedCanvas.getContext(
              '2d',
              { willReadFrequently: true } as CanvasRenderingContext2DSettings
            );
            const renderedImageData = ctx?.getImageData(0, 0, adoptedCanvas.width, adoptedCanvas.height);
            set((state) => ({
              layers: state.layers.map((layer) => {
                if (layer.id !== newLayerId || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
                  return layer;
                }
                return {
                  ...layer,
                  imageData: renderedImageData ?? layer.imageData,
                  colorCycleData: {
                    ...layer.colorCycleData,
                    canvas: adoptedCanvas,
                    canvasImageData: renderedImageData ?? layer.colorCycleData.canvasImageData,
                    colorCycleBrush: brush as LegacyColorCycleBrushField,
                    brushState: buildCanonicalBrushStateFromSnapshot(
                      layer,
                      newLayerId,
                      sourceColorCycleSnapshot,
                      layer.colorCycleData.brushState
                    ) as NonNullable<Layer['colorCycleData']>['brushState'],
                    hasContent: sourceColorCycleSnapshot.hasContent,
                  },
                };
              }),
            }));
          }
        } catch (error) {
          logError('duplicateLayer: failed to adopt CC canvas, falling back to init', error);
          colorCycleBrushManager.initColorCycleForLayer(
            newLayerId,
            project?.width || adoptedCanvas.width || 1024,
            project?.height || adoptedCanvas.height || 1024,
            undefined
          );
        }
      } else {
        try {
          colorCycleBrushManager.initColorCycleForLayer(
            newLayerId,
            project?.width || 1024,
            project?.height || 1024,
            undefined
          );
        } catch (error) {
          logError('duplicateLayer: failed to init color cycle layer', error);
        }
      }
    }

    const stateAfterDuplicate = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterDuplicate, {
      actionType: 'layer-duplicate',
      description: 'Duplicate layer',
      activeLayerId: newLayerId,
      previousSnapshot: beforeSnapshot,
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Duplicate layer',
      metadata: { sourceLayerId: layerId, duplicatedLayerId: newLayerId, operation: 'duplicate' },
    });
    get().markAllCompositeSegmentsDirty();

    return newLayerId;
  },
  duplicateLayers: (layerIds) => {
    const state = get();
    const validIds = layerIds.filter((layerId, index) => (
      layerId &&
      layerIds.indexOf(layerId) === index &&
      state.layers.some((layer) => layer.id === layerId)
    ));

    if (validIds.length === 0) {
      return [];
    }

    const orderedIds = state.layers
      .filter((layer) => validIds.includes(layer.id))
      .map((layer) => layer.id);

    const duplicatedIds = orderedIds
      .map((layerId) => get().duplicateLayer(layerId))
      .filter((layerId): layerId is string => Boolean(layerId));

    if (duplicatedIds.length > 1) {
      set({
        activeLayerId: duplicatedIds[duplicatedIds.length - 1] ?? null,
        selectedLayerIds: duplicatedIds,
      });
    }

    return duplicatedIds;
  },
});
