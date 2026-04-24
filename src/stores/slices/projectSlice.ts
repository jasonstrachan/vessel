import type { StateCreator } from 'zustand';
import type {
  Project,
  ExportContainerLayout,
  WebGLExportSettings,
  CustomBrush,
  Layer,
  BrushSettings,
} from '@/types';
import { BrushShape } from '@/types';
import {
  cloneExportLayout,
  createDefaultExportLayout,
  createDefaultPalette,
} from '@/utils/layoutDefaults';
import { normalizeCanvasShape } from '@/utils/canvasShape';
import { createProjectLifecycle, type SaveProjectRequest } from '@/stores/helpers/projectLifecycle';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import {
  captureResizeHistoryBaseline,
  recordResizeHistory,
} from '@/stores/helpers/resizeHistory';
import { flushPendingToolWork } from '@/utils/toolFlushRegistry';
import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from '../../constants/canvas';
import { adjustHueLightnessSaturation } from '@/utils/imageProcessing';
import { createCustomBrushPreset } from '@/utils/customBrushPreset';

type AppState = import('../useAppStore').AppState;
type CustomBrushSnapshot = {
  brushes: CustomBrush[];
  defaultCustomBrushId: string | null;
} | null;

type ColorCycleLayerSnapshot = {
  paintBuffer: ArrayBuffer;
  gradientIdBuffer?: ArrayBuffer;
  gradientDefIdBuffer?: ArrayBuffer;
  speedBuffer?: ArrayBuffer;
  flowBuffer?: ArrayBuffer;
  phaseBuffer?: ArrayBuffer;
  hasContent: boolean;
  strokeCounter: number;
};

const cloneImageData = (source: ImageData): ImageData => {
  return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
};

const getCanvasContext = (
  canvas: HTMLCanvasElement | OffscreenCanvas | null
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null => {
  if (!canvas) {
    return null;
  }
  return canvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
};

const createCanvasSurface = (
  width: number,
  height: number,
  options: { forceDom?: boolean } = {}
): HTMLCanvasElement | OffscreenCanvas | null => {
  if (typeof document !== 'undefined' && (options.forceDom || typeof OffscreenCanvas === 'undefined')) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  if (!options.forceDom && typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }

  return null;
};

const resolveSourceImageData = (
  sourceCanvas: HTMLCanvasElement | OffscreenCanvas | null | undefined,
  sourceImageData: ImageData | null | undefined
): ImageData | null => {
  const preferCanvasPixels = process.env.NODE_ENV !== 'test';
  const sourceCtx = sourceCanvas ? getCanvasContext(sourceCanvas) : null;
  const canvasImageData = sourceCanvas && sourceCtx
    ? sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)
    : null;

  if (preferCanvasPixels && canvasImageData) {
    return canvasImageData;
  }

  if (sourceImageData) {
    return sourceImageData;
  }

  return canvasImageData;
};

const scaleImageDataNearest = (
  sourceImageData: ImageData,
  width: number,
  height: number
): ImageData => {
  if (sourceImageData.width === width && sourceImageData.height === height) {
    return cloneImageData(sourceImageData);
  }

  const scaled = new ImageData(width, height);
  const source = sourceImageData.data;
  const target = scaled.data;
  const sourceWidth = sourceImageData.width;
  const sourceHeight = sourceImageData.height;

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / width));
      const sourceIndex = (sourceY * sourceWidth + sourceX) * 4;
      const targetIndex = (y * width + x) * 4;

      target[targetIndex] = source[sourceIndex];
      target[targetIndex + 1] = source[sourceIndex + 1];
      target[targetIndex + 2] = source[sourceIndex + 2];
      target[targetIndex + 3] = source[sourceIndex + 3];
    }
  }

  return scaled;
};

const scaleScalarBufferNearest = (
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number
): Uint8Array => {
  const scaled = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / width));
      scaled[y * width + x] = source[sourceY * sourceWidth + sourceX] ?? 0;
    }
  }

  return scaled;
};

