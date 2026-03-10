import type { StateCreator } from 'zustand';
import type { ColorAdjustParams, ColorAdjustState, Layer, Rectangle } from '@/types';
import {
  blitImageDataWithinSelection,
  resolveSelectionRasterScope,
} from '@/stores/helpers/selectionRoi';
import { cloneLayerImageData, commitLayerHistory } from '@/history/helpers/layerHistory';
import { selectionSnapshotFromValues } from '@/history/selectionState';
import { copyScalarRegion } from '@/stores/helpers/selectionCapture';
import {
  captureLayerStructureSnapshot,
  commitLayerStructureHistory,
} from '@/stores/helpers/layerStructureHistory';
import type { LayerStructureSnapshot } from '@/history/deltas/layerStructureDelta';
import { applyColorAdjustments } from '@/utils/imageProcessing';
import { parseCssColor } from '@/utils/color/parseCssColor';
import { requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import { writeColorCycleRegion } from '@/stores/helpers/colorCycleSelection';

type AppState = import('../useAppStore').AppState;

let colorAdjustPreviewHandle: number | null = null;
let colorAdjustLayerStructureBefore: LayerStructureSnapshot | null = null;
let colorAdjustOriginalColorCycleData: Layer['colorCycleData'] | null = null;
let colorAdjustOriginalColorCycleSnapshot: ColorCycleRuntimeSnapshot | null = null;

// Per-layer working buffers to avoid reallocations during slider drags
const workingImageCache = new Map<string, ImageData>();
const scratchCache = new Map<string, ImageData>();

type ColorCycleGradientStop = { position: number; color: string };

type ColorCycleRuntimeSnapshot = {
  paintBuffer: Uint8Array;
  gradientIdBuffer: Uint8Array;
  gradientDefIdBuffer: Uint16Array | null;
  speedBuffer: Uint8Array | null;
  flowBuffer: Uint8Array | null;
  width: number;
  height: number;
  hasContent: boolean;
  strokeCounter: number;
};

const hasColorAdjustments = (params: ColorAdjustParams): boolean =>
  params.hue !== 0 ||
  params.saturation !== 0 ||
  params.vibrance !== 0 ||
  params.lightness !== 0 ||
  params.contrast !== 0 ||
  params.red !== 0 ||
  params.green !== 0 ||
  params.blue !== 0;

const resolveSelectionBounds = (
  state: AppState,
  width: number,
  height: number
): AppState['colorAdjust']['selectionBounds'] => {
  const canvasSelection = state.canvas.selection;
  const selectionScope = resolveSelectionRasterScope({
    selectionStart: state.selectionStart,
    selectionEnd: state.selectionEnd,
    selectionMask: state.selectionMask,
    selectionMaskBounds: state.selectionMaskBounds,
  }, width, height);

  if (selectionScope.bounds) {
    return selectionScope.bounds;
  }

  return canvasSelection?.active ? canvasSelection.bounds : null;
};

const cloneGradientStops = (
  stops: ColorCycleGradientStop[]
): ColorCycleGradientStop[] =>
  stops.map((stop) => ({
    position: stop.position,
    color: stop.color,
  }));

const cloneUint8Array = (source?: ArrayBuffer | ArrayBufferLike | null): Uint8Array | null => {
  if (!source) {
    return null;
  }
  return new Uint8Array(source.slice(0));
};

const cloneUint16Array = (source?: ArrayBuffer | ArrayBufferLike | null): Uint16Array | null => {
  if (!source) {
    return null;
  }
  return new Uint16Array(source.slice(0));
};

const clampColorCycleSlot = (slot: number): number =>
  Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(slot)));

const collectUsedColorCycleSlots = (data: NonNullable<Layer['colorCycleData']>): Set<number> => {
  const used = new Set<number>();
  data.slotPalettes?.forEach((entry) => used.add(clampColorCycleSlot(entry.slot)));
  data.gradientDefs?.forEach((entry) => used.add(clampColorCycleSlot(entry.currentSlot)));
  if (typeof data.paintSlot === 'number') {
    used.add(clampColorCycleSlot(data.paintSlot));
  }
  if (typeof data.fgActiveSlot === 'number') {
    used.add(clampColorCycleSlot(data.fgActiveSlot));
  }
  used.add(TEMP_SAMPLE_SLOT);
  used.add(FLOW_SLOT_MASK);
  return used;
};

const pickAvailableColorCycleSlot = (used: Set<number>): number | null => {
  for (let slot = 0; slot < FLOW_SLOT_MASK; slot += 1) {
    if (!used.has(slot)) {
      return slot;
    }
  }
  return null;
};

