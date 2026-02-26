import type { StateCreator } from 'zustand';
import type {
  Layer,
  LayerGroup,
  LayerAlignmentSettings,
  Project,
  SequentialStrokeEvent,
} from '@/types';
import { cloneLayerAlignment, dedupeLayerIds, normalizeLayers } from '@/utils/layoutDefaults';
import { computeLayerPercentOffset } from '@/utils/layerMetrics';
import { clamp } from '@/utils/num';
import { __DEV__, logError, recordBreadcrumb } from '@/utils/debug';
import { syncCCRuntimes } from '@/stores/ccRuntime';
import { requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import {
  rebuildGradientSlotUsageAndGC,
  buildDefaultReservedSlots,
} from '@/utils/colorCycleSlotGC';
import {
  getColorCycleBrushManager,
  type ColorCycleBrushImplementation,
  type ColorCycleBrushManager,
} from '@/stores/colorCycleBrushManager';
import { compositeBitmapManager } from '@/lib/performance/CompositeBitmapManager';
import {
  clearSequentialLayerRendererAll,
  clearSequentialLayerRendererLayer,
  getSequentialLayerRenderCanvas,
  getSequentialLayerRendererStats,
} from '@/lib/sequential/SequentialLayerRenderer';
import { recordSequentialAppendPerf } from '@/lib/sequential/SequentialPerfCounters';
import type {
  CommitLayerStructureHistoryOptions,
  LayerHistorySnapshotOptions,
} from '@/stores/helpers/layerStructureHistory';
import type { LayerStructureSnapshot } from '@/history/deltas/layerStructureDelta';
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

type SequentialCompositeSegment = {
  kind: 'sequential';
  id: string;
  layerId: string;
  blendMode: GlobalCompositeOperation;
  opacity: number;
};

export type CompositeSegment =
  | StaticCompositeSegment
  | ColorCycleCompositeSegment
  | SequentialCompositeSegment;

let cachedSequentialAppendLayerId: string | null = null;
let cachedSequentialAppendLayerIndex = -1;

const resolveSequentialAppendLayerIndex = (
  layers: Layer[],
  layerId: string
): number => {
  if (cachedSequentialAppendLayerId === layerId && cachedSequentialAppendLayerIndex >= 0) {
    const cachedLayer = layers[cachedSequentialAppendLayerIndex];
    if (cachedLayer?.id === layerId && cachedLayer.layerType === 'sequential') {
      return cachedSequentialAppendLayerIndex;
    }
  }

  const scannedIndex = layers.findIndex(
    (layer) => layer.id === layerId && layer.layerType === 'sequential'
  );
  cachedSequentialAppendLayerId = scannedIndex >= 0 ? layerId : null;
  cachedSequentialAppendLayerIndex = scannedIndex;
  return scannedIndex;
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

type CompositeMode = 'alpha' | 'replace';

const alphaCompositeImageDataRegion = (
  base: ImageData | null,
  region: ImageData,
  offsetX: number,
  offsetY: number,
  fullWidth: number,
  fullHeight: number,
  mode: CompositeMode = 'alpha'
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

      const dstIndex = (dstRow * targetWidth + dstCol) * 4;

      if (mode === 'replace') {
        outData[dstIndex] = src[srcIndex];
        outData[dstIndex + 1] = src[srcIndex + 1];
        outData[dstIndex + 2] = src[srcIndex + 2];
        outData[dstIndex + 3] = srcAlpha8;
        continue;
      }

      if (srcAlpha8 === 0) {
        continue;
      }

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
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (ctx && 'drawImage' in ctx && 'putImageData' in ctx) {
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

const areGradientStopsEqual = (
  left?: Array<{ position: number; color: string }> | null,
  right?: Array<{ position: number; color: string }> | null
): boolean => {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftStop = left[index];
    const rightStop = right[index];
    if (leftStop.position !== rightStop.position || leftStop.color !== rightStop.color) {
      return false;
    }
  }
  return true;
};

const applyColorCycleEraseMask = (
  layer: Layer,
  targetCanvas: HTMLCanvasElement | OffscreenCanvas
): void => {
  const eraseMask = layer.colorCycleData?.eraseMask;
  if (!eraseMask) {
    return;
  }
  const canvasCtx = targetCanvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!canvasCtx) {
    return;
  }

  canvasCtx.save();
  canvasCtx.globalCompositeOperation = 'destination-out';
  canvasCtx.globalAlpha = 1;
  try {
    canvasCtx.drawImage(eraseMask as CanvasImageSource, 0, 0);
  } catch {
    // ignore transient erase-mask draw failures
  } finally {
    canvasCtx.restore();
  }
};

const omitUndefinedEntries = <T extends Record<string, unknown>>(value: T): Partial<T> => {
  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
  return Object.fromEntries(entries) as Partial<T>;
};

type GradientStop = { position: number; color: string };
type ColorCycleGradient = { id: string; slot: number; stops: GradientStop[] };
type ColorCycleGradientDef = { id: string; name?: string; currentSlot: number };
type ColorCycleSlotPalette = { slot: number; stops: GradientStop[] };

const EDITOR_SLOT = 255;

const DEFAULT_CC_GRADIENT: GradientStop[] = [
  { position: 0.0, color: '#ff0000' },
  { position: 0.17, color: '#ff7f00' },
  { position: 0.33, color: '#ffff00' },
  { position: 0.5, color: '#00ff00' },
  { position: 0.67, color: '#0000ff' },
  { position: 0.83, color: '#4b0082' },
  { position: 1.0, color: '#9400d3' }
];

const clampSlot = (slot: number): number => Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(slot)));

const normalizePaintSlot = (slot: number): number => {
  const clamped = clampSlot(slot);
  return clamped === EDITOR_SLOT ? 0 : clamped;
};

const collectUsedSlots = (
  defs: ColorCycleGradientDef[],
  palettes: ColorCycleSlotPalette[]
): Set<number> => {
  const used = new Set<number>();
  palettes.forEach((entry) => used.add(clampSlot(entry.slot)));
  defs.forEach((entry) => used.add(clampSlot(entry.currentSlot)));
  used.add(EDITOR_SLOT);
  used.add(TEMP_SAMPLE_SLOT);
  return used;
};

const pickAvailableSlot = (used: Set<number>): number => {
  for (let slot = 0; slot <= FLOW_SLOT_MASK; slot += 1) {
    if (slot === EDITOR_SLOT) {
      continue;
    }
    if (!used.has(slot)) {
      return slot;
    }
  }
  return 0;
};

const applyLegacySlotRemap = ({
  defs,
  palettes,
  paintSlot,
  legacyRemap,
  fallbackStops,
}: {
  defs: ColorCycleGradientDef[];
  palettes: ColorCycleSlotPalette[];
  paintSlot: number | undefined;
  legacyRemap?: { from: number; to: number };
  fallbackStops: GradientStop[];
}): {
  defs: ColorCycleGradientDef[];
  palettes: ColorCycleSlotPalette[];
  paintSlot: number;
  legacyRemap?: { from: number; to: number };
} => {
  const needsRemap =
    paintSlot === EDITOR_SLOT ||
    defs.some((entry) => entry.currentSlot === EDITOR_SLOT) ||
    palettes.some((entry) => entry.slot === EDITOR_SLOT);
  if (!needsRemap && !legacyRemap) {
    const safePaintSlot = Number.isFinite(paintSlot) ? normalizePaintSlot(paintSlot as number) : 0;
    const hasPaintPalette = palettes.some((entry) => entry.slot === safePaintSlot);
    const ensuredPalettes = hasPaintPalette
      ? palettes
      : [
          ...palettes,
          { slot: safePaintSlot, stops: cloneGradientStops(fallbackStops) ?? fallbackStops },
        ];
    return { defs, palettes: ensuredPalettes, paintSlot: safePaintSlot, legacyRemap };
  }

  const used = collectUsedSlots(defs, palettes);
  const targetSlot = legacyRemap?.to ?? pickAvailableSlot(used);
  const remap = legacyRemap ?? { from: EDITOR_SLOT, to: targetSlot };
  const legacyPalette = palettes.find((entry) => entry.slot === EDITOR_SLOT);
  const remapStops = legacyPalette?.stops?.length ? legacyPalette.stops : fallbackStops;

  const nextPalettes = [
    ...palettes.filter((entry) => entry.slot !== EDITOR_SLOT && entry.slot !== remap.to),
    { slot: remap.to, stops: cloneGradientStops(remapStops) ?? remapStops },
  ];
  const nextDefs = defs.map((entry) =>
    entry.currentSlot === EDITOR_SLOT ? { ...entry, currentSlot: remap.to } : entry
  );
  const nextPaintSlot =
    paintSlot === EDITOR_SLOT ? remap.to : normalizePaintSlot(paintSlot ?? remap.to);

  const hasPaintPalette = nextPalettes.some((entry) => entry.slot === nextPaintSlot);
  const ensuredPalettes = hasPaintPalette
    ? nextPalettes
    : [
        ...nextPalettes,
        { slot: nextPaintSlot, stops: cloneGradientStops(fallbackStops) ?? fallbackStops },
      ];

  return {
    defs: nextDefs,
    palettes: ensuredPalettes,
    paintSlot: nextPaintSlot,
    legacyRemap: remap,
  };
};

