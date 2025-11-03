import type { StoreApi } from 'zustand';
import type { Project, PaletteState, CustomBrush, Layer } from '@/types';
import {
  normalizeProject,
  createDefaultPalette,
  normalizeLayers,
  cloneExportLayout,
  createDefaultLayerAlignment,
  createDefaultExportLayout,
} from '@/utils/layoutDefaults';
import {
  restoreColorCycleBrushes,
  saveProjectToFile,
  loadProjectFromFile,
  exportProjectAsPNG,
} from '@/utils/projectIO';
import { mergeCustomBrushCollections } from './customBrushMerge';
import {
  getColorCycleBrushManager,
  type ColorCycleBrushManager,
  type ColorCycleBrushImplementation,
} from '../colorCycleBrushManager';
import { setActiveHistoryDocument } from '@/history/historyService';
import { logError } from '@/utils/debug';
import { compositeBitmapManager } from '@/lib/performance/CompositeBitmapManager';
import { computeLayerPercentOffset } from '@/utils/layerMetrics';
import { updateToolsWithPalette } from './paletteState';

type AppState = import('../useAppStore').AppState;

type StoreSet = StoreApi<AppState>['setState'];
type StoreGet = StoreApi<AppState>['getState'];

type CustomBrushSnapshot = {
  brushes: CustomBrush[];
  defaultCustomBrushId: string | null;
} | null;

type SyncPercentOffsetsFn = (layers: Layer[], project: Project | null) => Layer[];
type CaptureROI = import('../useAppStore').CaptureROI;

export interface ProjectLifecycleOptions {
  set: StoreSet;
  get: StoreGet;
  colorCycleBrushManager: ColorCycleBrushManager | null;
  persistCustomBrushes: () => void;
  getLastCustomBrushSnapshot: () => CustomBrushSnapshot;
  syncPercentOffsetsFromPixels: SyncPercentOffsetsFn;
}

const resolveDefaultCustomBrushId = (
  candidate: string | null,
  storedDefaultId: string | null,
  brushes: CustomBrush[]
): string | null => {
  if (storedDefaultId && brushes.some((brush) => brush.id === storedDefaultId)) {
    return storedDefaultId;
  }
  if (candidate && brushes.some((brush) => brush.id === candidate)) {
    return candidate;
  }
  return null;
};

const normalizeCaptureROI = (
  roi: CaptureROI | undefined,
  maxWidth: number,
  maxHeight: number
): CaptureROI | undefined => {
  if (!roi) {
    return undefined;
  }
  if (
    !Number.isFinite(roi.x) ||
    !Number.isFinite(roi.y) ||
    !Number.isFinite(roi.width) ||
    !Number.isFinite(roi.height)
  ) {
    return undefined;
  }
  if (roi.width <= 0 || roi.height <= 0) {
    return undefined;
  }
  const x = Math.max(0, Math.floor(roi.x));
  const y = Math.max(0, Math.floor(roi.y));
  const width = Math.max(1, Math.min(maxWidth - x, Math.ceil(roi.width)));
  const height = Math.max(1, Math.min(maxHeight - y, Math.ceil(roi.height)));
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
};

const mergeImageDataRegion = (
  base: ImageData | null,
  region: ImageData,
  offsetX: number,
  offsetY: number,
  fullWidth: number,
  fullHeight: number
): ImageData => {
  const targetWidth = fullWidth;
  const targetHeight = fullHeight;
  const baseMatches =
    base && base.width === targetWidth && base.height === targetHeight;
  const mergedData = baseMatches
    ? new Uint8ClampedArray(base!.data)
    : new Uint8ClampedArray(targetWidth * targetHeight * 4);

  const src = region.data;
  const rowStride = region.width * 4;
  for (let row = 0; row < region.height; row++) {
    const srcStart = row * rowStride;
    const destStart = ((offsetY + row) * targetWidth + offsetX) * 4;
    mergedData.set(src.subarray(srcStart, srcStart + rowStride), destStart);
  }

  return new ImageData(mergedData, targetWidth, targetHeight);
};

