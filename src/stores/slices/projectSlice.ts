import type { StateCreator } from 'zustand';
import type {
  Project,
  ExportContainerLayout,
  WebGLExportSettings,
  CustomBrush,
  CcCustomTilePattern,
  CcCustomTilePatternPack,
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
  applyColorCycleBrushLayerSnapshotToRuntime,
  hasRecoverableColorCycleRuntimeSource,
  mapDocumentSnapshotToArchiveState,
  readColorCycleBrushLayerSnapshotFromDocumentRead,
  readColorCycleBrushSerializedStateFromRuntime,
  type ColorCycleLayerDocument,
  type ColorCycleLayerDocumentRead,
  type ColorCycleLayerDocumentSnapshot,
  type ColorCycleLayerDocumentState,
  type ColorCycleBrushSerializedStateRuntimeReader,
  type ColorCyclePaintSnapshot,
} from '@/lib/colorCycle/document';
import {
  captureResizeHistoryBaseline,
  recordResizeHistory,
} from '@/stores/helpers/resizeHistory';
import { flushPendingToolWork } from '@/utils/toolFlushRegistry';
import { scaleColorCycleDocumentStateNearest } from '@/stores/helpers/colorCycleResize';
import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from '../../constants/canvas';
import { adjustHueLightnessSaturation } from '@/utils/imageProcessing';
import { createCustomBrushPreset } from '@/utils/customBrushPreset';
import {
  clearCcCustomTilePatternCache,
  normalizeCcCustomTilePattern,
  normalizeCcCustomTilePatternPack,
} from '@/utils/colorCycle/ccCustomTilePattern';

type AppState = import('../useAppStore').AppState;
type CustomBrushSnapshot = {
  brushes: CustomBrush[];
  defaultCustomBrushId: string | null;
} | null;

type PreparedColorCycleResize = {
  layerId: string;
  document: ColorCycleLayerDocument;
  beforeRead: ColorCycleLayerDocumentRead;
  beforeSnapshot: ColorCycleLayerDocumentSnapshot;
  beforeResidency: ColorCycleLayerDocument['residency'];
  beforeArchiveRefs: ColorCycleLayerDocument['archiveRefs'];
  beforeAuditEntries: ReturnType<ColorCycleLayerDocument['getAuditLog']>;
  beforeDirtyBatch: ReturnType<ColorCycleLayerDocument['peekDirtyBatch']>;
  nextState: ColorCycleLayerDocumentState;
  nextSnapshot: ColorCyclePaintSnapshot | null;
  beforeRuntimeSnapshot: ColorCyclePaintSnapshot | null;
  brush: ReturnType<ColorCycleBrushManager['getHistoryBrush']>;
  originalCanvas: HTMLCanvasElement | null;
};

const objectReferencesCcTilePattern = (
  value: unknown,
  patternId: string,
  seen = new WeakSet<object>()
): boolean => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof ImageData !== 'undefined' && value instanceof ImageData)
  ) {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  const record = value as Record<string, unknown>;
  if (record.stampDitherPatternTileId === patternId || record.patternTileId === patternId) {
    return true;
  }

  return Object.values(record).some((entry) => objectReferencesCcTilePattern(entry, patternId, seen));
};

const layerReferencesCcTilePattern = (layer: Layer, patternId: string): boolean => {
  if (objectReferencesCcTilePattern(layer.colorCycleData?.brushState, patternId)) {
    return true;
  }
  const colorCycleBrush = layer.colorCycleData?.colorCycleBrush as
    | ColorCycleBrushSerializedStateRuntimeReader
    | undefined;
  if (colorCycleBrush) {
    try {
      return objectReferencesCcTilePattern(
        readColorCycleBrushSerializedStateFromRuntime(colorCycleBrush),
        patternId,
      );
    } catch {
      return false;
    }
  }
  return false;
};

