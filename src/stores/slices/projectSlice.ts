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
import { createProjectLifecycle } from '@/stores/helpers/projectLifecycle';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from '../../constants/canvas';
import { adjustHueLightnessSaturation } from '@/utils/imageProcessing';
import { createCustomBrushPreset } from '@/utils/customBrushPreset';

type AppState = import('../useAppStore').AppState;
type CustomBrushSnapshot = {
  brushes: CustomBrush[];
  defaultCustomBrushId: string | null;
} | null;

const cloneImageData = (source: ImageData): ImageData => {
  return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
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
  saveProject: (filename?: string) => Promise<void>;
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
  listCustomBrushes: () => CustomBrush[];
  setProjectDimensions: (width: number, height: number) => void;
  resizeProjectCanvas: (width: number, height: number) => Promise<void>;
}

export interface ProjectSliceOptions {
  colorCycleBrushManager: ColorCycleBrushManager | null;
  persistCustomBrushes: () => void;
  getLastCustomBrushSnapshot: () => CustomBrushSnapshot;
  syncPercentOffsetsFromPixels: (layers: Layer[], project: Project | null) => Layer[];
  captureCanvasToActiveLayer: AppState['captureCanvasToActiveLayer'];
}

export const createProjectSlice =
  ({
    colorCycleBrushManager,
    persistCustomBrushes,
    getLastCustomBrushSnapshot,
    syncPercentOffsetsFromPixels,
    captureCanvasToActiveLayer,
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
      captureCanvasToActiveLayer,
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
        };

        const nextLayers = syncPercentOffsetsFromPixels(state.layers, updatedProject);

        return {
          project: updatedProject,
          layers: nextLayers,
        };
      });
    };

    const resizeProjectCanvas = async (width: number, height: number) => {
      const state = get();
      if (!state.project) {
        return;
      }

      const oldWidth = state.project.width;
      const oldHeight = state.project.height;

      const offsetX = (width - oldWidth) / 2;
      const offsetY = (height - oldHeight) / 2;

      let resizedLayers: Layer[] = state.layers;

      if (typeof OffscreenCanvas !== 'undefined') {
        resizedLayers = state.layers.map((layer) => {
          const framebuffer = layer.framebuffer;
          const imageData = layer.imageData;

          if (!framebuffer) {
            return layer;
          }

          const newFramebuffer = new OffscreenCanvas(width, height);
          const newCtx = newFramebuffer.getContext('2d', {
            willReadFrequently: true,
          } as CanvasRenderingContext2DSettings) as OffscreenCanvasRenderingContext2D | null;

          if (!newCtx) {
            return layer;
          }

          const oldCtx = framebuffer.getContext('2d', {
            willReadFrequently: true,
          } as CanvasRenderingContext2DSettings) as OffscreenCanvasRenderingContext2D | null;

          if (oldCtx && imageData) {
            oldCtx.clearRect(0, 0, framebuffer.width, framebuffer.height);
            oldCtx.putImageData(imageData, 0, 0);
          }

          newCtx.drawImage(framebuffer as CanvasImageSource, offsetX, offsetY);
          const newImageData = newCtx.getImageData(0, 0, width, height);

          return {
            ...layer,
            imageData: newImageData,
            framebuffer: newFramebuffer,
          };
        });
      }

      set((current) => {
        if (!current.project) {
          return current;
        }

        const updatedProject: Project = {
          ...current.project,
          width,
          height,
          updatedAt: new Date(),
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
        };
      });

      get().setLayersNeedRecomposition(true);
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
        const brushSettings: BrushSettings = {
          ...state.tools.brushSettings,
          brushShape: BrushShape.CUSTOM,
          selectedCustomBrush: brush.id,
          size: targetSize,
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
          globalBrushSize: targetSize,
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

        const updatedProject: Project = {
          ...state.project,
          customBrushes: [
            ...state.project.customBrushes,
            {
              ...tempBrush,
              imageData: finalImageData,
              thumbnail: finalThumbnail,
            },
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
              currentBrushTip: undefined,
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
        // Verbose Goblet/WebGL export logs are noisy in day-to-day use; keep them
        // opt-in via explicit env or UI toggle instead of defaulting on in dev.
        enableGobletDiagnostics: process.env.NEXT_PUBLIC_VESSEL_GOBLET_DEBUG === 'true',
        htmlTitle: 'Goblet',
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
        set((state) => ({
          webglExportSettings: {
            ...state.webglExportSettings,
            ...rest,
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
      listCustomBrushes,
      setProjectDimensions,
      resizeProjectCanvas,
    };
  };
