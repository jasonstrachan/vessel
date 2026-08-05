import type { StateCreator } from 'zustand';

import type { LayerStructureSnapshot } from '@/history/deltas/layerStructureDelta';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type {
  CommitLayerStructureHistoryOptions,
  LayerHistorySnapshotOptions,
} from '@/stores/helpers/layerStructureHistory';
import { bakeColorCycleLayerMasks } from '@/stores/layers/colorCycleLayerTransforms';
import {
  captureSoftEdgeMaskOnlyState,
  removeColorCycleSoftEdgeMaskFromLayer,
  resolveSoftEdgeCoverageFromBrush,
} from '@/stores/layers/layerColorCycleMaskState';
import type { LayersSlice } from '@/stores/layers/layersSliceTypes';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { buildColorCycleSoftEdgeMask } from '@/utils/colorCycleSoftEdgeMask';
import { debugWarn, logError } from '@/utils/debug';

type StoreSet = Parameters<StateCreator<AppState, [], [], AppState>>[0];
type StoreGet = Parameters<StateCreator<AppState, [], [], AppState>>[1];

type LayerColorCycleEditActions = Pick<
  LayersSlice,
  | 'convertColorCycleLayerToNormal'
  | 'applyColorCycleSoftEdgeMask'
  | 'setColorCycleSoftEdgeMaskEnabled'
  | 'clearColorCycleSoftEdgeMask'
>;

export interface LayerColorCycleEditActionDeps {
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
  scheduleSlotRebuild: (reason: string) => void;
}