const projectReferencesCcTilePattern = (
  state: Pick<AppState, 'layers' | 'project'>,
  patternId: string
): boolean => {
  const layers = [
    ...(state.layers ?? []),
    ...(state.project?.layers ?? []),
  ];
  return layers.some((layer) => layerReferencesCcTilePattern(layer, patternId));
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
  newProject: (
    width: number,
    height: number,
    name?: string,
    options?: { preserveRecoverySession?: boolean }
  ) => void;
  addCustomBrush: (brush: CustomBrush) => void;
  updateCustomBrush: (brushId: string, updates: Partial<CustomBrush>) => void;
  removeCustomBrush: (brushId: string) => void;
  addCcCustomTilePattern: (pattern: CcCustomTilePattern) => void;
  removeCcCustomTilePattern: (patternId: string) => void;
  renameCcCustomTilePattern: (patternId: string, name: string) => void;
  addCcCustomTilePatternPack: (pack: CcCustomTilePatternPack) => void;
  renameCcCustomTilePatternPack: (packId: string, name: string) => void;
  removeCcCustomTilePatternPack: (packId: string) => void;
  addCcCustomTilePatternToPack: (packId: string, patternId: string) => void;
  removeCcCustomTilePatternFromPack: (packId: string, patternId: string) => void;
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

      let state = get();
      if (!state.project) {
        return;
      }
      if (state.project.width === width && state.project.height === height) {
        return;
      }

      if (colorCycleBrushManager) {
        for (const layer of state.layers) {
          if (layer.layerType !== 'color-cycle' || layer.colorCycleData?.mode === 'recolor') {
            continue;
          }
          const document = colorCycleBrushManager.getDocument(layer.id);
          const needsWarmup = document?.residency === 'cold-archive-ref'
            || (!document && hasRecoverableColorCycleRuntimeSource(layer));
          if (!needsWarmup) {
            continue;
          }
          const warmed = await get().ensureColorCycleLayerRuntime(layer.id, { target: 'warm' });
          if (!warmed) {
            throw new Error(`Unable to hydrate color-cycle layer "${layer.name}" before resizing.`);
          }
        }
        state = get();
      }

      const historyBaseline = captureResizeHistoryBaseline({
        project: state.project,
        layers: state.layers,
      });
      const preparedColorCycleResizes: PreparedColorCycleResize[] = [];
      if (colorCycleBrushManager) {
        state.layers.forEach((layer) => {
          if (layer.layerType !== 'color-cycle' || layer.colorCycleData?.mode === 'recolor') {
            return;
          }

          const document = colorCycleBrushManager.getDocument(layer.id);
          if (!document) {
            return;
          }
          const beforeRead = document.read();
          if (beforeRead.snapshot.hasContent && !beforeRead.snapshot.paintBuffer) {
            throw new Error(`Color-cycle layer "${layer.name}" has no materialized paint buffer to resize.`);
          }
          const nextState = scaleColorCycleDocumentStateNearest({
            snapshot: beforeRead.snapshot,
            width,
            height,
          });
          const nextSnapshot = readColorCycleBrushLayerSnapshotFromDocumentRead({
            snapshot: nextState,
            version: beforeRead.version,
            pixelVersion: beforeRead.pixelVersion,
          });
          const beforeRuntimeSnapshot = readColorCycleBrushLayerSnapshotFromDocumentRead(beforeRead);
          const brush = colorCycleBrushManager.getHistoryBrush(layer.id);
          if (brush && !nextSnapshot) {
            throw new Error(`Color-cycle layer "${layer.name}" has no canonical runtime snapshot to resize.`);
          }

          preparedColorCycleResizes.push({
            layerId: layer.id,
            document,
            beforeRead,
            beforeSnapshot: beforeRead.snapshot,
            beforeResidency: document.residency,
            beforeArchiveRefs: document.archiveRefs,
            beforeAuditEntries: document.getAuditLog(),
            beforeDirtyBatch: document.peekDirtyBatch(),
            nextState,
            nextSnapshot,
            beforeRuntimeSnapshot,
            brush,
            originalCanvas: layer.colorCycleData?.canvas ?? null,
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
        const scaledSoftEdgeMask = layer.colorCycleData.softEdgeMask || layer.colorCycleData.softEdgeMaskImageData
          ? scaleCanvasContent(
              layer.colorCycleData.softEdgeMask,
              layer.colorCycleData.softEdgeMaskImageData,
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
            eraseMask:
              (scaledEraseMask?.canvas as HTMLCanvasElement | null) ??
              layer.colorCycleData.eraseMask,
            eraseMaskImageData:
              scaledEraseMask?.imageData ??
              layer.colorCycleData.eraseMaskImageData,
            softEdgeMask:
              (scaledSoftEdgeMask?.canvas as HTMLCanvasElement | null) ??
              layer.colorCycleData.softEdgeMask,
            softEdgeMaskImageData:
              scaledSoftEdgeMask?.imageData ??
              layer.colorCycleData.softEdgeMaskImageData,
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

      const migratedColorCycleLayers = new Map<string, Layer>();
      try {
        for (const prepared of preparedColorCycleResizes) {
          const resizedLayer = resizedLayers.find((layer) => layer.id === prepared.layerId);
          if (!resizedLayer?.colorCycleData) {
            throw new Error(`Color-cycle layer ${prepared.layerId} disappeared during resize preparation.`);
          }

          const layerCanvas = resizedLayer.colorCycleData.canvas;
          if (prepared.brush) {
            if (
              !layerCanvas ||
              typeof prepared.brush.setTargetCanvas !== 'function' ||
              typeof prepared.brush.renderDirectToCanvas !== 'function' ||
              !prepared.nextSnapshot
            ) {
              throw new Error(`Color-cycle runtime ${prepared.layerId} cannot migrate to the resized canvas.`);
            }

            prepared.brush.setTargetCanvas(layerCanvas);
            const applied = applyColorCycleBrushLayerSnapshotToRuntime(
              prepared.brush,
              prepared.layerId,
              prepared.nextSnapshot,
              undefined,
              'project-resize',
            );
            if (!applied) {
              throw new Error(`Color-cycle runtime ${prepared.layerId} rejected the resized snapshot.`);
            }
            prepared.brush.renderDirectToCanvas(layerCanvas, prepared.layerId);

            const layerCtx = layerCanvas.getContext(
              '2d',
              { willReadFrequently: true } as CanvasRenderingContext2DSettings,
            );
            if (!layerCtx) {
              throw new Error(`Color-cycle canvas ${prepared.layerId} has no readable 2D context.`);
            }
            const renderedImageData = layerCtx.getImageData(
              0,
              0,
              layerCanvas.width,
              layerCanvas.height,
            );
            migratedColorCycleLayers.set(prepared.layerId, {
              ...resizedLayer,
              imageData: renderedImageData,
              framebuffer: layerCanvas,
              colorCycleData: {
                ...resizedLayer.colorCycleData,
                canvas: layerCanvas,
                canvasImageData: renderedImageData,
                canvasWidth: width,
                canvasHeight: height,
                hasContent: prepared.nextState.hasContent,
              },
            });
          } else {
            prepared.document.replaceState(prepared.nextState, 'project-resize', {
              pixelsChanged: true,
            });
          }

          const migratedDocument = prepared.document.read().snapshot;
          if (migratedDocument.width !== width || migratedDocument.height !== height) {
            throw new Error(`Color-cycle document ${prepared.layerId} retained stale dimensions after resize.`);
          }
        }
      } catch (error) {
        for (const prepared of [...preparedColorCycleResizes].reverse()) {
          if (
            prepared.brush &&
            prepared.originalCanvas &&
            prepared.beforeRuntimeSnapshot &&
            typeof prepared.brush.setTargetCanvas === 'function'
          ) {
            try {
              prepared.brush.setTargetCanvas(prepared.originalCanvas);
              applyColorCycleBrushLayerSnapshotToRuntime(
                prepared.brush,
                prepared.layerId,
                prepared.beforeRuntimeSnapshot,
                undefined,
                'project-resize-rollback',
                { suppressClearAudit: true },
              );
              prepared.brush.renderDirectToCanvas?.(
                prepared.originalCanvas,
                prepared.layerId,
              );
            } catch {
              // The document baseline below remains the canonical recovery source.
            }
          }
          prepared.document.replaceBaseline(
            mapDocumentSnapshotToArchiveState(prepared.beforeSnapshot),
            {
              version: prepared.beforeRead.version,
              pixelVersion: prepared.beforeRead.pixelVersion,
              residency: prepared.beforeResidency,
              archiveRefs: prepared.beforeArchiveRefs,
              auditEntries: prepared.beforeAuditEntries,
              dirtyBatch: prepared.beforeDirtyBatch,
            },
          );
        }
        throw error;
      }

      resizedLayers = resizedLayers.map((layer) => (
        migratedColorCycleLayers.get(layer.id) ?? layer
      ));

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

      await recordResizeHistory({
        beforeProject: historyBaseline.projectSize,
        afterProject: { width, height },
        beforeLayers: historyBaseline.layerSnapshots,
        afterLayers: get().layers,
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

    const addCcCustomTilePattern = (pattern: CcCustomTilePattern) => {
      const normalized = normalizeCcCustomTilePattern(pattern);
      if (!normalized) {
        return;
      }
      clearCcCustomTilePatternCache(normalized.id);
      set((state) => {
        if (!state.project) {
          return state;
        }
        const existing = state.project.ccCustomTilePatterns ?? [];
        const withoutExisting = existing.filter((entry) => entry.id !== normalized.id);
        return {
          project: {
            ...state.project,
            ccCustomTilePatterns: [...withoutExisting, normalized],
            updatedAt: new Date(),
          },
          tools: {
            ...state.tools,
            brushSettings: {
              ...state.tools.brushSettings,
              ditherAlgorithm: 'pattern',
              patternStyle: 'image-tile',
              patternTileId: normalized.id,
            },
          },
          ccBrushDitherSelection: {
            ...state.ccBrushDitherSelection,
            ditherAlgorithm: 'pattern',
            patternStyle: 'image-tile',
            patternTileId: normalized.id,
          },
        };
      });
    };

    const removeCcCustomTilePattern = (patternId: string) => {
      let didRemove = false;
      set((state) => {
        if (!state.project) {
          return state;
        }
        if (projectReferencesCcTilePattern(state, patternId)) {
          return state;
        }
        const remaining = (state.project.ccCustomTilePatterns ?? []).filter(
          (entry) => entry.id !== patternId
        );
        didRemove = remaining.length !== (state.project.ccCustomTilePatterns ?? []).length;
        const packs = (state.project.ccCustomTilePatternPacks ?? []).map((pack) => ({
          ...pack,
          patternIds: pack.patternIds.filter((entry) => entry !== patternId),
          updatedAt: pack.patternIds.includes(patternId) ? Date.now() : pack.updatedAt,
        }));
        const selectedToolTileId = state.tools.brushSettings.patternTileId;
        const shouldResetToolSelection =
          selectedToolTileId === patternId &&
          state.tools.brushSettings.patternStyle === 'image-tile';
        const selectedSharedTileId = state.ccBrushDitherSelection.patternTileId;
        const shouldResetSharedSelection =
          selectedSharedTileId === patternId &&
          state.ccBrushDitherSelection.patternStyle === 'image-tile';
        const brushSettings = shouldResetToolSelection
          ? {
              ...state.tools.brushSettings,
              patternStyle: 'dots' as const,
              patternTileId: null,
            }
          : state.tools.brushSettings;
        return {
          project: {
            ...state.project,
            ccCustomTilePatterns: remaining,
            ccCustomTilePatternPacks: packs,
            updatedAt: new Date(),
          },
          tools: {
            ...state.tools,
            brushSettings,
          },
          ccBrushDitherSelection: shouldResetSharedSelection
            ? {
                ...state.ccBrushDitherSelection,
                patternStyle: 'dots',
                patternTileId: null,
              }
            : state.ccBrushDitherSelection,
        };
      });
      if (didRemove) {
        clearCcCustomTilePatternCache(patternId);
      }
    };

    const renameCcCustomTilePattern = (patternId: string, name: string) => {
      const nextName = name.trim();
      if (!nextName) {
        return;
      }
      set((state) => {
        if (!state.project) {
          return state;
        }
        return {
          project: {
            ...state.project,
            ccCustomTilePatterns: (state.project.ccCustomTilePatterns ?? []).map((pattern) =>
              pattern.id === patternId
                ? { ...pattern, name: nextName, updatedAt: Date.now() }
                : pattern
            ),
            updatedAt: new Date(),
          },
        };
      });
    };

    const addCcCustomTilePatternPack = (pack: CcCustomTilePatternPack) => {
      set((state) => {
        if (!state.project) {
          return state;
        }
        const validPatternIds = new Set((state.project.ccCustomTilePatterns ?? []).map((pattern) => pattern.id));
        const normalized = normalizeCcCustomTilePatternPack(pack, validPatternIds);
        if (!normalized) {
          return state;
        }
        const existing = state.project.ccCustomTilePatternPacks ?? [];
        return {
          project: {
            ...state.project,
            ccCustomTilePatternPacks: [
              ...existing.filter((entry) => entry.id !== normalized.id),
              normalized,
            ],
            updatedAt: new Date(),
          },
        };
      });
    };

    const renameCcCustomTilePatternPack = (packId: string, name: string) => {
      const nextName = name.trim();
      if (!nextName) {
        return;
      }
      set((state) => {
        if (!state.project) {
          return state;
        }
        return {
          project: {
            ...state.project,
            ccCustomTilePatternPacks: (state.project.ccCustomTilePatternPacks ?? []).map((pack) =>
              pack.id === packId ? { ...pack, name: nextName, updatedAt: Date.now() } : pack
            ),
            updatedAt: new Date(),
          },
        };
      });
    };

    const removeCcCustomTilePatternPack = (packId: string) => {
      set((state) => {
        if (!state.project) {
          return state;
        }
        const remaining = (state.project.ccCustomTilePatternPacks ?? []).filter((pack) => pack.id !== packId);
        const didRemovePack = remaining.length !== (state.project.ccCustomTilePatternPacks ?? []).length;
        if (!didRemovePack) {
          return state;
        }
        const shouldResetToolSelection =
          state.tools.brushSettings.patternTileSelectionMode === 'pack-random' &&
          state.tools.brushSettings.patternTilePackId === packId;
        const shouldResetSharedSelection =
          state.ccBrushDitherSelection.patternTileSelectionMode === 'pack-random' &&
          state.ccBrushDitherSelection.patternTilePackId === packId;
        return {
          project: {
            ...state.project,
            ccCustomTilePatternPacks: remaining,
            updatedAt: new Date(),
          },
          tools: shouldResetToolSelection
            ? {
                ...state.tools,
                brushSettings: {
                  ...state.tools.brushSettings,
                  patternStyle: 'dots',
                  patternTileId: null,
                  patternTilePackId: null,
                  patternTileSelectionMode: 'single',
                },
              }
            : state.tools,
          ccBrushDitherSelection: shouldResetSharedSelection
            ? {
                ...state.ccBrushDitherSelection,
                patternStyle: 'dots',
                patternTileId: null,
                patternTilePackId: null,
                patternTileSelectionMode: 'single',
              }
            : state.ccBrushDitherSelection,
        };
      });
    };

    const addCcCustomTilePatternToPack = (packId: string, patternId: string) => {
      set((state) => {
        if (!state.project) {
          return state;
        }
        const hasPattern = (state.project.ccCustomTilePatterns ?? []).some((pattern) => pattern.id === patternId);
        if (!hasPattern) {
          return state;
        }
        return {
          project: {
            ...state.project,
            ccCustomTilePatternPacks: (state.project.ccCustomTilePatternPacks ?? []).map((pack) =>
              pack.id === packId && !pack.patternIds.includes(patternId)
                ? { ...pack, patternIds: [...pack.patternIds, patternId], updatedAt: Date.now() }
                : pack
            ),
            updatedAt: new Date(),
          },
        };
      });
    };

    const removeCcCustomTilePatternFromPack = (packId: string, patternId: string) => {
      set((state) => {
        if (!state.project) {
          return state;
        }
        return {
          project: {
            ...state.project,
            ccCustomTilePatternPacks: (state.project.ccCustomTilePatternPacks ?? []).map((pack) =>
              pack.id === packId && pack.patternIds.includes(patternId)
                ? {
                    ...pack,
                    patternIds: pack.patternIds.filter((entry) => entry !== patternId),
                    updatedAt: Date.now(),
                  }
                : pack
            ),
            updatedAt: new Date(),
          },
        };
      });
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
        ccCustomTilePatterns: [],
        ccCustomTilePatternPacks: [],
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
        bundleFormat: 'zip-compat',
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
      addCcCustomTilePattern,
      removeCcCustomTilePattern,
      renameCcCustomTilePattern,
      addCcCustomTilePatternPack,
      renameCcCustomTilePatternPack,
      removeCcCustomTilePatternPack,
      addCcCustomTilePatternToPack,
      removeCcCustomTilePatternFromPack,
      setDefaultCustomBrush,
      saveCustomBrushAsPreset,
      getCustomBrushById,
      getCustomBrushByIdUnsafe,
      listCustomBrushes,
      setProjectDimensions,
      resizeProjectCanvas,
    };
  };
