import { useAppStore } from '@/stores/useAppStore';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import { cloneStops, getNextGradientSlot } from '@/hooks/canvas/utils/colorCycleHelpers';
import { signatureForStops } from '@/hooks/brushEngine/ccGradientRuntime';

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

const EDITOR_SLOT = 63;

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
  return used;
};

export const ensureGradientDefForStops = (params: {
  layerId: string;
  kind: 'linear' | 'concentric';
  stops: StoredStop[];
  source: GradientDefSource;
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

  let slot: number;
  let nextDefStore = defStore;
  let nextId = colorCycleData.nextGradientDefId ?? 1;
  let def: ColorCycleGradientDefStore;

  if (existing) {
    slot = typeof existingSlot === 'number' ? existingSlot : (() => {
      const picked = getNextGradientSlot(usedSlots);
      return typeof picked === 'number' ? picked : 0;
    })();
    if (existing.slot !== slot) {
      def = { ...existing, slot };
      nextDefStore = defStore.map((entry) => (entry.id === existing.id ? def : entry));
    } else {
      def = existing;
    }
  } else {
    const picked = getNextGradientSlot(usedSlots);
    slot = typeof picked === 'number' ? picked : 0;
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

  const hasSlotPalette = slotPalettes.some((entry) => entry.slot === slot);
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
