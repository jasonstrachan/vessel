import { debugWarn } from '@/utils/debug';
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
import {
  buildColorAdjustSessionTargets,
} from '@/stores/helpers/colorAdjustSession';
import type { LayerStructureSnapshot } from '@/history/deltas/layerStructureDelta';
import { applyColorAdjustments } from '@/utils/imageProcessing';
import { parseCssColor } from '@/utils/color/parseCssColor';
import { flushGradientApply, requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import { bindBrushToCanvas, refreshLayerCCSurface } from '@/hooks/brushEngine/colorCycleSurface';
import { ensureCanvasPixelSize } from '@/hooks/brushEngine/engineShared';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import { writeColorCycleRegion } from '@/stores/helpers/colorCycleSelection';
import { hashStops as hashColorCycleDefStops } from '@/utils/colorCycleGradientDefs';

type AppState = import('../useAppStore').AppState;

let colorAdjustPreviewHandle: number | null = null;
let colorAdjustLayerStructureBefore: LayerStructureSnapshot | null = null;
const colorAdjustOriginalImageDataByLayerId = new Map<string, ImageData>();
const colorAdjustOriginalColorCycleDataByLayerId = new Map<string, Layer['colorCycleData']>();
const colorAdjustOriginalColorCycleSnapshotByLayerId = new Map<string, ColorCycleRuntimeSnapshot>();

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
  phaseBuffer: Uint8Array | null;
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

const resetColorAdjustSessionCaches = (): void => {
  colorAdjustLayerStructureBefore = null;
  colorAdjustOriginalImageDataByLayerId.clear();
  colorAdjustOriginalColorCycleDataByLayerId.clear();
  colorAdjustOriginalColorCycleSnapshotByLayerId.clear();
};

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
    gradientIdBuffer: data.gradientIdBuffer ? data.gradientIdBuffer.slice(0) : data.gradientIdBuffer,
    gradientDefIdBuffer: data.gradientDefIdBuffer ? data.gradientDefIdBuffer.slice(0) : data.gradientDefIdBuffer,
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

const resolveSlotStopsFromColorCycleData = (
  data: NonNullable<Layer['colorCycleData']>,
  slot: number
): Array<{ position: number; color: string }> | null => {
  const paletteStops = data.slotPalettes?.find((entry) => entry.slot === slot)?.stops;
  if (paletteStops?.length) {
    return cloneGradientStops(paletteStops);
  }

  const defStops = data.gradientDefStore?.find((entry) => entry.slot === slot)?.stops;
  if (defStops?.length) {
    return cloneGradientStops(defStops);
  }

  const activeDef = data.gradientDefs?.find((entry) => entry.id === data.activeGradientId)
    ?? data.gradientDefs?.[0];
  const isPrimarySlot = slot === data.paintSlot || slot === activeDef?.currentSlot || slot === data.fgActiveSlot;
  if (isPrimarySlot && data.gradient?.length) {
    return cloneGradientStops(data.gradient);
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
      ? original.gradientDefStore.map((entry) => {
          const stops = adjustStops(entry.stops);
          return {
            ...entry,
            stops,
            hash: hashColorCycleDefStops(stops, entry.kind),
          };
        })
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

const rerenderColorCycleLayerSurface = (
  get: () => AppState,
  layerId: string
): void => {
  try {
    const state = get();
    const layer = state.layers.find((entry) => entry.id === layerId);
    if (!layer || layer.layerType !== 'color-cycle') {
      return;
    }

    const brush = state.getLayerColorCycleBrush(layerId) as {
      renderDirectToCanvas?: (canvas: HTMLCanvasElement, targetLayerId: string) => void;
      getCanvas?: () => HTMLCanvasElement | OffscreenCanvas | null;
    } | null;
    if (!brush?.renderDirectToCanvas) {
      return;
    }

    const layerCanvas = refreshLayerCCSurface(
      brush as Parameters<typeof refreshLayerCCSurface>[0],
      layerId
    );
    if (!layerCanvas) {
      return;
    }

    ensureCanvasPixelSize(layerCanvas);
    bindBrushToCanvas(brush as Parameters<typeof bindBrushToCanvas>[0], layerCanvas);
    flushGradientApply(layerId);
    brush.renderDirectToCanvas(layerCanvas, layerId);

    state.setCurrentCompositeBitmap?.(null);
    state.setLayersNeedRecomposition?.(true);
    state.markCompositeSegmentsDirtyByLayerIds?.([layerId]);
  } catch {
    // noop: preview can fall back to the next normal layer render
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
      phaseBuffer?: ArrayBuffer;
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
  const phaseBuffer = cloneUint8Array(snapshot.phaseBuffer);

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
  if (phaseBuffer && phaseBuffer.length !== width * height) {
    return null;
  }

  return {
    paintBuffer,
    gradientIdBuffer,
    gradientDefIdBuffer,
    speedBuffer,
    flowBuffer,
    phaseBuffer,
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
      phaseBuffer?: ArrayBuffer;
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
    phaseBuffer: snapshot.phaseBuffer?.slice().buffer,
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

  restoreColorCycleRuntimeSnapshot(state, layer, originalSnapshot);

  const selectionGradientIds = copyScalarRegion(
    originalSnapshot.gradientIdBuffer,
    originalSnapshot.width,
    originalSnapshot.height,
    selectionBounds
  );
  const selectionGradientDefIds = originalSnapshot.gradientDefIdBuffer
    ? new Uint16Array(
        copyScalarRegion(
          new Uint8Array(originalSnapshot.gradientDefIdBuffer.buffer),
          originalSnapshot.width * 2,
          originalSnapshot.height,
          {
            x: selectionBounds.x * 2,
            y: selectionBounds.y,
            width: selectionBounds.width * 2,
            height: selectionBounds.height,
          }
        ).buffer
      )
    : null;
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
  const originalDefStore = originalData.gradientDefStore ?? [];
  const nextDefStore = originalDefStore.map((entry) => ({
    ...entry,
    stops: cloneGradientStops(entry.stops),
  }));
  const defIdRemap = new Map<number, number>();
  let nextGradientDefId = Math.max(
    originalData.nextGradientDefId ?? 1,
    nextDefStore.reduce((max, entry) => Math.max(max, entry.id + 1), 1)
  );

  for (let index = 0; index < selectionGradientIds.length; index += 1) {
    if ((selectionPaint[index] ?? 0) === 0) {
      continue;
    }

    const sourceSlot = clampColorCycleSlot(selectionGradientIds[index] ?? 0);
    if (slotRemap.has(sourceSlot)) {
      continue;
    }

    const sourcePaletteStops = resolveSlotStopsFromColorCycleData(originalData, sourceSlot);
    if (!sourcePaletteStops?.length) {
      if (process.env.NODE_ENV !== 'production') {
        debugWarn('raw-console', '[colorAdjust] Missing CC slot palette for selected slot', {
          layerId: layer.id,
          sourceSlot,
        });
      }
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
      stops: applyColorAdjustmentsToGradient(sourcePaletteStops, params),
    });
  }

  if (selectionGradientDefIds && originalDefStore.length > 0) {
    for (let index = 0; index < selectionGradientDefIds.length; index += 1) {
      if ((selectionPaint[index] ?? 0) === 0) {
        continue;
      }

      const sourceDefId = selectionGradientDefIds[index] ?? 0;
      if (sourceDefId <= 0 || defIdRemap.has(sourceDefId)) {
        continue;
      }

      const sourceDef = originalDefStore.find((entry) => entry.id === sourceDefId);
      if (!sourceDef) {
        continue;
      }

      const sourceDefSlot = typeof sourceDef.slot === 'number'
        ? clampColorCycleSlot(sourceDef.slot)
        : undefined;
      let remappedSlot = typeof sourceDef.slot === 'number'
        ? slotRemap.get(sourceDefSlot!)
        : undefined;
      if (typeof sourceDefSlot === 'number' && remappedSlot === undefined) {
        const sourcePaletteStops = resolveSlotStopsFromColorCycleData(originalData, sourceDefSlot);
        if (sourcePaletteStops?.length) {
          const nextSlot = pickAvailableColorCycleSlot(usedSlots);
          if (nextSlot === null) {
            return false;
          }
          usedSlots.add(nextSlot);
          remappedSlot = nextSlot;
          slotRemap.set(sourceDefSlot, nextSlot);
          nextSlotPalettes.push({
            slot: nextSlot,
            stops: applyColorAdjustmentsToGradient(sourcePaletteStops, params),
          });
        }
      }

      const adjustedStops = applyColorAdjustmentsToGradient(sourceDef.stops, params);
      const adjustedDef = {
        ...sourceDef,
        id: nextGradientDefId,
        slot: remappedSlot ?? sourceDef.slot,
        stops: adjustedStops,
        hash: hashColorCycleDefStops(adjustedStops, sourceDef.kind),
      };
      nextDefStore.push(adjustedDef);
      defIdRemap.set(sourceDefId, nextGradientDefId);
      nextGradientDefId += 1;
    }
  }

  if (slotRemap.size === 0 && defIdRemap.size === 0) {
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

  const remappedGradientDefIds = selectionGradientDefIds ? selectionGradientDefIds.slice() : null;
  if (remappedGradientDefIds) {
    for (let index = 0; index < remappedGradientDefIds.length; index += 1) {
      if ((selectionPaint[index] ?? 0) === 0) {
        continue;
      }
      const sourceDefId = remappedGradientDefIds[index] ?? 0;
      const remappedDefId = defIdRemap.get(sourceDefId);
      if (remappedDefId !== undefined) {
        remappedGradientDefIds[index] = remappedDefId;
      }
    }
  }

  const previewColorCycleData = {
    ...baseColorCycleData,
    slotPalettes: nextSlotPalettes,
    gradientDefStore: nextDefStore,
    nextGradientDefId,
  };

  replaceColorCycleLayerData(set, get, layer.id, previewColorCycleData);
  const previewLayer = get().layers.find((entry) => entry.id === layer.id) ?? layer;

  const alphaData = buildSelectionAlphaData(
    selectionScope.selectionMask,
    selectionScope.selectionMaskBounds,
    selectionBounds
  );

  const wroteRegion = writeColorCycleRegion(
    state,
    previewLayer,
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
      sourceGradientDefIds: remappedGradientDefIds,
      skipMaterialize: true,
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
    gradientDefStore: nextDefStore,
    nextGradientDefId,
  });

  requestGradientApply(layer.id, 'color-adjust-preview-selection');
  refreshColorCycleGradientDefRuntime(get, layer.id);
  rerenderColorCycleLayerSurface(get, layer.id);
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
      debugWarn('raw-console', '[colorAdjust] Failed to sync framebuffer', error);
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
  targetLayerIds: [],
});

const applySessionTargetsToCaches = (
  sessionTargets: ReturnType<typeof buildColorAdjustSessionTargets<ColorCycleRuntimeSnapshot>>
): void => {
  colorAdjustOriginalImageDataByLayerId.clear();
  colorAdjustOriginalColorCycleDataByLayerId.clear();
  colorAdjustOriginalColorCycleSnapshotByLayerId.clear();

  sessionTargets.originalImageDataByLayerId.forEach((value, key) => {
    colorAdjustOriginalImageDataByLayerId.set(key, value);
  });
  sessionTargets.originalColorCycleDataByLayerId.forEach((value, key) => {
    colorAdjustOriginalColorCycleDataByLayerId.set(key, value);
  });
  sessionTargets.originalColorCycleSnapshotByLayerId.forEach((value, key) => {
    colorAdjustOriginalColorCycleSnapshotByLayerId.set(key, value as ColorCycleRuntimeSnapshot);
  });
};

const buildSessionTargets = (state: AppState) =>
  buildColorAdjustSessionTargets<ColorCycleRuntimeSnapshot>({
    state,
    cloneColorCycleData,
    resolveColorCycleGradient,
    snapshotLayerImageData,
    resolveSelectionBounds,
    captureColorCycleRuntimeSnapshot,
  });

const previewColorCycleLayerAdjustments = ({
  state,
  set,
  get,
  layer,
  params,
}: {
  state: AppState;
  set: Parameters<StateCreator<AppState, [], [], ColorAdjustSlice>>[0];
  get: () => AppState;
  layer: Layer;
  params: ColorAdjustParams;
}): void => {
  const originalColorCycleData = colorAdjustOriginalColorCycleDataByLayerId.get(layer.id);
  if (!originalColorCycleData || layer.layerType !== 'color-cycle') {
    return;
  }

  const originalRuntimeSnapshot =
    colorAdjustOriginalColorCycleSnapshotByLayerId.get(layer.id) ?? null;
  const colorCycleSelectionScope = resolveSelectionRasterScope({
    selectionStart: state.selectionStart,
    selectionEnd: state.selectionEnd,
    selectionMask: state.selectionMask,
    selectionMaskBounds: state.selectionMaskBounds,
  }, layer.imageData?.width ?? state.project?.width ?? 0, layer.imageData?.height ?? state.project?.height ?? 0);

  if (
    originalRuntimeSnapshot &&
    !originalColorCycleData.recolorSettings &&
    previewSelectedColorCycleRegion(
      state,
      set,
      get,
      layer,
      originalColorCycleData,
      originalRuntimeSnapshot,
      params,
      colorCycleSelectionScope
    )
  ) {
    return;
  }

  restoreColorCycleRuntimeSnapshot(state, layer, originalRuntimeSnapshot);
  const nextColorCycleData = hasColorAdjustments(params)
    ? buildAdjustedColorCycleData(originalColorCycleData, params)
    : cloneColorCycleData(originalColorCycleData);

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
    rerenderColorCycleLayerSurface(get, layer.id);
  }

  state.setLayersNeedRecomposition(true);
};

const previewRasterLayerAdjustments = ({
  state,
  layer,
  layerId,
  params,
}: {
  state: AppState;
  layer: Layer;
  layerId: string;
  params: ColorAdjustParams;
}): void => {
  const originalImageData = colorAdjustOriginalImageDataByLayerId.get(layer.id);
  if (!originalImageData || layer.layerType !== 'normal') {
    return;
  }

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
  const shouldAdjust = hasColorAdjustments(params);
  const working = getWorkingImage(layerId, originalImageData.width, originalImageData.height);

  if (!selectionBounds) {
    working.data.set(originalImageData.data);
    const adjusted = shouldAdjust
      ? applyColorAdjustments(working, params)
      : cloneLayerImageData(working) ?? working;
    state.updateLayer(layer.id, { imageData: adjusted });
    syncFramebufferFromImageData(layer, adjusted);
    state.setLayersNeedRecomposition(true);
    return;
  }

  working.data.set(originalImageData.data);

  const { width, height, x, y } = selectionBounds;
  const scratch = getScratchImage(layerId, width, height);
  const targetStride = scratch.width * 4;
  for (let row = 0; row < height; row += 1) {
    const srcStart = ((y + row) * originalImageData.width + x) * 4;
    const tgtStart = row * targetStride;
    scratch.data.set(
      originalImageData.data.subarray(srcStart, srcStart + width * 4),
      tgtStart
    );
  }

  const adjustedRegion = shouldAdjust
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
};

const restoreColorCycleLayerAdjustments = ({
  state,
  set,
  get,
  layer,
}: {
  state: AppState;
  set: Parameters<StateCreator<AppState, [], [], ColorAdjustSlice>>[0];
  get: () => AppState;
  layer: Layer;
}): void => {
  const originalColorCycleData = colorAdjustOriginalColorCycleDataByLayerId.get(layer.id) ?? null;
  if (layer.layerType !== 'color-cycle' || !originalColorCycleData) {
    return;
  }

  const restoredData = cloneColorCycleData(originalColorCycleData);
  if (restoredData) {
    replaceColorCycleLayerData(set, get, layer.id, restoredData);
    restoreColorCycleRuntimeSnapshot(
      state,
      layer,
      colorAdjustOriginalColorCycleSnapshotByLayerId.get(layer.id) ?? null
    );
  }
  if (restoredData?.mode === 'recolor' && restoredData.recolorSettings) {
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
  } else {
    requestGradientApply(layer.id, 'color-adjust-cancel');
    refreshColorCycleGradientDefRuntime(get, layer.id);
    rerenderColorCycleLayerSurface(get, layer.id);
  }
  state.setLayersNeedRecomposition(true);
};

const restoreRasterLayerAdjustments = ({
  state,
  layer,
}: {
  state: AppState;
  layer: Layer;
}): void => {
  const originalImageData = colorAdjustOriginalImageDataByLayerId.get(layer.id);
  if (layer.layerType !== 'normal' || !originalImageData) {
    return;
  }

  const restoredImage = cloneLayerImageData(originalImageData);
  if (!restoredImage) {
    return;
  }

  syncFramebufferFromImageData(layer, restoredImage);
  state.updateLayer(layer.id, { imageData: restoredImage });
  state.setLayersNeedRecomposition(true);
};

const commitRasterColorAdjustHistory = async ({
  state,
  refreshedState,
  targetLayerIds,
}: {
  state: AppState;
  refreshedState: AppState;
  targetLayerIds: string[];
}): Promise<void> => {
  const selectionSnapshot =
    state.selectionStart && state.selectionEnd
      ? selectionSnapshotFromValues(state.selectionStart, state.selectionEnd)
      : null;

  for (const targetLayerId of targetLayerIds) {
    const layer = refreshedState.layers.find((entry) => entry.id === targetLayerId);
    if (!layer || layer.layerType === 'color-cycle') {
      continue;
    }

    const originalImageData = colorAdjustOriginalImageDataByLayerId.get(layer.id);
    if (!originalImageData || layer.layerType !== 'normal') {
      continue;
    }

    const beforeImage = cloneLayerImageData(originalImageData);
    if (!beforeImage) {
      continue;
    }

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
        debugWarn('raw-console', '[history] Failed to record color adjust', error);
      }
    });
  }
};

