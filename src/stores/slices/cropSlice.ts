import type { StateCreator } from 'zustand';

import historyManager from '@/history/historyService';
import { mapCanvasActionToHistoryId } from '@/history/helpers/actions';
import type { ScopedTxn } from '@/history/actionTypes';
import type { CropState, Layer, Project, Rectangle } from '@/types';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { normalizeCropRect } from '@/utils/crop/normalize';
import { applyCroppedLayers } from '@/utils/crop/apply';
import {
  captureCropHistoryBaseline,
  recordCropHistory,
} from '@/stores/helpers/cropHistory';
import { captureCropRollback } from '@/stores/helpers/cropRollback';
import { selectionSnapshotFromState } from '@/history/selectionState';
import { rebuildCCLayerAfterCrop, rebuildRecolorLayersAfterCrop } from '@/utils/crop/ccRebuild';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import { cloneCropProjectGeometry } from '@/history/deltas/cropGeometryDelta';

const DEFAULT_MARQUEE: Rectangle | null = null;

export const defaultCropState: CropState = {
  status: 'idle',
  marquee: DEFAULT_MARQUEE,
  activeHandle: null,
  commitInFlight: false,
};

type AppState = import('../useAppStore').AppState;

export interface CropSlice {
  crop: CropState;
  setCropState: (partial: Partial<CropState>) => void;
  resetCrop: () => void;
  cancelCrop: () => void;
  commitCrop: (overrideRect?: Rectangle | null) => Promise<void>;
}

type SyncPercentFn = (layers: Layer[], project: Project | null) => Layer[];

type CropSliceDeps = {
  colorCycleBrushManager: ColorCycleBrushManager;
  syncPercentOffsetsFromPixels: SyncPercentFn;
  syncPlaybackColorCycleLayers: (layers: Layer[], cause: string) => void;
  logError: (message: string, error?: unknown) => void;
};

