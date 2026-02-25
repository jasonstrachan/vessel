import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import { signatureForStops } from '@/hooks/brushEngine/ccGradientRuntime';
import type { Layer } from '@/types';

const EDITOR_SLOT = 255;
const DEFAULT_THROTTLE_MS = 750;

export type GradientSlotRebuildScope = 'layer' | 'project';

export type GradientSlotRebuildStats = {
  scanMs: number;
  layersScanned: number;
  pixelsScanned: number;
  usedDefsCount: number;
  missingDefsCount: number;
  freedSlotsCount: number;
  unassignedDefsCount: number;
  reassignedSlotsCount: number;
  scope: GradientSlotRebuildScope;
};

export type GradientSlotRebuildUpdate = {
  layerId: string;
  colorCycleData: Layer['colorCycleData'];
};

export type GradientSlotRebuildResult = {
  stats: GradientSlotRebuildStats;
  updates: GradientSlotRebuildUpdate[];
  missingDefLayers?: Array<{ layerId: string; missingDefIds: number[] }>;
};

const clampSlot = (slot: number): number => Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(slot)));

export const buildDefaultReservedSlots = (): Set<number> =>
  new Set<number>([EDITOR_SLOT, TEMP_SAMPLE_SLOT]);

const scanDefIds = (buffer?: ArrayBuffer | null): { usedDefIds: Set<number>; pixelsScanned: number } => {
  if (!buffer || buffer.byteLength === 0) {
    return { usedDefIds: new Set<number>(), pixelsScanned: 0 };
  }
  const view = new Uint16Array(buffer);
  const usedDefIds = new Set<number>();
  for (let i = 0; i < view.length; i += 1) {
    const id = view[i];
    if (id !== 0) {
      usedDefIds.add(id);
    }
  }
  return { usedDefIds, pixelsScanned: view.length };
};

const collectNonDefSlots = (data: Layer['colorCycleData'] | undefined | null): Set<number> => {
  const used = new Set<number>();
  if (!data) {
    return used;
  }
  data.gradientDefs?.forEach((entry) => used.add(clampSlot(entry.currentSlot)));
  data.fgDerivedGradients?.forEach((entry) => used.add(clampSlot(entry.slot)));
  data.derivedGradients?.forEach((entry) => used.add(clampSlot(entry.slot)));
  if (typeof data.paintSlot === 'number') {
    used.add(clampSlot(data.paintSlot));
  }
  if (typeof data.fgActiveSlot === 'number') {
    used.add(clampSlot(data.fgActiveSlot));
  }
  return used;
};

const buildSlotPaletteMap = (slotPalettes: Array<{ slot: number; stops: Array<{ position: number; color: string }> }>) => {
  const map = new Map<number, Array<{ position: number; color: string }>>();
  slotPalettes.forEach((entry) => {
    map.set(clampSlot(entry.slot), entry.stops);
  });
  return map;
};

const removeSlotPalette = (
  slotPalettes: Array<{ slot: number; stops: Array<{ position: number; color: string }> }>,
  slot: number
): Array<{ slot: number; stops: Array<{ position: number; color: string }> }> =>
  slotPalettes.filter((entry) => clampSlot(entry.slot) !== slot);

const ensureSlotPalette = (
  slotPalettes: Array<{ slot: number; stops: Array<{ position: number; color: string }> }>,
  slot: number,
  stops: Array<{ position: number; color: string }>
): Array<{ slot: number; stops: Array<{ position: number; color: string }> }> => {
  const existing = slotPalettes.find((entry) => clampSlot(entry.slot) === slot);
  if (existing) {
    return slotPalettes;
  }
  return [...slotPalettes, { slot, stops }];
};