const commitColorCycleColorAdjustHistory = ({
  set,
  refreshedState,
  targetLayerIds,
}: {
  set: Parameters<StateCreator<AppState, [], [], ColorAdjustSlice>>[0];
  refreshedState: AppState;
  targetLayerIds: string[];
}): void => {
  const colorCycleTargetIds = targetLayerIds.filter((targetLayerId) => {
    const layer = refreshedState.layers.find((entry) => entry.id === targetLayerId);
    return layer?.layerType === 'color-cycle';
  });

  if (colorCycleTargetIds.length === 0) {
    return;
  }

  const beforeSnapshot = colorAdjustLayerStructureBefore;
  const afterSnapshot = captureLayerStructureSnapshot(refreshedState, {
    actionType: 'color-adjust',
    description: 'Color adjust',
    activeLayerId: refreshedState.activeLayerId ?? colorCycleTargetIds[0],
    previousSnapshot: beforeSnapshot,
  });

  if (!beforeSnapshot) {
    return;
  }

  commitLayerStructureHistory({
    set,
    beforeSnapshot,
    afterSnapshot,
    label: 'Color adjust',
    metadata: {
      layerIds: colorCycleTargetIds,
      tool: 'color-adjust',
    },
  });
};

const refreshColorAdjustSessionState = (
  state: AppState,
  set: Parameters<StateCreator<AppState, [], [], ColorAdjustSlice>>[0]
): void => {
  const sessionTargets = buildSessionTargets(state);

  if (sessionTargets.eligibleLayerIds.length === 0 || !sessionTargets.firstLayerId) {
    resetColorAdjustSessionCaches();
    set({ colorAdjust: createDefaultColorAdjustState() });
    return;
  }

  applySessionTargetsToCaches(sessionTargets);

  if (sessionTargets.hasColorCycleTarget) {
    colorAdjustLayerStructureBefore = captureLayerStructureSnapshot(state, {
      actionType: 'color-adjust',
      description: 'Color adjust',
      activeLayerId: state.activeLayerId ?? sessionTargets.firstLayerId,
    });
  } else {
    colorAdjustLayerStructureBefore = null;
  }

  set({
    colorAdjust: {
      active: true,
      targetLayerId: sessionTargets.firstLayerId,
      targetLayerIds: sessionTargets.eligibleLayerIds,
      targetLayerType: sessionTargets.distinctLayerTypes.size === 1 ? sessionTargets.firstLayerType : null,
      originalImageData: sessionTargets.firstOriginalImageData,
      originalColorCycleGradient: sessionTargets.firstOriginalGradient,
      selectionBounds: sessionTargets.firstSelectionBounds,
      params: { ...defaultColorAdjustParams },
    },
  });
};

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
    resetColorAdjustSessionCaches();
    refreshColorAdjustSessionState(get(), set);
    if (!get().colorAdjust.active) {
      return;
    }
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
    const targetLayerIds = colorAdjust.targetLayerIds;

    if (!colorAdjust.active || targetLayerIds.length === 0) {
      return;
    }

    for (const targetLayerId of targetLayerIds) {
      const layer = state.layers.find((entry) => entry.id === targetLayerId);
      if (!layer) {
        continue;
      }

      if (layer.layerType === 'color-cycle') {
        previewColorCycleLayerAdjustments({
          state,
          set,
          get,
          layer,
          params: colorAdjust.params,
        });
        continue;
      }

      previewRasterLayerAdjustments({
        state,
        layer,
        layerId: targetLayerId,
        params: colorAdjust.params,
      });
    }
  },
  applyColorAdjust: async () => {
    const state = get();
    const { colorAdjust } = state;
    const targetLayerIds = colorAdjust.targetLayerIds;

    if (!colorAdjust.active || targetLayerIds.length === 0) {
      return;
    }

    cancelScheduledColorAdjustPreview();

    get().previewColorAdjust();
    const refreshedState = get();
    await commitRasterColorAdjustHistory({
      state,
      refreshedState,
      targetLayerIds,
    });
    commitColorCycleColorAdjustHistory({
      set,
      refreshedState,
      targetLayerIds,
    });
    refreshColorAdjustSessionState(get(), set);
  },
  cancelColorAdjust: () => {
    const state = get();
    const { colorAdjust } = state;
    const targetLayerIds = colorAdjust.targetLayerIds;

    if (!colorAdjust.active || targetLayerIds.length === 0) {
      set({ colorAdjust: createDefaultColorAdjustState() });
      resetColorAdjustSessionCaches();
      return;
    }

    cancelScheduledColorAdjustPreview();

    for (const targetLayerId of targetLayerIds) {
      const layer = state.layers.find((entry) => entry.id === targetLayerId);
      if (!layer) {
        continue;
      }

      if (layer.layerType === 'color-cycle') {
        restoreColorCycleLayerAdjustments({
          state,
          set,
          get,
          layer,
        });
        continue;
      }

      restoreRasterLayerAdjustments({ state, layer });
    }

    resetColorAdjustSessionCaches();
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
