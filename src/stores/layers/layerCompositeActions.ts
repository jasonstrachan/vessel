import type { StateCreator } from 'zustand';

import type { ColorCycleDirtyRect, ColorCycleLayerDirtyBatch } from '@/lib/colorCycle/document/ColorCycleLayerDocument';
import { compositeBitmapManager } from '@/lib/performance/CompositeBitmapManager';
import { getSequentialLayerRendererStats } from '@/lib/sequential/SequentialLayerRenderer';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { appendPendingCompositeDirtyBatches } from '@/stores/layers/layerCompositeDirtyBatches';
import { createLayerCompositeDrawing } from '@/stores/layers/layerCompositeDrawing';
import {
  hasCleanStaticCompositeSegments,
  markCompositeSegmentsDirtyByLayerIds as markCompositeSegmentsDirtyByLayerIdsInSegments,
  markStaticCompositeSegmentsDirty,
} from '@/stores/layers/layerCompositeInvalidation';
import { realizeCompositeSegments } from '@/stores/layers/layerCompositeRenderer';
import type { LayersSlice } from '@/stores/layers/layersSliceTypes';
import type { AppState } from '@/stores/useAppStore';
import { logError } from '@/utils/debug';

type StoreSet = Parameters<StateCreator<AppState, [], [], AppState>>[0];
type StoreGet = Parameters<StateCreator<AppState, [], [], AppState>>[1];

type LayerCompositeActions = Pick<
  LayersSlice,
  | 'setCurrentOffscreenCanvas'
  | 'setCurrentCompositeBitmap'
  | 'setLayersNeedRecomposition'
  | 'getCompositeSegmentsSnapshot'
  | 'markCompositeSegmentsDirtyByLayerIds'
  | 'markAllCompositeSegmentsDirty'
  | 'compositeLayersToCanvas'
  | 'compositeLayersToCanvasSync'
  | 'renderStaticComposite'
  | 'renderColorCycleOverlay'
>;

export interface LayerCompositeActionDeps {
  set: StoreSet;
  get: StoreGet;
  colorCycleBrushManager: ColorCycleBrushManager;
  createLayerTransferCanvas: (
    width: number,
    height: number,
  ) => HTMLCanvasElement | OffscreenCanvas | null;
  hasValidFramebuffer: (
    framebuffer: HTMLCanvasElement | OffscreenCanvas | null | undefined,
  ) => framebuffer is HTMLCanvasElement | OffscreenCanvas;
}