export const rebuildGradientSlotUsageAndGC = (args: {
  layers: Layer[];
  scope?: GradientSlotRebuildScope;
  layerId?: string;
  reservedSlots?: Set<number>;
  activeSessionSlots?: Set<number>;
  nowMs?: number;
}): GradientSlotRebuildResult | null => {
  const scope = args.scope ?? 'layer';
  const nowMs = args.nowMs ?? Date.now();
  const reservedSlots = args.reservedSlots ?? buildDefaultReservedSlots();
  const activeSessionSlots = args.activeSessionSlots ?? new Set<number>();

  const targetLayers = scope === 'layer'
    ? args.layers.filter((layer) => layer.id === args.layerId)
    : args.layers;

  if (targetLayers.length === 0) {
    return null;
  }

  const start = typeof performance !== 'undefined' && performance.now ? performance.now() : nowMs;

  const updates: GradientSlotRebuildUpdate[] = [];
  const missingDefLayers: Array<{ layerId: string; missingDefIds: number[] }> = [];
  let pixelsScanned = 0;
  let usedDefsCount = 0;
  let freedSlotsCount = 0;
  let unassignedDefsCount = 0;
  let reassignedSlotsCount = 0;

  let globalUsedDefIds: Set<number> | null = null;
  if (scope === 'project') {
    globalUsedDefIds = new Set<number>();
    for (const layer of targetLayers) {
      if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
        continue;
      }
      const { usedDefIds, pixelsScanned: layerPixels } = scanDefIds(layer.colorCycleData.gradientDefIdBuffer);
      pixelsScanned += layerPixels;
      usedDefIds.forEach((id) => globalUsedDefIds?.add(id));
    }
  }

  for (const layer of targetLayers) {
    if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      continue;
    }
    const data = layer.colorCycleData;
    const defStore = data.gradientDefStore ?? [];
    const slotPalettes = data.slotPalettes ?? [];

    const { usedDefIds: usedDefIdsForLayer, pixelsScanned: layerPixels } = scanDefIds(data.gradientDefIdBuffer);
    if (scope !== 'project') {
      pixelsScanned += layerPixels;
    }
    usedDefsCount += usedDefIdsForLayer.size;
    const usedDefIds = scope === 'project' ? (globalUsedDefIds ?? new Set<number>()) : usedDefIdsForLayer;

    if (usedDefIdsForLayer.size === 0 && defStore.length === 0) {
      continue;
    }

    const defById = new Map<number, typeof defStore[number]>();
    defStore.forEach((entry) => {
      defById.set(entry.id, entry);
    });

    const missingDefIds: number[] = [];
    usedDefIdsForLayer.forEach((id) => {
      if (!defById.has(id)) {
        missingDefIds.push(id);
      }
    });
    if (missingDefIds.length > 0) {
      missingDefLayers.push({ layerId: layer.id, missingDefIds });
      continue;
    }

    const nonDefSlots = collectNonDefSlots(data);
    const slotPaletteMap = buildSlotPaletteMap(slotPalettes);

    const usedDefSlots = new Set<number>();
    const needsSlot: typeof defStore = [];
    usedDefIds.forEach((id) => {
      const def = defById.get(id);
      if (!def) return;
      if (typeof def.slot === 'number') {
        usedDefSlots.add(clampSlot(def.slot));
      } else {
        needsSlot.push(def);
      }
    });

    let nextDefStore: typeof defStore | null = null;
    let nextSlotPalettes: typeof slotPalettes | null = null;

    const updateDefSlot = (defId: number, slot?: number) => {
      if (!nextDefStore) {
        nextDefStore = defStore.map((entry) => ({ ...entry }));
      }
      const idx = nextDefStore.findIndex((entry) => entry.id === defId);
      if (idx >= 0) {
        const value = typeof slot === 'number' ? clampSlot(slot) : undefined;
        if (value === undefined) {
          delete nextDefStore[idx].slot;
        } else {
          nextDefStore[idx].slot = value;
        }
      }
    };

    const ensurePalette = (slot: number, stops: Array<{ position: number; color: string }>) => {
      if (!nextSlotPalettes) {
        nextSlotPalettes = slotPalettes.map((entry) => ({
          slot: entry.slot,
          stops: entry.stops.map((stop) => ({ position: stop.position, color: stop.color })),
        }));
      }
      nextSlotPalettes = ensureSlotPalette(nextSlotPalettes, slot, stops);
    };

    const removePalette = (slot: number) => {
      if (!nextSlotPalettes) {
        nextSlotPalettes = slotPalettes.map((entry) => ({
          slot: entry.slot,
          stops: entry.stops.map((stop) => ({ position: stop.position, color: stop.color })),
        }));
      }
      nextSlotPalettes = removeSlotPalette(nextSlotPalettes, slot);
    };

    for (const def of defStore) {
      if (usedDefIds.has(def.id)) {
        continue;
      }
      if (typeof def.slot !== 'number') {
        continue;
      }
      const slot = clampSlot(def.slot);
      updateDefSlot(def.id, undefined);
      unassignedDefsCount += 1;
      if (!reservedSlots.has(slot)) {
        freedSlotsCount += 1;
      }
      if (!nonDefSlots.has(slot)) {
        const paletteStops = slotPaletteMap.get(slot);
        if (paletteStops && signatureForStops(paletteStops) === signatureForStops(def.stops)) {
          removePalette(slot);
        }
      }
    }

    const blockedSlots = new Set<number>(reservedSlots);
    activeSessionSlots.forEach((slot) => blockedSlots.add(clampSlot(slot)));
    nonDefSlots.forEach((slot) => blockedSlots.add(clampSlot(slot)));
    usedDefSlots.forEach((slot) => blockedSlots.add(clampSlot(slot)));

    needsSlot.sort((a, b) => a.id - b.id);

    for (const def of needsSlot) {
      let assigned: number | null = null;
      for (let slot = 0; slot <= FLOW_SLOT_MASK; slot += 1) {
        const clamped = clampSlot(slot);
        if (blockedSlots.has(clamped)) {
          continue;
        }
        const paletteStops = slotPaletteMap.get(clamped);
        if (paletteStops) {
          if (signatureForStops(paletteStops) !== signatureForStops(def.stops)) {
            continue;
          }
        }
        assigned = clamped;
        break;
      }
      if (assigned === null) {
        continue;
      }
      updateDefSlot(def.id, assigned);
      ensurePalette(assigned, def.stops);
      reassignedSlotsCount += 1;
      blockedSlots.add(assigned);
    }

    if (nextDefStore || nextSlotPalettes) {
      const updatedData: Layer['colorCycleData'] = {
        ...data,
        gradientDefStore: nextDefStore ?? defStore,
        slotPalettes: nextSlotPalettes ?? slotPalettes,
      };
      updates.push({ layerId: layer.id, colorCycleData: updatedData });
    }
  }

  const end = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  const stats: GradientSlotRebuildStats = {
    scanMs: Math.max(0, end - start),
    layersScanned: targetLayers.length,
    pixelsScanned,
    usedDefsCount,
    missingDefsCount: missingDefLayers.reduce((sum, entry) => sum + entry.missingDefIds.length, 0),
    freedSlotsCount,
    unassignedDefsCount,
    reassignedSlotsCount,
    scope,
  };

  if (missingDefLayers.length > 0) {
    return { stats, updates: [], missingDefLayers };
  }

  return { stats, updates };
};

const lastRebuildByKey = new Map<string, number>();

export const rebuildOnDemandAndRetryAllocate = (args: {
  attemptAllocate: () => number | null;
  runRebuild: () => GradientSlotRebuildResult | null;
  throttleMs?: number;
  throttleKey?: string;
  nowMs?: number;
}): { slot: number | null; didRebuild: boolean; stats?: GradientSlotRebuildStats; throttled?: boolean } => {
  const initial = args.attemptAllocate();
  if (typeof initial === 'number') {
    return { slot: initial, didRebuild: false };
  }
  const nowMs = args.nowMs ?? Date.now();
  const throttleMs = args.throttleMs ?? DEFAULT_THROTTLE_MS;
  const key = args.throttleKey ?? 'default';
  const last = lastRebuildByKey.get(key) ?? 0;
  if (nowMs - last < throttleMs) {
    return { slot: null, didRebuild: false, throttled: true };
  }
  lastRebuildByKey.set(key, nowMs);
  const result = args.runRebuild();
  const retry = args.attemptAllocate();
  return {
    slot: typeof retry === 'number' ? retry : null,
    didRebuild: true,
    stats: result?.stats,
  };
};