const cloneColorCycleGradients = (
  gradients?: ColorCycleGradient[]
): ColorCycleGradient[] | undefined => {
  if (!gradients) {
    return undefined;
  }
  return gradients.map((entry, index) => ({
    id: entry.id ?? `g${index}`,
    slot: Number.isFinite(entry.slot) ? entry.slot : index,
    stops: cloneGradientStops(entry.stops) ?? entry.stops,
  }));
};

const cloneGradientDefs = (
  defs?: ColorCycleGradientDef[]
): ColorCycleGradientDef[] | undefined => {
  if (!defs) {
    return undefined;
  }
  return defs.map((entry, index) => ({
    id: entry.id ?? `g${index}`,
    name: entry.name,
    currentSlot: Number.isFinite(entry.currentSlot) ? entry.currentSlot : index,
  }));
};

const cloneSlotPalettes = (
  palettes?: ColorCycleSlotPalette[]
): ColorCycleSlotPalette[] | undefined => {
  if (!palettes) {
    return undefined;
  }
  return palettes.map((entry) => ({
    slot: Number.isFinite(entry.slot) ? entry.slot : 0,
    stops: cloneGradientStops(entry.stops) ?? entry.stops,
  }));
};

const resolveLegacyGradientStops = (
  data?: Layer['colorCycleData']
): GradientStop[] | undefined => {
  const legacyStops = (data as { gradient?: GradientStop[] } | undefined)?.gradient;
  if (Array.isArray(legacyStops) && legacyStops.length > 0) {
    return legacyStops.map((stop) => ({ ...stop }));
  }
  return undefined;
};

const ensureColorCycleGradients = (
  data: Layer['colorCycleData'] | undefined,
  fallbackStops: GradientStop[]
): {
  gradientDefs: ColorCycleGradientDef[];
  slotPalettes: ColorCycleSlotPalette[];
  activeGradientId: string;
  paintSlot: number;
  legacyRemap?: { from: number; to: number };
} => {
  const existingDefs = cloneGradientDefs(data?.gradientDefs);
  const existingPalettes = cloneSlotPalettes(data?.slotPalettes);

  if (existingDefs && existingDefs.length > 0 && existingPalettes && existingPalettes.length > 0) {
    const existingActiveId = data?.activeGradientId;
    const hasActive = existingActiveId
      ? existingDefs.some((entry) => entry.id === existingActiveId)
      : false;
    const activeGradientId = hasActive ? (existingActiveId as string) : existingDefs[0].id;
    const normalizedDefs = existingDefs.map((entry) => ({
      ...entry,
      currentSlot: clampSlot(entry.currentSlot),
    }));
    const normalizedPalettes = existingPalettes.map((entry) => ({
      ...entry,
      slot: clampSlot(entry.slot),
    }));
    const activeDef = normalizedDefs.find((entry) => entry.id === activeGradientId) ?? normalizedDefs[0];
    const remapResult = applyLegacySlotRemap({
      defs: normalizedDefs,
      palettes: normalizedPalettes,
      paintSlot: data?.paintSlot ?? activeDef?.currentSlot ?? 0,
      legacyRemap: data?.legacyRemap,
      fallbackStops,
    });
    return {
      gradientDefs: remapResult.defs,
      slotPalettes: remapResult.palettes,
      activeGradientId,
      paintSlot: remapResult.paintSlot,
      legacyRemap: remapResult.legacyRemap,
    };
  }

  const legacyGradients = cloneColorCycleGradients(data?.gradients);
  if (legacyGradients && legacyGradients.length > 0) {
    const gradientDefs = legacyGradients.map((entry) => ({
      id: entry.id,
      currentSlot: entry.slot,
    }));
    const slotPalettes = legacyGradients.map((entry) => ({
      slot: entry.slot,
      stops: cloneGradientStops(entry.stops) ?? entry.stops,
    }));
    const existingActiveId = data?.activeGradientId;
    const hasActive = existingActiveId
      ? gradientDefs.some((entry) => entry.id === existingActiveId)
      : false;
    const activeGradientId = hasActive ? (existingActiveId as string) : gradientDefs[0].id;
    const normalizedDefs = gradientDefs.map((entry) => ({
      ...entry,
      currentSlot: clampSlot(entry.currentSlot),
    }));
    const normalizedPalettes = slotPalettes.map((entry) => ({
      ...entry,
      slot: clampSlot(entry.slot),
    }));
    const activeDef = normalizedDefs.find((entry) => entry.id === activeGradientId) ?? normalizedDefs[0];
    const remapResult = applyLegacySlotRemap({
      defs: normalizedDefs,
      palettes: normalizedPalettes,
      paintSlot: data?.paintSlot ?? activeDef?.currentSlot ?? 0,
      legacyRemap: data?.legacyRemap,
      fallbackStops,
    });
    return {
      gradientDefs: remapResult.defs,
      slotPalettes: remapResult.palettes,
      activeGradientId,
      paintSlot: remapResult.paintSlot,
      legacyRemap: remapResult.legacyRemap,
    };
  }

  if (existingDefs && existingDefs.length > 0) {
    const legacyStops = resolveLegacyGradientStops(data);
    const stops = legacyStops && legacyStops.length > 0 ? legacyStops : fallbackStops;
    const slotPalettes = existingDefs.map((entry, index) => ({
      slot: Number.isFinite(entry.currentSlot) ? entry.currentSlot : index,
      stops: cloneGradientStops(stops) ?? stops,
    }));
    const existingActiveId = data?.activeGradientId;
    const hasActive = existingActiveId
      ? existingDefs.some((entry) => entry.id === existingActiveId)
      : false;
    const activeGradientId = hasActive ? (existingActiveId as string) : existingDefs[0].id;
    const normalizedDefs = existingDefs.map((entry) => ({
      ...entry,
      currentSlot: clampSlot(entry.currentSlot),
    }));
    const normalizedPalettes = slotPalettes.map((entry) => ({
      ...entry,
      slot: clampSlot(entry.slot),
    }));
    const activeDef = normalizedDefs.find((entry) => entry.id === activeGradientId) ?? normalizedDefs[0];
    const remapResult = applyLegacySlotRemap({
      defs: normalizedDefs,
      palettes: normalizedPalettes,
      paintSlot: data?.paintSlot ?? activeDef?.currentSlot ?? 0,
      legacyRemap: data?.legacyRemap,
      fallbackStops,
    });
    return {
      gradientDefs: remapResult.defs,
      slotPalettes: remapResult.palettes,
      activeGradientId,
      paintSlot: remapResult.paintSlot,
      legacyRemap: remapResult.legacyRemap,
    };
  }

  if (existingPalettes && existingPalettes.length > 0) {
    const gradientDefs = existingPalettes.map((entry, index) => ({
      id: `g${index}`,
      currentSlot: entry.slot,
    }));
    const existingActiveId = data?.activeGradientId;
    const hasActive = existingActiveId
      ? gradientDefs.some((entry) => entry.id === existingActiveId)
      : false;
    const activeGradientId = hasActive ? (existingActiveId as string) : gradientDefs[0].id;
    const normalizedDefs = gradientDefs.map((entry) => ({
      ...entry,
      currentSlot: clampSlot(entry.currentSlot),
    }));
    const normalizedPalettes = existingPalettes.map((entry) => ({
      ...entry,
      slot: clampSlot(entry.slot),
    }));
    const activeDef = normalizedDefs.find((entry) => entry.id === activeGradientId) ?? normalizedDefs[0];
    const remapResult = applyLegacySlotRemap({
      defs: normalizedDefs,
      palettes: normalizedPalettes,
      paintSlot: data?.paintSlot ?? activeDef?.currentSlot ?? 0,
      legacyRemap: data?.legacyRemap,
      fallbackStops,
    });
    return {
      gradientDefs: remapResult.defs,
      slotPalettes: remapResult.palettes,
      activeGradientId,
      paintSlot: remapResult.paintSlot,
      legacyRemap: remapResult.legacyRemap,
    };
  }

  const legacyStops = resolveLegacyGradientStops(data);
  const stops = legacyStops && legacyStops.length > 0 ? legacyStops : fallbackStops;
  const gradientDefs = [
    {
      id: 'g0',
      currentSlot: 0,
    },
  ];
  const slotPalettes = [
    {
      slot: 0,
      stops: cloneGradientStops(stops) ?? stops,
    },
  ];
  const remapResult = applyLegacySlotRemap({
    defs: gradientDefs,
    palettes: slotPalettes,
    paintSlot: data?.paintSlot ?? 0,
    legacyRemap: data?.legacyRemap,
    fallbackStops: stops,
  });
  return {
    gradientDefs: remapResult.defs,
    slotPalettes: remapResult.palettes,
    activeGradientId: 'g0',
    paintSlot: remapResult.paintSlot,
    legacyRemap: remapResult.legacyRemap,
  };
};

const resolveActiveGradientDef = (
  data: Layer['colorCycleData'] | undefined
): ColorCycleGradientDef | undefined => {
  if (!data?.gradientDefs || data.gradientDefs.length === 0) {
    return undefined;
  }
  if (data.activeGradientId) {
    const match = data.gradientDefs.find((entry) => entry.id === data.activeGradientId);
    if (match) {
      return match;
    }
  }
  return data.gradientDefs[0];
};