export const createLayerColorCycleEditActions = ({
  set,
  get,
  colorCycleBrushManager,
  captureLayerStructureSnapshot,
  commitLayerStructureHistory,
  createLayerTransferCanvas,
  hasValidFramebuffer,
  scheduleSlotRebuild,
}: LayerColorCycleEditActionDeps): LayerColorCycleEditActions => ({
  convertColorCycleLayerToNormal: (layerId) => {
    const stateBeforeConversion = get();
    const sourceLayer = stateBeforeConversion.layers.find((layer) => layer.id === layerId);
    if (!sourceLayer || sourceLayer.layerType !== 'color-cycle' || !stateBeforeConversion.project) {
      return false;
    }

    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeConversion, {
      actionType: 'layer',
      description: 'Convert color-cycle layer to regular',
    });
    const width = stateBeforeConversion.project.width || 1;
    const height = stateBeforeConversion.project.height || 1;
    const sourceCanvas =
      (sourceLayer.colorCycleData?.canvas as HTMLCanvasElement | OffscreenCanvas | undefined) ??
      (hasValidFramebuffer(sourceLayer.framebuffer) ? sourceLayer.framebuffer : null);
    const brush = colorCycleBrushManager.getSurfaceBrush(layerId);

    if (!brush || !sourceCanvas || typeof brush.renderDirectToCanvas !== 'function') {
      return false;
    }
    try {
      brush.renderDirectToCanvas(sourceCanvas as HTMLCanvasElement, layerId);
    } catch (error) {
      logError('[convertColorCycleLayerToNormal] Failed to render color-cycle layer', error);
      return false;
    }

    const compositeSource = bakeColorCycleLayerMasks({
      layer: sourceLayer,
      sourceCanvas,
      createCanvas: createLayerTransferCanvas,
    });
    if (!compositeSource) {
      logError('[convertColorCycleLayerToNormal] Failed to bake active masks');
      return false;
    }

    const regularCanvas = createLayerTransferCanvas(width, height);
    if (!regularCanvas) {
      return false;
    }
    const regularContext = regularCanvas.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings,
    ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!regularContext) {
      return false;
    }

    try {
      regularContext.drawImage(compositeSource as CanvasImageSource, 0, 0, width, height);
    } catch (error) {
      logError('[convertColorCycleLayerToNormal] Failed to capture color-cycle pixels', error);
      return false;
    }

    let imageData: ImageData;
    try {
      imageData = regularContext.getImageData(0, 0, width, height);
    } catch (error) {
      logError('[convertColorCycleLayerToNormal] Failed to read regular layer pixels', error);
      return false;
    }

    set((state) => ({
      layers: state.layers.map((layer) => {
        if (layer.id !== layerId) {
          return layer;
        }
        const convertedLayer: Layer = {
          ...layer,
          layerType: 'normal',
          imageData,
          framebuffer: regularCanvas,
          version: (layer.version ?? 0) + 1,
        };
        delete convertedLayer.colorCycleData;
        return convertedLayer;
      }),
      layersNeedRecomposition: true,
    }));

    colorCycleBrushManager.removeColorCycleBrush(layerId);
    get().setActiveLayer(layerId, {
      previousActiveLayer: sourceLayer,
      forceLifecycle: true,
      preserveSelection: true,
    });

    const afterSnapshot = captureLayerStructureSnapshot(get(), {
      actionType: 'layer',
      description: 'Convert color-cycle layer to regular',
      activeLayerId: layerId,
      previousSnapshot: beforeSnapshot,
    });
    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Convert to regular layer',
      metadata: { layerId, operation: 'convert-color-cycle-to-normal' },
    });
    get().markAllCompositeSegmentsDirty();
    scheduleSlotRebuild('convert-color-cycle-to-normal');
    return true;
  },
  applyColorCycleSoftEdgeMask: async (layerId, radius, ditherSize, ditherAlgorithm) => {
    const { captureColorCycleBrushState } = await import('@/history/helpers/colorCycle');
    const { commitLayerHistory } = await import('@/history/helpers/layerHistory');
    const beforeColorState = captureColorCycleBrushState(layerId);
    const warmed = await get().ensureColorCycleLayerRuntime(layerId, { target: 'active' });
    if (!warmed) {
      return false;
    }

    const state = get();
    const layer = state.layers.find((candidate) => candidate.id === layerId);
    if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      return false;
    }

    const canvas = layer.colorCycleData.canvas;
    const brush = colorCycleBrushManager.getSurfaceBrush(layerId);
    if (canvas && brush?.renderDirectToCanvas) {
      try {
        brush.renderDirectToCanvas(canvas, layerId);
      } catch (error) {
        logError('[soft-edge-mask] Failed to render color-cycle frame before mask capture', error);
      }
    }

    const result = buildColorCycleSoftEdgeMask(
      layer,
      radius,
      resolveSoftEdgeCoverageFromBrush(layer, brush),
      { ditherSize, ditherAlgorithm },
    );
    if (!result) {
      return false;
    }

    const nextVersion = (layer.colorCycleData.softEdgeMaskVersion ?? 0) + 1;
    const nextEnabled = layer.colorCycleData.softEdgeMask || layer.colorCycleData.softEdgeMaskImageData
      ? layer.colorCycleData.softEdgeMaskEnabled !== false
      : true;
    state.updateLayer(
      layerId,
      {
        colorCycleData: {
          softEdgeMask: result.softEdgeMask,
          softEdgeMaskImageData: result.softEdgeMaskImageData,
          softEdgeMaskEnabled: nextEnabled,
          softEdgeMaskVersion: nextVersion,
        },
      },
      { skipColorCycleSync: true },
    );
    state.markCompositeSegmentsDirtyByLayerIds([layerId]);
    state.setLayersNeedRecomposition(true);
    state.markAutosaveDirty('layer-change');

    await commitLayerHistory({
      layerId,
      beforeImage: null,
      beforeColorState,
      actionType: 'color-cycle-soft-edge-mask',
      description: 'Bake color-cycle soft edge mask',
      tool: 'color-cycle',
      skipBitmapDelta: true,
    }).catch((error) => {
      if (process.env.NODE_ENV !== 'production') {
        debugWarn('raw-console', '[history] Failed to record color-cycle soft edge mask', error);
      }
    });

    return true;
  },

  setColorCycleSoftEdgeMaskEnabled: (layerId, enabled) => {
    const state = get();
    const layer = state.layers.find((candidate) => candidate.id === layerId);
    if (
      !layer ||
      layer.layerType !== 'color-cycle' ||
      !layer.colorCycleData ||
      (!layer.colorCycleData.softEdgeMask && !layer.colorCycleData.softEdgeMaskImageData) ||
      (layer.colorCycleData.softEdgeMaskEnabled !== false) === enabled
    ) {
      return;
    }

    const nextVersion = (layer.colorCycleData.softEdgeMaskVersion ?? 0) + 1;
    state.updateLayer(
      layerId,
      {
        colorCycleData: {
          softEdgeMaskEnabled: enabled,
          softEdgeMaskVersion: nextVersion,
        },
      },
      { skipColorCycleSync: true },
    );
    state.markCompositeSegmentsDirtyByLayerIds([layerId]);
    state.setLayersNeedRecomposition(true);
    state.markAutosaveDirty('layer-change');
  },

  clearColorCycleSoftEdgeMask: (layerId) => {
    const state = get();
    const layer = state.layers.find((candidate) => candidate.id === layerId);
    if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      return;
    }
    if (!layer.colorCycleData.softEdgeMask && !layer.colorCycleData.softEdgeMaskImageData) {
      return;
    }
    const beforeColorState = captureSoftEdgeMaskOnlyState(layer);

    const nextVersion = (layer.colorCycleData.softEdgeMaskVersion ?? 0) + 1;
    set((current) => ({
      layers: current.layers.map((candidate) => (
        candidate.id === layerId
          ? removeColorCycleSoftEdgeMaskFromLayer(candidate, nextVersion)
          : candidate
      )),
    }));
    state.markCompositeSegmentsDirtyByLayerIds([layerId]);
    state.setLayersNeedRecomposition(true);
    state.markAutosaveDirty('layer-change');

    void (async () => {
      const { commitLayerHistory } = await import('@/history/helpers/layerHistory');
      await commitLayerHistory({
        layerId,
        beforeImage: null,
        beforeColorState,
        actionType: 'color-cycle-soft-edge-mask',
        description: 'Clear color-cycle soft edge mask',
        tool: 'color-cycle',
        skipBitmapDelta: true,
      });
    })().catch((error) => {
      if (process.env.NODE_ENV !== 'production') {
        debugWarn('raw-console', '[history] Failed to record color-cycle soft edge mask clear', error);
      }
    });
  },
});
