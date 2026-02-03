import { useAppStore } from '@/stores/useAppStore';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import { cloneStops, getNextGradientSlot } from '@/hooks/canvas/utils/colorCycleHelpers';
import { signatureForStops } from '@/hooks/brushEngine/ccGradientRuntime';
import { TEMP_SAMPLE_SLOT } from '@/hooks/canvas/handlers/colorCycle/ccGradientSampling';

export type StoredStop = { position: number; color: string };

export type GradientDefSource = 'manual' | 'fg' | 'sampled';

export type ColorCycleGradientDefStore = {
  id: number;
  kind: 'linear' | 'concentric';
  stops: StoredStop[];
  hash: string;
  source: GradientDefSource;
  createdAtMs: number;
  slot?: number;
};

const EDITOR_SLOT = 255;

const clampSlot = (slot: number): number => Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(slot)));

export const hashStops = (stops: StoredStop[], kind: 'linear' | 'concentric'): string =>
  `${kind}:${signatureForStops(stops)}`;

export const findDefByHash = (
  defs: ColorCycleGradientDefStore[] | undefined,
  hash: string
): ColorCycleGradientDefStore | null => {
  if (!defs?.length) return null;
  return defs.find((entry) => entry.hash === hash) ?? null;
};

const collectUsedSlots = (params: {
  slotPalettes?: Array<{ slot: number }>;
  gradientDefs?: Array<{ currentSlot: number }>;
  gradientDefStore?: Array<{ slot?: number }>;
}): Set<number> => {
  const used = new Set<number>();
  params.slotPalettes?.forEach((entry) => used.add(clampSlot(entry.slot)));
  params.gradientDefs?.forEach((entry) => used.add(clampSlot(entry.currentSlot)));
  params.gradientDefStore?.forEach((entry) => {
    if (typeof entry.slot === 'number') {
      used.add(clampSlot(entry.slot));
    }
  });
  used.add(EDITOR_SLOT);
  used.add(TEMP_SAMPLE_SLOT);
  return used;
};

const reportSlotAllocationFailure = (params: {
  layerId: string;
  usedSlots: Set<number>;
  context: string;
}) => {
  if (process.env.NODE_ENV === 'production') {
    return;
  }
  console.error('[CC] Gradient slot allocation failed', {
    layerId: params.layerId,
    context: params.context,
    usedSlotsSize: params.usedSlots.size,
    editorReserved: params.usedSlots.has(EDITOR_SLOT),
    tempSampleReserved: params.usedSlots.has(TEMP_SAMPLE_SLOT),
  });
};

export const ensureGradientDefForStops = (params: {
  layerId: string;
  kind: 'linear' | 'concentric';
  stops: StoredStop[];
  source: GradientDefSource;
  preferredSlot?: number;
}): { def: ColorCycleGradientDefStore; slot: number; hash: string } | null => {
  const state = useAppStore.getState();
  const layer = state.layers.find((entry) => entry.id === params.layerId);
  if (!layer || layer.layerType !== 'color-cycle') {
    return null;
  }
  const colorCycleData = layer.colorCycleData ?? {};
  const frozenStops = cloneStops(params.stops);
  const hash = hashStops(frozenStops, params.kind);
  const defStore = colorCycleData.gradientDefStore ?? [];
  const existing = findDefByHash(defStore, hash);
  const existingSlot = existing?.slot;
  const slotPalettes = colorCycleData.slotPalettes ?? [];
  const usedSlots = collectUsedSlots({
    slotPalettes,
    gradientDefs: colorCycleData.gradientDefs,
    gradientDefStore: defStore,
  });
  const preferredSlot =
    typeof params.preferredSlot === 'number' ? clampSlot(params.preferredSlot) : null;

  let slot: number | null = null;
  let nextDefStore = defStore;
  let nextId = colorCycleData.nextGradientDefId ?? 1;
  let def: ColorCycleGradientDefStore;

  if (existing) {
    slot = typeof existingSlot === 'number'
      ? existingSlot
      : (preferredSlot !== null && !usedSlots.has(preferredSlot))
        ? preferredSlot
        : getNextGradientSlot(usedSlots);
    if (typeof slot !== 'number') {
      reportSlotAllocationFailure({ layerId: params.layerId, usedSlots, context: 'existing-def' });
      return null;
    }
    if (existing.slot !== slot) {
      def = { ...existing, slot };
      nextDefStore = defStore.map((entry) => (entry.id === existing.id ? def : entry));
    } else {
      def = existing;
    }
  } else {
    if (preferredSlot !== null && !usedSlots.has(preferredSlot)) {
      slot = preferredSlot;
    } else {
      slot = getNextGradientSlot(usedSlots);
    }
    if (typeof slot !== 'number') {
      reportSlotAllocationFailure({ layerId: params.layerId, usedSlots, context: 'new-def' });
      return null;
    }
    def = {
      id: nextId,
      kind: params.kind,
      stops: frozenStops,
      hash,
      source: params.source,
      createdAtMs: Date.now(),
      slot,
    };
    nextDefStore = [...defStore, def];
    nextId += 1;
  }

  const existingPalette = slotPalettes.find((entry) => entry.slot === slot);
  if (existingPalette) {
    const existingSig = signatureForStops(existingPalette.stops);
    const nextSig = signatureForStops(frozenStops);
    if (existingSig !== nextSig) {
      if (process.env.NODE_ENV !== 'production') {
        throw new Error(
          `[CC] Slot overwrite blocked: slot ${slot} has different palette (layer ${params.layerId})`
        );
      }
      return null;
    }
  }
  const hasSlotPalette = Boolean(existingPalette);
  const nextSlotPalettes = hasSlotPalette
    ? slotPalettes
    : [...slotPalettes, { slot, stops: cloneStops(frozenStops) }];

  state.updateLayer(layer.id, {
    colorCycleData: {
      ...colorCycleData,
      gradientDefStore: nextDefStore,
      nextGradientDefId: nextId,
      slotPalettes: nextSlotPalettes,
    },
  });

  return { def, slot, hash };
};
