import type { StateCreator } from 'zustand';
import type { CanvasSnapshot, Layer, LayerAlignmentSettings, Project } from '@/types';
import { cloneLayerAlignment, normalizeLayers } from '@/utils/layoutDefaults';
import { computeLayerPercentOffset } from '@/utils/layerMetrics';
import { clamp } from '@/utils/num';
import { __DEV__, logError, recordBreadcrumb } from '@/utils/debug';
import { syncCCRuntimes } from '@/stores/ccRuntime';
import {
  getColorCycleBrushManager,
  type ColorCycleBrushImplementation,
  type ColorCycleBrushManager,
} from '@/stores/colorCycleBrushManager';
import { compositeBitmapManager } from '@/lib/performance/CompositeBitmapManager';
import type {
  CommitLayerStructureHistoryOptions,
  LayerHistorySnapshotOptions,
} from '@/stores/helpers/layerStructureHistory';
import type { AppState, CaptureROI, VesselWindow } from '../useAppStore';

type StaticCompositeSegment = {
  kind: 'static';
  id: string;
  layerIds: string[];
  includeBackground: boolean;
  orderRange: { start: number; end: number };
  canvas: HTMLCanvasElement;
  bitmap: ImageBitmap | null;
  dirty: boolean;
};

type ColorCycleCompositeSegment = {
  kind: 'color-cycle';
  id: string;
  layerId: string;
  blendMode: GlobalCompositeOperation;
  opacity: number;
};

export type CompositeSegment = StaticCompositeSegment | ColorCycleCompositeSegment;

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

const alphaCompositeImageDataRegion = (
  base: ImageData | null,
  region: ImageData,
  offsetX: number,
  offsetY: number,
  fullWidth: number,
  fullHeight: number
): ImageData => {
  const targetWidth = Math.max(1, fullWidth);
  const targetHeight = Math.max(1, fullHeight);
  const outData = new Uint8ClampedArray(targetWidth * targetHeight * 4);

  if (base) {
    const src = base.data;
    const copyWidth = Math.min(base.width, targetWidth);
    const copyHeight = Math.min(base.height, targetHeight);
    const srcStride = base.width * 4;
    const dstStride = targetWidth * 4;

    for (let row = 0; row < copyHeight; row += 1) {
      const srcRowStart = row * srcStride;
      const dstRowStart = row * dstStride;
      const rowLength = copyWidth * 4;
      outData.set(src.subarray(srcRowStart, srcRowStart + rowLength), dstRowStart);
    }
  }

  const src = region.data;
  const srcStride = region.width * 4;

  for (let row = 0; row < region.height; row += 1) {
    const dstRow = offsetY + row;
    if (dstRow < 0 || dstRow >= targetHeight) {
      continue;
    }

    for (let col = 0; col < region.width; col += 1) {
      const dstCol = offsetX + col;
      if (dstCol < 0 || dstCol >= targetWidth) {
        continue;
      }

      const srcIndex = row * srcStride + col * 4;
      const srcAlpha8 = src[srcIndex + 3];
      if (srcAlpha8 === 0) {
        continue;
      }

      const dstIndex = (dstRow * targetWidth + dstCol) * 4;

      const srcAlpha = srcAlpha8 / 255;
      const invSrcAlpha = 1 - srcAlpha;

      const dstAlpha = outData[dstIndex + 3] / 255;
      const outAlpha = srcAlpha + dstAlpha * invSrcAlpha;

      const dstR = outData[dstIndex];
      const dstG = outData[dstIndex + 1];
      const dstB = outData[dstIndex + 2];

      const srcR = src[srcIndex];
      const srcG = src[srcIndex + 1];
      const srcB = src[srcIndex + 2];

      const outR = srcR * srcAlpha + dstR * invSrcAlpha;
      const outG = srcG * srcAlpha + dstG * invSrcAlpha;
      const outB = srcB * srcAlpha + dstB * invSrcAlpha;

      outData[dstIndex] = Math.round(outR);
      outData[dstIndex + 1] = Math.round(outG);
      outData[dstIndex + 2] = Math.round(outB);
      outData[dstIndex + 3] = Math.round(outAlpha * 255);
    }
  }
  return new ImageData(outData, targetWidth, targetHeight);
};

const normalizeImageDataDimensions = (
  imageData: ImageData,
  width: number,
  height: number
): ImageData => {
  if (imageData.width === width && imageData.height === height) {
    return imageData;
  }

  const normalized = new ImageData(width, height);
  const target = normalized.data;
  const source = imageData.data;
  const copyWidth = Math.min(width, imageData.width);
  const copyHeight = Math.min(height, imageData.height);
  const sourceStride = imageData.width * 4;
  const targetStride = width * 4;

  for (let row = 0; row < copyHeight; row += 1) {
    const srcStart = row * sourceStride;
    const destStart = row * targetStride;
    target.set(source.subarray(srcStart, srcStart + copyWidth * 4), destStart);
  }

  return normalized;
};

const snapshotFramebufferRegion = (
  framebuffer: HTMLCanvasElement | OffscreenCanvas | null | undefined,
  width: number,
  height: number
): ImageData | null => {
  if (!framebuffer) {
    return null;
  }
  try {
    const fbCtx = framebuffer.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings
    ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!fbCtx) {
      return null;
    }
    const targetWidth = Math.min(width, framebuffer.width);
    const targetHeight = Math.min(height, framebuffer.height);
    return fbCtx.getImageData(0, 0, targetWidth, targetHeight);
  } catch {
    return null;
  }
};

const cloneImageData = (imageData: ImageData | null | undefined): ImageData | null => {
  if (!imageData) {
    return null;
  }
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
};