const resolveActiveGradientStops = (
  data: Layer['colorCycleData'] | undefined
): GradientStop[] | undefined => {
  const activeDef = resolveActiveGradientDef(data);
  if (activeDef && data?.slotPalettes?.length) {
    const slotPalette = data.slotPalettes.find((entry) => entry.slot === activeDef.currentSlot);
    if (slotPalette?.stops && slotPalette.stops.length > 0) {
      return slotPalette.stops;
    }
  }
  const legacy = resolveLegacyGradientStops(data);
  if (legacy && legacy.length > 0) {
    return legacy;
  }
  return data?.recolorSettings?.gradient;
};

const ensureGradientIdBuffer = ({
  existingBuffer,
  width,
  height,
  previousWidth,
  previousHeight,
  fillSlot,
}: {
  existingBuffer?: ArrayBuffer;
  width: number;
  height: number;
  previousWidth?: number;
  previousHeight?: number;
  fillSlot: number;
}): ArrayBuffer => {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const targetSize = safeWidth * safeHeight;

  if (existingBuffer && existingBuffer.byteLength === targetSize) {
    return existingBuffer;
  }

  const buffer = new ArrayBuffer(targetSize);
  const view = new Uint8Array(buffer);
  const clampedSlot = normalizePaintSlot(fillSlot);
  view.fill(clampedSlot);

  if (
    existingBuffer &&
    previousWidth &&
    previousHeight &&
    existingBuffer.byteLength === previousWidth * previousHeight
  ) {
    const previousView = new Uint8Array(existingBuffer);
    const copyWidth = Math.min(previousWidth, safeWidth);
    const copyHeight = Math.min(previousHeight, safeHeight);
    for (let row = 0; row < copyHeight; row += 1) {
      const srcOffset = row * previousWidth;
      const destOffset = row * safeWidth;
      view.set(previousView.subarray(srcOffset, srcOffset + copyWidth), destOffset);
    }
  }

  return buffer;
};

const ensureGradientDefIdBuffer = ({
  existingBuffer,
  width,
  height,
  previousWidth,
  previousHeight,
}: {
  existingBuffer?: ArrayBuffer;
  width: number;
  height: number;
  previousWidth?: number;
  previousHeight?: number;
}): ArrayBuffer => {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const targetSize = safeWidth * safeHeight;
  const targetBytes = targetSize * 2;

  if (existingBuffer && existingBuffer.byteLength === targetBytes) {
    return existingBuffer;
  }

  const buffer = new ArrayBuffer(targetBytes);
  const view = new Uint16Array(buffer);
  view.fill(0);

  if (
    existingBuffer &&
    previousWidth &&
    previousHeight &&
    existingBuffer.byteLength === previousWidth * previousHeight * 2
  ) {
    const previousView = new Uint16Array(existingBuffer);
    const copyWidth = Math.min(previousWidth, safeWidth);
    const copyHeight = Math.min(previousHeight, safeHeight);
    for (let row = 0; row < copyHeight; row += 1) {
      const srcOffset = row * previousWidth;
      const destOffset = row * safeWidth;
      view.set(previousView.subarray(srcOffset, srcOffset + copyWidth), destOffset);
    }
  }

  return buffer;
};

const hashStopsForDef = (kind: 'linear' | 'concentric', stops: GradientStop[]): string =>
  `${kind}:${stops.map((stop) => `${stop.position}:${stop.color}`).join('|')}`;

const migrateGradientIdBuffer = ({
  buffer,
  legacyRemap,
  usedSlots,
}: {
  buffer: ArrayBuffer;
  legacyRemap?: { from: number; to: number };
  usedSlots: Set<number>;
}): { buffer: ArrayBuffer; legacyRemap?: { from: number; to: number } } => {
  const view = new Uint8Array(buffer);
  let hasLegacy = false;
  for (let i = 0; i < view.length; i += 1) {
    const raw = view[i] & FLOW_SLOT_MASK;
    if (raw === EDITOR_SLOT) {
      hasLegacy = true;
      break;
    }
  }

  let remap = legacyRemap;
  if (hasLegacy && !remap) {
    const target = pickAvailableSlot(usedSlots);
    remap = { from: EDITOR_SLOT, to: target };
  }

  if (!hasLegacy && !remap) {
    for (let i = 0; i < view.length; i += 1) {
      view[i] = view[i] & FLOW_SLOT_MASK;
    }
    return { buffer, legacyRemap };
  }

  const remapSlot = remap?.to ?? 0;
  for (let i = 0; i < view.length; i += 1) {
    let raw = view[i] & FLOW_SLOT_MASK;
    if (raw === EDITOR_SLOT) {
      raw = remapSlot;
    }
    view[i] = raw;
  }

  return { buffer, legacyRemap: remap };
};

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

  const { gradientDefs, slotPalettes, activeGradientId, paintSlot, legacyRemap } = ensureColorCycleGradients(
    data,
    DEFAULT_CC_GRADIENT
  );

  return {
    ...data,
    gradient: cloneGradientStops(data.gradient) ?? data.gradient,
    gradientDefs,
    slotPalettes,
    activeGradientId,
    paintSlot,
    legacyRemap,
    fgActiveSlot: data.fgActiveSlot,
    fgDerivedKey: data.fgDerivedKey,
    fgDerivedGradients: (data.fgDerivedGradients ?? data.derivedGradients)
      ? (data.fgDerivedGradients ?? data.derivedGradients)?.map((entry) => ({
          key: entry.key,
          slot: entry.slot,
          spec: { ...entry.spec },
        }))
      : undefined,
    derivedGradients: (data.fgDerivedGradients ?? data.derivedGradients)
      ? (data.fgDerivedGradients ?? data.derivedGradients)?.map((entry) => ({
          key: entry.key,
          slot: entry.slot,
          spec: { ...entry.spec },
        }))
      : undefined,
    gradientIdBuffer: data.gradientIdBuffer ? data.gradientIdBuffer.slice(0) : undefined,
    gradientDefIdBuffer: data.gradientDefIdBuffer ? data.gradientDefIdBuffer.slice(0) : undefined,
    gradientDefStore: data.gradientDefStore
      ? data.gradientDefStore.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          stops: cloneGradientStops(entry.stops) ?? entry.stops,
          hash: entry.hash,
          source: entry.source,
          createdAtMs: entry.createdAtMs,
          slot: entry.slot,
          speedCps: entry.speedCps,
        }))
      : undefined,
    nextGradientDefId: data.nextGradientDefId,
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

const normalizeLayerGroupName = (name: string | undefined, fallbackIndex: number): string => {
  const trimmed = name?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : `Group ${fallbackIndex + 1}`;
};

const sanitizeLayerGroups = (layers: Layer[], layerGroups: LayerGroup[]): LayerGroup[] => {
  const usedGroupIds = new Set(
    layers
      .map((layer) => layer.groupId)
      .filter((groupId): groupId is string => typeof groupId === 'string' && groupId.length > 0)
  );
  const deduped = new Set<string>();
  const sanitized: LayerGroup[] = [];

  layerGroups.forEach((group, index) => {
    if (!group?.id || !usedGroupIds.has(group.id) || deduped.has(group.id)) {
      return;
    }
    deduped.add(group.id);
    sanitized.push({
      id: group.id,
      name: normalizeLayerGroupName(group.name, index),
    });
  });

  return sanitized;
};

const sanitizeHiddenLayerGroupIds = (hiddenGroupIds: string[], layerGroups: LayerGroup[]): string[] => {
  if (hiddenGroupIds.length === 0) {
    return hiddenGroupIds;
  }
  const validGroupIds = new Set(layerGroups.map((group) => group.id));
  return hiddenGroupIds.filter((groupId) => validGroupIds.has(groupId));
};

