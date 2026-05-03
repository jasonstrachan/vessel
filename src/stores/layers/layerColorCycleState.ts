import type { Layer } from '@/types';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import { clamp } from '@/utils/num';
import { cloneCanvasLike, cloneImageData } from './layerCloneService';

export type GradientStop = { position: number; color: string; opacity?: number };
type ColorCycleGradient = { id: string; slot: number; stops: GradientStop[] };
type ColorCycleGradientDef = { id: string; name?: string; currentSlot: number };
type ColorCycleSlotPalette = { slot: number; stops: GradientStop[] };

const EDITOR_SLOT = 255;

export const DEFAULT_CC_GRADIENT: GradientStop[] = [
  { position: 0.0, color: '#ff0000' },
  { position: 0.17, color: '#ff7f00' },
  { position: 0.33, color: '#ffff00' },
  { position: 0.5, color: '#00ff00' },
  { position: 0.67, color: '#0000ff' },
  { position: 0.83, color: '#4b0082' },
  { position: 1.0, color: '#9400d3' },
];

const clampSlot = (slot: number): number => Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(slot)));

const normalizePaintSlot = (slot: number): number => {
  const clamped = clampSlot(slot);
  return clamped === EDITOR_SLOT ? 0 : clamped;
};

export const cloneGradientStops = (
  stops?: Array<{ position: number; color: string; opacity?: number }> | null
): Array<{ position: number; color: string; opacity?: number }> | undefined => {
  if (!stops) {
    return undefined;
  }
  return stops.map((stop) => ({ ...stop }));
};

export const areGradientStopsEqual = (
  left?: Array<{ position: number; color: string; opacity?: number }> | null,
  right?: Array<{ position: number; color: string; opacity?: number }> | null
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
    if (
      leftStop.position !== rightStop.position ||
      leftStop.color !== rightStop.color ||
      Number(leftStop.opacity ?? 1) !== Number(rightStop.opacity ?? 1)
    ) {
      return false;
    }
  }
  return true;
};

export const collectUsedSlots = (
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

export const resolveLegacyGradientStops = (
  data?: Layer['colorCycleData']
): GradientStop[] | undefined => {
  const legacyStops = (data as { gradient?: GradientStop[] } | undefined)?.gradient;
  if (Array.isArray(legacyStops) && legacyStops.length > 0) {
    return legacyStops.map((stop) => ({ ...stop }));
  }
  return undefined;
};

export const ensureColorCycleGradients = (
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

export const resolveActiveGradientStops = (
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

export const ensureGradientIdBuffer = ({
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

export const ensureGradientDefIdBuffer = ({
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

export const hashStopsForDef = (kind: 'linear' | 'concentric', stops: GradientStop[]): string =>
  `${kind}:${stops.map((stop) => `${stop.position}:${stop.color}`).join('|')}`;

export const migrateGradientIdBuffer = ({
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
    b: value & 0xff,
  };
};

export const gradientStopsToUint8Array = (gradient?: GradientStop[]): Uint8Array => {
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

export const cloneColorCycleData = (
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
    softEdgeMask: stripSurfaces
      ? undefined
      : data.softEdgeMask
        ? (cloneCanvasLike(data.softEdgeMask, null, { forceDom: true }) as HTMLCanvasElement | null) || undefined
        : undefined,
    softEdgeMaskImageData: stripSurfaces
      ? undefined
      : cloneImageData(data.softEdgeMaskImageData ?? null) ?? undefined,
    softEdgeMaskEnabled: data.softEdgeMaskEnabled,
    hasContent: stripSurfaces ? false : data.hasContent,
    recolorSettings: clonedRecolorSettings,
  };
};