const createCanvas = (
  width: number,
  height: number,
  { forceDom }: { forceDom?: boolean } = {}
): HTMLCanvasElement | OffscreenCanvas | null => {
  if (typeof document !== 'undefined') {
    if (forceDom || typeof OffscreenCanvas === 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
  }
  if (!forceDom && typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  return null;
};

const cloneCanvasLike = <T extends HTMLCanvasElement | OffscreenCanvas | undefined | null>(
  source: T,
  fallbackImageData: ImageData | null,
  options?: { forceDom?: boolean }
): HTMLCanvasElement | OffscreenCanvas | T => {
  const width = source?.width ?? fallbackImageData?.width ?? 1;
  const height = source?.height ?? fallbackImageData?.height ?? 1;
  if (!source && !fallbackImageData) {
    return null as T;
  }
  const canvas = createCanvas(width, height, options ?? {});
  if (!canvas) {
    return source ?? (null as T);
  }
  const ctx = canvas.getContext('2d');
  if (ctx) {
    if (source) {
      try {
        ctx.drawImage(source as CanvasImageSource, 0, 0);
      } catch {
        if (fallbackImageData) {
          ctx.putImageData(fallbackImageData, 0, 0);
        }
      }
    } else if (fallbackImageData) {
      ctx.putImageData(fallbackImageData, 0, 0);
    }
  }
  return canvas;
};

const cloneGradientStops = (
  stops?: Array<{ position: number; color: string }> | null
): Array<{ position: number; color: string }> | undefined => {
  if (!stops) {
    return undefined;
  }
  return stops.map((stop) => ({ ...stop }));
};

type GradientStop = { position: number; color: string };

const DEFAULT_CC_GRADIENT: GradientStop[] = [
  { position: 0.0, color: '#ff0000' },
  { position: 0.17, color: '#ff7f00' },
  { position: 0.33, color: '#ffff00' },
  { position: 0.5, color: '#00ff00' },
  { position: 0.67, color: '#0000ff' },
  { position: 0.83, color: '#4b0082' },
  { position: 1.0, color: '#9400d3' }
];

const parseHexColor = (hex: string): { r: number; g: number; b: number } => {
  if (!hex || hex[0] !== '#' || (hex.length !== 7 && hex.length !== 4)) {
    return { r: 255, g: 0, b: 0 };
  }
  if (hex.length === 4) {
    const r = parseInt(hex[1] + hex[1], 16);
    const g = parseInt(hex[2] + hex[2], 16);
    const b = parseInt(hex[3] + hex[3], 16);
    return { r, g, b };
  }
  const value = parseInt(hex.substring(1), 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff
  };
};

const gradientStopsToUint8Array = (gradient?: GradientStop[]): Uint8Array => {
  const stops = gradient && gradient.length > 0 ? gradient : DEFAULT_CC_GRADIENT;
  const sortedStops = [...stops].sort((a, b) => a.position - b.position);
  const result = new Uint8Array(256 * 3);

  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    let start = sortedStops[0];
    let end = sortedStops[sortedStops.length - 1];
    for (let j = 0; j < sortedStops.length - 1; j += 1) {
      if (t >= sortedStops[j].position && t <= sortedStops[j + 1].position) {
        start = sortedStops[j];
        end = sortedStops[j + 1];
        break;
      }
    }
    const range = Math.max(1e-6, end.position - start.position);
    const localT = clamp((t - start.position) / range, 0, 1);
    const startColor = parseHexColor(start.color);
    const endColor = parseHexColor(end.color);
    const r = Math.round(startColor.r + (endColor.r - startColor.r) * localT);
    const g = Math.round(startColor.g + (endColor.g - startColor.g) * localT);
    const b = Math.round(startColor.b + (endColor.b - startColor.b) * localT);
    result[i * 3] = r;
    result[i * 3 + 1] = g;
    result[i * 3 + 2] = b;
  }

  return result;
};

const cloneColorCycleData = (
  data: Layer['colorCycleData'] | undefined,
  options?: { stripSurfaces?: boolean }
): Layer['colorCycleData'] | undefined => {
  if (!data) {
    return undefined;
  }

  const stripSurfaces = options?.stripSurfaces === true;

  const clonedRecolorSettings = data.recolorSettings
    ? {
        ...data.recolorSettings,
        gradient: cloneGradientStops(data.recolorSettings.gradient) ?? data.recolorSettings.gradient,
        colorMap: data.recolorSettings.colorMap
          ? new Map(data.recolorSettings.colorMap)
          : undefined,
        indexBuffer: data.recolorSettings.indexBuffer
          ? new Uint8Array(data.recolorSettings.indexBuffer)
          : undefined,
        palette: data.recolorSettings.palette
          ? new Uint32Array(data.recolorSettings.palette)
          : undefined,
        animation: { ...data.recolorSettings.animation },
      }
    : undefined;

  return {
    ...data,
    gradient: cloneGradientStops(data.gradient) ?? data.gradient,
    colorCycleBrush: undefined,
    brushState: undefined,
    canvas: stripSurfaces
      ? undefined
      : (cloneCanvasLike(data.canvas ?? null, null, { forceDom: true }) as HTMLCanvasElement | null) || undefined,
    canvasImageData: stripSurfaces
      ? undefined
      : cloneImageData(data.canvasImageData ?? null) ?? undefined,
    eraseMask: stripSurfaces
      ? undefined
      : data.eraseMask
        ? (cloneCanvasLike(data.eraseMask, null, { forceDom: true }) as HTMLCanvasElement | null) || undefined
        : undefined,
    eraseMaskImageData: stripSurfaces
      ? undefined
      : cloneImageData(data.eraseMaskImageData ?? null) ?? undefined,
    hasContent: stripSurfaces ? false : data.hasContent,
    recolorSettings: clonedRecolorSettings,
  };
};

const generateDuplicateLayerName = (name: string, layers: Layer[]): string => {
  const trimmed = name?.trim() ?? '';
  const base = trimmed.length > 0 ? `${trimmed} Copy` : 'Layer Copy';
  if (!layers.some((layer) => layer.name === base)) {
    return base;
  }
  let suffix = 2;
  while (suffix < 1000) {
    const candidate = `${base} ${suffix}`;
    if (!layers.some((layer) => layer.name === candidate)) {
      return candidate;
    }
    suffix += 1;
  }
  return `${base} ${Date.now()}`;
};

export type UpdateLayerOptions = {
  skipColorCycleSync?: boolean;
};

export interface LayersSlice {
  layers: Layer[];
  layersNeedRecomposition: boolean;
  staticCompositeVersion: number;
  compositeSegmentsVersion: number;
  compositeSegments: CompositeSegment[];
  activeLayerId: string | null;
  selectedLayerIds: string[];
  referenceLayerId: string | null;
  currentLayer: number;
  setLayersNeedRecomposition: (needed: boolean) => void;
  setLayers: (layers: Layer[]) => void;
  addLayer: (layer: Omit<Layer, 'id' | 'order'>) => string;
  duplicateLayer: (layerId: string) => string | null;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<Layer>, options?: UpdateLayerOptions) => void;
  setSelectedLayerIds: (layerIds: string[]) => void;
  setActiveLayer: (id: string) => void;
  setReferenceLayer: (id: string | null) => void;
  reorderLayers: (sourceIndex: number, destinationIndex: number) => void;
  updateLayerAlignment: (layerId: string, alignment: LayerAlignmentSettings) => void;
  initColorCycleForLayer: (layerId: string, width: number, height: number) => void;
  cleanupColorCycleForLayer: (layerId: string) => void;
  getLayerColorCycleBrush: (layerId: string) => ColorCycleBrushImplementation | null;
  compositeLayersToCanvas: (targetCanvas: HTMLCanvasElement) => void;
  renderStaticComposite: (
    targetCanvas: HTMLCanvasElement,
    options?: { captureBitmap?: boolean }
  ) => boolean | Promise<boolean>;
  renderColorCycleOverlay: (targetCanvas: HTMLCanvasElement) => boolean;
  getCompositeSegmentsSnapshot: () => CompositeSegment[];
  markCompositeSegmentsDirtyByLayerIds: (layerIds: string[]) => void;
  markAllCompositeSegmentsDirty: () => void;
  captureCanvasToActiveLayer: (
    sourceCanvas?: HTMLCanvasElement,
    roi?: CaptureROI
  ) => Promise<void>;
  captureCanvasToLayer: (
    sourceCanvas: HTMLCanvasElement,
    targetLayerId: string | null
  ) => Promise<void>;
}

export interface LayersSliceOptions {
  syncPercentOffsetsFromPixels: (layers: Layer[], project: Project | null) => Layer[];
  trackLayerChanges: (...args: unknown[]) => void;
  colorCycleBrushManager: ColorCycleBrushManager;
  captureLayerStructureSnapshot: (
    state: AppState,
    options: LayerHistorySnapshotOptions
  ) => CanvasSnapshot;
  commitLayerStructureHistory: (options: CommitLayerStructureHistoryOptions) => void;
  getVesselWindow: () => VesselWindow | undefined;
}