const generateLayerGroupName = (existingGroups: LayerGroup[]): string => {
  const usedNames = new Set(existingGroups.map((group) => group.name));
  let suffix = existingGroups.length + 1;
  while (suffix < 1000) {
    const candidate = `Group ${suffix}`;
    if (!usedNames.has(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
  return `Group ${Date.now()}`;
};

export type UpdateLayerOptions = {
  skipColorCycleSync?: boolean;
};

export interface LayersSlice {
  layers: Layer[];
  layerGroups: LayerGroup[];
  hiddenLayerGroupIds: string[];
  layersNeedRecomposition: boolean;
  staticCompositeVersion: number;
  compositeSegmentsVersion: number;
  compositeSegments: CompositeSegment[];
  currentOffscreenCanvas: HTMLCanvasElement | null;
  currentCompositeBitmap: ImageBitmap | null;
  activeLayerId: string | null;
  selectedLayerIds: string[];
  referenceLayerId: string | null;
  currentLayer: number;
  setLayersNeedRecomposition: (needed: boolean) => void;
  setCurrentOffscreenCanvas: (canvas: HTMLCanvasElement | null) => void;
  setCurrentCompositeBitmap: (bitmap: ImageBitmap | null) => void;
  setLayers: (layers: Layer[]) => void;
  addLayer: (layer: Omit<Layer, 'id' | 'order'>) => string;
  duplicateLayer: (layerId: string) => string | null;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<Layer>, options?: UpdateLayerOptions) => void;
  appendSequentialLayerEvent: (
    layerId: string,
    event: SequentialStrokeEvent,
    metadata: { frameCount: number; fps: number; durationMs: number }
  ) => void;
  appendSequentialLayerEvents: (
    layerId: string,
    events: SequentialStrokeEvent[],
    metadata: { frameCount: number; fps: number; durationMs: number }
  ) => void;
  setLayersVisibility: (layerIds: string[], visible: boolean) => void;
  toggleLayersVisibility: (layerIds: string[]) => void;
  createLayerGroupFromSelection: (layerIds: string[]) => string | null;
  removeLayerGroup: (groupId: string) => void;
  renameLayerGroup: (groupId: string, name: string) => void;
  setLayerGroupVisibility: (groupId: string, visible: boolean) => void;
  setSelectedLayerIds: (layerIds: string[]) => void;
  mergeLayers: (layerIds: string[]) => string | null;
  setActiveLayer: (id: string, opts?: { preserveSelection?: boolean }) => void;
  setReferenceLayer: (id: string | null) => void;
  reorderLayers: (sourceIndex: number, destinationIndex: number) => void;
  reorderLayerBlock: (layerIds: string[], destinationIndex: number) => void;
  updateLayerAlignment: (layerId: string, alignment: LayerAlignmentSettings) => void;
  scheduleColorCycleSlotRebuild: (reason: string) => void;
  runColorCycleSlotRebuild: (reason: string) => void;
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
  ) => LayerStructureSnapshot;
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

    let slotRebuildTimer: ReturnType<typeof setTimeout> | null = null;
    const SLOT_REBUILD_DEBOUNCE_MS = 250;

    const runSlotRebuild = (reason: string) => {
      const state = get();
      const result = rebuildGradientSlotUsageAndGC({
        layers: state.layers,
        scope: 'project',
        reservedSlots: buildDefaultReservedSlots(),
      });
      if (!result) {
        return;
      }
      if (result.missingDefLayers && result.missingDefLayers.length > 0) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[CC] Slot GC aborted due to missing defs', {
            reason,
            missingDefLayers: result.missingDefLayers,
          });
        }
        return;
      }
      if (result.updates.length === 0) {
        return;
      }
      const updateMap = new Map(result.updates.map((entry) => [entry.layerId, entry.colorCycleData]));
      set((current) => {
        const nextLayers = current.layers.map((layer) => {
          const nextData = updateMap.get(layer.id);
          if (!nextData) {
            return layer;
          }
          return { ...layer, colorCycleData: nextData };
        });
        const syncedLayers = syncPercentOffsetsFromPixels(nextLayers, current.project ?? null);
        return { layers: syncedLayers };
      });
      try {
        const refreshed = get();
        const updatedLayers = refreshed.layers.filter((layer) => updateMap.has(layer.id));
        syncCCRuntimes(updatedLayers, 'slot-gc');
        updatedLayers.forEach((layer) => {
          if (layer.layerType === 'color-cycle') {
            requestGradientApply(layer.id, 'slot-gc');
          }
        });
      } catch (error) {
        logError('[slot-gc] Failed to sync CC runtimes after rebuild', error);
      }
      if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
        console.info('[CC] Slot GC rebuild summary', { reason, ...result.stats });
      }
      return result;
    };

    const scheduleSlotRebuild = (reason: string) => {
      if (typeof setTimeout === 'undefined') {
        return;
      }
      if (slotRebuildTimer) {
        clearTimeout(slotRebuildTimer);
      }
      slotRebuildTimer = setTimeout(() => {
        slotRebuildTimer = null;
        runSlotRebuild(reason);
      }, SLOT_REBUILD_DEBOUNCE_MS);
    };

    const groupVisibilitySnapshotByGroupId = new Map<string, Map<string, boolean>>();
    const pruneGroupVisibilitySnapshots = (validGroupIds: Set<string>) => {
      groupVisibilitySnapshotByGroupId.forEach((_, existingGroupId) => {
        if (!validGroupIds.has(existingGroupId)) {
          groupVisibilitySnapshotByGroupId.delete(existingGroupId);
        }
      });
    };

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
        if (
          !layer.visible ||
          layer.layerType === 'color-cycle' ||
          layer.layerType === 'sequential'
        ) {
          continue;
        }
        let source: CanvasImageSource | null = null;

        if (hasValidFramebuffer(layer.framebuffer)) {
          source = layer.framebuffer as CanvasImageSource;
        } else if (layer.imageData) {
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
          source = layerCanvas as CanvasImageSource;
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
    };

    const drawSequentialLayers = (
      ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      sortedLayers: Layer[],
      project: Project,
      frameIndex: number
    ): boolean => {
      let drewLayer = false;

      for (const layer of sortedLayers) {
        if (
          !layer.visible ||
          layer.layerType !== 'sequential' ||
          !layer.sequentialData
        ) {
          continue;
        }

        const source = getSequentialLayerRenderCanvas({
          layer,
          width: project.width,
          height: project.height,
          frameIndex,
        });
        if (!source) {
          continue;
        }

        try {
          ctx.globalCompositeOperation = layer.blendMode;
          ctx.globalAlpha = layer.opacity;
          ctx.drawImage(source as CanvasImageSource, 0, 0);
          drewLayer = true;
        } catch {
          // ignore transient draw failures
        }
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      return drewLayer;
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

        applyColorCycleEraseMask(layer, canvas);

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
    let compositeRenderToken = 0;

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
      layers: [],
      layerGroups: [],
      hiddenLayerGroupIds: [],
      layersNeedRecomposition: false,
      staticCompositeVersion: 0,
      compositeSegmentsVersion: 0,
      compositeSegments: [],
      currentOffscreenCanvas: null,
      currentCompositeBitmap: null,
      setCurrentOffscreenCanvas: (canvas) => set({ currentOffscreenCanvas: canvas }),
      setCurrentCompositeBitmap: (bitmap) => {
        const previous = get().currentCompositeBitmap;
        set({ currentCompositeBitmap: bitmap ?? null });
        if (previous && previous !== bitmap) {
          scheduleCompositeBitmapRelease(previous);
        }
      },
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
        clearSequentialLayerRendererAll();
        set((state) => {
          const normalized = dedupeLayerIds(
            normalizeLayers(
              incomingLayers.map((layer, index) => ({
                ...layer,
                order: index,
                alignment: cloneLayerAlignment(layer.alignment),
              })),
            ),
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
          const sanitizedGroups = sanitizeLayerGroups(hydratedLayers, state.layerGroups);
          const validGroupIds = new Set(sanitizedGroups.map((group) => group.id));
          const groupedLayers = hydratedLayers.map((layer) => {
            if (!layer.groupId || validGroupIds.has(layer.groupId)) {
              return layer;
            }
            return { ...layer, groupId: undefined };
          });
          const validLayerIds = new Set(groupedLayers.map((layer) => layer.id));
          const nextReferenceLayerId = state.referenceLayerId && validLayerIds.has(state.referenceLayerId)
            ? state.referenceLayerId
            : null;

          return {
            layers: groupedLayers,
            layerGroups: sanitizedGroups,
            hiddenLayerGroupIds: sanitizeHiddenLayerGroupIds(state.hiddenLayerGroupIds, sanitizedGroups),
            referenceLayerId: nextReferenceLayerId,
          };
        });
        pruneGroupVisibilitySnapshots(new Set(get().layerGroups.map((group) => group.id)));
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
      
      const resolvedLayerType = layer.layerType || (
        (logError('CRITICAL: Layer missing layerType!', {
          layerId: newLayerId?.substring(0, 20),
          hasColorCycleData: !!layer.colorCycleData,
          fallbackToNormal: true
        }),
        'normal')
      );

      const newLayer = {
        ...layer,
        id: newLayerId,
        // Temporary order; will be normalized after insertion
        order: 0,
        alignment: cloneLayerAlignment(layer.alignment),
        transparencyLocked: layer.transparencyLocked === true,
        // CRITICAL: Preserve layerType EXACTLY - DO NOT convert CC layers to normal!
        layerType: resolvedLayerType,
        sequentialData: resolvedLayerType === 'sequential'
          ? {
              frameCount: layer.sequentialData?.frameCount ?? 24,
              fps: layer.sequentialData?.fps ?? 24,
              durationMs:
                layer.sequentialData?.durationMs ??
                Math.round(((layer.sequentialData?.frameCount ?? 24) * 1000) / (layer.sequentialData?.fps ?? 24)),
              events: layer.sequentialData?.events ?? [],
            }
          : layer.sequentialData
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
          hasGradient: Boolean(resolveActiveGradientStops(l.colorCycleData)?.length)
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
            resolveActiveGradientStops(duplicatedLayer?.colorCycleData) ?? DEFAULT_CC_GRADIENT;
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
    clearSequentialLayerRendererLayer(id);
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
      const nextLayerGroups = sanitizeLayerGroups(syncedLayers, state.layerGroups);
      const nextHiddenLayerGroupIds = sanitizeHiddenLayerGroupIds(state.hiddenLayerGroupIds, nextLayerGroups);
    return {
      layers: syncedLayers,
      layerGroups: nextLayerGroups,
      hiddenLayerGroupIds: nextHiddenLayerGroupIds,
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
    pruneGroupVisibilitySnapshots(new Set(get().layerGroups.map((group) => group.id)));
    get().markAllCompositeSegmentsDirty();
    scheduleSlotRebuild('remove-layer');
  },
  scheduleColorCycleSlotRebuild: (reason) => {
    scheduleSlotRebuild(reason);
  },
  runColorCycleSlotRebuild: (reason) => {
    runSlotRebuild(reason);
  },
  updateLayer: (id, updates, options?: UpdateLayerOptions) => {
    if ('layerType' in updates && updates.layerType !== 'sequential') {
      clearSequentialLayerRendererLayer(id);
    }
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
              const sanitizedColorCyclePatch = omitUndefinedEntries(
                updates.colorCycleData as Record<string, unknown>
              ) as Layer['colorCycleData'];
              // Merging colorCycleData for color-cycle layer
              const mergedColorCycleData = {
                ...layer.colorCycleData,
                ...sanitizedColorCyclePatch
              };
              if (mergedColorCycleData.flowMode && mergedColorCycleData.flowMode !== 'forward') {
                mergedColorCycleData.flowMode = 'forward';
              }
              const legacyStops = resolveLegacyGradientStops(mergedColorCycleData);
              const fallbackStops = legacyStops
                ?? state.tools.brushSettings.colorCycleGradient
                ?? DEFAULT_CC_GRADIENT;
              const { gradientDefs, slotPalettes, activeGradientId, paintSlot, legacyRemap } = ensureColorCycleGradients(
                mergedColorCycleData,
                fallbackStops
              );
              const activeDef = gradientDefs.find((entry) => entry.id === activeGradientId)
                ?? gradientDefs[0];
              const shouldApplyLegacyStops = Boolean(legacyStops)
                && !sanitizedColorCyclePatch?.slotPalettes
                && !sanitizedColorCyclePatch?.gradientDefs;
              const updatedSlotPalettes = shouldApplyLegacyStops
                ? slotPalettes.map((entry) =>
                    entry.slot === activeDef.currentSlot
                      ? { ...entry, stops: (cloneGradientStops(legacyStops) ?? legacyStops) ?? entry.stops }
                      : entry
                  )
                : slotPalettes;
              const activeSlotPalette = updatedSlotPalettes.find((entry) => entry.slot === activeDef.currentSlot);
              updatedLayer.colorCycleData = {
                ...mergedColorCycleData,
                gradientDefs,
                slotPalettes: updatedSlotPalettes,
                activeGradientId,
                gradient: activeSlotPalette?.stops ?? legacyStops ?? mergedColorCycleData.gradient,
                paintSlot,
                legacyRemap,
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
          requestGradientApply(syncedLayer.id, 'update-layer');
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
  appendSequentialLayerEvent: (layerId, event, metadata) => {
    get().appendSequentialLayerEvents(layerId, [event], metadata);
  },
  appendSequentialLayerEvents: (layerId, events, metadata) => {
    if (events.length === 0) {
      return;
    }
    const normalizedFrameCount = Math.max(1, Math.round(metadata.frameCount));
    const normalizedFps = Math.max(1, Math.round(metadata.fps));
    const normalizedDurationMs = Math.max(1, Math.round(metadata.durationMs));
    const appendStartMs =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    let didAppend = false;
    set((state) => {
      const targetIndex = resolveSequentialAppendLayerIndex(state.layers, layerId);
      if (targetIndex < 0) {
        return state;
      }

      const targetLayer = state.layers[targetIndex];
      const previousSequentialData = targetLayer.sequentialData;
      const nextEvents = [...(previousSequentialData?.events ?? []), ...events];
      const updatedLayer: Layer = {
        ...targetLayer,
        sequentialData: {
          frameCount: normalizedFrameCount,
          fps: normalizedFps,
          durationMs: normalizedDurationMs,
          events: nextEvents,
        },
      };
      const nextLayers = [...state.layers];
      nextLayers[targetIndex] = updatedLayer;
      didAppend = true;

      return {
        layers: nextLayers,
        layersNeedRecomposition: state.layersNeedRecomposition,
      };
    });
    if (!didAppend) {
      return;
    }
    get().markCompositeSegmentsDirtyByLayerIds([layerId]);
    const appendDurationMs =
      (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()) - appendStartMs;
    recordSequentialAppendPerf({
      events: events.length,
      durationMs: appendDurationMs,
    });
  },
  setLayersVisibility: (layerIds, visible) => {
    const uniqueIds = Array.from(new Set(layerIds));
    if (uniqueIds.length === 0) {
      return;
    }

    const stateBeforeChange = get();
    const targetIds = uniqueIds.filter((id) => stateBeforeChange.layers.some((layer) => layer.id === id));
    if (targetIds.length === 0) {
      return;
    }

    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeChange, {
      actionType: 'layers',
      description: visible ? 'Show selected layers' : 'Hide selected layers',
    });

    let didChange = false;
    set((state) => {
      const targetIdSet = new Set(targetIds);
      const nextLayers = state.layers.map((layer) => {
        if (!targetIdSet.has(layer.id) || layer.visible === visible) {
          return layer;
        }
        didChange = true;
        return { ...layer, visible };
      });

      if (!didChange) {
        return state;
      }

      return {
        layers: nextLayers,
        layersNeedRecomposition: true,
      };
    });

    if (!didChange) {
      return;
    }

    const stateAfterChange = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterChange, {
      actionType: 'layers',
      description: visible ? 'Show selected layers' : 'Hide selected layers',
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: visible ? 'Show selected layers' : 'Hide selected layers',
      metadata: {
        operation: visible ? 'show-selected-layers' : 'hide-selected-layers',
        layerIds: targetIds,
      },
    });
    get().markCompositeSegmentsDirtyByLayerIds(targetIds);
  },
  toggleLayersVisibility: (layerIds) => {
    const uniqueIds = Array.from(new Set(layerIds));
    if (uniqueIds.length === 0) {
      return;
    }

    const stateBeforeChange = get();
    const targetIds = uniqueIds.filter((id) => stateBeforeChange.layers.some((layer) => layer.id === id));
    if (targetIds.length === 0) {
      return;
    }

    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeChange, {
      actionType: 'layers',
      description: 'Toggle selected layers visibility',
    });

    let didChange = false;
    set((state) => {
      const targetIdSet = new Set(targetIds);
      const nextLayers = state.layers.map((layer) => {
        if (!targetIdSet.has(layer.id)) {
          return layer;
        }
        didChange = true;
        return { ...layer, visible: !layer.visible };
      });

      if (!didChange) {
        return state;
      }

      return {
        layers: nextLayers,
        layersNeedRecomposition: true,
      };
    });

    if (!didChange) {
      return;
    }

    const stateAfterChange = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterChange, {
      actionType: 'layers',
      description: 'Toggle selected layers visibility',
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Toggle selected layers visibility',
      metadata: {
        operation: 'toggle-selected-layers-visibility',
        layerIds: targetIds,
      },
    });
    get().markCompositeSegmentsDirtyByLayerIds(targetIds);
  },
  createLayerGroupFromSelection: (layerIds) => {
    const stateBeforeChange = get();
    const targetIds = Array.from(
      new Set(layerIds.filter((id) => stateBeforeChange.layers.some((layer) => layer.id === id)))
    );
    if (targetIds.length === 0) {
      return null;
    }

    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeChange, {
      actionType: 'layers',
      description: 'Create layer group',
    });

    const newGroupId = `group-${Date.now()}-${Math.random()}`;
    const nextGroupName = generateLayerGroupName(stateBeforeChange.layerGroups);

    set((state) => {
      const targetIdSet = new Set(targetIds);
      const nextLayers = state.layers.map((layer) => (
        targetIdSet.has(layer.id)
          ? { ...layer, groupId: newGroupId }
          : layer
      ));
      const nextGroups = [
        ...state.layerGroups,
        { id: newGroupId, name: nextGroupName },
      ];

      return {
        layers: nextLayers,
        layerGroups: sanitizeLayerGroups(nextLayers, nextGroups),
        hiddenLayerGroupIds: state.hiddenLayerGroupIds,
      };
    });

    const stateAfterChange = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterChange, {
      actionType: 'layers',
      description: 'Create layer group',
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Create layer group',
      metadata: {
        operation: 'create-layer-group',
        groupId: newGroupId,
        layerIds: targetIds,
      },
    });

    return newGroupId;
  },
  removeLayerGroup: (groupId) => {
    const stateBeforeChange = get();
    if (!stateBeforeChange.layerGroups.some((group) => group.id === groupId)) {
      return;
    }

    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeChange, {
      actionType: 'layers',
      description: 'Remove layer group',
    });

    let didChange = false;
    set((state) => {
      const nextLayers = state.layers.map((layer) => {
        if (layer.groupId !== groupId) {
          return layer;
        }
        didChange = true;
        return { ...layer, groupId: undefined };
      });
      const nextGroups = state.layerGroups.filter((group) => group.id !== groupId);
      if (nextGroups.length !== state.layerGroups.length) {
        didChange = true;
      }
      if (!didChange) {
        return state;
      }
      return {
        layers: nextLayers,
        layerGroups: sanitizeLayerGroups(nextLayers, nextGroups),
        hiddenLayerGroupIds: state.hiddenLayerGroupIds.filter((id) => id !== groupId),
      };
    });

    if (!didChange) {
      return;
    }

    const stateAfterChange = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterChange, {
      actionType: 'layers',
      description: 'Remove layer group',
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Remove layer group',
      metadata: {
        operation: 'remove-layer-group',
        groupId,
      },
    });
    pruneGroupVisibilitySnapshots(new Set(get().layerGroups.map((group) => group.id)));
  },
  renameLayerGroup: (groupId, name) => {
    const normalizedName = name.trim();
    if (!normalizedName) {
      return;
    }

    const stateBeforeChange = get();
    const targetGroup = stateBeforeChange.layerGroups.find((group) => group.id === groupId);
    if (!targetGroup || targetGroup.name === normalizedName) {
      return;
    }

    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeChange, {
      actionType: 'layers',
      description: 'Rename layer group',
    });

    set((state) => ({
      layerGroups: state.layerGroups.map((group) => (
        group.id === groupId
          ? { ...group, name: normalizedName }
          : group
      )),
    }));

    const stateAfterChange = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterChange, {
      actionType: 'layers',
      description: 'Rename layer group',
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Rename layer group',
      metadata: {
        operation: 'rename-layer-group',
        groupId,
      },
    });
  },
  setLayerGroupVisibility: (groupId, visible) => {
    const stateBeforeChange = get();
    if (!stateBeforeChange.layerGroups.some((group) => group.id === groupId)) {
      return;
    }

    const memberIds = stateBeforeChange.layers
      .filter((layer) => layer.groupId === groupId)
      .map((layer) => layer.id);
    if (memberIds.length === 0) {
      return;
    }

    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeChange, {
      actionType: 'layers',
      description: visible ? 'Show layer group' : 'Hide layer group',
    });

    let didChange = false;
    let didHiddenStateChange = false;
    set((state) => {
      const hiddenGroupIds = new Set(state.hiddenLayerGroupIds);
      const previousVisibilityByLayerId = groupVisibilitySnapshotByGroupId.get(groupId) ?? new Map<string, boolean>();
      const nextVisibilityByLayerId = new Map<string, boolean>();
      const nextLayers = state.layers.map((layer) => {
        if (layer.groupId !== groupId) {
          return layer;
        }
        if (visible) {
          const restoredVisibility = previousVisibilityByLayerId.has(layer.id)
            ? Boolean(previousVisibilityByLayerId.get(layer.id))
            : layer.visible;
          nextVisibilityByLayerId.set(layer.id, restoredVisibility);
          if (layer.visible === restoredVisibility) {
            return layer;
          }
          didChange = true;
          return { ...layer, visible: restoredVisibility };
        }

        nextVisibilityByLayerId.set(layer.id, layer.visible);
        if (!layer.visible) {
          return layer;
        }
        didChange = true;
        return { ...layer, visible: false };
      });

      if (visible) {
        hiddenGroupIds.delete(groupId);
      } else {
        hiddenGroupIds.add(groupId);
      }
      const nextHiddenLayerGroupIds = Array.from(hiddenGroupIds);
      didHiddenStateChange = nextHiddenLayerGroupIds.length !== state.hiddenLayerGroupIds.length
        || nextHiddenLayerGroupIds.some((id, index) => id !== state.hiddenLayerGroupIds[index]);
      if (!didChange && nextHiddenLayerGroupIds.length === state.hiddenLayerGroupIds.length) {
        const didHiddenIdsChange = nextHiddenLayerGroupIds.some((id, index) => id !== state.hiddenLayerGroupIds[index]);
        if (!didHiddenIdsChange) {
          return state;
        }
      }

      groupVisibilitySnapshotByGroupId.set(groupId, nextVisibilityByLayerId);

      return {
        layers: nextLayers,
        hiddenLayerGroupIds: nextHiddenLayerGroupIds,
        layersNeedRecomposition: true,
      };
    });

    if (!didChange && !didHiddenStateChange) {
      return;
    }

    const stateAfterChange = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterChange, {
      actionType: 'layers',
      description: visible ? 'Show layer group' : 'Hide layer group',
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: visible ? 'Show layer group' : 'Hide layer group',
      metadata: {
        operation: visible ? 'show-layer-group' : 'hide-layer-group',
        groupId,
      },
    });
    if (didChange) {
      get().markCompositeSegmentsDirtyByLayerIds(memberIds);
    }
  },
  setSelectedLayerIds: (layerIds) => set((state) => {
    const validIds = layerIds.filter((layerId, index, list) => {
      return list.indexOf(layerId) === index && state.layers.some(layer => layer.id === layerId);
    });

    return {
      selectedLayerIds: validIds
    };
  }),
  mergeLayers: (layerIds) => {
    const stateBeforeMerge = get();
    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeMerge, {
      actionType: 'layer-merge',
      description: 'Merge layers',
    });

    let mergedLayerId: string | null = null;

    set((state) => {
      if (!state.project) {
        return state;
      }

      const uniqueIds = Array.from(new Set(layerIds));
      const layersToMerge = state.layers.filter((layer) => uniqueIds.includes(layer.id));

      if (layersToMerge.length < 2) {
        return state;
      }

      const sortedByOrder = [...layersToMerge].sort((a, b) => a.order - b.order);
      const sourceGroupIds = Array.from(
        new Set(
          layersToMerge
            .map((layer) => layer.groupId)
            .filter((groupId): groupId is string => typeof groupId === 'string' && groupId.length > 0)
        )
      );
      const mergedGroupId = sourceGroupIds.length === 1 ? sourceGroupIds[0] : undefined;
      const sequentialFrameIndex = state.sequentialRecord.currentFrame;
      const anchorOrder = (() => {
        const anchorId = uniqueIds[0];
        const anchorLayer = state.layers.find(layer => layer.id === anchorId);
        return anchorLayer?.order ?? sortedByOrder[0]?.order ?? 0;
      })();
      const projectWidth = state.project.width || 1;
      const projectHeight = state.project.height || 1;
      const mergeCanvas = createLayerTransferCanvas(projectWidth, projectHeight);
      if (!mergeCanvas) {
        return state;
      }

      const ctx = mergeCanvas.getContext(
        '2d',
        { willReadFrequently: true } as CanvasRenderingContext2DSettings
      ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

      if (!ctx) {
        return state;
      }

      ctx.clearRect(0, 0, projectWidth, projectHeight);

      const ensureCanvasFromImageData = (imageData: ImageData | null | undefined) => {
        if (!imageData) {
          return null;
        }
        const tempCanvas = createLayerTransferCanvas(imageData.width, imageData.height);
        if (!tempCanvas) {
          return null;
        }
        const tempCtx = tempCanvas.getContext(
          '2d',
          { willReadFrequently: true } as CanvasRenderingContext2DSettings
        ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        tempCtx?.putImageData(imageData, 0, 0);
        return tempCanvas;
      };

      const drawLayerOntoMergeCanvas = (layer: Layer) => {
        ctx.globalCompositeOperation = layer.blendMode;
        ctx.globalAlpha = layer.opacity ?? 1;

        if (layer.layerType === 'color-cycle') {
          const brush = colorCycleBrushManager.getBrush(layer.id);
          const sourceCanvas =
            (layer.colorCycleData?.canvas as HTMLCanvasElement | OffscreenCanvas | undefined) ??
            (hasValidFramebuffer(layer.framebuffer) ? layer.framebuffer : null);

          if (brush && sourceCanvas && typeof HTMLCanvasElement !== 'undefined' && sourceCanvas instanceof HTMLCanvasElement) {
            try {
              brush.renderDirectToCanvas?.(sourceCanvas, layer.id);
            } catch (error) {
              logError('[mergeLayers] Failed to render CC layer before merge', error);
            }
          }

          const ccCanvas =
            sourceCanvas ??
            ensureCanvasFromImageData(layer.colorCycleData?.canvasImageData) ??
            ensureCanvasFromImageData(layer.imageData);

          if (ccCanvas) {
            try {
              ctx.drawImage(ccCanvas as CanvasImageSource, 0, 0, projectWidth, projectHeight);
            } catch (error) {
              logError('[mergeLayers] Failed to draw CC layer', error);
            }
          }
          return;
        }

        if (layer.layerType === 'sequential' && layer.sequentialData) {
          const sequentialCanvas = getSequentialLayerRenderCanvas({
            layer,
            width: projectWidth,
            height: projectHeight,
            frameIndex: sequentialFrameIndex,
          });
          if (sequentialCanvas) {
            try {
              ctx.drawImage(
                sequentialCanvas as CanvasImageSource,
                0,
                0,
                projectWidth,
                projectHeight
              );
            } catch (error) {
              logError('[mergeLayers] Failed to draw sequential layer', error);
            }
          }
          return;
        }

        const sourceCanvas =
          ensureCanvasFromImageData(layer.imageData) ||
          (hasValidFramebuffer(layer.framebuffer) ? layer.framebuffer : null);

        if (sourceCanvas) {
          try {
            ctx.drawImage(sourceCanvas as CanvasImageSource, 0, 0, projectWidth, projectHeight);
          } catch (error) {
            logError('[mergeLayers] Failed to draw normal layer', error);
          }
        }
      };

      sortedByOrder.forEach(drawLayerOntoMergeCanvas);

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      let mergedImageData: ImageData | null = null;
      try {
        mergedImageData = (ctx as CanvasRenderingContext2D).getImageData(0, 0, projectWidth, projectHeight);
      } catch (error) {
        logError('[mergeLayers] Failed to read merged imageData', error);
      }

      mergedLayerId = `layer-${Date.now()}-${Math.random()}`;
      const topLayer = sortedByOrder[sortedByOrder.length - 1];
      const mergedLayer: Layer = {
        id: mergedLayerId,
        name:
          sortedByOrder.length === 2
            ? `${sortedByOrder[1].name} + ${sortedByOrder[0].name}`
            : `Merged ${sortedByOrder.length} layers`,
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        locked: false,
        transparencyLocked: false,
        order: 0,
        imageData: mergedImageData,
        framebuffer: mergeCanvas,
        alignment: cloneLayerAlignment(topLayer.alignment),
        groupId: mergedGroupId,
        layerType: 'normal',
        version: (topLayer.version ?? 0) + 1,
      };

      const remainingLayers = state.layers.filter((layer) => !uniqueIds.includes(layer.id));
      const insertionIndex = (() => {
        const idx = remainingLayers.findIndex((layer) => layer.order >= anchorOrder);
        if (idx === -1) {
          return remainingLayers.length;
        }
        return idx;
      })();
      remainingLayers.splice(insertionIndex, 0, mergedLayer);

      const normalizedLayers = remainingLayers.map((layer, index) => ({ ...layer, order: index }));
      const syncedLayers = syncPercentOffsetsFromPixels(normalizedLayers, state.project ?? null);
      const nextLayerGroups = sanitizeLayerGroups(syncedLayers, state.layerGroups);
      const nextHiddenLayerGroupIds = sanitizeHiddenLayerGroupIds(state.hiddenLayerGroupIds, nextLayerGroups);

      const nextReferenceLayerId =
        state.referenceLayerId && uniqueIds.includes(state.referenceLayerId) ? null : state.referenceLayerId;

      return {
        layers: syncedLayers,
        layerGroups: nextLayerGroups,
        hiddenLayerGroupIds: nextHiddenLayerGroupIds,
        activeLayerId: mergedLayerId,
        selectedLayerIds: [mergedLayerId],
        referenceLayerId: nextReferenceLayerId,
        layersNeedRecomposition: true,
      };
    });

    if (!mergedLayerId) {
      return null;
    }

    for (const sourceLayerId of layerIds) {
      clearSequentialLayerRendererLayer(sourceLayerId);
    }

    const stateAfterMerge = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterMerge, {
      actionType: 'layer-merge',
      description: 'Merge layers',
      activeLayerId: mergedLayerId,
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Merge layers',
      metadata: { sourceLayerIds: layerIds, mergedLayerId },
    });
    pruneGroupVisibilitySnapshots(new Set(get().layerGroups.map((group) => group.id)));
    get().markAllCompositeSegmentsDirty();
    scheduleSlotRebuild('merge-layers');

    return mergedLayerId;
  },
  setActiveLayer: (id, opts) => set((state) => {
    const layer = state.layers.find(l => l.id === id);
    if (!layer) {
      logError('setActiveLayer: Invalid layer ID', id);
      return state;
    }

    // Fast path: avoid rerunning selection/runtime work when nothing changes.
    if (state.activeLayerId === id) {
      if (opts?.preserveSelection) {
        if (state.selectedLayerIds.includes(id)) {
          return state;
        }
      } else if (
        state.selectedLayerIds.length === 1 &&
        state.selectedLayerIds[0] === id
      ) {
        return state;
      }
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
        hasGradient: Boolean(resolveActiveGradientStops(l.colorCycleData)?.length)
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
    const baseSelection = (() => {
      if (opts?.preserveSelection) {
        return state.selectedLayerIds.includes(id)
          ? state.selectedLayerIds
          : [...state.selectedLayerIds, id];
      }
      return [id];
    })();

    if (layer?.layerType === 'color-cycle' && state.tools.currentTool !== 'recolor') {
      /* console.log('🟣 SWITCHING TO CC LAYER:', {
        layerId: id.substring(0, 20),
        hasGradient: Boolean(resolveActiveGradientStops(layer.colorCycleData)?.length),
        gradientLength: resolveActiveGradientStops(layer.colorCycleData)?.length ?? 0
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

      const resolvedFlowMode = 'forward' as const;
      const layerGradientStops = resolveActiveGradientStops(layer.colorCycleData);
      const currentGradientStops = state.tools.brushSettings.colorCycleGradient;
      const hasGradientChange =
        Boolean(layerGradientStops) && !areGradientStopsEqual(currentGradientStops, layerGradientStops);

      const shouldUpdateBrushSettings =
        state.tools.brushSettings.customBrushColorCycle !== true ||
        state.tools.brushSettings.colorCycleFlowMode !== resolvedFlowMode ||
        hasGradientChange;

      let nextBrushSettings = state.tools.brushSettings;
      if (shouldUpdateBrushSettings) {
        nextBrushSettings = {
          ...state.tools.brushSettings,
          customBrushColorCycle: true,
          colorCycleFlowMode: resolvedFlowMode,
          ...(hasGradientChange && layerGradientStops
            ? { colorCycleGradient: layerGradientStops.map(stop => ({ ...stop })) }
            : {})
        };
      }

      const shouldUpdateToolMemory =
        savedRegularTool !== state.tools.lastRegularTool ||
        savedBrushShape !== state.tools.lastRegularBrushShape ||
        state.tools.lastColorCycleShapeMode !== state.tools.shapeMode;

      const nextTools =
        shouldUpdateBrushSettings || shouldUpdateToolMemory
          ? {
              ...state.tools,
              lastRegularTool: savedRegularTool,
              lastRegularBrushShape: savedBrushShape,
              lastColorCycleShapeMode: state.tools.shapeMode,
              brushSettings: nextBrushSettings
            }
          : state.tools;

      const result = {
        activeLayerId: id,
        selectedLayerIds: baseSelection,
        tools: nextTools
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
      selectedLayerIds: baseSelection,
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
      return {
        referenceLayerId: null,
        project: state.project
          ? {
              ...state.project,
              referenceLayerId: null,
            }
          : state.project,
      };
    }

    const nextReferenceLayerId = id ?? null;
    return {
      referenceLayerId: nextReferenceLayerId,
      project: state.project
        ? {
            ...state.project,
            referenceLayerId: nextReferenceLayerId,
          }
        : state.project,
    };
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
  reorderLayerBlock: (layerIds, destinationIndex) => {
    const uniqueLayerIds = Array.from(new Set(layerIds));
    if (uniqueLayerIds.length === 0) {
      return;
    }

    const stateBeforeReorder = get();
    const beforeSnapshot = captureLayerStructureSnapshot(stateBeforeReorder, {
      actionType: 'layer-reorder',
      description: 'Reorder layer block',
    });

    let didReorder = false;

    set((state) => {
      const layerIdSet = new Set(uniqueLayerIds);
      const indexedLayers = state.layers.map((layer, index) => ({ layer, index }));
      const blockEntries = indexedLayers.filter(({ layer }) => layerIdSet.has(layer.id));
      if (blockEntries.length === 0) {
        return {};
      }

      const blockById = new Map(blockEntries.map(({ layer }) => [layer.id, layer]));
      const orderedBlock = uniqueLayerIds
        .map((id) => blockById.get(id))
        .filter((layer): layer is Layer => Boolean(layer));
      const remainingLayers = state.layers.filter((layer) => !layerIdSet.has(layer.id));
      const removedBeforeDestination = blockEntries.filter(({ index }) => index < destinationIndex).length;
      const adjustedDestination = Math.max(
        0,
        Math.min(remainingLayers.length, destinationIndex - removedBeforeDestination),
      );
      const currentBlockStartIndex = blockEntries[0]?.index ?? -1;
      const isContiguousBlock = blockEntries.every(
        ({ index }, entryIndex) => index === currentBlockStartIndex + entryIndex,
      );
      if (isContiguousBlock && adjustedDestination === currentBlockStartIndex) {
        return {};
      }
      const nextLayers = [...remainingLayers];
      nextLayers.splice(adjustedDestination, 0, ...orderedBlock);

      const isSameOrder = nextLayers.length === state.layers.length
        && nextLayers.every((layer, index) => state.layers[index]?.id === layer.id);
      if (isSameOrder) {
        return {};
      }

      didReorder = true;
      const normalizedLayers = nextLayers.map((layer, index) => ({
        ...layer,
        order: index,
      }));
      const syncedLayers = syncPercentOffsetsFromPixels(normalizedLayers, state.project ?? null);

      return {
        layers: syncedLayers,
        layersNeedRecomposition: true,
      };
    });

    if (!didReorder) {
      return;
    }

    const stateAfterReorder = get();
    const afterSnapshot = captureLayerStructureSnapshot(stateAfterReorder, {
      actionType: 'layer-reorder',
      description: 'Reorder layer block',
    });

    commitLayerStructureHistory({
      set,
      beforeSnapshot,
      afterSnapshot,
      label: 'Reorder layer block',
      metadata: { operation: 'reorder-block' },
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

      const safeWidth = Math.max(
        width || layer.colorCycleData?.canvasWidth || state.project?.width || 1024,
        1
      );
      const safeHeight = Math.max(
        height || layer.colorCycleData?.canvasHeight || state.project?.height || 1024,
        1
      );
      const fallbackStops = state.tools.brushSettings.colorCycleGradient ?? DEFAULT_CC_GRADIENT;
      const { gradientDefs, slotPalettes, activeGradientId, paintSlot, legacyRemap } = ensureColorCycleGradients(
        layer.colorCycleData,
        fallbackStops
      );
      const activeDef = gradientDefs.find((entry) => entry.id === activeGradientId) ?? gradientDefs[0];
      const activeSlotPalette = slotPalettes.find((entry) => entry.slot === activeDef.currentSlot);
      const activeStops = activeSlotPalette?.stops ?? fallbackStops;
      const gradientIdBuffer = ensureGradientIdBuffer({
        existingBuffer: layer.colorCycleData?.gradientIdBuffer,
        width: safeWidth,
        height: safeHeight,
        previousWidth: layer.colorCycleData?.canvasWidth ?? layer.colorCycleData?.canvas?.width,
        previousHeight: layer.colorCycleData?.canvasHeight ?? layer.colorCycleData?.canvas?.height,
        fillSlot: paintSlot,
      });
      const usedSlots = collectUsedSlots(gradientDefs, slotPalettes);
      const migrated = migrateGradientIdBuffer({
        buffer: gradientIdBuffer,
        legacyRemap,
        usedSlots,
      });
      const migratedGradientIdBuffer = migrated.buffer;
      const migratedLegacyRemap = migrated.legacyRemap ?? legacyRemap;
      const defKind: 'linear' | 'concentric' =
        state.tools.brushSettings.colorCycleFillMode === 'linear' ? 'linear' : 'concentric';
      const existingDefStore = layer.colorCycleData?.gradientDefStore ?? [];
      const existingNextDefId = layer.colorCycleData?.nextGradientDefId;
      const seededDefId = typeof existingNextDefId === 'number'
        ? existingNextDefId
        : (existingDefStore.reduce((max, entry) => Math.max(max, entry.id), 0) + 1) || 1;
      const gradientDefStore = existingDefStore.length > 0
        ? existingDefStore
        : [{
            id: seededDefId,
            kind: defKind,
            stops: cloneGradientStops(activeStops) ?? activeStops,
            hash: hashStopsForDef(defKind, activeStops),
            source: 'manual' as const,
            createdAtMs: Date.now(),
            slot: activeDef.currentSlot,
            speedCps: state.tools.brushSettings.colorCycleSpeed,
          }];
      const nextGradientDefId = existingDefStore.length > 0
        ? (existingNextDefId ?? seededDefId + 1)
        : seededDefId + 1;
      const gradientDefIdBuffer = ensureGradientDefIdBuffer({
        existingBuffer: layer.colorCycleData?.gradientDefIdBuffer,
        width: safeWidth,
        height: safeHeight,
        previousWidth: layer.colorCycleData?.canvasWidth ?? layer.colorCycleData?.canvas?.width,
        previousHeight: layer.colorCycleData?.canvasHeight ?? layer.colorCycleData?.canvas?.height,
      });
      
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
                gradient: activeStops,
                gradientDefs,
                slotPalettes,
                activeGradientId,
                paintSlot,
                gradientIdBuffer: migratedGradientIdBuffer,
                gradientDefIdBuffer,
                gradientDefStore,
                nextGradientDefId,
                colorCycleBrush: existingBrush,
              // Keep current animation state if present; default to true for responsiveness
              isAnimating: l.colorCycleData?.isAnimating ?? true,
              flowMode: l.colorCycleData?.flowMode ?? (state.tools.brushSettings.colorCycleFlowMode ?? 'forward'),
              legacyRemap: migratedLegacyRemap,
              canvas,
              canvasWidth: safeWidth,
              canvasHeight: safeHeight,
            }
          };
        });
        trackLayerChanges('initColorCycleForLayer (hydrate existing)', updatedLayers);
        const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);
        return { layers: syncedLayers };
      }
      
      // Create a canvas element for this layer's color cycle
      // Use the current brush gradient if available
      const gradientArray = gradientStopsToUint8Array(activeStops);
      
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
          gradient: activeStops || [],
          gradientDefs,
          slotPalettes,
          activeGradientId,
          paintSlot,
          legacyRemap: migratedLegacyRemap,
          gradientIdBuffer: migratedGradientIdBuffer,
          gradientDefIdBuffer,
          gradientDefStore,
          nextGradientDefId,
          colorCycleBrush,
          isAnimating: true,
          flowMode: state.tools.brushSettings.colorCycleFlowMode ?? 'forward',
          canvas: layerCanvas ?? (colorCycleBrush.getCanvas ? colorCycleBrush.getCanvas() : undefined),
          eraseMask,
          eraseMaskVersion,
          canvasWidth: safeWidth,
          canvasHeight: safeHeight,
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
      const renderToken = ++compositeRenderToken;

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
        drawSequentialLayers(
          ctx,
          sortedLayers,
          state.project!,
          get().sequentialRecord.currentFrame
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
          }
        | {
            kind: 'sequential';
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
        if (layer.layerType === 'sequential') {
          flushStaticSegment();
          descriptors.push({
            kind: 'sequential',
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
          if (descriptor.kind === 'sequential' && segment.kind === 'sequential') {
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
          const previous = state.compositeSegments[index] as
            | ColorCycleCompositeSegment
            | SequentialCompositeSegment;
          return {
            ...previous,
            blendMode: descriptor.blendMode,
            opacity: descriptor.opacity
          };
        }
        if (descriptor.kind === 'sequential') {
          return {
            kind: 'sequential',
            id: `seq-${descriptor.layerId}-${index}`,
            layerId: descriptor.layerId,
            blendMode: descriptor.blendMode,
            opacity: descriptor.opacity,
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
          if (
            !layer ||
            !layer.visible ||
            layer.layerType === 'color-cycle' ||
            layer.layerType === 'sequential'
          ) {
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

  captureCanvasToActiveLayer: async (sourceCanvas, roi, options?: { mode?: CompositeMode }) => {
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

      // If a selection is active, zero-out pixels outside the selection before merging.
      const { selectionMask, selectionMaskBounds, selectionStart, selectionEnd } = state;
      if (selectionMask && selectionMaskBounds) {
        const maskData = selectionMask.data;
        const mb = selectionMaskBounds;
        const stride = regionWidth * 4;
        for (let y = 0; y < regionHeight; y += 1) {
          const globalY = captureY + y;
          const localY = globalY - mb.y;
          const rowOffset = y * stride;
          if (localY < 0 || localY >= mb.height) {
            // Entire row is outside selection bounds.
            for (let x = 0; x < regionWidth; x += 1) {
              const idx = rowOffset + x * 4;
              capturedImageData.data[idx] = 0;
              capturedImageData.data[idx + 1] = 0;
              capturedImageData.data[idx + 2] = 0;
              capturedImageData.data[idx + 3] = 0;
            }
            continue;
          }
          for (let x = 0; x < regionWidth; x += 1) {
            const globalX = captureX + x;
            const localX = globalX - mb.x;
            const destIdx = rowOffset + x * 4;
            if (localX < 0 || localX >= mb.width) {
              capturedImageData.data[destIdx] = 0;
              capturedImageData.data[destIdx + 1] = 0;
              capturedImageData.data[destIdx + 2] = 0;
              capturedImageData.data[destIdx + 3] = 0;
              continue;
            }
            const maskIdx = (Math.floor(localY) * mb.width + Math.floor(localX)) * 4 + 3;
            if (maskData[maskIdx] === 0) {
              capturedImageData.data[destIdx] = 0;
              capturedImageData.data[destIdx + 1] = 0;
              capturedImageData.data[destIdx + 2] = 0;
              capturedImageData.data[destIdx + 3] = 0;
            }
          }
        }
      } else if (selectionStart && selectionEnd) {
        const minX = Math.min(selectionStart.x, selectionEnd.x);
        const maxX = Math.max(selectionStart.x, selectionEnd.x);
        const minY = Math.min(selectionStart.y, selectionEnd.y);
        const maxY = Math.max(selectionStart.y, selectionEnd.y);

        const stride = regionWidth * 4;
        for (let y = 0; y < regionHeight; y += 1) {
          const globalY = captureY + y;
          const rowOffset = y * stride;
          for (let x = 0; x < regionWidth; x += 1) {
            const globalX = captureX + x;
            const destIdx = rowOffset + x * 4;
            const inside =
              globalX >= minX && globalX < maxX && globalY >= minY && globalY < maxY;
            if (!inside) {
              capturedImageData.data[destIdx] = 0;
              capturedImageData.data[destIdx + 1] = 0;
              capturedImageData.data[destIdx + 2] = 0;
              capturedImageData.data[destIdx + 3] = 0;
            }
          }
        }
      }

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

          const framebufferInitial = hasValidFramebuffer(layer.framebuffer)
            ? layer.framebuffer
            : createLayerTransferCanvas(captureWidth, captureHeight) ?? null;
          const matchedImageData =
            layer.imageData &&
            layer.imageData.width === captureWidth &&
            layer.imageData.height === captureHeight
              ? layer.imageData
              : null;
          const framebufferSnapshot = snapshotFramebufferRegion(
            framebufferInitial,
            captureWidth,
            captureHeight
          );

          const baseImageDataRaw =
            framebufferSnapshot ?? matchedImageData;

          const baseImageData =
            baseImageDataRaw &&
            (baseImageDataRaw.width !== captureWidth || baseImageDataRaw.height !== captureHeight)
              ? normalizeImageDataDimensions(baseImageDataRaw, captureWidth, captureHeight)
              : baseImageDataRaw;

          const targetWidth = baseImageData?.width ?? captureWidth;
          const targetHeight = baseImageData?.height ?? captureHeight;

      const compositeMode = options?.mode ?? 'alpha';
      const mergedImageData = alphaCompositeImageDataRegion(
        baseImageData,
        capturedImageData,
        captureX,
        captureY,
        targetWidth,
        targetHeight,
        compositeMode
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