export const createCropSlice = ({
  colorCycleBrushManager,
  syncPercentOffsetsFromPixels,
  syncPlaybackColorCycleLayers,
  logError,
}: CropSliceDeps): StateCreator<AppState, [], [], CropSlice> => (set, get) => ({
  crop: defaultCropState,
  setCropState: (partial) =>
    set((state) => ({
      crop: {
        ...state.crop,
        ...partial,
      },
    })),
  resetCrop: () => set({ crop: defaultCropState }),
  cancelCrop: () => set({ crop: defaultCropState }),
  commitCrop: async (overrideRect) => {
    const state = get();
    const cropState = state.crop;

    if (cropState.commitInFlight) {
      return;
    }

    const sourceRect = overrideRect ?? cropState.marquee;
    const project = state.project;
    const normalizedRect = normalizeCropRect(sourceRect ?? null, project);

    if (!sourceRect || !normalizedRect || !project) {
      set({ crop: defaultCropState });
      return;
    }

    let txn: ScopedTxn;
    try {
      txn = historyManager.begin(mapCanvasActionToHistoryId('crop'), {
        description: 'Crop to selection',
      });
    } catch (error) {
      logError('[crop] History is unavailable for crop', error);
      return;
    }

    set((prev) => ({
      crop: {
        ...prev.crop,
        commitInFlight: true,
      },
    }));

    let rollback: (() => Promise<void>) | undefined;
    let published = false;
    try {
      rollback = captureCropRollback(state, colorCycleBrushManager, get, set, syncPlaybackColorCycleLayers);
      const {
        projectSize: beforeProject,
        layerSnapshots: beforeLayerSnapshots,
        selectionSnapshot: selectionBefore,
        txtShapes: beforeTxtShapes,
        uiShapes: beforeUiShapes,
      } = captureCropHistoryBaseline({
        project,
        layers: state.layers,
        selectionState: state,
      });

      const {
        updatedProject,
        updatedLayers,
        colorCycleBrushResets,
        recolorRebuildQueue,
      } = applyCroppedLayers({
        project,
        layers: state.layers,
        rect: normalizedRect,
        activeLayerId: state.activeLayerId ?? null,
        syncPercentOffsetsFromPixels,
      });

      const currentCanvas = state.canvas;
      const currentZoom = currentCanvas?.zoom ?? 1;
      const nextOffsetX = (currentCanvas?.offsetX ?? 0) + normalizedRect.x * currentZoom;
      const nextOffsetY = (currentCanvas?.offsetY ?? 0) + normalizedRect.y * currentZoom;

      const nextCanvasState = currentCanvas
        ? {
            ...currentCanvas,
            canvasWidth: normalizedRect.width,
            canvasHeight: normalizedRect.height,
            offsetX: nextOffsetX,
            offsetY: nextOffsetY,
            selection: {
              active: false,
              bounds: { x: 0, y: 0, width: 0, height: 0 },
              pixels:
                currentCanvas.selection?.pixels ??
                (typeof ImageData !== 'undefined' ? new ImageData(1, 1) : ({} as ImageData)),
            },
          }
        : currentCanvas;

      set((prev) => ({
        project: updatedProject,
        layers: updatedLayers,
        canvas: nextCanvasState,
        selectionStart: null,
        selectionEnd: null,
        selectionMask: null,
        selectionMaskBounds: null,
        selectionMaskLayerId: null,
        selectionVectorPath: null,
        selectionLastAction: null,
        floatingPaste: null,
        crop: {
          ...prev.crop,
          marquee: null,
          status: 'ready',
          activeHandle: null,
          commitInFlight: true,
        },
      }));
      published = true;
      get().setLayersNeedRecomposition(true);

      if (colorCycleBrushResets.length > 0) {
        await rebuildCCLayerAfterCrop({
          entries: colorCycleBrushResets,
          colorCycleBrushManager,
          getState: get,
          setState: set,
          syncPlaybackColorCycleLayers,
          logError,
        });
      }

      if (recolorRebuildQueue.length > 0) {
        const manager = RecolorManager.getInstance();
        await rebuildRecolorLayersAfterCrop({
          queue: recolorRebuildQueue,
          getState: get,
          setState: set,
          restoreLayer: (layer) => manager.restoreLayer(layer),
          logError,
        });
      }

      const postState = get();
      const { compositeLayersToCanvas } = postState;

      if (compositeLayersToCanvas) {
        if (typeof document !== 'undefined') {
          const croppedCanvas = document.createElement('canvas');
          croppedCanvas.width = normalizedRect.width;
          croppedCanvas.height = normalizedRect.height;
          compositeLayersToCanvas(croppedCanvas);
          set({ currentOffscreenCanvas: croppedCanvas });
        } else if (postState.currentOffscreenCanvas) {
          compositeLayersToCanvas(postState.currentOffscreenCanvas);
        }
      }

      await recordCropHistory({
        txn,
        beforeProject,
        afterProject: postState.project
          ? cloneCropProjectGeometry(postState.project)
          : null,
        beforeLayers: beforeLayerSnapshots,
        afterLayers: postState.layers,
        beforeTxtShapes,
        afterTxtShapes: postState.project?.txtShapes ?? [],
        beforeUiShapes,
        afterUiShapes: postState.project?.uiShapes ?? [],
        beforeSelection: selectionBefore,
        afterSelection: selectionSnapshotFromState(postState),
        description: 'Crop to selection',
      });

      set({ crop: defaultCropState });

    } catch (error) {
      txn.cancel();
      logError('[crop] Failed to commit crop', error);
      try {
        if (published) await rollback?.();
      } catch (rollbackError) {
        logError('[crop] Failed to restore crop after error', rollbackError);
      }
      if (get().project?.id === project.id) {
        set({ crop: cropState });
      }
    } finally {
      if (get().project?.id === project.id) {
        set((prev) => ({
          crop: {
            ...prev.crop,
            commitInFlight: false,
          },
        }));
      }
    }
  },
});