const buildSelectionAlphaData = (
  selectionMask: ImageData | null,
  selectionMaskBounds: Rectangle | null,
  selectionBounds: Rectangle
): Uint8ClampedArray | null => {
  if (!selectionMask || !selectionMaskBounds) {
    return null;
  }

  const alpha = new Uint8ClampedArray(selectionBounds.width * selectionBounds.height * 4);
  const offsetX = selectionBounds.x - Math.floor(selectionMaskBounds.x);
  const offsetY = selectionBounds.y - Math.floor(selectionMaskBounds.y);

  for (let y = 0; y < selectionBounds.height; y += 1) {
    const maskY = y + offsetY;
    if (maskY < 0 || maskY >= selectionMask.height) {
      continue;
    }
    for (let x = 0; x < selectionBounds.width; x += 1) {
      const maskX = x + offsetX;
      if (maskX < 0 || maskX >= selectionMask.width) {
        continue;
      }
      const maskIndex = (maskY * selectionMask.width + maskX) * 4 + 3;
      const targetIndex = (y * selectionBounds.width + x) * 4 + 3;
      alpha[targetIndex] = selectionMask.data[maskIndex] ?? 0;
    }
  }

  return alpha;
};

const cloneColorCycleData = (
  data: Layer['colorCycleData'] | undefined
): Layer['colorCycleData'] | null => {
  if (!data) {
    return null;
  }
  return {
    ...data,
    gradient: data.gradient ? cloneGradientStops(data.gradient) : data.gradient,
    gradients: data.gradients
      ? data.gradients.map((entry) => ({
          ...entry,
          stops: cloneGradientStops(entry.stops),
        }))
      : data.gradients,
    slotPalettes: data.slotPalettes
      ? data.slotPalettes.map((entry) => ({
          slot: entry.slot,
          stops: cloneGradientStops(entry.stops),
        }))
      : data.slotPalettes,
    gradientDefStore: data.gradientDefStore
      ? data.gradientDefStore.map((entry) => ({
          ...entry,
          stops: cloneGradientStops(entry.stops),
        }))
      : data.gradientDefStore,
    recolorSettings: data.recolorSettings
      ? {
          ...data.recolorSettings,
          gradient: cloneGradientStops(data.recolorSettings.gradient),
        }
      : data.recolorSettings,
  };
};

const resolveColorCycleGradient = (layer: Layer): Array<{ position: number; color: string }> | null => {
  if (layer.layerType !== 'color-cycle') {
    return null;
  }
  const recolorGradient = layer.colorCycleData?.recolorSettings?.gradient;
  if (Array.isArray(recolorGradient) && recolorGradient.length > 0) {
    return cloneGradientStops(recolorGradient);
  }
  const brushGradient = layer.colorCycleData?.gradient;
  if (Array.isArray(brushGradient) && brushGradient.length > 0) {
    return cloneGradientStops(brushGradient);
  }
  const slotPaletteGradient = layer.colorCycleData?.slotPalettes?.[0]?.stops;
  if (Array.isArray(slotPaletteGradient) && slotPaletteGradient.length > 0) {
    return cloneGradientStops(slotPaletteGradient);
  }
  const defStoreGradient = layer.colorCycleData?.gradientDefStore?.[0]?.stops;
  if (Array.isArray(defStoreGradient) && defStoreGradient.length > 0) {
    return cloneGradientStops(defStoreGradient);
  }
  return null;
};