export const createProjectLifecycle = ({
  set,
  get,
  colorCycleBrushManager,
  persistCustomBrushes,
  getLastCustomBrushSnapshot,
  syncPercentOffsetsFromPixels,
}: ProjectLifecycleOptions) => {
  const setProject = (project: Project): void => {
    const normalized = normalizeProject(project);
    setActiveHistoryDocument(normalized.id);

    const snapshot = getLastCustomBrushSnapshot();
    const storedBrushes = snapshot?.brushes ?? [];
    const storedDefaultId = snapshot?.defaultCustomBrushId ?? null;

    const mergedCustomBrushes = mergeCustomBrushCollections(
      normalized.customBrushes,
      storedBrushes
    );
    const mergedDefaultId = resolveDefaultCustomBrushId(
      normalized.defaultCustomBrushId ?? null,
      storedDefaultId,
      mergedCustomBrushes
    );

    const nextPalette = normalized.palette ?? createDefaultPalette();
    const projectWithPalette: Project = {
      ...normalized,
      customBrushes: mergedCustomBrushes,
      defaultCustomBrushId: mergedDefaultId,
      palette: nextPalette,
    };

    set((state) => ({
      project: projectWithPalette,
      palette: nextPalette,
      paletteDirty: false,
      projectFilename: null,
      projectFileHandle: null,
      tools: updateToolsWithPalette(nextPalette, state.tools),
    }));

    if (projectWithPalette.defaultCustomBrushId) {
      get().setDefaultCustomBrush(projectWithPalette.defaultCustomBrushId);
    }

    persistCustomBrushes();
  };

  const updateProject = (updates: Partial<Project>): void => {
    const stateBefore = get();
    if (!stateBefore.project) {
      set({ project: null });
      return;
    }

    const baseProject: Project = {
      ...stateBefore.project,
      ...updates,
      exportLayout: 'exportLayout' in updates
        ? cloneExportLayout(updates.exportLayout)
        : cloneExportLayout(stateBefore.project.exportLayout),
    };

    const normalized = normalizeProject(baseProject);

    if (normalized.id) {
      setActiveHistoryDocument(normalized.id);
    }

    const nextPalette = normalized.palette ?? stateBefore.palette ?? createDefaultPalette();
    const projectWithPalette: Project = {
      ...normalized,
      palette: nextPalette,
    };

    set((state) => ({
      project: projectWithPalette,
      palette: nextPalette,
      paletteDirty: false,
      referenceLayerId: null,
      tools: updateToolsWithPalette(nextPalette, state.tools),
    }));

    const previousDefault = stateBefore.project.defaultCustomBrushId ?? null;
    const nextDefault = projectWithPalette.defaultCustomBrushId ?? null;
    if (nextDefault && nextDefault !== previousDefault) {
      get().setDefaultCustomBrush(nextDefault);
    }

    persistCustomBrushes();
  };

  const applyLoadedProject = async (loadedProject: Project): Promise<void> => {
    const state = get();

    const layersWithRestoredColorCycles = await restoreColorCycleBrushes(loadedProject.layers);
    const finalLayers = layersWithRestoredColorCycles ?? loadedProject.layers;
    console.log(
      '🔵 LOAD PROJECT - Final layers being set:',
      finalLayers.map((layer) => ({
        id: layer.id?.substring(0, 20),
        type: layer.layerType,
        hasColorCycleData: Boolean(layer.colorCycleData),
      }))
    );

    const normalizedProject = normalizeProject(loadedProject);
    const normalizedPalette = normalizedProject.palette ?? createDefaultPalette();
    const projectWithPalette = {
      ...normalizedProject,
      palette: normalizedPalette,
    };

    const toolsWithPalette = updateToolsWithPalette(normalizedPalette, state.tools);
    const normalizedLayers = normalizeLayers(finalLayers);
    const syncedLayers = syncPercentOffsetsFromPixels(normalizedLayers, normalizedProject);

    set({
      project: projectWithPalette,
      palette: normalizedPalette,
      paletteDirty: false,
      layers: syncedLayers,
      activeLayerId: loadedProject.layers[0]?.id ?? null,
      selectedLayerIds: loadedProject.layers[0]?.id ? [loadedProject.layers[0].id] : [],
      layersNeedRecomposition: true,
      referenceLayerId: null,
      canvas: loadedProject.viewState
        ? {
            ...get().canvas,
            zoom: loadedProject.viewState.zoom,
          }
        : get().canvas,
      brushSpecificSettings: loadedProject.brushSpecificSettings ?? {},
      globalBrushSize: loadedProject.globalBrushSize ?? 10,
      tools: toolsWithPalette,
    });

    get().setCanvasDimensions(loadedProject.width, loadedProject.height);

    const currentState = get();
    if (currentState.tools && currentState.globalBrushSize) {
      set((s) => ({
        tools: {
          ...s.tools,
          brushSettings: {
            ...s.tools.brushSettings,
            size: currentState.globalBrushSize,
          },
        },
      }));
    }

    if (colorCycleBrushManager) {
      const postLoadState = get();
      const colorCycleLayerIds = new Set(
        postLoadState.layers
          .filter((layer) => layer.layerType === 'color-cycle')
          .map((layer) => layer.id)
      );

      try {
        colorCycleBrushManager.cleanupOrphanedBrushes(colorCycleLayerIds);
      } catch (error) {
        console.warn('[Store] Failed to cleanup orphaned color cycle brushes during load:', error);
      }

      const now = Date.now();
      const projectWidth = postLoadState.project?.width ?? loadedProject.width ?? 0;
      const projectHeight = postLoadState.project?.height ?? loadedProject.height ?? 0;

      for (const layer of postLoadState.layers) {
        if (layer.layerType !== 'color-cycle' || !layer.colorCycleData?.colorCycleBrush) {
          continue;
        }

        const brush = layer.colorCycleData.colorCycleBrush as ColorCycleBrushImplementation & {
          setLayerId?: (layerId: string) => void;
          isUsingWebGL?: () => boolean;
        };

        try {
          brush.setLayerId?.(layer.id);
        } catch (error) {
          console.warn('[Store] Failed to set layerId on restored color cycle brush:', error);
        }

        colorCycleBrushManager.brushes.set(layer.id, brush);
        colorCycleBrushManager.brushMetadata.set(layer.id, {
          layerId: layer.id,
          created: now,
          lastUsed: now,
          width: layer.colorCycleData.canvas?.width ?? projectWidth,
          height: layer.colorCycleData.canvas?.height ?? projectHeight,
          gradientHash: undefined,
          isActive: false,
        });
        colorCycleBrushManager.activeResources.add(layer.id);
        colorCycleBrushManager.activeResources.add(`canvas_${layer.id}`);

        try {
          if (brush.isUsingWebGL?.()) {
            colorCycleBrushManager.activeResources.add(`webgl_${layer.id}`);
          }
        } catch (error) {
          console.warn('[Store] Failed to register WebGL resource for restored CC brush:', error);
        }
      }

      if (postLoadState.activeLayerId) {
        try {
          colorCycleBrushManager.setActiveState(postLoadState.activeLayerId, true);
        } catch (error) {
          console.warn('[Store] Failed to set active CC brush state during load:', error);
        }
      }
    }

    get().clearHistory();

    setTimeout(() => {
      const current = get();
      if (current.layersNeedRecomposition === false) {
        set({ layersNeedRecomposition: true });
      }
    }, 100);

    get().addNotification({
      type: 'success',
      title: 'Project Loaded',
      message: `${loadedProject.name} has been loaded successfully`,
      timestamp: new Date(),
    });
  };

  const saveProject = async (filename?: string): Promise<void> => {
    const state = get();
    if (!state.project) {
      throw new Error('No project to save');
    }

    try {
      await state.captureCanvasToActiveLayer();

      const freshState = get();
      const projectWithViewState = {
        ...freshState.project!,
        viewState: {
          zoom: freshState.canvas.zoom,
        },
        brushSpecificSettings: freshState.brushSpecificSettings,
        globalBrushSize: freshState.globalBrushSize,
        palette: freshState.palette,
      };

      const preferredName = filename ?? state.projectFilename ?? state.project.name;
      const { fileName: savedFileName, fileHandle } = await saveProjectToFile(
        projectWithViewState,
        preferredName,
        freshState.layers,
        state.projectFileHandle ?? undefined
      );

      set({
        paletteDirty: false,
        projectFilename: savedFileName ?? null,
        projectFileHandle: fileHandle ?? null,
      });

      state.addNotification({
        type: 'success',
        title: 'Project Saved',
        message: `${savedFileName || state.project.name} has been saved successfully`,
        timestamp: new Date(),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      state.addNotification({
        type: 'error',
        title: 'Save Failed',
        message: error instanceof Error ? error.message : 'Failed to save project',
        timestamp: new Date(),
      });
      throw error;
    }
  };

  const loadProject = async (): Promise<void> => {
    const state = get();

    try {
      const { project: loadedProject, fileName, fileHandle } = await loadProjectFromFile();
      await applyLoadedProject(loadedProject);
      set({
        projectFilename: fileName ?? null,
        projectFileHandle: fileHandle ?? null,
      });
    } catch (error) {
      state.addNotification({
        type: 'error',
        title: 'Load Failed',
        message: error instanceof Error ? error.message : 'Failed to load project',
        timestamp: new Date(),
      });
      throw error;
    }
  };

  const importProject = async (
    project: Project,
    options?: { fileName?: string | null }
  ): Promise<void> => {
    const state = get();

    try {
      await applyLoadedProject(project);
      set({
        projectFilename: options?.fileName ?? null,
        projectFileHandle: null,
      });
    } catch (error) {
      state.addNotification({
        type: 'error',
        title: 'Load Failed',
        message: error instanceof Error ? error.message : 'Failed to load project',
        timestamp: new Date(),
      });
      throw error;
    }
  };

  const exportProject = async (
    format: 'png',
    options: { quality?: number; scale?: number } = {}
  ): Promise<void> => {
    const state = get();
    if (!state.project) {
      throw new Error('No project to export');
    }

    try {
      if (format === 'png') {
        await exportProjectAsPNG(state.project, state.layers, options);
        state.addNotification({
          type: 'success',
          title: 'Export Complete',
          message: `${state.project.name} has been exported as PNG`,
          timestamp: new Date(),
        });
      } else {
        throw new Error(`Unsupported export format: ${format}`);
      }
    } catch (error) {
      state.addNotification({
        type: 'error',
        title: 'Export Failed',
        message: error instanceof Error ? error.message : 'Failed to export project',
        timestamp: new Date(),
      });
      throw error;
    }
  };

  const newProject = (width: number, height: number, name = 'Untitled'): void => {
    const currentState = get();
    const layerIdFactory = () => `layer-${Date.now()}-${Math.random()}`;
    const existingCustomBrushes = currentState.project?.customBrushes ?? [];
    const existingDefaultCustomBrushId = currentState.project?.defaultCustomBrushId ?? null;

    const defaultLayerId = layerIdFactory();
    const defaultFramebuffer = new OffscreenCanvas(width, height);
    const defaultLayer: Layer = {
      id: defaultLayerId,
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      order: 0,
      locked: false,
      transparencyLocked: false,
      imageData: new ImageData(width, height),
      framebuffer: defaultFramebuffer,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
    };

    const colorCycleLayerId = layerIdFactory();
    const colorCycleFramebuffer = new OffscreenCanvas(width, height);
    const colorCycleCanvas =
      typeof document !== 'undefined'
        ? (() => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            return canvas;
          })()
        : undefined;

    const fallbackColorCycleGradient = [
      { position: 0.0, color: '#ff0000' },
      { position: 0.17, color: '#ff7f00' },
      { position: 0.33, color: '#ffff00' },
      { position: 0.5, color: '#00ff00' },
      { position: 0.67, color: '#0000ff' },
      { position: 0.83, color: '#4b0082' },
      { position: 1.0, color: '#9400d3' },
    ];
    const gradientSource = currentState.tools?.brushSettings?.colorCycleGradient;
    const initialColorCycleGradient = (gradientSource ?? fallbackColorCycleGradient).map((stop) => ({
      position: stop.position,
      color: stop.color,
    }));
    const initialColorCycleSpeed =
      currentState.tools?.brushSettings?.colorCycleSpeed ?? 0.1;

    const colorCycleLayer: Layer = {
      id: colorCycleLayerId,
      name: 'CC Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      order: 1,
      locked: false,
      transparencyLocked: false,
      imageData: null,
      framebuffer: colorCycleFramebuffer,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        mode: 'brush',
        gradient: initialColorCycleGradient,
        isAnimating: true,
        brushSpeed: initialColorCycleSpeed,
        flowMode: currentState.tools?.brushSettings?.colorCycleFlowMode ?? 'forward',
        canvas: colorCycleCanvas,
      },
    };

    const newPalette = createDefaultPalette();
    const newProject: Project = {
      id: `project-${Date.now()}-${Math.random()}`,
      name,
      width,
      height,
      layers: [],
      backgroundColor: 'transparent',
      createdAt: new Date(),
      updatedAt: new Date(),
      customBrushes: existingCustomBrushes,
      defaultCustomBrushId: existingDefaultCustomBrushId,
      brushSpecificSettings: {},
      exportLayout: createDefaultExportLayout(),
      palette: newPalette,
    };

    const normalizedProject = normalizeProject(newProject);
    const normalizedPalette = normalizedProject.palette ?? createDefaultPalette();
    const projectWithPalette = {
      ...normalizedProject,
      palette: normalizedPalette,
    };
    const normalizedLayers = normalizeLayers([defaultLayer, colorCycleLayer]);
    const syncedLayers = syncPercentOffsetsFromPixels(normalizedLayers, normalizedProject);

    setActiveHistoryDocument(normalizedProject.id);

    set({
      project: projectWithPalette,
      palette: normalizedPalette,
      paletteDirty: false,
      projectFilename: null,
      projectFileHandle: null,
      layers: syncedLayers,
      activeLayerId: defaultLayerId,
      selectedLayerIds: defaultLayerId ? [defaultLayerId] : [],
      referenceLayerId: null,
      canvas: {
        ...get().canvas,
        canvasWidth: width,
        canvasHeight: height,
      },
      layersNeedRecomposition: true,
    });

    if (typeof window !== 'undefined') {
      setTimeout(() => {
        try {
          get().initColorCycleForLayer(colorCycleLayerId, width, height);
        } catch (error) {
          logError('[Store] Failed to initialize default color cycle layer', error);
        }
      }, 0);
    }

    get().clearHistory();

    persistCustomBrushes();
  };

  const compositeLayersToCanvas = (targetCanvas: HTMLCanvasElement): void => {
    const state = get();

    const createLayerTransferCanvas = (width: number, height: number) => {
      if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(width, height);
      }
      const layerCanvas = document.createElement('canvas');
      layerCanvas.width = width;
      layerCanvas.height = height;
      return layerCanvas;
    };

    try {
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
      baseCtx.imageSmoothingEnabled = !isPixelBrush;

      const manager = colorCycleBrushManager ?? getColorCycleBrushManager();

      const drawLayers = (
        ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
      ) => {
        ctx.clearRect(0, 0, expectedWidth, expectedHeight);

        if (state.project?.backgroundColor && state.project.backgroundColor !== 'transparent') {
          ctx.fillStyle = state.project.backgroundColor;
          ctx.fillRect(0, 0, expectedWidth, expectedHeight);
        }

        const sortedLayers = [...state.layers].sort((a, b) => a.order - b.order);

        for (const layer of sortedLayers) {
          try {
            if (!layer.visible) continue;

            if (
              layer.layerType === 'color-cycle' &&
              layer.colorCycleData?.canvas &&
              layer.colorCycleData?.mode !== 'recolor'
            ) {
              const brush = manager?.getBrush(layer.id);
              const wantPlaying = Boolean(layer.colorCycleData.isAnimating);

              if (brush) {
                try {
                  const playing = typeof brush.isPlaying === 'function' ? brush.isPlaying() : false;

                  if (wantPlaying && !playing) {
                    brush.startAnimation?.();
                  } else if (!wantPlaying && playing) {
                    brush.stopAnimation?.();
                  }

                  if (wantPlaying) {
                    brush.updateAnimation?.();
                  }
                  brush.renderDirectToCanvas?.(layer.colorCycleData.canvas, layer.id);
                } catch (error) {
                  logError('[compose] CC advance/render failed', error);
                }
              }

              ctx.globalCompositeOperation = layer.blendMode;
              ctx.globalAlpha = layer.opacity;
              ctx.drawImage(layer.colorCycleData.canvas, 0, 0);
              continue;
            }

            if (
              layer.layerType === 'color-cycle' &&
              layer.colorCycleData?.mode === 'recolor' &&
              layer.colorCycleData.canvas
            ) {
              ctx.globalCompositeOperation = layer.blendMode;
              ctx.globalAlpha = layer.opacity;
              ctx.drawImage(layer.colorCycleData.canvas, 0, 0);
              continue;
            }

            if (!layer.imageData) {
              continue;
            }

            const layerImageData = layer.imageData;
            const layerCanvas = createLayerTransferCanvas(layerImageData.width, layerImageData.height);
            const layerCtx = layerCanvas.getContext(
              '2d',
              { willReadFrequently: true } as CanvasRenderingContext2DSettings
            ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
            if (!layerCtx) {
              continue;
            }
            layerCtx.putImageData(layerImageData, 0, 0);
            ctx.globalCompositeOperation = layer.blendMode;
            ctx.globalAlpha = layer.opacity;
            ctx.drawImage(layerCanvas as CanvasImageSource, 0, 0);
          } catch (layerError) {
            logError('[compose] Layer compose error', layerError);
          }
        }

        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;
      };

      const renderWithFallback = () => {
        drawLayers(baseCtx);
        get().setCurrentCompositeBitmap(null);
      };

      if (compositeBitmapManager.isSupported()) {
        void compositeBitmapManager
          .render(expectedWidth, expectedHeight, drawLayers, targetCanvas)
          .then((bitmap) => {
            const setBitmap = get().setCurrentCompositeBitmap;
            setBitmap(bitmap ?? null);
          })
          .catch((error) => {
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
  };

  const captureCanvasToActiveLayer = async (
    sourceCanvas?: HTMLCanvasElement,
    roi?: CaptureROI
  ): Promise<void> => {
    const state = get();

    if (state.history.isCapturing) {
      return;
    }
    if (!state.project || state.layers.length === 0) {
      return;
    }
    if (!sourceCanvas) {
      return;
    }

    const ctx = sourceCanvas.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings
    ) as CanvasRenderingContext2D | null;
    if (!ctx) {
      return;
    }

    try {
      const projectWidth = state.project.width;
      const projectHeight = state.project.height;
      const captureWidth = Math.min(projectWidth, sourceCanvas.width);
      const captureHeight = Math.min(projectHeight, sourceCanvas.height);

      const normalizedRoi = normalizeCaptureROI(roi, captureWidth, captureHeight);
      const captureX = normalizedRoi ? normalizedRoi.x : 0;
      const captureY = normalizedRoi ? normalizedRoi.y : 0;
      const regionWidth = normalizedRoi ? normalizedRoi.width : captureWidth;
      const regionHeight = normalizedRoi ? normalizedRoi.height : captureHeight;

      const capturedImageData = ctx.getImageData(captureX, captureY, regionWidth, regionHeight);

      const activeLayerId = state.activeLayerId || state.layers[0]?.id;
      if (!activeLayerId) {
        return;
      }

      set((currentState) => {
        const updatedLayers = currentState.layers.map((layer) => {
          if (layer.id !== activeLayerId) {
            return layer;
          }

          const fb = layer.framebuffer;
          if (fb.width !== captureWidth || fb.height !== captureHeight) {
            fb.width = captureWidth;
            fb.height = captureHeight;
          }

          const framebufferCtx = fb.getContext(
            '2d',
            { willReadFrequently: true } as CanvasRenderingContext2DSettings
          ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
          if (framebufferCtx) {
            if (normalizedRoi) {
              framebufferCtx.putImageData(capturedImageData, captureX, captureY);
            } else {
              framebufferCtx.clearRect(0, 0, fb.width, fb.height);
              framebufferCtx.putImageData(capturedImageData, 0, 0);
            }
          }

          const baseImageData =
            layer.imageData &&
            layer.imageData.width === captureWidth &&
            layer.imageData.height === captureHeight
              ? layer.imageData
              : null;

          const mergedImageData = normalizedRoi
            ? mergeImageDataRegion(
                baseImageData,
                capturedImageData,
                captureX,
                captureY,
                captureWidth,
                captureHeight
              )
            : capturedImageData;

          let nextAlignment = layer.alignment;
          const project = currentState.project;
          if (project && nextAlignment && nextAlignment.positioning === 'auto') {
            try {
              const layerForMetrics: Layer = {
                ...layer,
                imageData: mergedImageData,
                alignment: {
                  ...nextAlignment,
                  offsetPercent: undefined,
                  offsetPx: undefined,
                },
              };
              const percentOffset = computeLayerPercentOffset(layerForMetrics, project);
              const safeWidth = Math.max(1, project.width);
              const safeHeight = Math.max(1, project.height);
              nextAlignment = {
                ...nextAlignment,
                offsetPercent: percentOffset,
                offsetPx: {
                  x: Math.round((percentOffset.x / 100) * safeWidth),
                  y: Math.round((percentOffset.y / 100) * safeHeight),
                },
              };
            } catch (error) {
              console.warn('[captureCanvasToActiveLayer] Failed to sync percent alignment', error);
            }
          }

          const updatedLayer: Layer = {
            ...layer,
            imageData: mergedImageData,
            alignment: nextAlignment,
            version: (layer.version || 0) + 1,
          };

          if (updatedLayer.layerType !== layer.layerType) {
            console.error('🚨 LAYER TYPE CORRUPTION IN CAPTURE!', {
              layerId: layer.id?.substring(0, 20),
              originalType: layer.layerType,
              corruptedType: updatedLayer.layerType,
            });
            updatedLayer.layerType = layer.layerType;
          }

          return updatedLayer;
        });

        const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, currentState.project ?? null);
        return {
          layers: syncedLayers,
          layersNeedRecomposition: true,
        };
      });

      const nextState = get();
      const activeLayer = nextState.layers.find((layer) => layer.id === activeLayerId);
      if (activeLayer && activeLayer.layerType === 'color-cycle') {
        try {
          nextState.updateLayer(activeLayerId, {
            colorCycleData: {
              ...(activeLayer.colorCycleData ?? {}),
            },
          });
        } catch (error) {
          console.warn('[captureCanvasToActiveLayer] Failed to flag CC framebuffer update', error);
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        console.warn('[captureCanvasToActiveLayer] Canvas capture blocked by CORS/security policy');
        return;
      }
      logError('[captureCanvasToActiveLayer] Failed', error);
      throw error;
    }
  };

  const captureCanvasToLayer = async (
    sourceCanvas: HTMLCanvasElement,
    targetLayerId: string | null
  ): Promise<void> => {
    const state = get();
    if (state.history.isCapturing) {
      return;
    }
    if (!state.project || state.layers.length === 0) {
      return;
    }
    if (!targetLayerId) {
      return;
    }

    const ctx = sourceCanvas.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings
    ) as CanvasRenderingContext2D | null;
    if (!ctx) {
      return;
    }

    try {
      const captureWidth = Math.min(state.project.width, sourceCanvas.width);
      const captureHeight = Math.min(state.project.height, sourceCanvas.height);
      const imageData = ctx.getImageData(0, 0, captureWidth, captureHeight);

      const targetLayer = state.layers.find((layer) => layer.id === targetLayerId);
      if (!targetLayer) {
        return;
      }

      set((currentState) => {
        const updatedLayers = currentState.layers.map((layer) => {
          if (layer.id !== targetLayerId) {
            return layer;
          }

          const fb = layer.framebuffer;
          if (fb.width !== imageData.width || fb.height !== imageData.height) {
            fb.width = imageData.width;
            fb.height = imageData.height;
          }

          const ctx2 = fb.getContext(
            '2d',
            { willReadFrequently: true } as CanvasRenderingContext2DSettings
          ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
          if (ctx2) {
            ctx2.clearRect(0, 0, fb.width, fb.height);
            ctx2.putImageData(imageData, 0, 0);
          }

          return {
            ...layer,
            imageData,
          };
        });

        const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, currentState.project ?? null);
        return {
          layers: syncedLayers,
          layersNeedRecomposition: true,
        };
      });
    } catch (error) {
      console.error('Capture to specific layer failed with error:', error);
    }
  };

  return {
    setProject,
    updateProject,
    applyLoadedProject,
    saveProject,
    loadProject,
    importProject,
    exportProject,
    newProject,
    compositeLayersToCanvas,
    captureCanvasToActiveLayer,
    captureCanvasToLayer,
  };
};