const scaleScalarBufferNearest16 = (
  source: Uint16Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number
): Uint16Array => {
  const scaled = new Uint16Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / width));
      scaled[y * width + x] = source[sourceY * sourceWidth + sourceX] ?? 0;
    }
  }

  return scaled;
};

const scaleColorCycleSnapshot = ({
  snapshot,
  sourceWidth,
  sourceHeight,
  width,
  height,
}: {
  snapshot: ColorCycleLayerSnapshot;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
}): ColorCycleLayerSnapshot => {
  const scaleUint8Buffer = (buffer?: ArrayBuffer): ArrayBuffer | undefined => {
    if (!buffer) {
      return undefined;
    }
    const source = new Uint8Array(buffer);
    if (source.length !== sourceWidth * sourceHeight) {
      return undefined;
    }
    return scaleScalarBufferNearest(source, sourceWidth, sourceHeight, width, height).buffer.slice(0) as ArrayBuffer;
  };

  const scaleUint16Buffer = (buffer?: ArrayBuffer): ArrayBuffer | undefined => {
    if (!buffer) {
      return undefined;
    }
    const source = new Uint16Array(buffer);
    if (source.length !== sourceWidth * sourceHeight) {
      return undefined;
    }
    return scaleScalarBufferNearest16(source, sourceWidth, sourceHeight, width, height).buffer.slice(0) as ArrayBuffer;
  };

  const scaledPaintBuffer = scaleUint8Buffer(snapshot.paintBuffer);
  if (!scaledPaintBuffer) {
    return snapshot;
  }

  return {
    ...snapshot,
    paintBuffer: scaledPaintBuffer,
    gradientIdBuffer: scaleUint8Buffer(snapshot.gradientIdBuffer),
    gradientDefIdBuffer: scaleUint16Buffer(snapshot.gradientDefIdBuffer),
    speedBuffer: scaleUint8Buffer(snapshot.speedBuffer),
    flowBuffer: scaleUint8Buffer(snapshot.flowBuffer),
    phaseBuffer: scaleUint8Buffer(snapshot.phaseBuffer),
  };
};

const scaleCanvasContent = (
  sourceCanvas: HTMLCanvasElement | OffscreenCanvas | null | undefined,
  sourceImageData: ImageData | null | undefined,
  width: number,
  height: number,
  options: { forceDom?: boolean } = {}
): {
  canvas: HTMLCanvasElement | OffscreenCanvas | null;
  imageData: ImageData | null;
} => {
  const target = createCanvasSurface(width, height, options);
  const targetCtx = getCanvasContext(target);
  if (!target || !targetCtx) {
    return { canvas: null, imageData: null };
  }

  const resolvedSourceImageData = resolveSourceImageData(sourceCanvas, sourceImageData);
  if (!resolvedSourceImageData) {
    return { canvas: target, imageData: targetCtx.getImageData(0, 0, width, height) };
  }

  targetCtx.clearRect(0, 0, width, height);
  const scaledImageData = scaleImageDataNearest(resolvedSourceImageData, width, height);
  targetCtx.putImageData(scaledImageData, 0, 0);

  return {
    canvas: target,
    imageData: scaledImageData,
  };
};

const generateThumbnailFromImageData = (imageData: ImageData): string => {
  if (typeof document === 'undefined') {
    return '';
  }

  const size = 64;
  const thumbnailCanvas = document.createElement('canvas');
  thumbnailCanvas.width = size;
  thumbnailCanvas.height = size;
  const thumbnailCtx = thumbnailCanvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | null;

  if (!thumbnailCtx) {
    return '';
  }

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = imageData.width;
  tempCanvas.height = imageData.height;
  const tempCtx = tempCanvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | null;

  if (!tempCtx) {
    return '';
  }

  tempCtx.putImageData(imageData, 0, 0);
  const scale = Math.min(size / imageData.width, size / imageData.height);
  const scaledWidth = imageData.width * scale;
  const scaledHeight = imageData.height * scale;
  const offsetX = (size - scaledWidth) / 2;
  const offsetY = (size - scaledHeight) / 2;

  thumbnailCtx.clearRect(0, 0, size, size);
  thumbnailCtx.drawImage(
    tempCanvas,
    0,
    0,
    imageData.width,
    imageData.height,
    offsetX,
    offsetY,
    scaledWidth,
    scaledHeight
  );

  return thumbnailCanvas.toDataURL();
};