const colorToCss = (r: number, g: number, b: number, a: number): string => {
  if (a >= 255) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  const alpha = Math.max(0, Math.min(1, a / 255));
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(4)})`;
};

const applyColorAdjustmentsToColor = (
  color: string,
  params: ColorAdjustParams
): string => {
  const parsed = parseCssColor(color, { r: 255, g: 255, b: 255, a: 255 });
  const pixel = new ImageData(1, 1);
  pixel.data[0] = parsed.r;
  pixel.data[1] = parsed.g;
  pixel.data[2] = parsed.b;
  pixel.data[3] = parsed.a;
  const adjusted = applyColorAdjustments(pixel, params);
  return colorToCss(
    adjusted.data[0] ?? parsed.r,
    adjusted.data[1] ?? parsed.g,
    adjusted.data[2] ?? parsed.b,
    adjusted.data[3] ?? parsed.a
  );
};

const applyColorAdjustmentsToGradient = (
  stops: Array<{ position: number; color: string }>,
  params: ColorAdjustParams
): Array<{ position: number; color: string }> =>
  stops.map((stop) => ({
    position: stop.position,
    color: applyColorAdjustmentsToColor(stop.color, params),
  }));

const buildAdjustedColorCycleData = (
  original: Layer['colorCycleData'],
  params: ColorAdjustParams
): Layer['colorCycleData'] => {
  if (!original) {
    return original;
  }
  const adjustStops = (stops: Array<{ position: number; color: string }>) =>
    applyColorAdjustmentsToGradient(stops, params);

  return {
    ...original,
    gradient: original.gradient ? adjustStops(original.gradient) : original.gradient,
    gradients: original.gradients
      ? original.gradients.map((entry) => ({
          ...entry,
          stops: adjustStops(entry.stops),
        }))
      : original.gradients,
    slotPalettes: original.slotPalettes
      ? original.slotPalettes.map((entry) => ({
          slot: entry.slot,
          stops: adjustStops(entry.stops),
        }))
      : original.slotPalettes,
    gradientDefStore: original.gradientDefStore
      ? original.gradientDefStore.map((entry) => ({
          ...entry,
          stops: adjustStops(entry.stops),
        }))
      : original.gradientDefStore,
    recolorSettings: original.recolorSettings
      ? {
          ...original.recolorSettings,
          gradient: adjustStops(original.recolorSettings.gradient),
        }
      : original.recolorSettings,
  };
};

const replaceColorCycleLayerData = (
  set: Parameters<StateCreator<AppState, [], [], ColorAdjustSlice>>[0],
  get: () => AppState,
  layerId: string,
  colorCycleData: Layer['colorCycleData']
): void => {
  let didReplace = false;

  set((state) => {
    const layerIndex = state.layers.findIndex((layer) => layer.id === layerId);
    if (layerIndex < 0) {
      return state;
    }

    const currentLayer = state.layers[layerIndex];
    if (currentLayer.layerType !== 'color-cycle') {
      return state;
    }

    const updatedLayer: Layer = {
      ...currentLayer,
      colorCycleData,
    };
    const nextLayers = [...state.layers];
    nextLayers[layerIndex] = updatedLayer;
    didReplace = true;

    return {
      layers: nextLayers,
      layersNeedRecomposition: true,
    };
  });

  if (didReplace) {
    get().markCompositeSegmentsDirtyByLayerIds([layerId]);
  }
};

const refreshColorCycleGradientDefRuntime = (
  get: () => AppState,
  layerId: string
): void => {
  try {
    const brush = get().getLayerColorCycleBrush(layerId) as {
      syncGradientDefRuntime?: (targetLayerId: string) => void;
    } | null;
    brush?.syncGradientDefRuntime?.(layerId);
  } catch {
    // noop: shape-bound defs can fall back to next full render if runtime is unavailable
  }
};

const captureColorCycleRuntimeSnapshot = (
  state: AppState,
  layer: Layer
): ColorCycleRuntimeSnapshot | null => {
  if (layer.layerType !== 'color-cycle') {
    return null;
  }

  const brush = state.getLayerColorCycleBrush(layer.id) as {
    getLayerSnapshot?: (layerId: string) => {
      paintBuffer?: ArrayBuffer;
      gradientIdBuffer?: ArrayBuffer;
      gradientDefIdBuffer?: ArrayBuffer;
      speedBuffer?: ArrayBuffer;
      flowBuffer?: ArrayBuffer;
      hasContent?: boolean;
      strokeCounter?: number;
    } | null;
    getCanvas?: () => HTMLCanvasElement | OffscreenCanvas | null;
  } | null;
  const snapshot = brush?.getLayerSnapshot?.(layer.id) ?? null;
  const canvas = layer.colorCycleData?.canvas ?? brush?.getCanvas?.() ?? layer.framebuffer;
  const width = canvas?.width ?? layer.imageData?.width ?? state.project?.width ?? 0;
  const height = canvas?.height ?? layer.imageData?.height ?? state.project?.height ?? 0;

  if (!snapshot?.paintBuffer || width <= 0 || height <= 0) {
    return null;
  }

  const paintBuffer = cloneUint8Array(snapshot.paintBuffer);
  const gradientIdBuffer = cloneUint8Array(snapshot.gradientIdBuffer) ?? new Uint8Array(width * height);
  const gradientDefIdBuffer = cloneUint16Array(snapshot.gradientDefIdBuffer);
  const speedBuffer = cloneUint8Array(snapshot.speedBuffer);
  const flowBuffer = cloneUint8Array(snapshot.flowBuffer);

  if (!paintBuffer || paintBuffer.length !== width * height || gradientIdBuffer.length !== width * height) {
    return null;
  }
  if (gradientDefIdBuffer && gradientDefIdBuffer.length !== width * height) {
    return null;
  }
  if (speedBuffer && speedBuffer.length !== width * height) {
    return null;
  }
  if (flowBuffer && flowBuffer.length !== width * height) {
    return null;
  }

  return {
    paintBuffer,
    gradientIdBuffer,
    gradientDefIdBuffer,
    speedBuffer,
    flowBuffer,
    width,
    height,
    hasContent: snapshot.hasContent ?? paintBuffer.some((value) => value !== 0),
    strokeCounter: snapshot.strokeCounter ?? 0,
  };
};

const restoreColorCycleRuntimeSnapshot = (
  state: AppState,
  layer: Layer,
  snapshot: ColorCycleRuntimeSnapshot | null
): void => {
  if (layer.layerType !== 'color-cycle' || !snapshot) {
    return;
  }

  const brush = state.getLayerColorCycleBrush(layer.id) as {
    applyLayerSnapshot?: (layerId: string, payload: {
      paintBuffer: ArrayBuffer;
      gradientIdBuffer?: ArrayBuffer;
      gradientDefIdBuffer?: ArrayBuffer;
      speedBuffer?: ArrayBuffer;
      flowBuffer?: ArrayBuffer;
      hasContent: boolean;
      strokeCounter: number;
    }) => void;
    renderDirectToCanvas?: (canvas: HTMLCanvasElement | OffscreenCanvas, layerId: string) => void;
    getCanvas?: () => HTMLCanvasElement | OffscreenCanvas | null;
  } | null;

  if (!brush?.applyLayerSnapshot) {
    return;
  }

  brush.applyLayerSnapshot(layer.id, {
    paintBuffer: snapshot.paintBuffer.slice().buffer,
    gradientIdBuffer: snapshot.gradientIdBuffer.slice().buffer,
    gradientDefIdBuffer: snapshot.gradientDefIdBuffer?.slice().buffer,
    speedBuffer: snapshot.speedBuffer?.slice().buffer,
    flowBuffer: snapshot.flowBuffer?.slice().buffer,
    hasContent: snapshot.hasContent,
    strokeCounter: snapshot.strokeCounter,
  });

  const canvas = layer.colorCycleData?.canvas ?? brush.getCanvas?.();
  if (canvas && brush.renderDirectToCanvas) {
    try {
      brush.renderDirectToCanvas(canvas, layer.id);
    } catch {
      // noop: requestGradientApply can refresh the runtime palette
    }
  }
};

const previewSelectedColorCycleRegion = (
  state: AppState,
  set: Parameters<StateCreator<AppState, [], [], ColorAdjustSlice>>[0],
  get: () => AppState,
  layer: Layer,
  originalData: NonNullable<Layer['colorCycleData']>,
  originalSnapshot: ColorCycleRuntimeSnapshot,
  params: ColorAdjustParams,
  selectionScope: ReturnType<typeof resolveSelectionRasterScope>
): boolean => {
  if (layer.layerType !== 'color-cycle' || !state.project) {
    return false;
  }

  const selectionBounds = selectionScope.bounds;
  if (!selectionBounds || selectionBounds.width <= 0 || selectionBounds.height <= 0) {
    return false;
  }

  const slotPalettes = originalData.slotPalettes ?? [];
  if (slotPalettes.length === 0) {
    return false;
  }

  restoreColorCycleRuntimeSnapshot(state, layer, originalSnapshot);

  const selectionGradientIds = copyScalarRegion(
    originalSnapshot.gradientIdBuffer,
    originalSnapshot.width,
    originalSnapshot.height,
    selectionBounds
  );
  const selectionPaint = copyScalarRegion(
    originalSnapshot.paintBuffer,
    originalSnapshot.width,
    originalSnapshot.height,
    selectionBounds
  );

  const usedSlots = collectUsedColorCycleSlots(originalData);
  const slotRemap = new Map<number, number>();
  const nextSlotPalettes = slotPalettes.map((entry) => ({
    slot: entry.slot,
    stops: cloneGradientStops(entry.stops),
  }));

  for (let index = 0; index < selectionGradientIds.length; index += 1) {
    if ((selectionPaint[index] ?? 0) === 0) {
      continue;
    }

    const sourceSlot = clampColorCycleSlot(selectionGradientIds[index] ?? 0);
    if (slotRemap.has(sourceSlot)) {
      continue;
    }

    const sourcePalette = nextSlotPalettes.find((entry) => entry.slot === sourceSlot);
    if (!sourcePalette) {
      continue;
    }

    const nextSlot = pickAvailableColorCycleSlot(usedSlots);
    if (nextSlot === null) {
      return false;
    }

    usedSlots.add(nextSlot);
    slotRemap.set(sourceSlot, nextSlot);
    nextSlotPalettes.push({
      slot: nextSlot,
      stops: applyColorAdjustmentsToGradient(sourcePalette.stops, params),
    });
  }

  if (slotRemap.size === 0) {
    return false;
  }

  const baseColorCycleData = cloneColorCycleData(originalData) ?? originalData;

  const remappedGradientIds = selectionGradientIds.slice();
  for (let index = 0; index < remappedGradientIds.length; index += 1) {
    if ((selectionPaint[index] ?? 0) === 0) {
      continue;
    }
    const sourceSlot = clampColorCycleSlot(remappedGradientIds[index] ?? 0);
    const remappedSlot = slotRemap.get(sourceSlot);
    if (remappedSlot !== undefined) {
      remappedGradientIds[index] = remappedSlot;
    }
  }

  replaceColorCycleLayerData(set, get, layer.id, {
    ...baseColorCycleData,
    slotPalettes: nextSlotPalettes,
  });

  const alphaData = buildSelectionAlphaData(
    selectionScope.selectionMask,
    selectionScope.selectionMaskBounds,
    selectionBounds
  );

  const wroteRegion = writeColorCycleRegion(
    state,
    layer,
    state.project,
    selectionBounds,
    selectionPaint,
    selectionBounds.width,
    selectionBounds.height,
    {
      alphaData,
      alphaStride: 4,
      alphaChannelOffset: 3,
      alphaThreshold: 0,
      sourceGradientIds: remappedGradientIds,
    }
  );

  if (!wroteRegion) {
    replaceColorCycleLayerData(set, get, layer.id, baseColorCycleData);
    restoreColorCycleRuntimeSnapshot(state, layer, originalSnapshot);
    return false;
  }

  const refreshedLayer = get().layers.find((entry) => entry.id === layer.id);
  const refreshedColorCycleData =
    refreshedLayer?.layerType === 'color-cycle'
      ? cloneColorCycleData(refreshedLayer.colorCycleData) ?? baseColorCycleData
      : baseColorCycleData;
  replaceColorCycleLayerData(set, get, layer.id, {
    ...refreshedColorCycleData,
    slotPalettes: nextSlotPalettes,
  });

  requestGradientApply(layer.id, 'color-adjust-preview-selection');
  refreshColorCycleGradientDefRuntime(get, layer.id);
  state.setLayersNeedRecomposition(true);
  return true;
};

const snapshotLayerImageData = (layer: Layer | undefined): ImageData | null => {
  if (!layer) {
    return null;
  }
  if (layer.imageData) {
    return cloneLayerImageData(layer.imageData);
  }

  // Fallback: read from framebuffer when imageData hasn't been synced yet.
  const framebuffer = layer.framebuffer;
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
    return fbCtx.getImageData(0, 0, framebuffer.width, framebuffer.height);
  } catch {
    return null;
  }
};

const getWorkingImage = (layerId: string, width: number, height: number): ImageData => {
  const cacheKey = layerId;
  const existing = workingImageCache.get(cacheKey);
  if (existing && existing.width === width && existing.height === height) {
    return existing;
  }
  const fresh = new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
  workingImageCache.set(cacheKey, fresh);
  return fresh;
};

const getScratchImage = (layerId: string, width: number, height: number): ImageData => {
  const cacheKey = `${layerId}-${width}x${height}`;
  const existing = scratchCache.get(cacheKey);
  if (existing && existing.width === width && existing.height === height) {
    return existing;
  }
  const fresh = new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
  scratchCache.set(cacheKey, fresh);
  return fresh;
};

// Keep the framebuffer in sync with ImageData updates so compositing uses the adjusted pixels.
const syncFramebufferFromImageData = (layer: Layer | undefined, imageData: ImageData): void => {
  if (!layer?.framebuffer) {
    return;
  }

  try {
    const framebuffer = layer.framebuffer;
    if (framebuffer.width !== imageData.width || framebuffer.height !== imageData.height) {
      framebuffer.width = imageData.width;
      framebuffer.height = imageData.height;
    }

    const fbCtx = framebuffer.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings
    ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

    if (!fbCtx) {
      return;
    }

    fbCtx.clearRect(0, 0, framebuffer.width, framebuffer.height);
    fbCtx.putImageData(imageData, 0, 0);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[colorAdjust] Failed to sync framebuffer', error);
    }
  }
};

const cancelScheduledColorAdjustPreview = (): void => {
  if (typeof window !== 'undefined' && colorAdjustPreviewHandle !== null) {
    cancelAnimationFrame(colorAdjustPreviewHandle);
  }
  colorAdjustPreviewHandle = null;
};

const scheduleColorAdjustPreview = (getState: () => AppState): void => {
  if (typeof window === 'undefined') {
    getState().previewColorAdjust();
    return;
  }

  cancelScheduledColorAdjustPreview();
  colorAdjustPreviewHandle = requestAnimationFrame(() => {
    colorAdjustPreviewHandle = null;
    getState().previewColorAdjust();
  });
};

export const defaultColorAdjustParams: ColorAdjustParams = {
  hue: 0,
  saturation: 0,
  vibrance: 0,
  lightness: 0,
  contrast: 0,
  red: 0,
  green: 0,
  blue: 0,
  hueRangeEnabled: false,
  hueRangeStart: 0,
  hueRangeEnd: 360,
};

export const createDefaultColorAdjustState = (): ColorAdjustState => ({
  active: false,
  params: { ...defaultColorAdjustParams },
  originalImageData: null,
  originalColorCycleGradient: null,
  targetLayerType: null,
  selectionBounds: null,
  targetLayerId: null,
});

export interface ColorAdjustSlice {
  colorAdjust: ColorAdjustState;
  startColorAdjustSession: () => void;
  updateColorAdjustParams: (params: Partial<ColorAdjustParams>) => void;
  previewColorAdjust: () => void;
  applyColorAdjust: () => Promise<void>;
  cancelColorAdjust: () => void;
  resetColorAdjustParams: () => void;
}

export const createColorAdjustSlice: StateCreator<AppState, [], [], ColorAdjustSlice> = (set, get) => ({
  colorAdjust: createDefaultColorAdjustState(),
  startColorAdjustSession: () => {
    const state = get();
    const { activeLayerId, layers } = state;
    colorAdjustLayerStructureBefore = null;
    colorAdjustOriginalColorCycleData = null;
    colorAdjustOriginalColorCycleSnapshot = null;

    if (!activeLayerId) {
      set({ colorAdjust: createDefaultColorAdjustState() });
      return;
    }

    const layer = layers.find((l) => l.id === activeLayerId);
    if (!layer) {
      set({ colorAdjust: createDefaultColorAdjustState() });
      return;
    }

    if (layer.layerType === 'color-cycle') {
      const originalGradient = resolveColorCycleGradient(layer);
      if (!originalGradient || originalGradient.length === 0) {
        set({ colorAdjust: createDefaultColorAdjustState() });
        return;
      }
      colorAdjustOriginalColorCycleData = cloneColorCycleData(layer.colorCycleData);
      colorAdjustOriginalColorCycleSnapshot = captureColorCycleRuntimeSnapshot(state, layer);

      colorAdjustLayerStructureBefore = captureLayerStructureSnapshot(state, {
        actionType: 'color-adjust',
        description: 'Color adjust',
        activeLayerId: layer.id,
      });

      set({
        colorAdjust: {
          active: true,
          targetLayerId: layer.id,
          targetLayerType: 'color-cycle',
          originalImageData: null,
          originalColorCycleGradient: originalGradient,
          selectionBounds: null,
          params: { ...defaultColorAdjustParams },
        },
      });
      scheduleColorAdjustPreview(get);
      return;
    }

    if (layer.layerType !== 'normal') {
      set({ colorAdjust: createDefaultColorAdjustState() });
      return;
    }

    const originalImageData = snapshotLayerImageData(layer);
    if (!originalImageData) {
      set({ colorAdjust: createDefaultColorAdjustState() });
      return;
    }

    const selectionBounds = resolveSelectionBounds(
      state,
      originalImageData.width,
      originalImageData.height
    );

    set({
      colorAdjust: {
        active: true,
        targetLayerId: layer.id,
        targetLayerType: 'normal',
        originalImageData,
        originalColorCycleGradient: null,
        selectionBounds,
        params: { ...defaultColorAdjustParams },
      },
    });
    scheduleColorAdjustPreview(get);
  },
  updateColorAdjustParams: (params) => {
    let didUpdate = false;
    set((state) => {
      if (!state.colorAdjust.active) {
        return state;
      }

      didUpdate = true;
      return {
        colorAdjust: {
          ...state.colorAdjust,
          params: {
            ...state.colorAdjust.params,
            ...params,
          },
        },
      };
    });

    if (didUpdate) {
      scheduleColorAdjustPreview(get);
    }
  },
  previewColorAdjust: () => {
    const state = get();
    const { colorAdjust } = state;
    if (!colorAdjust.active || !colorAdjust.targetLayerId) {
      return;
    }

    const layer = state.layers.find((l) => l.id === colorAdjust.targetLayerId);
    if (!layer) {
      return;
    }

    if (colorAdjust.targetLayerType === 'color-cycle') {
      if (layer.layerType !== 'color-cycle' || !colorAdjustOriginalColorCycleData) {
        return;
      }
      const colorCycleSelectionScope = resolveSelectionRasterScope({
        selectionStart: state.selectionStart,
        selectionEnd: state.selectionEnd,
        selectionMask: state.selectionMask,
        selectionMaskBounds: state.selectionMaskBounds,
      }, layer.imageData?.width ?? state.project?.width ?? 0, layer.imageData?.height ?? state.project?.height ?? 0);

      if (
        colorAdjustOriginalColorCycleSnapshot &&
        !colorAdjustOriginalColorCycleData.recolorSettings &&
        previewSelectedColorCycleRegion(
          state,
          set,
          get,
          layer,
          colorAdjustOriginalColorCycleData,
          colorAdjustOriginalColorCycleSnapshot,
          colorAdjust.params,
          colorCycleSelectionScope
        )
      ) {
        return;
      }

      restoreColorCycleRuntimeSnapshot(state, layer, colorAdjustOriginalColorCycleSnapshot);
      const nextColorCycleData = hasColorAdjustments(colorAdjust.params)
        ? buildAdjustedColorCycleData(colorAdjustOriginalColorCycleData, colorAdjust.params)
        : cloneColorCycleData(colorAdjustOriginalColorCycleData);

      if (nextColorCycleData) {
        replaceColorCycleLayerData(set, get, layer.id, nextColorCycleData);
      }

      if (nextColorCycleData?.mode === 'recolor' && nextColorCycleData.recolorSettings) {
        const refreshedLayer = get().layers.find((entry) => entry.id === layer.id);
        if (refreshedLayer?.layerType === 'color-cycle') {
          try {
            RecolorManager.getInstance().updateGradient(
              refreshedLayer,
              cloneGradientStops(nextColorCycleData.recolorSettings.gradient)
            );
          } catch {
            // noop: keep store layer data updated even if runtime manager is unavailable
          }
        }
      } else {
        requestGradientApply(layer.id, 'color-adjust-preview');
        refreshColorCycleGradientDefRuntime(get, layer.id);
      }

      state.setLayersNeedRecomposition(true);
      return;
    }

    if (!colorAdjust.originalImageData || layer.layerType !== 'normal') {
      return;
    }

    const { params, originalImageData, targetLayerId } = colorAdjust;
    const selectionScope = resolveSelectionRasterScope({
      selectionStart: state.selectionStart,
      selectionEnd: state.selectionEnd,
      selectionMask: state.selectionMask,
      selectionMaskBounds: state.selectionMaskBounds,
    }, originalImageData.width, originalImageData.height);
    const selectionBounds = selectionScope.bounds ?? resolveSelectionBounds(
      state,
      originalImageData.width,
      originalImageData.height
    );
    const hasAdjustments = hasColorAdjustments(params);
    const working = getWorkingImage(targetLayerId, originalImageData.width, originalImageData.height);

    if (!selectionBounds) {
      // Full-layer adjustment; copy baseline then adjust
      working.data.set(originalImageData.data);
      const adjusted = hasAdjustments
        ? applyColorAdjustments(working, params)
        : cloneLayerImageData(working) ?? working;
      state.updateLayer(layer.id, { imageData: adjusted });
      syncFramebufferFromImageData(layer, adjusted);
      state.setLayersNeedRecomposition(true);
      return;
    }

    // ROI path: keep baseline elsewhere intact, only touch the selection bounds
    working.data.set(originalImageData.data);

    const { width, height, x, y } = selectionBounds;
    const scratch = getScratchImage(targetLayerId, width, height);
    const targetStride = scratch.width * 4;
    for (let row = 0; row < height; row += 1) {
      const srcStart = ((y + row) * originalImageData.width + x) * 4;
      const tgtStart = row * targetStride;
      scratch.data.set(
        originalImageData.data.subarray(srcStart, srcStart + width * 4),
        tgtStart
      );
    }

    const adjustedRegion = hasAdjustments
      ? applyColorAdjustments(scratch, params)
      : scratch;

    blitImageDataWithinSelection(
      adjustedRegion,
      working,
      selectionBounds.x,
      selectionBounds.y,
      selectionScope.selectionMask,
      selectionScope.selectionMaskBounds
    );

    syncFramebufferFromImageData(layer, working);
    state.updateLayer(layer.id, { imageData: working });
    state.setLayersNeedRecomposition(true);
  },
  applyColorAdjust: async () => {
    const state = get();
    const { colorAdjust } = state;
    if (!colorAdjust.active || !colorAdjust.targetLayerId) {
      return;
    }

    cancelScheduledColorAdjustPreview();

    const layer = state.layers.find((l) => l.id === colorAdjust.targetLayerId);
    if (!layer) {
      set({ colorAdjust: createDefaultColorAdjustState() });
      colorAdjustLayerStructureBefore = null;
      colorAdjustOriginalColorCycleData = null;
      colorAdjustOriginalColorCycleSnapshot = null;
      return;
    }

    if (colorAdjust.targetLayerType === 'color-cycle') {
      if (layer.layerType !== 'color-cycle') {
        set({ colorAdjust: createDefaultColorAdjustState() });
        colorAdjustLayerStructureBefore = null;
        colorAdjustOriginalColorCycleData = null;
        colorAdjustOriginalColorCycleSnapshot = null;
        return;
      }

      get().previewColorAdjust();

      const beforeSnapshot = colorAdjustLayerStructureBefore;
      const refreshedState = get();
      const afterSnapshot = captureLayerStructureSnapshot(refreshedState, {
        actionType: 'color-adjust',
        description: 'Color adjust',
        activeLayerId: layer.id,
        previousSnapshot: beforeSnapshot,
      });

      if (beforeSnapshot) {
        commitLayerStructureHistory({
          set,
          beforeSnapshot,
          afterSnapshot,
          label: 'Color adjust',
          metadata: {
            layerId: layer.id,
            tool: 'color-adjust',
          },
        });
      }

      const refreshedLayer = refreshedState.layers.find((entry) => entry.id === layer.id);
      const updatedBaseline =
        refreshedLayer && refreshedLayer.layerType === 'color-cycle'
          ? resolveColorCycleGradient(refreshedLayer)
          : null;

      if (updatedBaseline && updatedBaseline.length > 0) {
        colorAdjustLayerStructureBefore = afterSnapshot;
        colorAdjustOriginalColorCycleData = cloneColorCycleData(refreshedLayer?.colorCycleData);
        colorAdjustOriginalColorCycleSnapshot = refreshedLayer
          ? captureColorCycleRuntimeSnapshot(get(), refreshedLayer)
          : null;
        set({
          colorAdjust: {
            active: true,
            targetLayerId: layer.id,
            targetLayerType: 'color-cycle',
            originalImageData: null,
            originalColorCycleGradient: updatedBaseline,
            selectionBounds: null,
            params: { ...defaultColorAdjustParams },
          },
        });
      } else {
        colorAdjustLayerStructureBefore = null;
        colorAdjustOriginalColorCycleData = null;
        colorAdjustOriginalColorCycleSnapshot = null;
        set({ colorAdjust: createDefaultColorAdjustState() });
      }
      return;
    }

    if (!colorAdjust.originalImageData || layer.layerType !== 'normal') {
      set({ colorAdjust: createDefaultColorAdjustState() });
      return;
    }

    const beforeImage = cloneLayerImageData(colorAdjust.originalImageData);
    if (!beforeImage) {
      set({ colorAdjust: createDefaultColorAdjustState() });
      return;
    }

    get().previewColorAdjust();

    const selectionSnapshot =
      state.selectionStart && state.selectionEnd
        ? selectionSnapshotFromValues(state.selectionStart, state.selectionEnd)
        : null;

    await commitLayerHistory({
      layerId: layer.id,
      beforeImage,
      beforeColorState: null,
      actionType: 'color-adjust',
      description: 'Color adjust',
      tool: 'color-adjust',
      selectionBefore: selectionSnapshot ?? undefined,
      bitmapRoi: resolveSelectionBounds(state, beforeImage.width, beforeImage.height) ?? undefined,
    }).catch((error) => {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[history] Failed to record color adjust', error);
      }
    });

    const refreshedLayer = get().layers.find((l) => l.id === layer.id);
    const updatedBaseline = refreshedLayer?.imageData
      ? cloneLayerImageData(refreshedLayer.imageData)
      : null;

    if (updatedBaseline) {
      set(() => ({
        colorAdjust: {
          active: true,
          targetLayerId: layer.id,
          targetLayerType: 'normal',
          originalImageData: updatedBaseline,
          originalColorCycleGradient: null,
          selectionBounds: resolveSelectionBounds(get(), updatedBaseline.width, updatedBaseline.height),
          params: { ...defaultColorAdjustParams },
        },
      }));
    } else {
      set({ colorAdjust: createDefaultColorAdjustState() });
    }
  },
  cancelColorAdjust: () => {
    const state = get();
    const { colorAdjust } = state;
    if (!colorAdjust.active || !colorAdjust.targetLayerId) {
      set({ colorAdjust: createDefaultColorAdjustState() });
      colorAdjustLayerStructureBefore = null;
      colorAdjustOriginalColorCycleData = null;
      colorAdjustOriginalColorCycleSnapshot = null;
      return;
    }

    cancelScheduledColorAdjustPreview();

    const layer = state.layers.find((l) => l.id === colorAdjust.targetLayerId);
    if (layer && colorAdjust.targetLayerType === 'color-cycle' && colorAdjustOriginalColorCycleData) {
      const restoredData = cloneColorCycleData(colorAdjustOriginalColorCycleData);
      if (layer.layerType === 'color-cycle' && restoredData) {
        replaceColorCycleLayerData(set, get, layer.id, restoredData);
        restoreColorCycleRuntimeSnapshot(state, layer, colorAdjustOriginalColorCycleSnapshot);
      }
      if (layer.layerType === 'color-cycle' && restoredData?.mode === 'recolor' && restoredData.recolorSettings) {
        const refreshedLayer = get().layers.find((entry) => entry.id === layer.id);
        if (refreshedLayer?.layerType === 'color-cycle') {
          try {
            RecolorManager.getInstance().updateGradient(
              refreshedLayer,
              cloneGradientStops(restoredData.recolorSettings.gradient)
            );
          } catch {
            // noop
          }
        }
      } else if (layer.layerType === 'color-cycle') {
        requestGradientApply(layer.id, 'color-adjust-cancel');
        refreshColorCycleGradientDefRuntime(get, layer.id);
      }
      state.setLayersNeedRecomposition(true);
    }

    if (layer && colorAdjust.targetLayerType !== 'color-cycle' && colorAdjust.originalImageData) {
      if (layer.layerType === 'normal') {
        const restoredImage = cloneLayerImageData(colorAdjust.originalImageData);
        if (restoredImage) {
          syncFramebufferFromImageData(layer, restoredImage);
          state.updateLayer(layer.id, { imageData: restoredImage });
          state.setLayersNeedRecomposition(true);
        }
      }
    }

    colorAdjustLayerStructureBefore = null;
    colorAdjustOriginalColorCycleData = null;
    colorAdjustOriginalColorCycleSnapshot = null;
    set({ colorAdjust: createDefaultColorAdjustState() });
  },
  resetColorAdjustParams: () => {
    let didReset = false;
    set((state) => {
      if (!state.colorAdjust.active) {
        return state;
      }

      didReset = true;
      return {
        colorAdjust: {
          ...state.colorAdjust,
          params: { ...defaultColorAdjustParams },
        },
      };
    });

    if (didReset) {
      scheduleColorAdjustPreview(get);
    }
  },
});

export { cancelScheduledColorAdjustPreview };