export const createLayerCompositeActions = ({
  set,
  get,
  colorCycleBrushManager,
  createLayerTransferCanvas,
  hasValidFramebuffer,
}: LayerCompositeActionDeps): LayerCompositeActions => {
  const {
    drawStaticLayers,
    drawAllLayersInOrder,
    drawColorCycleLayers,
  } = createLayerCompositeDrawing({
    createLayerTransferCanvas,
    hasValidFramebuffer,
  });

    let staticBitmapCaptureToken = 0;
    let compositeRenderToken = 0;

    const markCompositeSegmentsDirtyByDirtyBatches = (
      dirtyBatches: ColorCycleLayerDirtyBatch[] | undefined,
    ): void => {
      if (!dirtyBatches?.length) {
        return;
      }
      const layerIds = Array.from(new Set(
        dirtyBatches.map((batch) => batch.layerId).filter(Boolean),
      ));
      if (layerIds.length === 0) {
        return;
      }
      set((state) => ({
        compositeSegments: markCompositeSegmentsDirtyByLayerIdsInSegments(
          state.compositeSegments,
          layerIds,
        ),
      }));
    };

    const markCompositeSegmentsDirtyByLayerIdsWithRects = (
      layerIds: string[],
      dirtyRectsByLayerId?: Map<string, ColorCycleDirtyRect[]>,
    ): void => {
      if (!layerIds.length) {
        return;
      }
      set((state) => ({
        compositeSegments: markCompositeSegmentsDirtyByLayerIdsInSegments(
          state.compositeSegments,
          layerIds
        ),
        pendingCompositeDirtyBatches: appendPendingCompositeDirtyBatches(
          state,
          layerIds,
          dirtyRectsByLayerId,
        ),
      }));
    };

    const captureStaticBitmapFromCanvas = (canvas: HTMLCanvasElement) => {
      if (typeof window === 'undefined' || typeof window.createImageBitmap !== 'function') {
        get().setCurrentCompositeBitmap(null);
        return;
      }
      const captureId = ++staticBitmapCaptureToken;
      window
        .createImageBitmap(canvas)
        .then((bitmap) => {
          if (captureId !== staticBitmapCaptureToken) {
            try {
              bitmap.close();
            } catch {
              // ignore
            }
            return;
          }
          get().setCurrentCompositeBitmap(bitmap);
        })
        .catch(() => {
          if (captureId === staticBitmapCaptureToken) {
            get().setCurrentCompositeBitmap(null);
          }
        });
    };

    const scheduleCompositeBitmapRelease = (bitmap: ImageBitmap) => {
      const dispose = () => {
        try {
          bitmap.close();
        } catch {
          // ignore close errors
        }
      };

      if (typeof window === 'undefined') {
        dispose();
        return;
      }

      const MAX_ATTEMPTS = 3;
      let attempts = 0;

      const tryDispose = () => {
        if (get().currentCompositeBitmap === bitmap && attempts < MAX_ATTEMPTS) {
          attempts += 1;
          window.requestAnimationFrame(tryDispose);
          return;
        }
        dispose();
      };

      window.setTimeout(tryDispose, 160);
    };

  return {
      setCurrentOffscreenCanvas: (canvas) => set({ currentOffscreenCanvas: canvas }),
      setCurrentCompositeBitmap: (bitmap) => {
        const previous = get().currentCompositeBitmap;
        const nextBitmap = bitmap ?? null;
        if (previous === nextBitmap) {
          return;
        }
        set({ currentCompositeBitmap: nextBitmap });
        if (previous) {
          scheduleCompositeBitmapRelease(previous);
        }
      },
      setLayersNeedRecomposition: (needed) => {
        set((state) => {
          if (!needed) {
            if (!state.layersNeedRecomposition) {
              return state;
            }
            return { layersNeedRecomposition: false };
          }

          const hasCleanStaticSegments = hasCleanStaticCompositeSegments(state.compositeSegments);

          if (state.layersNeedRecomposition && !hasCleanStaticSegments) {
            return state;
          }

          if (needed) {
            const layerIds = state.compositeSegments.flatMap((segment) =>
              segment.kind === 'static' ? segment.layerIds : []
            );
            return {
              layersNeedRecomposition: true,
              compositeSegments: markStaticCompositeSegmentsDirty(state.compositeSegments),
              pendingCompositeDirtyBatches: appendPendingCompositeDirtyBatches(state, layerIds),
            };
          }
          return state;
        });
      },
      getCompositeSegmentsSnapshot: () =>
        get().compositeSegments.map((segment) =>
          segment.kind === 'static'
            ? { ...segment, canvas: segment.canvas, bitmap: segment.bitmap }
            : { ...segment }
        ),
      markCompositeSegmentsDirtyByLayerIds: (layerIds, options) => {
        markCompositeSegmentsDirtyByLayerIdsWithRects(
          layerIds,
          options?.dirtyRectsByLayerId,
        );
      },
      markAllCompositeSegmentsDirty: () => {
        set((state) => ({
          compositeSegments: markStaticCompositeSegmentsDirty(state.compositeSegments),
          pendingCompositeDirtyBatches: appendPendingCompositeDirtyBatches(
            state,
            state.compositeSegments.flatMap((segment) =>
              segment.kind === 'static' ? segment.layerIds : []
            ),
          ),
        }));
      },
	  compositeLayersToCanvas: (targetCanvas, options) => {
      const renderToken = ++compositeRenderToken;

    try {
      markCompositeSegmentsDirtyByDirtyBatches(options?.dirtyBatches);
      const state = get();

      if (!state.project || !state.layers.length) {
        get().setCurrentCompositeBitmap(null);
        return;
      }

      const expectedWidth = state.project.width;
      const expectedHeight = state.project.height;

      if (targetCanvas.width !== expectedWidth || targetCanvas.height !== expectedHeight) {
        targetCanvas.width = expectedWidth;
        targetCanvas.height = expectedHeight;
      }

      const baseCtx = targetCanvas.getContext(
        '2d',
        { willReadFrequently: true } as CanvasRenderingContext2DSettings
      ) as CanvasRenderingContext2D | null;
      if (!baseCtx) {
        get().setCurrentCompositeBitmap(null);
        return;
      }

      const currentState = get();
      const isPixelBrush =
        currentState.tools.brushSettings.brushShape === 'pixel_round' ||
        (currentState.tools.brushSettings.brushShape === 'square' &&
          !currentState.tools.brushSettings.antialiasing);

      const sortedLayers = [...state.layers].sort((a, b) => a.order - b.order);
      const projectWithGroups = { ...state.project, layerGroups: state.layerGroups };

      const drawAllLayers = (
        ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
      ) => {
        if ('imageSmoothingEnabled' in ctx) {
          (ctx as CanvasRenderingContext2D).imageSmoothingEnabled = !isPixelBrush;
        }
        drawAllLayersInOrder(
          ctx,
          sortedLayers,
          projectWithGroups,
          colorCycleBrushManager,
          get().sequentialRecord.currentFrame,
          options?.liveLayerOverlay,
        );
        const stats = getSequentialLayerRendererStats();
        get().setSequentialFrameCacheStats({
          frameCacheEntries: stats.entries,
          frameCacheHits: stats.hits,
          frameCacheMisses: stats.misses,
        });
      };

      const renderWithFallback = () => {
        baseCtx.imageSmoothingEnabled = !isPixelBrush;
        drawAllLayers(baseCtx);
        get().setCurrentCompositeBitmap(null);
      };

	      if (compositeBitmapManager.isSupported()) {
	        void compositeBitmapManager
	          .render(expectedWidth, expectedHeight, drawAllLayers, targetCanvas)
	          .then((bitmap) => {
              if (renderToken !== compositeRenderToken) {
                if (bitmap) {
                  scheduleCompositeBitmapRelease(bitmap);
                }
                return;
              }
	            const setBitmap = get().setCurrentCompositeBitmap;
	            setBitmap(bitmap ?? null);
	          })
	          .catch((error) => {
              if (renderToken !== compositeRenderToken) {
                return;
              }
	            logError('[compose] compositeBitmapManager.render failed', error);
	            renderWithFallback();
	          });
	        return;
	      }

      renderWithFallback();
    } catch (error) {
      logError('[compose] Failed to composite layers', error);
      get().setCurrentCompositeBitmap(null);
    }
  },

  compositeLayersToCanvasSync: (targetCanvas, options) => {
    try {
      markCompositeSegmentsDirtyByDirtyBatches(options?.dirtyBatches);
      const state = get();

      if (!state.project || !state.layers.length) {
        get().setCurrentCompositeBitmap(null);
        return false;
      }

      const expectedWidth = state.project.width;
      const expectedHeight = state.project.height;

      if (targetCanvas.width !== expectedWidth || targetCanvas.height !== expectedHeight) {
        targetCanvas.width = expectedWidth;
        targetCanvas.height = expectedHeight;
      }

      const ctx = targetCanvas.getContext(
        '2d',
        { willReadFrequently: true } as CanvasRenderingContext2DSettings
      ) as CanvasRenderingContext2D | null;
      if (!ctx) {
        get().setCurrentCompositeBitmap(null);
        return false;
      }

      const currentState = get();
      const isPixelBrush =
        currentState.tools.brushSettings.brushShape === 'pixel_round' ||
        (currentState.tools.brushSettings.brushShape === 'square' &&
          !currentState.tools.brushSettings.antialiasing);
      ctx.imageSmoothingEnabled = !isPixelBrush;

      const sortedLayers = [...state.layers].sort((a, b) => a.order - b.order);
      const projectWithGroups = { ...state.project, layerGroups: state.layerGroups };
      drawAllLayersInOrder(
        ctx,
        sortedLayers,
        projectWithGroups,
        colorCycleBrushManager,
        get().sequentialRecord.currentFrame,
        options?.liveLayerOverlay,
      );

      const stats = getSequentialLayerRendererStats();
      get().setSequentialFrameCacheStats({
        frameCacheEntries: stats.entries,
        frameCacheHits: stats.hits,
        frameCacheMisses: stats.misses,
      });
      get().setCurrentCompositeBitmap(null);
      return true;
    } catch (error) {
      logError('[compose] Failed to synchronously composite layers', error);
      get().setCurrentCompositeBitmap(null);
      return false;
    }
  },

  renderStaticComposite: (targetCanvas, options) => {
    try {
      const state = get();
      const dirtyBatches = options?.dirtyBatches ?? state.pendingCompositeDirtyBatches;
      const shouldClearPendingDirtyBatches = !options?.dirtyBatches;

      if (!state.project) {
        const ctx = targetCanvas.getContext(
          '2d',
          { willReadFrequently: true } as CanvasRenderingContext2DSettings
        );
        ctx?.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
        get().setCurrentCompositeBitmap(null);
        set({ compositeSegments: [], compositeSegmentsVersion: 0 });
        return false;
      }

      if (typeof document === 'undefined') {
        return false;
      }

      const project = { ...state.project, layerGroups: state.layerGroups };
      const expectedWidth = project.width;
      const expectedHeight = project.height;
      if (expectedWidth <= 0 || expectedHeight <= 0) {
        return false;
      }

      if (targetCanvas.width !== expectedWidth || targetCanvas.height !== expectedHeight) {
        targetCanvas.width = expectedWidth;
        targetCanvas.height = expectedHeight;
      }

      const staticCtx = targetCanvas.getContext(
        '2d',
        { willReadFrequently: true } as CanvasRenderingContext2DSettings
      ) as CanvasRenderingContext2D | null;
      if (!staticCtx) {
        return false;
      }

      const sortedLayers = [...state.layers].sort((a, b) => a.order - b.order);
      const {
        segments: realizedSegments,
        anySegmentUpdated,
        fullStaticRedrawNeeded,
        staticDirtyRects,
      } = realizeCompositeSegments({
        sortedLayers,
        project,
        previousSegments: state.compositeSegments,
        width: expectedWidth,
        height: expectedHeight,
        createStaticCanvas: (width, height) => {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          return canvas;
        },
        createLayerTransferCanvas,
        dirtyBatches,
      });

      if (anySegmentUpdated) {
        set((prev) => ({
          compositeSegments: realizedSegments,
          compositeSegmentsVersion: prev.compositeSegmentsVersion + 1,
          staticCompositeVersion: prev.staticCompositeVersion + 1,
          ...(shouldClearPendingDirtyBatches ? { pendingCompositeDirtyBatches: [] } : {}),
        }));
      } else {
        set((prev) => ({
          compositeSegments: realizedSegments,
          staticCompositeVersion: prev.staticCompositeVersion + 1,
          ...(shouldClearPendingDirtyBatches ? { pendingCompositeDirtyBatches: [] } : {}),
        }));
      }

      const isPixelBrush =
        state.tools.brushSettings.brushShape === 'pixel_round' ||
        (state.tools.brushSettings.brushShape === 'square' &&
          !state.tools.brushSettings.antialiasing);
      staticCtx.imageSmoothingEnabled = !isPixelBrush;
      drawStaticLayers(
        staticCtx,
        sortedLayers,
        project,
        !fullStaticRedrawNeeded ? staticDirtyRects : undefined,
      );

      if (
        options?.captureBitmap !== false &&
        typeof HTMLCanvasElement !== 'undefined' &&
        targetCanvas instanceof HTMLCanvasElement
      ) {
        captureStaticBitmapFromCanvas(targetCanvas);
      }

      return true;
    } catch (error) {
      logError('[compose] Failed to render static composite', error);
      return false;
    }
  },

  renderColorCycleOverlay: (targetCanvas) => {
    const state = get();
    if (!state.project || !state.layers.length) {
      const ctx = targetCanvas.getContext(
        '2d',
        { willReadFrequently: true } as CanvasRenderingContext2DSettings
      );
      ctx?.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      return false;
    }

    const expectedWidth = state.project.width;
    const expectedHeight = state.project.height;

    if (targetCanvas.width !== expectedWidth || targetCanvas.height !== expectedHeight) {
      targetCanvas.width = expectedWidth;
      targetCanvas.height = expectedHeight;
    }

    const ctx = targetCanvas.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings
    ) as CanvasRenderingContext2D | null;
    if (!ctx) {
      return false;
    }

    const isPixelBrush =
      state.tools.brushSettings.brushShape === 'pixel_round' ||
      (state.tools.brushSettings.brushShape === 'square' &&
        !state.tools.brushSettings.antialiasing);
    ctx.imageSmoothingEnabled = !isPixelBrush;

    const sortedLayers = [...state.layers].sort((a, b) => a.order - b.order);
    return drawColorCycleLayers(ctx, sortedLayers, state.project, colorCycleBrushManager, { clear: true });
  },

  };
};