const resolveBrushForSaving = (state: AppState, customBrushId: string): CustomBrush | null => {
  if (
    state.temporaryCustomBrush &&
    state.temporaryCustomBrush.id === customBrushId
  ) {
    return state.temporaryCustomBrush;
  }

  const brushTip = state.tools.brushSettings.currentBrushTip;
  if (
    brushTip &&
    state.tools.brushSettings.brushShape === BrushShape.CUSTOM &&
    state.tools.brushSettings.selectedCustomBrush === customBrushId &&
    brushTip.brushId === customBrushId
  ) {
    const clonedImageData = cloneImageData(brushTip.imageData);
    const width = brushTip.width ?? brushTip.imageData.width;
    const height = brushTip.height ?? brushTip.imageData.height;
    const naturalWidth = brushTip.naturalWidth ?? width;
    const naturalHeight = brushTip.naturalHeight ?? height;

    return {
      id: customBrushId,
      name: 'Temp Brush',
      imageData: clonedImageData,
      thumbnail: generateThumbnailFromImageData(clonedImageData),
      width,
      height,
      createdAt: Date.now(),
      naturalWidth,
      naturalHeight,
      maxDimension: brushTip.maxDimension ?? Math.max(naturalWidth, naturalHeight),
      colorCycle: brushTip.colorCycle,
    };
  }

  return null;
};

export interface ProjectSlice {
  project: Project | null;
  projectFilename: string | null;
  projectFileHandle: FileSystemFileHandle | null;
  webglExportSettings: WebGLExportSettings;
  setProject: (project: Project) => void;
  updateProject: (updates: Partial<Project>) => void;
  setExportLayout: (layout: ExportContainerLayout) => void;
  updateWebglExportSettings: (settings: Partial<WebGLExportSettings>) => void;
  saveProject: (request?: SaveProjectRequest) => Promise<void>;
  loadProject: () => Promise<void>;
  importProject: (
    project: Project,
    options?: { fileName?: string | null; fileHandle?: FileSystemFileHandle | null }
  ) => Promise<void>;
  exportProject: (
    format: 'png',
    options?: { quality?: number; scale?: number }
  ) => Promise<void>;
  newProject: (width: number, height: number, name?: string) => void;
  addCustomBrush: (brush: CustomBrush) => void;
  updateCustomBrush: (brushId: string, updates: Partial<CustomBrush>) => void;
  removeCustomBrush: (brushId: string) => void;
  setDefaultCustomBrush: (brushId: string | null) => void;
  saveCustomBrushAsPreset: (customBrushId: string) => void;
  getCustomBrushById: (brushId: string) => CustomBrush | null;
  getCustomBrushByIdUnsafe: (brushId: string) => CustomBrush | null;
  listCustomBrushes: () => CustomBrush[];
  setProjectDimensions: (width: number, height: number) => void;
  resizeProjectCanvas: (width: number, height: number) => Promise<void>;
}

export interface ProjectSliceOptions {
  colorCycleBrushManager: ColorCycleBrushManager | null;
  persistCustomBrushes: () => void;
  getLastCustomBrushSnapshot: () => CustomBrushSnapshot;
  syncPercentOffsetsFromPixels: (layers: Layer[], project: Project | null) => Layer[];
}