export const createLayersSlice = (
  options: LayersSliceOptions,
): StateCreator<AppState, [], [], LayersSlice> =>
  (set, get) => {
    const {
      syncPercentOffsetsFromPixels,
      trackLayerChanges,
      colorCycleBrushManager,
      captureLayerStructureSnapshot,
      commitLayerStructureHistory,
      getVesselWindow,
    } = options;

    const createLayerTransferCanvas = (width: number, height: number) => {
      if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(width, height);
      }
      if (typeof document === 'undefined') {
        return null;
      }
      const layerCanvas = document.createElement('canvas');
      layerCanvas.width = width;
      layerCanvas.height = height;
      return layerCanvas;
    };

    const hasValidFramebuffer = (
      framebuffer: HTMLCanvasElement | OffscreenCanvas | null | undefined,
    ): framebuffer is HTMLCanvasElement | OffscreenCanvas =>
      Boolean(
        framebuffer &&
          Number.isFinite(framebuffer.width) &&
          framebuffer.width > 0 &&
          Number.isFinite(framebuffer.height) &&
          framebuffer.height > 0,
      );

    const drawStaticLayers = (
      ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      sortedLayers: Layer[],
      project: Project
    ) => {
      ctx.clearRect(0, 0, project.width, project.height);
      if (project.backgroundColor && project.backgroundColor !== 'transparent') {
        ctx.fillStyle = project.backgroundColor;
        ctx.fillRect(0, 0, project.width, project.height);
      }

      for (const layer of sortedLayers) {
        if (!layer.visible || layer.layerType === 'color-cycle') {
          continue;
        }
        if (!layer.imageData) {
          continue;
        }
        const layerCanvas = createLayerTransferCanvas(layer.imageData.width, layer.imageData.height);
        if (!layerCanvas) {
          continue;
        }
        const layerCtx = layerCanvas.getContext(
          '2d',
          { willReadFrequently: true } as CanvasRenderingContext2DSettings
        ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        if (!layerCtx) {
          continue;
        }
        layerCtx.putImageData(layer.imageData, 0, 0);
        ctx.globalCompositeOperation = layer.blendMode;
        ctx.globalAlpha = layer.opacity;
        ctx.drawImage(layerCanvas as CanvasImageSource, 0, 0);
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    };

    const drawColorCycleLayers = (
      ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      sortedLayers: Layer[],
      project: Project,
      manager: ColorCycleBrushManager | null,
      options?: { clear?: boolean }
    ): boolean => {
      if (options?.clear !== false) {
        ctx.clearRect(0, 0, project.width, project.height);
      }

      let drewLayer = false;

      const brushManager = manager ?? getColorCycleBrushManager();

      for (const layer of sortedLayers) {
        if (!layer.visible || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
          continue;
        }

        const canvas = layer.colorCycleData.canvas;
        if (!canvas) {
          continue;
        }

        if (layer.colorCycleData.mode !== 'recolor') {
          const brush = brushManager?.getBrush(layer.id);
          if (brush) {
            try {
              const wantPlaying = Boolean(layer.colorCycleData.isAnimating);
              const isPlaying = typeof brush.isPlaying === 'function' ? brush.isPlaying() : false;
              if (wantPlaying && !isPlaying) {
                brush.startAnimation?.();
              } else if (!wantPlaying && isPlaying) {
                brush.stopAnimation?.();
              }
              if (wantPlaying) {
                brush.updateAnimation?.();
              }
              brush.renderDirectToCanvas?.(canvas, layer.id);
            } catch (error) {
              logError('[compose] CC advance/render failed', error);
            }
          }
        }

        try {
          ctx.globalCompositeOperation = layer.blendMode;
          ctx.globalAlpha = layer.opacity;
          ctx.drawImage(canvas, 0, 0);
          drewLayer = true;
        } catch (error) {
          logError('[compose] Layer compose error', error);
        }
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      return drewLayer;
    };

    let staticBitmapCaptureToken = 0;

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

    return {
      layers: [],
      layersNeedRecomposition: false,
      staticCompositeVersion: 0,
      compositeSegmentsVersion: 0,
      compositeSegments: [],
      setLayersNeedRecomposition: (needed) => {
        set((state) => {
          if (needed) {
            return {
              layersNeedRecomposition: needed,
              compositeSegments: state.compositeSegments.map((segment) =>
                segment.kind === 'static' ? { ...segment, dirty: true } : segment
              )
            };
          }
          return { layersNeedRecomposition: needed };
        });
      },
      getCompositeSegmentsSnapshot: () =>
        get().compositeSegments.map((segment) =>
          segment.kind === 'static'
            ? { ...segment, canvas: segment.canvas, bitmap: segment.bitmap }
            : { ...segment }
        ),
      markCompositeSegmentsDirtyByLayerIds: (layerIds) => {
        if (!layerIds.length) {
          return;
        }
        set((state) => ({
          compositeSegments: state.compositeSegments.map((segment) =>
            segment.kind === 'static' && segment.layerIds.some((layerId) => layerIds.includes(layerId))
              ? { ...segment, dirty: true }
              : segment
          )
        }));
      },
      markAllCompositeSegmentsDirty: () => {
        set((state) => ({
          compositeSegments: state.compositeSegments.map((segment) =>
            segment.kind === 'static' ? { ...segment, dirty: true } : segment
          )
        }));
      },
      setLayers: (incomingLayers) => {
        set((state) => {
          const normalized = normalizeLayers(
            incomingLayers.map((layer, index) => ({
              ...layer,
              order: index,
              alignment: cloneLayerAlignment(layer.alignment),
            })),
          );

          trackLayerChanges('setLayers', normalized);
          const syncedLayers = syncPercentOffsetsFromPixels(normalized, state.project ?? null);
          const hydratedLayers = syncedLayers.map((layer) => {
            if (layer.layerType === 'color-cycle') {
              return layer;
            }

            if (hasValidFramebuffer(layer.framebuffer)) {
              return layer;
            }

            const sourceImage = layer.imageData ?? null;
            const fallbackWidth = sourceImage?.width ?? state.project?.width ?? 1;
            const fallbackHeight = sourceImage?.height ?? state.project?.height ?? 1;
            const nextFramebuffer = createLayerTransferCanvas(fallbackWidth, fallbackHeight);

            if (nextFramebuffer && sourceImage) {
              const fbCtx = nextFramebuffer.getContext(
                '2d',
                { willReadFrequently: true } as CanvasRenderingContext2DSettings,
              ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
              try {
                fbCtx?.putImageData(sourceImage, 0, 0);
              } catch {
                // ignore hydration failures; merged imageData will still draw correctly
              }
            }

            return {
              ...layer,
              framebuffer: nextFramebuffer ?? layer.framebuffer ?? null,
            };
          });
          const validLayerIds = new Set(syncedLayers.map((layer) => layer.id));
          const nextReferenceLayerId = state.referenceLayerId && validLayerIds.has(state.referenceLayerId)
            ? state.referenceLayerId
            : null;

          return {
            layers: hydratedLayers,
            referenceLayerId: nextReferenceLayerId,
          };
        });
        get().markAllCompositeSegmentsDirty();
      },
  // Layer Management - Start empty for SSR compatibility
  activeLayerId: null,
  selectedLayerIds: [],
  referenceLayerId: null,
  currentLayer: 0,
  addLayer: (layer) => {
    if (__DEV__) {
      // quiet
    }
    recordBreadcrumb('layers', { event: 'store-addLayer-enter', incomingType: layer?.layerType });
    const stateBeforeAdd = get();
    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeAdd, {
      actionType: 'layer-add',
      description: 'Add layer',
    });

    const newLayerId = `layer-${Date.now()}-${Math.random()}`;
    // quiet

    set((state) => {
      // quiet
      // CRITICAL CHECK: Verify existing layers are not mutated
      const existingLayersSnapshot = state.layers.map(l => ({
        id: l.id,
        type: l.layerType,
        hasCC: !!l.colorCycleData
      }));
      
      const newLayer = {
        ...layer,
        id: newLayerId,
        // Temporary order; will be normalized after insertion
        order: 0,
        alignment: cloneLayerAlignment(layer.alignment),
        transparencyLocked: layer.transparencyLocked === true,
        // CRITICAL: Preserve layerType EXACTLY - DO NOT convert CC layers to normal!
        layerType: layer.layerType || (
          (logError('CRITICAL: Layer missing layerType!', {
            layerId: newLayerId?.substring(0, 20),
            hasColorCycleData: !!layer.colorCycleData,
            fallbackToNormal: true
          }),
          'normal')
        )
      };
      
      // Insert the new layer directly ABOVE the currently active layer
      // Fallback: if no active layer, append to top of stack
      const activeIdx = state.activeLayerId
        ? state.layers.findIndex(l => l.id === state.activeLayerId)
        : -1;
      const insertedIndex = activeIdx >= 0 ? activeIdx + 1 : state.layers.length;
      const newLayers = [...state.layers];
      newLayers.splice(insertedIndex, 0, newLayer);

      // Normalize order values to match visual/composite order (ascending = bottom -> top)
      const updatedLayers = newLayers.map((l, idx) => ({ ...l, order: idx }));
      recordBreadcrumb('layers', { event: 'store-addLayer-updated', total: updatedLayers.length, insertedIndex });
      // quiet
      
      // Initialize ColorCycleBrush for color-cycle layers
      if (newLayer.layerType === 'color-cycle' && state.project) {
        const width = state.project.width || 1024;
        const height = state.project.height || 1024;
        // quiet

        // Use enhanced manager method for initialization
        // Note: gradient is in { position, color }[] format, but initColorCycleForLayer expects Uint8Array
        // Pass undefined to use default gradient
        const success = colorCycleBrushManager.initColorCycleForLayer(
          newLayerId, 
          width, 
          height, 
          undefined
        );
        
        if (!success) {
          console.error('Failed to initialize ColorCycleBrush for new layer:', newLayerId);
        } else {
          // Pre-create the animator to avoid lag on first paint
          const brush = colorCycleBrushManager.getBrush(newLayerId);
          if (brush && 'setSpeed' in brush && typeof brush.setSpeed === 'function') {
            // Call setSpeed to trigger animator creation internally
            // This ensures the animator is ready before first paint
            brush.setSpeed(1.0);
            // quiet
          }
        }
      }
      
      // VERIFY: Check if any existing layer lost its type
      // IMPORTANT: Compare by stable id, not by array index, because we inserted a new
      // layer and normalized order which shifts indices. Index-based comparison would
      // falsely report a mutation at and after the insertion point.
      existingLayersSnapshot.forEach((original) => {
        const updated = updatedLayers.find(l => l.id === original.id);
        if (!updated) {
          // Should never happen; log once for diagnostics without throwing
          console.error('🔴🔴🔴 LAYER MISSING AFTER ADD_LAYER (by id lookup):', {
            layerId: original.id.substring(0, 20),
            originalType: original.type
          });
          return;
        }
        if (original.type !== updated.layerType) {
          console.error('🔴🔴🔴 LAYER TYPE MUTATION IN ADD_LAYER:', {
            layerId: original.id.substring(0, 20),
            originalType: original.type,
            newType: updated.layerType,
            wasCC: original.hasCC,
            isCC: !!updated.colorCycleData
          });
        }
      });
      
      /* console.log('🔵 ADD LAYER RESULT:', {
        totalLayers: updatedLayers.length,
        layers: updatedLayers.map(l => ({
          id: l.id.substring(0, 20),
          type: l.layerType,
          hasCC: !!l.colorCycleData,
          hasGradient: !!l.colorCycleData?.gradient
        }))
      }); */
      
      const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);

      return {
        layers: syncedLayers
      };
    });

    // Ensure the newly created layer becomes the active selection.
    try {
      const storeState = get();
      if (storeState.setActiveLayer) {
        if (storeState.activeLayerId !== newLayerId) {
          storeState.setActiveLayer(newLayerId);
        } else if (!storeState.selectedLayerIds.includes(newLayerId) && storeState.setSelectedLayerIds) {
          storeState.setSelectedLayerIds([newLayerId]);
        }
      }
    } catch (error) {
      logError('addLayer: failed to auto-select new layer', error);
      set(() => ({
        activeLayerId: newLayerId,
        selectedLayerIds: [newLayerId]
      }));
    }

    const stateAfterAdd = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterAdd, {
      actionType: 'layer-add',
      description: 'Add layer',
      activeLayerId: newLayerId,
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Add layer',
      metadata: { layerId: newLayerId, operation: 'add' },
    });
    get().markAllCompositeSegmentsDirty();

    return newLayerId;
  },
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
        layerType: treatAsColorCycle ? 'color-cycle' : targetLayer.layerType,
        order: 0,
        transparencyLocked: targetLayer.transparencyLocked === true,
        version: targetLayer.version,
      };

      const updatedLayers = [...state.layers];
      updatedLayers.splice(targetIndex, 0, newLayer);
      const normalizedLayers = updatedLayers.map((layer, index) => ({ ...layer, order: index }));
      trackLayerChanges('duplicateLayer RETURN', normalizedLayers);
      const syncedLayers = syncPercentOffsetsFromPixels(normalizedLayers, state.project ?? null);

      return {
        layers: syncedLayers,
        activeLayerId: newLayerId,
        selectedLayerIds: [newLayerId],
      };
    });

    const project = stateBeforeDuplicate.project;
    const stateAfterInsert = get();
    const duplicatedLayer = stateAfterInsert.layers.find((layer) => layer.id === newLayerId);

    if (targetLayer.layerType === 'color-cycle') {
      const adoptedCanvas = duplicatedLayer?.colorCycleData?.canvas as HTMLCanvasElement | OffscreenCanvas | undefined;
      if (adoptedCanvas) {
        try {
          const width = adoptedCanvas.width || project?.width || 1024;
          const height = adoptedCanvas.height || project?.height || 1024;
          const gradientStops =
            duplicatedLayer?.colorCycleData?.gradient ||
            duplicatedLayer?.colorCycleData?.recolorSettings?.gradient ||
            DEFAULT_CC_GRADIENT;
          const gradientArray = gradientStopsToUint8Array(gradientStops);
          const brush = colorCycleBrushManager.createBrush(newLayerId, width, height, gradientArray) as ColorCycleBrushImplementation & {
            setTargetCanvas?: (canvas: HTMLCanvasElement | OffscreenCanvas | null) => void;
          };
          brush.setTargetCanvas?.(adoptedCanvas);
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
  removeLayer: (id) => {
    const stateBeforeRemove = get();
    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeRemove, {
      actionType: 'layer-remove',
      description: 'Remove layer',
    });

    set((state) => {
      // Use enhanced manager method for cleanup
      colorCycleBrushManager.removeColorCycleBrush(id);
      
      const updatedLayers = state.layers.filter(l => l.id !== id);
      const newActiveLayerId = state.activeLayerId === id ? 
        updatedLayers.find(l => l.id !== id)?.id || null : 
        state.activeLayerId;

      const filteredSelection = state.selectedLayerIds.filter(selectedId => {
        if (selectedId === id) {
          return false;
        }
        return updatedLayers.some(layer => layer.id === selectedId);
      });
      const nextSelection = filteredSelection.length > 0
        ? filteredSelection
        : (newActiveLayerId ? [newActiveLayerId] : []);
      
      trackLayerChanges('removeLayer RETURN', updatedLayers);
      const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);
      return {
        layers: syncedLayers,
        activeLayerId: newActiveLayerId,
        selectedLayerIds: nextSelection,
        referenceLayerId: state.referenceLayerId === id ? null : state.referenceLayerId
      // Remove the project update entirely - only update top-level layers
    };
    });

    const stateAfterRemove = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterRemove, {
      actionType: 'layer-remove',
      description: 'Remove layer',
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Remove layer',
      metadata: { layerId: id, operation: 'remove' },
    });
    get().markAllCompositeSegmentsDirty();
  },
  updateLayer: (id, updates, options?: UpdateLayerOptions) => {
    set((state) => {
    const logCC =
      process.env.NODE_ENV !== 'production' &&
      (() => {
        try {
          return Boolean((globalThis as { __TB_DEBUG?: { logCC?: boolean } }).__TB_DEBUG?.logCC);
        } catch {
          return false;
        }
      })();

    if (logCC) {
      console.log('[layersSlice] updateLayer args', { layerId: id, options });
    }
    const skipColorCycleSync = options?.skipColorCycleSync ?? false;
    const originalLayer = state.layers.find(l => l.id === id);
    
    // CRITICAL: Detect when a color-cycle layer is being changed to normal
    if (originalLayer?.layerType === 'color-cycle' && 
        updates.layerType === 'normal') {
      console.error('🔴🔴🔴 LAYER TYPE CORRUPTION DETECTED');
      console.error('Stack trace:', new Error().stack);
      console.error('Layer being corrupted:', id);
      console.error('Update that caused it:', updates);
      // Only break into debugger when explicitly opted-in
      const debugWindow = getVesselWindow();
      if (debugWindow?.__TB_DEBUG?.breakOnLayerErrors) {
        debugger;
      }
    }
    
    // Also detect when colorCycleData is being cleared
    if (originalLayer?.colorCycleData && 
        'colorCycleData' in updates && 
        !updates.colorCycleData) {
      console.error('🔴🔴🔴 COLOR CYCLE DATA BEING CLEARED');
      console.error('Stack trace:', new Error().stack);
      console.error('Layer:', id);
      // Only break into debugger when explicitly opted-in
      const debugWindow = getVesselWindow();
      if (debugWindow?.__TB_DEBUG?.breakOnLayerErrors) {
        debugger;
      }
    }
    
    
    // DEBUG: Log any layerType changes from color-cycle
    if (originalLayer && originalLayer.layerType === 'color-cycle' && 
        ('layerType' in updates && updates.layerType !== 'color-cycle')) {
      console.error('🔴 CRITICAL WARNING: Changing color-cycle layer to:', updates.layerType, 'for layer:', id.substring(0, 20));
      console.trace('Stack trace for layer type change');
    }
    
    const updatedLayers = state.layers.map(layer => {
      if (layer.id === id) {
        // Start with a shallow copy
        const updatedLayer = { ...layer };
        
        // Special handling for colorCycleData updates
        if ('colorCycleData' in updates) {
          if (logCC) {
            console.log('[layersSlice] updateLayer colorCycleData', {
              layerId: id.substring(0, 24),
              hasCanvas: Boolean(updates.colorCycleData?.canvas),
              hasCanvasImageData: Boolean(updates.colorCycleData?.canvasImageData),
              hasEraseMask: Boolean(updates.colorCycleData?.eraseMask),
              hasBrushState: Boolean(updates.colorCycleData?.brushState),
              isAnimating: updates.colorCycleData?.isAnimating,
              skipColorCycleSync,
              stack: new Error().stack?.split('\n').slice(0, 4).join('\n'),
            });
          }
          if (updates.colorCycleData) {
            // CRITICAL: Only allow colorCycleData updates on color-cycle layers
            if (layer.layerType !== 'color-cycle') {
              console.error('🚨 BLOCKED: Attempted to add colorCycleData to normal layer!', {
                layerId: layer.id?.substring(0, 20),
                layerType: layer.layerType
              });
              // Skip this update - don't add colorCycleData to normal layers
            } else {
              // Merging colorCycleData for color-cycle layer
              updatedLayer.colorCycleData = {
                ...layer.colorCycleData,
                ...updates.colorCycleData
              };
              // Layer is already color-cycle, keep it that way
              updatedLayer.layerType = 'color-cycle';
            }
          } else {
            // FORBIDDEN: CC layers cannot be converted to normal layers!
            console.error('🚨🚨🚨 BLOCKED: Attempted to convert CC layer to normal!', {
              layerId: layer.id?.substring(0, 20),
              originalType: layer.layerType,
              attemptedConversion: 'CC -> Normal - BLOCKED!'
            });
            // DO NOT delete colorCycleData or change layerType - preserve CC layer!
            // Keep the layer as-is to prevent conversion
          }
        }
        
        // Apply all other updates except colorCycleData
        const otherUpdates = { ...updates };
        delete (otherUpdates as Partial<typeof layer>).colorCycleData;
        Object.assign(updatedLayer, otherUpdates);
        
        // Protect against accidentally clearing layerType or colorCycleData
        // If the layer was color-cycle and we're not explicitly changing it
        if (layer.layerType === 'color-cycle' && 
            !('layerType' in updates) && 
            !('colorCycleData' in updates)) {
          // Ensure we preserve the color-cycle nature
          updatedLayer.layerType = 'color-cycle';
          updatedLayer.colorCycleData = layer.colorCycleData;
        }
        
        // FORBIDDEN: Never allow conversion from CC to normal!
        if (updates.layerType === 'normal' && layer.layerType === 'color-cycle') {
          console.error('🚨🚨🚨 BLOCKED: Direct conversion CC -> Normal!', {
            layerId: layer.id?.substring(0, 20),
            originalType: layer.layerType,
            attemptedType: updates.layerType,
            hasColorCycleData: !!layer.colorCycleData
          });
          // REVERT the layerType change - keep it as color-cycle
          updatedLayer.layerType = 'color-cycle';
          // DO NOT delete colorCycleData!
        } else if (updates.layerType === 'normal' && layer.layerType === 'normal') {
          // Safe: normal -> normal, can clear colorCycleData if any exists
          delete updatedLayer.colorCycleData;
        }
        
        return updatedLayer;
      }
      return layer;
    });

    // Check if visual properties changed that require recomposition
    const needsRecomposition = 'visible' in updates || 'opacity' in updates || 'blendMode' in updates || 
                               'colorCycleData' in updates || 'layerType' in updates;
    if (needsRecomposition) {
      // Visual property changed - triggering recomposition
    }
    
    // FINAL VERIFICATION: Check for unexpected CC -> Normal conversions
    const updatedLayer = updatedLayers.find(l => l.id === id);
    if (originalLayer?.layerType === 'color-cycle' && updatedLayer?.layerType === 'normal') {
      logError('LAYER CONVERSION DETECTED DESPITE PROTECTIONS!', {
        layerId: id.substring(0, 20),
        originalType: originalLayer.layerType,
        finalType: updatedLayer.layerType,
        hadColorCycleData: !!originalLayer.colorCycleData,
        hasColorCycleData: !!updatedLayer.colorCycleData,
        stackTrace: new Error().stack
      });
    }

    trackLayerChanges('updateLayer RETURN', updatedLayers);
    const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);

      try {
        const syncedLayer = syncedLayers.find(layer => layer.id === id);
        if (syncedLayer?.layerType === 'color-cycle' && logCC) {
          console.log('[layersSlice] shouldSyncCC', {
            layerId: id,
            skip: options?.skipColorCycleSync ?? false,
          });
        }
        if (
          syncedLayer?.layerType === 'color-cycle' &&
          syncedLayer.colorCycleData &&
          !skipColorCycleSync
        ) {
          syncCCRuntimes([syncedLayer], 'updateLayer');
        }
      } catch (error) {
        logError('[updateLayer] Failed to sync CC runtime', error);
      }

      return {
        layers: syncedLayers,
        layersNeedRecomposition: needsRecomposition || state.layersNeedRecomposition
        // Remove the project update entirely - only update top-level layers
      };
    });
    get().markCompositeSegmentsDirtyByLayerIds([id]);
  },
  setSelectedLayerIds: (layerIds) => set((state) => {
    const validIds = layerIds.filter((layerId, index, list) => {
      return list.indexOf(layerId) === index && state.layers.some(layer => layer.id === layerId);
    });

    return {
      selectedLayerIds: validIds
    };
  }),
  setActiveLayer: (id) => set((state) => {
    const layer = state.layers.find(l => l.id === id);
    if (!layer) {
      logError('setActiveLayer: Invalid layer ID', id);
      return state;
    }
    // quiet
    
    /* console.log('🟢 SET ACTIVE LAYER DEBUG:', {
      newActiveId: id?.substring(0, 20),
      oldActiveId: state.activeLayerId?.substring(0, 20),
      targetLayerType: layer?.layerType,
      targetHasCC: !!layer?.colorCycleData,
      allLayersBefore: state.layers.map(l => ({
        id: l.id.substring(0, 20),
        type: l.layerType,
        hasCC: !!l.colorCycleData,
        hasGradient: !!l.colorCycleData?.gradient
      }))
    }); */
    
    // When switching away from a color-cycle layer, mark it as inactive
    const currentActiveLayer = state.layers.find(l => l.id === state.activeLayerId);
    if (currentActiveLayer?.layerType === 'color-cycle' && currentActiveLayer.id !== id) {
      /* console.log('🟠 SWITCHING AWAY FROM CC LAYER:', {
        fromLayerId: currentActiveLayer.id.substring(0, 20),
        toLayerId: id?.substring(0, 20)
      }); */
      
      try {
        // Mark the old layer's brush as inactive
        if (colorCycleBrushManager) {
          if (state.activeLayerId) {
            try { colorCycleBrushManager.setActiveState(state.activeLayerId, false); } catch (e) { logError('CC cleanup error (non-fatal): setActiveState', e); }
            // End any active strokes
            try {
              const oldBrush = colorCycleBrushManager.getLayerColorCycleBrush(state.activeLayerId);
              oldBrush?.endStroke(state.activeLayerId);
            } catch (e) { logError('CC cleanup error (non-fatal): endStroke', e); }
          }
        }
      } catch {
        // quiet
      }
      // quiet
    }
    
    // If switching to a color-cycle layer in BRUSH context, validate/reinit brush resources.
    // Skip entirely when the Recolor tool is active so we don't override recolor mode.
    if (layer?.layerType === 'color-cycle' && state.tools.currentTool !== 'recolor') {
      /* console.log('🟣 SWITCHING TO CC LAYER:', {
        layerId: id.substring(0, 20),
        hasGradient: !!layer.colorCycleData?.gradient,
        gradientLength: layer.colorCycleData?.gradient?.length
      }); */
      
      // Validate and reinitialize if needed
      if (!colorCycleBrushManager.validateColorCycleBrush(id)) {
        
        const width = state.project?.width || 1024;
        const height = state.project?.height || 1024;
        // Note: gradient is in { position, color }[] format, but initColorCycleForLayer expects Uint8Array
        try {
          colorCycleBrushManager.initColorCycleForLayer(
          id, 
          width, 
          height, 
          undefined
        );
        } catch (e) {
          console.error('Error re-initializing CC brush on setActiveLayer:', e);
        }
        // quiet
      }
      
      // Mark as active
      try { colorCycleBrushManager.setActiveState(id, true); } catch (e) { console.error('CC setActiveState error:', e); }
      
      // Ensure brush tracks the active layer before runtime sync
      try {
        const colorCycleBrush = colorCycleBrushManager.getLayerColorCycleBrush(id);
        if (colorCycleBrush && 'setActiveLayer' in colorCycleBrush && typeof colorCycleBrush.setActiveLayer === 'function') {
          colorCycleBrush.setActiveLayer(id);
        }
      } catch {
        // quiet
      }
      
      // Remember the user's current brush context so we can restore it when leaving CC layers
      let savedRegularTool = state.tools.lastRegularTool;
      let savedBrushShape = state.tools.lastRegularBrushShape;
      if (state.tools.currentTool === 'brush' || state.tools.currentTool === 'eraser') {
        savedRegularTool = state.tools.currentTool;
        savedBrushShape = state.tools.brushSettings.brushShape;
      }

      const layerGradientStops = layer.colorCycleData?.gradient
        ?? layer.colorCycleData?.recolorSettings?.gradient;
      const gradientForBrushSettings = layerGradientStops
        ? layerGradientStops.map(stop => ({ ...stop }))
        : undefined;

      const nextBrushSettings = {
        ...state.tools.brushSettings,
        customBrushColorCycle: true,
        ...(gradientForBrushSettings ? { colorCycleGradient: gradientForBrushSettings } : {})
      };
      if (typeof layer.colorCycleData?.brushSpeed === 'number') {
        nextBrushSettings.colorCycleSpeed = layer.colorCycleData.brushSpeed;
      }
      const resolvedFlowMode = layer.colorCycleData?.flowMode ?? state.tools.brushSettings.colorCycleFlowMode ?? 'reverse';
      nextBrushSettings.colorCycleFlowMode = resolvedFlowMode;

      const result = {
        activeLayerId: id,
        selectedLayerIds: [id],
        tools: {
          ...state.tools,
          lastRegularTool: savedRegularTool,
          lastRegularBrushShape: savedBrushShape,
          lastColorCycleShapeMode: state.tools.shapeMode,
          brushSettings: nextBrushSettings
        }
      };

      try {
        syncCCRuntimes([layer], 'setActiveLayer');
      } catch (error) {
        logError('[setActiveLayer] Failed to sync CC runtime', error);
      }
      
      /* console.log('🟢 SET ACTIVE LAYER RESULT (CC):', {
        activeLayerId: result.activeLayerId.substring(0, 20),
        gradientSet: !!result.tools.brushSettings.colorCycleGradient,
        allLayersAfter: state.layers.map(l => ({
          id: l.id.substring(0, 20),
          type: l.layerType,
          hasCC: !!l.colorCycleData
        }))
      }); */
      
      return result;
    }
    
    // When switching to a regular layer from color cycle, restore last regular tool
    const baseBrushSettings = {
      ...state.tools.brushSettings,
      customBrushColorCycle: false
    };

    let nextTools = {
      ...state.tools,
      brushSettings: baseBrushSettings
    };
    const wasOnColorCycle = currentActiveLayer?.layerType === 'color-cycle';
    // Only restore last regular tool if we're NOT explicitly in recolor tool
    if (wasOnColorCycle && layer && layer.layerType === 'normal' && state.tools.currentTool !== 'recolor') {
      // Restore the last regular tool and brush shape
      const lastTool = state.tools.lastRegularTool ?? 'brush';
      const lastShape = state.tools.lastRegularBrushShape ?? state.tools.brushSettings.brushShape;

      nextTools = {
        ...nextTools,
        currentTool: lastTool,
        brushSettings: {
          ...baseBrushSettings,
          brushShape: lastShape
        }
      };
    }

    const result = {
      activeLayerId: id,
      selectedLayerIds: [id],
      tools: nextTools
      // DO NOT return layers unless we're actually changing them
    };
    
    /* console.log('🟢 SET ACTIVE LAYER RESULT (NORMAL):', {
      activeLayerId: id?.substring(0, 20),
      allLayersAfter: state.layers.map(l => ({
        id: l.id.substring(0, 20),
        type: l.layerType,
        hasCC: !!l.colorCycleData
      })),
      returnedLayers: 'layers' in result
    }); */
    
    // Debug checks removed - the race condition has been fixed
    
    return result;
  }),
  setReferenceLayer: (id) => set((state) => {
    if (id && !state.layers.some(layer => layer.id === id)) {
      return { referenceLayerId: null };
    }

    return { referenceLayerId: id ?? null };
  }),
  updateLayerAlignment: (layerId, alignment) => {
    set((state) => {
    const targetLayer = state.layers.find(layer => layer.id === layerId);

    if (!targetLayer) {
      return { layers: state.layers };
    }

    let nextAlignment = cloneLayerAlignment(alignment);

    const previousAlignment = targetLayer.alignment;
    const becameAuto = nextAlignment.positioning === 'auto' && previousAlignment.positioning !== 'auto';
    const previousPercent = previousAlignment.offsetPercent ?? { x: 0, y: 0 };
    const nextPercent = nextAlignment.offsetPercent ?? { x: 0, y: 0 };
    const offsetPercentChanged = previousPercent.x !== nextPercent.x || previousPercent.y !== nextPercent.y;

    if (state.project) {
      if (becameAuto && !offsetPercentChanged) {
        try {
          const percentOffset = computeLayerPercentOffset(targetLayer, state.project);
          nextAlignment = {
            ...nextAlignment,
            offsetPercent: percentOffset
          };
        } catch (error) {
          console.warn('[useAppStore] Failed to compute percent offset during alignment update', error);
        }
      }

      if (nextAlignment.positioning === 'auto') {
        const percent = nextAlignment.offsetPercent ?? { x: 0, y: 0 };
        const width = Math.max(1, state.project.width);
        const height = Math.max(1, state.project.height);
        nextAlignment = {
          ...nextAlignment,
          offsetPercent: percent,
          offsetPx: {
            x: Math.round((percent.x / 100) * width),
            y: Math.round((percent.y / 100) * height)
          }
        };
      } else {
        nextAlignment = {
          ...nextAlignment,
          offsetPercent: undefined
        };
      }
    } else if (nextAlignment.positioning !== 'auto') {
      nextAlignment = {
        ...nextAlignment,
        offsetPercent: undefined
      };
    }

    const updatedLayers = state.layers.map(layer => (
      layer.id === layerId
        ? { ...layer, alignment: nextAlignment }
        : layer
    ));

    const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);

    return {
      layers: syncedLayers,
      layersNeedRecomposition: true
    };
  });
    get().markCompositeSegmentsDirtyByLayerIds([layerId]);
  },
  reorderLayers: (sourceIndex, destinationIndex) => {
    const stateBeforeReorder = get();
    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeReorder, {
      actionType: 'layer-reorder',
      description: 'Reorder layers',
    });

    set((state) => {
      const newLayers = [...state.layers];
      const [removed] = newLayers.splice(sourceIndex, 1);
      newLayers.splice(destinationIndex, 0, removed);
      
      // Update order values
      const updatedLayers = newLayers.map((layer, index) => ({
        ...layer,
        order: index
      }));
      
      // Layer order changed - triggering recomposition
      
      const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);

      return {
        layers: syncedLayers,
        layersNeedRecomposition: true
        // Remove the project update entirely - only update top-level layers
      };
    });

    const stateAfterReorder = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterReorder, {
      actionType: 'layer-reorder',
      description: 'Reorder layers',
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Reorder layers',
      metadata: { operation: 'reorder' },
    });
    get().markAllCompositeSegmentsDirty();
  },

  // Color Cycle Layer Management
  initColorCycleForLayer: (layerId, width, height) => {
    set((state) => {
    try {
      const layer = state.layers.find(l => l.id === layerId);
      if (!layer) {
        console.error('[Store] Layer not found:', layerId);
        return {};
      }
      
      // CRITICAL: Only allow initialization for color-cycle layers
      if (layer.layerType !== 'color-cycle') {
        console.error('🚨 BLOCKED: Attempted to init color cycle for non-CC layer!', {
          layerId: layerId.substring(0, 20),
          layerType: layer.layerType
        });
        return {}; // Prevent color cycle initialization on regular layers
      }
      
      // GUARD: Don't re-initialize if already initialized
      const existingBrush = colorCycleBrushManager.getBrush(layerId);
      if (existingBrush) {
        // quiet
        // Ensure the layer has a valid canvas and CC metadata even if we skip recreation.
        const updatedLayers = state.layers.map(l => {
          if (l.id !== layerId) return l;
          const existingCanvas = l.colorCycleData?.canvas;
          const brushWithControls = existingBrush as typeof existingBrush & {
            setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
          };
          const layerCanvas =
            typeof HTMLCanvasElement !== 'undefined' && existingCanvas instanceof HTMLCanvasElement
              ? existingCanvas
              : undefined;
          if (layerCanvas && brushWithControls.setTargetCanvas) {
            brushWithControls.setTargetCanvas(layerCanvas);
          }
          const canvas = existingBrush.getCanvas ? existingBrush.getCanvas() : layerCanvas ?? existingCanvas;
          return {
            ...l,
            layerType: 'color-cycle' as const,
            colorCycleData: {
              ...(l.colorCycleData || {}),
              // Preserve existing gradient if any
              gradient: l.colorCycleData?.gradient || state.tools.brushSettings.colorCycleGradient || l.colorCycleData?.gradient,
              colorCycleBrush: existingBrush,
              // Keep current animation state if present; default to true for responsiveness
              isAnimating: l.colorCycleData?.isAnimating ?? true,
              // Ensure per-layer brush speed exists
              brushSpeed: l.colorCycleData?.brushSpeed ?? (state.tools.brushSettings.colorCycleSpeed || 0.1),
              flowMode: l.colorCycleData?.flowMode ?? (state.tools.brushSettings.colorCycleFlowMode ?? 'reverse'),
              canvas
            }
          };
        });
        trackLayerChanges('initColorCycleForLayer (hydrate existing)', updatedLayers);
        const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);
        return { layers: syncedLayers };
      }
      
      // Validate dimensions
      const safeWidth = Math.max(width || 1024, 1);
      const safeHeight = Math.max(height || 1024, 1);
      
      // Create a canvas element for this layer's color cycle
      // Use the current brush gradient if available
      const currentBrushGradient = state.tools.brushSettings.colorCycleGradient;
      const gradient = currentBrushGradient || layer?.colorCycleData?.gradient || DEFAULT_CC_GRADIENT;
      const gradientArray = gradientStopsToUint8Array(gradient);
      
      // Create brush through manager
      const colorCycleBrush = colorCycleBrushManager.createBrush(layerId, safeWidth, safeHeight, gradientArray);
      
      if (!colorCycleBrush) {
        console.error('[Store] Failed to create color cycle brush');
        return {};
      }

      let layerCanvas: HTMLCanvasElement | undefined;
      if (typeof document !== 'undefined') {
        const offscreen = document.createElement('canvas');
        offscreen.width = safeWidth;
        offscreen.height = safeHeight;
        layerCanvas = offscreen;
      } else if (colorCycleBrush.getCanvas) {
        layerCanvas = colorCycleBrush.getCanvas();
      }

      const brushWithControls = colorCycleBrush as typeof colorCycleBrush & {
        setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
        renderDirectToCanvas?: (targetCanvas: HTMLCanvasElement, layerId: string) => void;
      };
      if (layerCanvas && brushWithControls.setTargetCanvas) {
        brushWithControls.setTargetCanvas(layerCanvas);
      }
      if (layerCanvas && brushWithControls.renderDirectToCanvas) {
        try {
          brushWithControls.renderDirectToCanvas(layerCanvas, layerId);
        } catch {
          // best effort; canvas will be populated on next stroke
        }
      }

    const updatedLayers = state.layers.map(l => {
      if (l.id !== layerId) {
        return l;
      }

      let eraseMask = l.colorCycleData?.eraseMask;
      let eraseMaskVersion = l.colorCycleData?.eraseMaskVersion ?? 0;

      if (typeof document !== 'undefined') {
        if (eraseMask) {
          if (eraseMask.width !== safeWidth || eraseMask.height !== safeHeight) {
            const resized = document.createElement('canvas');
            resized.width = safeWidth;
            resized.height = safeHeight;
            const ctx = resized.getContext('2d');
            if (ctx) {
              ctx.drawImage(
                eraseMask,
                0,
                0,
                eraseMask.width,
                eraseMask.height,
                0,
                0,
                safeWidth,
                safeHeight
              );
            }
            eraseMask = resized;
            eraseMaskVersion =
              typeof l.colorCycleData?.eraseMaskVersion === 'number'
                ? l.colorCycleData.eraseMaskVersion + 1
                : 1;
          }
        } else {
          const maskCanvas = document.createElement('canvas');
          maskCanvas.width = safeWidth;
          maskCanvas.height = safeHeight;
          eraseMask = maskCanvas;
          eraseMaskVersion = 0;
        }
      }

      return {
        ...l,
        layerType: 'color-cycle' as const,
        colorCycleData: {
          gradient: gradient || [],
          colorCycleBrush,
          isAnimating: true,
          // Initialize per-layer brush speed from current brush settings
          brushSpeed: state.tools.brushSettings.colorCycleSpeed || 0.1,
          flowMode: state.tools.brushSettings.colorCycleFlowMode ?? 'reverse',
          canvas: layerCanvas ?? (colorCycleBrush.getCanvas ? colorCycleBrush.getCanvas() : undefined),
          eraseMask,
          eraseMaskVersion
        }
      };
    });
    
    trackLayerChanges('initColorCycleForLayer RETURN', updatedLayers);
    const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);
    return {
      layers: syncedLayers
      // Remove the project update entirely - only update top-level layers
    };
    } catch (error) {
      console.error('[Store] Error initializing color cycle:', error);
      return {}; // Return empty partial state on error
    }
    });
    get().markAllCompositeSegmentsDirty();
  },

  cleanupColorCycleForLayer: (layerId) => {
    set((state) => {
    const layer = state.layers.find(l => l.id === layerId);
    // CRITICAL: Only cleanup color-cycle layers, never touch normal layers
    if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) return state;
    
    // Cleanup through manager
    colorCycleBrushManager.deleteBrush(layerId);
    
    // CRITICAL FIX: Don't change the layer type when cleaning up!
    // We're just disposing Canvas2D resources, not converting the layer
    const updatedLayers = state.layers.map(l => 
      l.id === layerId 
        ? {
            ...l,
            // Keep the layer type as is - don't change it!
            colorCycleData: {
              ...l.colorCycleData,
              colorCycleBrush: undefined // Just clear the brush instance
            }
          }
        : l
    );
    
    const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);
    return {
      layers: syncedLayers
    };
  });
    get().markAllCompositeSegmentsDirty();
  },

  compositeLayersToCanvas: (targetCanvas) => {
    const state = get();

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

      const sortedLayers = [...state.layers].sort((a, b) => a.order - b.order);

      const drawAllLayers = (
        ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
      ) => {
        if ('imageSmoothingEnabled' in ctx) {
          (ctx as CanvasRenderingContext2D).imageSmoothingEnabled = !isPixelBrush;
        }
        drawStaticLayers(ctx, sortedLayers, state.project!);
        drawColorCycleLayers(ctx, sortedLayers, state.project!, colorCycleBrushManager, { clear: false });
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
  },

  renderStaticComposite: (targetCanvas, options) => {
    const state = get();
    try {
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

      const project = state.project;
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

      type SegmentDescriptor =
        | {
            kind: 'static';
            layerIds: string[];
            includeBackground: boolean;
            orderRange: { start: number; end: number };
          }
        | {
            kind: 'color-cycle';
            layerId: string;
            blendMode: GlobalCompositeOperation;
            opacity: number;
          };

      const sortedLayers = [...state.layers].sort((a, b) => a.order - b.order);
      const layerLookup = new Map(sortedLayers.map((layer) => [layer.id, layer]));

      const descriptors: SegmentDescriptor[] = [];
      let pendingStatic: Layer[] = [];
      const shouldPaintBackground = Boolean(
        project.backgroundColor && project.backgroundColor !== 'transparent'
      );
      let includeBackgroundNext = shouldPaintBackground;

      const flushStaticSegment = () => {
        if (!pendingStatic.length && !includeBackgroundNext) {
          return;
        }
        const layerIds = pendingStatic.map((layer) => layer.id);
        const orderStart = pendingStatic.length ? pendingStatic[0].order : Number.NEGATIVE_INFINITY;
        const orderEnd = pendingStatic.length
          ? pendingStatic[pendingStatic.length - 1].order
          : orderStart;
        descriptors.push({
          kind: 'static',
          layerIds,
          includeBackground: includeBackgroundNext,
          orderRange: {
            start: orderStart,
            end: orderEnd
          }
        });
        includeBackgroundNext = false;
        pendingStatic = [];
      };

      for (const layer of sortedLayers) {
        if (!layer.visible) {
          continue;
        }
        if (layer.layerType === 'color-cycle') {
          flushStaticSegment();
          descriptors.push({
            kind: 'color-cycle',
            layerId: layer.id,
            blendMode: layer.blendMode,
            opacity: layer.opacity,
          });
          continue;
        }
        pendingStatic.push(layer);
      }
      flushStaticSegment();
      if (!descriptors.length) {
        descriptors.push({
          kind: 'static',
          layerIds: [],
          includeBackground: includeBackgroundNext,
          orderRange: { start: Number.NEGATIVE_INFINITY, end: Number.NEGATIVE_INFINITY }
        });
      }

      const makeStaticSegment = (
        descriptor: Extract<SegmentDescriptor, { kind: 'static' }>,
        index: number
      ): StaticCompositeSegment => {
        const canvas = document.createElement('canvas');
        canvas.width = expectedWidth;
        canvas.height = expectedHeight;
        return {
          kind: 'static',
          id: `static-${Date.now()}-${index}`,
          layerIds: descriptor.layerIds,
          includeBackground: descriptor.includeBackground,
          orderRange: descriptor.orderRange,
          canvas,
          bitmap: null,
          dirty: true
        };
      };

      const structuresMatch =
        state.compositeSegments.length === descriptors.length &&
        state.compositeSegments.every((segment, index) => {
          const descriptor = descriptors[index];
          if (!descriptor || segment.kind !== descriptor.kind) {
            return false;
          }
          if (descriptor.kind === 'static' && segment.kind === 'static') {
            if (segment.includeBackground !== descriptor.includeBackground) {
              return false;
            }
            if (segment.layerIds.length !== descriptor.layerIds.length) {
              return false;
            }
            for (let idx = 0; idx < descriptor.layerIds.length; idx += 1) {
              if (segment.layerIds[idx] !== descriptor.layerIds[idx]) {
                return false;
              }
            }
            return true;
          }
          if (descriptor.kind === 'color-cycle' && segment.kind === 'color-cycle') {
            return segment.layerId === descriptor.layerId;
          }
          return false;
        });

      const nextSegments: CompositeSegment[] = descriptors.map((descriptor, index) => {
        if (descriptor.kind === 'static') {
          if (structuresMatch) {
            const previous = state.compositeSegments[index] as StaticCompositeSegment;
            return {
              ...previous,
              layerIds: descriptor.layerIds,
              includeBackground: descriptor.includeBackground,
              orderRange: descriptor.orderRange,
            };
          }
          return makeStaticSegment(descriptor, index);
        }
        if (structuresMatch) {
          const previous = state.compositeSegments[index] as ColorCycleCompositeSegment;
          return {
            ...previous,
            blendMode: descriptor.blendMode,
            opacity: descriptor.opacity
          };
        }
        return {
          kind: 'color-cycle',
          id: `cc-${descriptor.layerId}-${index}`,
          layerId: descriptor.layerId,
          blendMode: descriptor.blendMode,
          opacity: descriptor.opacity
        };
      });

      const repaintStaticSegment = (
        segment: StaticCompositeSegment,
        layerIds: string[]
      ): StaticCompositeSegment => {
        if (segment.canvas.width !== expectedWidth || segment.canvas.height !== expectedHeight) {
          segment.canvas.width = expectedWidth;
          segment.canvas.height = expectedHeight;
        }
        const ctx = segment.canvas.getContext(
          '2d',
          { willReadFrequently: true } as CanvasRenderingContext2DSettings
        ) as CanvasRenderingContext2D | null;
        if (!ctx) {
          return segment;
        }
        ctx.clearRect(0, 0, expectedWidth, expectedHeight);
        if (segment.includeBackground && project.backgroundColor && project.backgroundColor !== 'transparent') {
          ctx.fillStyle = project.backgroundColor;
          ctx.fillRect(0, 0, expectedWidth, expectedHeight);
        }
        for (const layerId of layerIds) {
          const layer = layerLookup.get(layerId);
          if (!layer || !layer.visible || layer.layerType === 'color-cycle') {
            continue;
          }
          let source: CanvasImageSource | null = null;
          if (layer.framebuffer) {
            source = layer.framebuffer as CanvasImageSource;
          } else if (layer.imageData) {
            const transferCanvas = createLayerTransferCanvas(
              layer.imageData.width,
              layer.imageData.height
            );
            if (transferCanvas) {
              const transferCtx = transferCanvas.getContext(
                '2d',
                { willReadFrequently: true } as CanvasRenderingContext2DSettings
              ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
              transferCtx?.putImageData(layer.imageData, 0, 0);
              source = transferCanvas as CanvasImageSource;
            }
          }
          if (!source) {
            continue;
          }
          ctx.globalCompositeOperation = layer.blendMode;
          ctx.globalAlpha = layer.opacity;
          ctx.drawImage(source, 0, 0);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        return { ...segment, dirty: false };
      };

      let anySegmentUpdated = !structuresMatch;
      const realizedSegments = nextSegments.map((segment) => {
        if (segment.kind === 'static') {
          if (segment.dirty || !structuresMatch) {
            anySegmentUpdated = true;
            return repaintStaticSegment(segment, segment.layerIds);
          }
        }
        return segment;
      });

      if (anySegmentUpdated) {
        set((prev) => ({
          compositeSegments: realizedSegments,
          compositeSegmentsVersion: prev.compositeSegmentsVersion + 1,
          staticCompositeVersion: prev.staticCompositeVersion + 1
        }));
      } else {
        set((prev) => ({
          compositeSegments: realizedSegments,
          staticCompositeVersion: prev.staticCompositeVersion + 1
        }));
      }

      const isPixelBrush =
        state.tools.brushSettings.brushShape === 'pixel_round' ||
        (state.tools.brushSettings.brushShape === 'square' &&
          !state.tools.brushSettings.antialiasing);
      staticCtx.imageSmoothingEnabled = !isPixelBrush;
      drawStaticLayers(staticCtx, sortedLayers, project);

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

  captureCanvasToActiveLayer: async (sourceCanvas, roi) => {
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

      const activeLayer = state.layers.find((layer) => layer.id === activeLayerId);
      if (!activeLayer) {
        return;
      }

      if (activeLayer.layerType === 'color-cycle') {
        get().setLayersNeedRecomposition(true);
        return;
      }

      set((currentState) => {
        const updatedLayers = currentState.layers.map((layer) => {
          if (layer.id !== activeLayerId) {
            return layer;
          }

          const matchedImageData =
            layer.imageData &&
            layer.imageData.width === captureWidth &&
            layer.imageData.height === captureHeight
              ? layer.imageData
              : null;
          const framebufferInitial = hasValidFramebuffer(layer.framebuffer)
            ? layer.framebuffer
            : createLayerTransferCanvas(captureWidth, captureHeight) ?? null;

          const baseImageDataRaw =
            matchedImageData ?? snapshotFramebufferRegion(framebufferInitial, captureWidth, captureHeight);

          const baseImageData =
            baseImageDataRaw &&
            (baseImageDataRaw.width !== captureWidth || baseImageDataRaw.height !== captureHeight)
              ? normalizeImageDataDimensions(baseImageDataRaw, captureWidth, captureHeight)
              : baseImageDataRaw;

          const targetWidth = baseImageData?.width ?? captureWidth;
          const targetHeight = baseImageData?.height ?? captureHeight;

          const mergedImageData = alphaCompositeImageDataRegion(
            baseImageData,
            capturedImageData,
            captureX,
            captureY,
            targetWidth,
            targetHeight
          );

          let framebuffer = framebufferInitial;
          if (!framebuffer) {
            framebuffer = createLayerTransferCanvas(mergedImageData.width, mergedImageData.height) ?? null;
          }

          if (framebuffer) {
            if (framebuffer.width !== targetWidth || framebuffer.height !== targetHeight) {
              framebuffer.width = targetWidth;
              framebuffer.height = targetHeight;
            }

            const framebufferCtx = framebuffer.getContext(
              '2d',
              { willReadFrequently: true } as CanvasRenderingContext2DSettings
            ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
            framebufferCtx?.putImageData(mergedImageData, 0, 0);
          }

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
            framebuffer: framebuffer ?? layer.framebuffer,
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
        };
      });

      get().setLayersNeedRecomposition(true);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        console.warn('[captureCanvasToActiveLayer] Canvas capture blocked by CORS/security policy');
        return;
      }
      logError('[captureCanvasToActiveLayer] Failed', error);
      throw error;
    }
  },

  captureCanvasToLayer: async (sourceCanvas, targetLayerId) => {
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
        };
      });

      get().setLayersNeedRecomposition(true);
    } catch (error) {
      console.error('Capture to specific layer failed with error:', error);
    }
  },

  getLayerColorCycleBrush: (layerId) => {
    // CRITICAL: Verify layer is actually a color-cycle layer
    const state = get();
    const layer = state.layers.find(l => l.id === layerId);
    if (layer && layer.layerType !== 'color-cycle') {
      // Silently return null for non-CC layers - this is expected behavior
      return null; // Never return a CC brush for regular layers
    }
    
    // Get from manager
    return colorCycleBrushManager.getBrush(layerId) ?? null;
  },

    };
  };
