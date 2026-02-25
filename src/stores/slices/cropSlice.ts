import type { StateCreator } from 'zustand';
import type { CropState, Layer, Project, Rectangle } from '@/types';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { normalizeCropRect } from '@/utils/crop/normalize';
import { applyCroppedLayers } from '@/utils/crop/apply';
import {
  captureCropHistoryBaseline,
  recordCropHistory,
  recordCropSelectionHistory,
  selectionSnapshotFromCropState,
} from '@/stores/helpers/cropHistory';
import { rebuildCCLayerAfterCrop, rebuildRecolorLayersAfterCrop } from '@/utils/crop/ccRebuild';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';

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
  syncCCRuntimes: (layers: Layer[], cause: string) => void;
  logError: (message: string, error?: unknown) => void;
};

export const createCropSlice = ({
  colorCycleBrushManager,
  syncPercentOffsetsFromPixels,
  syncCCRuntimes,
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

    set((prev) => ({
      crop: {
        ...prev.crop,
        commitInFlight: true,
      },
    }));

    try {
      const {
        projectSize: beforeProject,
        layerSnapshots: beforeLayerSnapshots,
        selectionSnapshot: selectionBefore,
      } = captureCropHistoryBaseline({
        project,
        layers: state.layers,
        selectionStart: state.selectionStart,
        selectionEnd: state.selectionEnd,
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
        floatingPaste: null,
        crop: {
          ...prev.crop,
          marquee: null,
          status: 'ready',
          activeHandle: null,
          commitInFlight: true,
        },
      }));
      get().setLayersNeedRecomposition(true);

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
        beforeProject,
        afterProject: postState.project
          ? { width: postState.project.width, height: postState.project.height }
          : null,
        beforeLayers: beforeLayerSnapshots,
        afterLayers: postState.layers,
        description: 'Crop to selection',
      });

      const selectionAfter = selectionSnapshotFromCropState(
        postState.selectionStart,
        postState.selectionEnd,
      );
      recordCropSelectionHistory({
        before: selectionBefore,
        after: selectionAfter,
        description: 'Crop selection reset',
      });

      set({ crop: defaultCropState });

      if (colorCycleBrushResets.length > 0) {
        rebuildCCLayerAfterCrop({
          entries: colorCycleBrushResets,
          colorCycleBrushManager,
          getState: get,
          setState: set,
          syncCCRuntimes,
          logError,
        });
      }

      if (recolorRebuildQueue.length > 0) {
        const manager = RecolorManager.getInstance();
        rebuildRecolorLayersAfterCrop({
          queue: recolorRebuildQueue,
          getState: get,
          setState: set,
          processLayer: (layer, options) => manager.processLayer(layer, options),
          logError,
        });
      }
    } catch (error) {
      logError('[crop] Failed to commit crop', error);
      set({ crop: defaultCropState });
    } finally {
      set((prev) => ({
        crop: {
          ...prev.crop,
          commitInFlight: false,
        },
      }));
    }
  },
});