export const createProjectSlice =
  ({
    colorCycleBrushManager,
    persistCustomBrushes,
    getLastCustomBrushSnapshot,
    syncPercentOffsetsFromPixels,
  }: ProjectSliceOptions): StateCreator<AppState, [], [], ProjectSlice> =>
  (set, get) => {
    const {
      setProject,
      updateProject,
      saveProject,
      loadProject,
      importProject,
      exportProject,
      newProject,
    } = createProjectLifecycle({
      set,
      get,
      colorCycleBrushManager,
      persistCustomBrushes,
      getLastCustomBrushSnapshot,
      syncPercentOffsetsFromPixels,
    });

    const initialPalette = createDefaultPalette();

    const setProjectDimensions = (width: number, height: number) => {
      set((state) => {
        if (!state.project) {
          return state;
        }

        if (state.project.width === width && state.project.height === height) {
          return state;
        }

        const updatedProject: Project = {
          ...state.project,
          width,
          height,
          updatedAt: new Date(),
          canvasShape: normalizeCanvasShape(state.project.canvasShape, width, height),
        };

        const nextLayers = syncPercentOffsetsFromPixels(state.layers, updatedProject);

        return {
          project: updatedProject,
          layers: nextLayers,
        };
      });
    };

    const resizeProjectCanvas = async (width: number, height: number) => {
      await flushPendingToolWork();

      const state = get();
      if (!state.project) {
        return;
      }
      if (state.project.width === width && state.project.height === height) {
        return;
      }

      const historyBaseline = captureResizeHistoryBaseline({
        project: state.project,
        layers: state.layers,
      });
      const colorCycleSnapshots = new Map<string, ColorCycleLayerSnapshot>();
      if (colorCycleBrushManager) {
        state.layers.forEach((layer) => {
          if (layer.layerType !== 'color-cycle' || layer.colorCycleData?.mode === 'recolor') {
            return;
          }

          const brush = state.getLayerColorCycleBrush(layer.id) ?? colorCycleBrushManager.getBrush(layer.id);
          const snapshot = brush?.getLayerSnapshot?.(layer.id);
          if (!snapshot?.paintBuffer) {
            return;
          }

          colorCycleSnapshots.set(layer.id, {
            paintBuffer: snapshot.paintBuffer.slice(0),
            gradientIdBuffer: snapshot.gradientIdBuffer?.slice(0),
            gradientDefIdBuffer: snapshot.gradientDefIdBuffer?.slice(0),
            speedBuffer: snapshot.speedBuffer?.slice(0),
            flowBuffer: snapshot.flowBuffer?.slice(0),
            phaseBuffer: snapshot.phaseBuffer?.slice(0),
            hasContent: snapshot.hasContent,
            strokeCounter: snapshot.strokeCounter,
          });
        });
      }

      let resizedLayers: Layer[] = state.layers;
      resizedLayers = state.layers.map((layer) => {
        const scaledLayer = scaleCanvasContent(layer.framebuffer, layer.imageData, width, height);
        if (!scaledLayer.canvas || !scaledLayer.imageData) {
          return layer;
        }

        if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
          return {
            ...layer,
            imageData: scaledLayer.imageData,
            framebuffer: scaledLayer.canvas,
            version: (layer.version ?? 0) + 1,
          };
        }

        const scaledColorCycle = scaleCanvasContent(
          layer.colorCycleData.canvas,
          layer.colorCycleData.canvasImageData ?? layer.imageData,
          width,
          height,
          { forceDom: true }
        );
        const scaledEraseMask = layer.colorCycleData.eraseMask || layer.colorCycleData.eraseMaskImageData
          ? scaleCanvasContent(
              layer.colorCycleData.eraseMask,
              layer.colorCycleData.eraseMaskImageData,
              width,
              height,
              { forceDom: true }
            )
          : null;
        const scaledOriginalImage = layer.colorCycleData.recolorSettings?.originalImageData
          ? scaleCanvasContent(
              null,
              layer.colorCycleData.recolorSettings.originalImageData,
              width,
              height
            )
          : null;
        const sourceWidth = Math.max(
          1,
          layer.colorCycleData.canvasWidth ??
            layer.colorCycleData.canvas?.width ??
            layer.imageData?.width ??
            state.project?.width ??
            width
        );
        const sourceHeight = Math.max(
          1,
          layer.colorCycleData.canvasHeight ??
            layer.colorCycleData.canvas?.height ??
            layer.imageData?.height ??
            state.project?.height ??
            height
        );
        const scaledSnapshot = (() => {
          const snapshot = colorCycleSnapshots.get(layer.id);
          if (!snapshot) {
            return null;
          }
          return scaleColorCycleSnapshot({
            snapshot,
            sourceWidth,
            sourceHeight,
            width,
            height,
          });
        })();

        return {
          ...layer,
          imageData: scaledLayer.imageData,
          framebuffer: scaledLayer.canvas,
          version: (layer.version ?? 0) + 1,
          colorCycleData: {
            ...layer.colorCycleData,
            canvas:
              (scaledColorCycle.canvas as HTMLCanvasElement | null) ??
              layer.colorCycleData.canvas,
            canvasImageData:
              scaledColorCycle.imageData ??
              layer.colorCycleData.canvasImageData,
            canvasWidth: width,
            canvasHeight: height,
            gradientIdBuffer:
              scaledSnapshot?.gradientIdBuffer ??
              layer.colorCycleData.gradientIdBuffer,
            gradientDefIdBuffer:
              scaledSnapshot?.gradientDefIdBuffer ??
              layer.colorCycleData.gradientDefIdBuffer,
            eraseMask:
              (scaledEraseMask?.canvas as HTMLCanvasElement | null) ??
              layer.colorCycleData.eraseMask,
            eraseMaskImageData:
              scaledEraseMask?.imageData ??
              layer.colorCycleData.eraseMaskImageData,
            recolorSettings: layer.colorCycleData.recolorSettings
              ? {
                  ...layer.colorCycleData.recolorSettings,
                  originalImageData:
                    scaledOriginalImage?.imageData ??
                    layer.colorCycleData.recolorSettings.originalImageData,
                  indexBuffer: undefined,
                  phaseMap: undefined,
                }
              : undefined,
          },
        };
      });

      set((current) => {
        if (!current.project) {
          return current;
        }

        const updatedProject: Project = {
          ...current.project,
          width,
          height,
          updatedAt: new Date(),
          canvasShape: normalizeCanvasShape(current.project.canvasShape, width, height),
          layers: resizedLayers,
        };

        const nextLayers = syncPercentOffsetsFromPixels(resizedLayers, updatedProject);

        return {
          project: updatedProject,
          layers: nextLayers,
          canvas: {
            ...current.canvas,
            zoom: 1,
            canvasWidth: width,
            canvasHeight: height,
            needsDimensionUpdate: true,
          },
          currentOffscreenCanvas: null,
          currentCompositeBitmap: null,
        };
      });

      get().setLayersNeedRecomposition(true);

      if (colorCycleBrushManager) {
        resizedLayers.forEach((layer) => {
          if (layer.layerType !== 'color-cycle' || layer.colorCycleData?.mode === 'recolor') {
            return;
          }

          const scaledSnapshot = colorCycleSnapshots.get(layer.id);
          const layerCanvas = layer.colorCycleData?.canvas;
          const brush = state.getLayerColorCycleBrush(layer.id) ?? colorCycleBrushManager.getBrush(layer.id);
          if (!scaledSnapshot || !layerCanvas || !brush) {
            return;
          }

          const nextSnapshot = scaleColorCycleSnapshot({
            snapshot: scaledSnapshot,
            sourceWidth: Math.max(1, state.project?.width ?? layerCanvas.width),
            sourceHeight: Math.max(1, state.project?.height ?? layerCanvas.height),
            width,
            height,
          });

          try {
            brush.setTargetCanvas?.(layerCanvas);
            brush.applyLayerSnapshot?.(layer.id, nextSnapshot);
            brush.renderDirectToCanvas?.(layerCanvas, layer.id);

            const layerCtx = layerCanvas.getContext(
              '2d',
              { willReadFrequently: true } as CanvasRenderingContext2DSettings
            );
            const renderedImageData = layerCtx?.getImageData(0, 0, layerCanvas.width, layerCanvas.height);
            if (renderedImageData) {
              get().updateLayer(
                layer.id,
                {
                  imageData: renderedImageData,
                  colorCycleData: {
                    ...(layer.colorCycleData ?? {}),
                    canvas: layerCanvas,
                    canvasImageData: renderedImageData,
                    colorCycleBrush: brush,
                    gradientIdBuffer:
                      nextSnapshot.gradientIdBuffer ??
                      layer.colorCycleData?.gradientIdBuffer,
                    gradientDefIdBuffer:
                      nextSnapshot.gradientDefIdBuffer ??
                      layer.colorCycleData?.gradientDefIdBuffer,
                  },
                },
                { skipColorCycleSync: true }
              );
            }
          } catch {
            // Best effort: the scaled layer canvas still preserves visible pixels.
          }
        });
      }

      await recordResizeHistory({
        beforeProject: historyBaseline.projectSize,
        afterProject: { width, height },
        beforeLayers: historyBaseline.layerSnapshots,
        afterLayers: resizedLayers,
        description: `Resize canvas to ${width}×${height}`,
      });
    };

    const addCustomBrush = (brush: CustomBrush) => {
      set((state) => {
        if (!state.project) {
          return state;
        }

        const naturalWidth = brush.naturalWidth ?? brush.width;
        const naturalHeight = brush.naturalHeight ?? brush.height;
        const maxDimension = brush.maxDimension ?? Math.max(naturalWidth, naturalHeight);
        const brushWithMetadata: CustomBrush = {
          ...brush,
          naturalWidth,
          naturalHeight,
          maxDimension,
        };

        const targetSize = Math.max(1, Math.round(maxDimension));
        const isCurrentlyCustomBrush = state.tools.brushSettings.brushShape === BrushShape.CUSTOM;
        const stableRegularSize = Math.max(
          1,
          Math.round(
            isCurrentlyCustomBrush
              ? (
                  state.tools.brushSettings.lastRegularBrushSize ??
                  state.globalBrushSize ??
                  targetSize
                )
              : (
                  state.tools.brushSettings.size ??
                  state.globalBrushSize ??
                  targetSize
                )
          )
        );
        const brushSettings: BrushSettings = {
          ...state.tools.brushSettings,
          brushShape: BrushShape.CUSTOM,
          selectedCustomBrush: brush.id,
          size: targetSize,
          lastRegularBrushSize: stableRegularSize,
          customBrushSizePercent: 100,
          useSwatchColor: false,
          hueShift: 0,
          lightnessAdjust: 0,
          saturationAdjust: 100,
          pressureEnabled: false,
          minPressure: 99,
          maxPressure: undefined,
        };

        return {
          project: {
            ...state.project,
            customBrushes: [...state.project.customBrushes, brushWithMetadata],
            updatedAt: new Date(),
          },
          globalBrushSize: stableRegularSize,
          tools: {
            ...state.tools,
            brushSettings,
          },
        };
      });
      persistCustomBrushes();
    };

    const updateCustomBrush = (brushId: string, updates: Partial<CustomBrush>) => {
      set((state) => {
        if (!state.project) {
          return state;
        }
        return {
          project: {
            ...state.project,
            customBrushes: state.project.customBrushes.map((brush) =>
              brush.id === brushId ? { ...brush, ...updates } : brush
            ),
            updatedAt: new Date(),
          },
        };
      });
      persistCustomBrushes();
    };

    const removeCustomBrush = (brushId: string) => {
      set((state) => {
        if (!state.project) {
          return state;
        }
        const remaining = state.project.customBrushes.filter((brush) => brush.id !== brushId);
        const resetDefault =
          state.project.defaultCustomBrushId === brushId ? null : state.project.defaultCustomBrushId;

        return {
          project: {
            ...state.project,
            customBrushes: remaining,
            defaultCustomBrushId: resetDefault,
            updatedAt: new Date(),
          },
        };
      });
      persistCustomBrushes();
    };

    const setDefaultCustomBrush = (brushId: string | null) => {
      const state = get();
      if (!state.project) {
        return;
      }
      const targetBrush =
        brushId !== null
          ? state.project.customBrushes.find((brush) => brush.id === brushId) ?? null
          : null;
      const nextDefault = targetBrush ? targetBrush.id : null;

      set((current) => {
        if (!current.project) {
          return current;
        }
        return {
          project: {
            ...current.project,
            defaultCustomBrushId: nextDefault,
            updatedAt: new Date(),
          },
          autosave: {
            ...current.autosave,
            hasUnsavedChanges: true,
            lastDirtyReason: 'project-change',
            lastDirtyAt: new Date(),
          },
        };
      });

      if (targetBrush) {
        const preset = createCustomBrushPreset(targetBrush, { isDefault: true });
        get().setBrushPreset(preset, true);
      }

      persistCustomBrushes();
    };

    const saveCustomBrushAsPreset = (customBrushId: string) => {
      set((state) => {
        if (!state.project) {
          return state;
        }

        const tempBrush = resolveBrushForSaving(state, customBrushId);
        if (!tempBrush) {
          return state;
        }

        const brushSettings = state.tools.brushSettings;
        const hasAdjustments =
          (brushSettings.hueShift ?? 0) !== 0 ||
          (brushSettings.lightnessAdjust ?? 0) !== 0 ||
          (brushSettings.saturationAdjust ?? 100) !== 100;

        const finalImageData = hasAdjustments
          ? adjustHueLightnessSaturation(
              tempBrush.imageData,
              brushSettings.hueShift ?? 0,
              brushSettings.lightnessAdjust ?? 0,
              brushSettings.saturationAdjust ?? 100
            )
          : tempBrush.imageData;

        const finalThumbnail =
          tempBrush.thumbnail && tempBrush.thumbnail.length > 0
            ? tempBrush.thumbnail
            : generateThumbnailFromImageData(finalImageData);

        const savedBrush: CustomBrush = {
          ...tempBrush,
          imageData: finalImageData,
          thumbnail: finalThumbnail,
        };

        const updatedProject: Project = {
          ...state.project,
          customBrushes: [
            ...state.project.customBrushes,
            savedBrush,
          ],
          updatedAt: new Date(),
        };

        const targetSize =
          typeof state.globalBrushSize === 'number' ? state.globalBrushSize : 100;

        return {
          temporaryCustomBrush: null,
          project: updatedProject,
          globalBrushSize: targetSize,
          tools: {
            ...state.tools,
            brushSettings: {
              ...state.tools.brushSettings,
              brushShape: BrushShape.CUSTOM,
              selectedCustomBrush: tempBrush.id,
              currentBrushTip: {
                imageData: savedBrush.imageData,
                brushId: savedBrush.id,
                isColorizable: false,
                width: savedBrush.width,
                height: savedBrush.height,
                naturalWidth: savedBrush.naturalWidth ?? savedBrush.width,
                naturalHeight: savedBrush.naturalHeight ?? savedBrush.height,
                maxDimension: savedBrush.maxDimension ?? Math.max(savedBrush.width, savedBrush.height),
                colorCycle: savedBrush.colorCycle,
              },
              useSwatchColor: false,
              hueShift: 0,
              lightnessAdjust: 0,
              saturationAdjust: 100,
              size: targetSize,
              pressureEnabled: false,
              minPressure: 99,
              maxPressure: undefined,
            },
          },
        };
      });

      persistCustomBrushes();
    };

    const cloneBrush = (brush: CustomBrush): CustomBrush => {
      const { imageData } = brush;
      const clonedImageData = imageData
        ? new ImageData(
            new Uint8ClampedArray(imageData.data),
            imageData.width,
            imageData.height
          )
        : imageData;

      return {
        ...brush,
        imageData: clonedImageData,
      };
    };

    const getCustomBrushById = (brushId: string): CustomBrush | null => {
      if (!brushId) {
        return null;
      }
      const state = get();
      if (!state.project) {
        return null;
      }

      const found = state.project.customBrushes.find((brush) => brush.id === brushId);
      return found ? cloneBrush(found) : null;
    };

    const getCustomBrushByIdUnsafe = (brushId: string): CustomBrush | null => {
      if (!brushId) {
        return null;
      }
      const state = get();
      if (!state.project) {
        return null;
      }
      return state.project.customBrushes.find((brush) => brush.id === brushId) ?? null;
    };

    const listCustomBrushes = (): CustomBrush[] => {
      const state = get();
      if (!state.project) {
        return [];
      }
      return state.project.customBrushes.map((brush) => cloneBrush(brush));
    };

    return {
      project: {
        id: 'default-project',
        name: 'Untitled',
        width: DEFAULT_CANVAS_WIDTH,
        height: DEFAULT_CANVAS_HEIGHT,
        layers: [],
        backgroundColor: 'transparent',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: [],
        defaultCustomBrushId: null,
        brushSpecificSettings: {},
        exportLayout: createDefaultExportLayout(),
        palette: initialPalette,
      },
      projectFilename: null,
      projectFileHandle: null,
      webglExportSettings: {
        includeHiddenLayers: true,
        embedCanvasFallback: false,
        minifyOutput: true,
        bundleFormat: 'single-html',
        gobletVersion: 'goblet2',
        // Verbose Goblet/WebGL export logs are noisy in day-to-day use; keep them
        // opt-in via explicit env or UI toggle instead of defaulting on in dev.
        enableGobletDiagnostics: process.env.NEXT_PUBLIC_VESSEL_GOBLET_DEBUG === 'true',
        htmlTitle: 'Goblet',
        htmlBackgroundColor: '#000000',
        transparencyBackgroundMode: 'checker',
        viewportPreset: 'default',
        designScalePercent: 100,
      },
      setProject,
      updateProject,
      setExportLayout: (layout) =>
        set((state) => {
          if (!state.project) {
            return state;
          }

          return {
            project: {
              ...state.project,
              exportLayout: cloneExportLayout(layout),
              updatedAt: new Date(),
            },
          };
        }),
      updateWebglExportSettings: (settings) => {
        const { enableViewerDiagnostics, ...rest } = settings as Partial<WebGLExportSettings> & {
          enableViewerDiagnostics?: boolean;
        };
        const normalizedDesignScalePercent = Number.isFinite(rest.designScalePercent)
          ? Math.max(25, Math.min(800, Math.round(rest.designScalePercent as number)))
          : undefined;
        const normalizedViewportPreset = rest.viewportPreset === 'default'
          || rest.viewportPreset === 'embed-fill'
          || rest.viewportPreset === 'embed-fit'
          || rest.viewportPreset === 'fixed'
          ? rest.viewportPreset
          : undefined;
        const normalizedHtmlBackgroundColor = typeof rest.htmlBackgroundColor === 'string'
          && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(rest.htmlBackgroundColor.trim())
          ? rest.htmlBackgroundColor.trim().toLowerCase()
          : undefined;
        set((state) => ({
          webglExportSettings: {
            ...state.webglExportSettings,
            ...rest,
            ...(typeof normalizedDesignScalePercent === 'number'
              ? { designScalePercent: normalizedDesignScalePercent }
              : {}),
            ...(normalizedViewportPreset
              ? { viewportPreset: normalizedViewportPreset }
              : {}),
            ...(normalizedHtmlBackgroundColor
              ? { htmlBackgroundColor: normalizedHtmlBackgroundColor }
              : {}),
            ...(typeof enableViewerDiagnostics === 'boolean'
              ? { enableGobletDiagnostics: enableViewerDiagnostics }
              : {}),
          },
        }));
      },
      saveProject,
      loadProject,
      importProject,
      exportProject,
      newProject,
      addCustomBrush,
      updateCustomBrush,
      removeCustomBrush,
      setDefaultCustomBrush,
      saveCustomBrushAsPreset,
      getCustomBrushById,
      getCustomBrushByIdUnsafe,
      listCustomBrushes,
      setProjectDimensions,
      resizeProjectCanvas,
    };
  };
