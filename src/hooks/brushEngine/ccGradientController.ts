import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { requestGradientApply } from './ccGradientApplyScheduler';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';

export type GradientStop = { position: number; color: string };

type GradientDef = { id: string; name?: string; currentSlot: number };

type SlotPalette = { slot: number; stops: GradientStop[] };

type GradientEditIntent = 'preview' | 'commitFuture' | 'commitRecolor';

const EDITOR_SLOT = 255;

const clampSlot = (slot: number): number => Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(slot)));

const cloneStops = (stops: GradientStop[]): GradientStop[] =>
  stops.map((stop) => ({ position: stop.position, color: stop.color }));

const collectUsedSlots = (defs: GradientDef[], palettes: SlotPalette[]): Set<number> => {
  const used = new Set<number>();
  palettes.forEach((entry) => used.add(clampSlot(entry.slot)));
  defs.forEach((entry) => used.add(clampSlot(entry.currentSlot)));
  used.add(EDITOR_SLOT);
  used.add(TEMP_SAMPLE_SLOT);
  return used;
};

const pickAvailableSlot = (used: Set<number>): number | null => {
  for (let slot = 0; slot <= FLOW_SLOT_MASK; slot += 1) {
    if (slot === EDITOR_SLOT) {
      continue;
    }
    if (!used.has(slot)) {
      return slot;
    }
  }
  return null;
};

const resolveActiveDef = (defs: GradientDef[], activeId: string | undefined): GradientDef => {
  return defs.find((entry) => entry.id === activeId) ?? defs[0] ?? { id: 'g0', currentSlot: 0 };
};

const normalizeDefs = (defs: GradientDef[]): GradientDef[] =>
  defs.map((entry, index) => ({
    id: entry.id ?? `g${index}`,
    name: entry.name,
    currentSlot: clampSlot(entry.currentSlot),
  }));

const normalizePalettes = (palettes: SlotPalette[]): SlotPalette[] =>
  palettes.map((entry) => ({
    slot: clampSlot(entry.slot),
    stops: cloneStops(entry.stops),
  }));

export const applyGradientEdit = (params: {
  stops: GradientStop[];
  layerId?: string;
  intent?: GradientEditIntent;
}): void => {
  const state = useAppStore.getState();
  const targetLayerId = params.layerId ?? state.activeLayerId;
  if (!targetLayerId) {
    return;
  }
  const layer = state.layers.find((entry) => entry.id === targetLayerId);
  if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return;
  }
  if (layer.colorCycleData.recolorSettings) {
    return;
  }

  const intent: GradientEditIntent = params.intent ?? 'commitRecolor';
  const gradientDefs = normalizeDefs(layer.colorCycleData.gradientDefs ?? [{ id: 'g0', currentSlot: 0 }]);
  let slotPalettes = normalizePalettes(layer.colorCycleData.slotPalettes ?? []);
  const activeGradientId = layer.colorCycleData.activeGradientId ?? gradientDefs[0].id;
  let activeDef = resolveActiveDef(gradientDefs, activeGradientId);
  const paintSlot = layer.colorCycleData.paintSlot ?? activeDef.currentSlot;

  if (intent === 'preview') {
    state.updateLayer(targetLayerId, {
      colorCycleData: {
        ...layer.colorCycleData,
        gradient: cloneStops(params.stops),
      },
    });
    return;
  }

  if (intent === 'commitFuture') {
    const used = collectUsedSlots(gradientDefs, slotPalettes);
    const nextSlot = pickAvailableSlot(used);
    if (nextSlot !== null) {
      gradientDefs.splice(0, gradientDefs.length, ...gradientDefs.map((entry) =>
        entry.id === activeDef.id ? { ...entry, currentSlot: nextSlot } : entry
      ));
      activeDef = { ...activeDef, currentSlot: nextSlot };
      const hasSlot = slotPalettes.some((entry) => entry.slot === nextSlot);
      slotPalettes = hasSlot
        ? slotPalettes.map((entry) =>
            entry.slot === nextSlot
              ? { slot: nextSlot, stops: cloneStops(params.stops) }
              : entry
          )
        : [...slotPalettes, { slot: nextSlot, stops: cloneStops(params.stops) }];
      state.updateLayer(targetLayerId, {
        colorCycleData: {
          ...layer.colorCycleData,
          gradientDefs,
          slotPalettes,
          activeGradientId: activeDef.id,
          paintSlot: nextSlot,
          gradient: cloneStops(params.stops),
        },
      });
      requestGradientApply(targetLayerId, 'commit-future');
    }
    return;
  }

  // commitRecolor
  const targetSlot = paintSlot === EDITOR_SLOT ? 0 : clampSlot(paintSlot);
  const hasSlot = slotPalettes.some((entry) => entry.slot === targetSlot);
  slotPalettes = hasSlot
    ? slotPalettes.map((entry) =>
        entry.slot === targetSlot
          ? { slot: targetSlot, stops: cloneStops(params.stops) }
          : entry
      )
    : [...slotPalettes, { slot: targetSlot, stops: cloneStops(params.stops) }];

  state.updateLayer(targetLayerId, {
    colorCycleData: {
      ...layer.colorCycleData,
      gradientDefs,
      slotPalettes,
      activeGradientId: activeDef.id,
      paintSlot: targetSlot,
      gradient: cloneStops(params.stops),
    },
  });
  requestGradientApply(targetLayerId, 'commit-recolor');
};

export const setActiveGradientId = (layerId: string, gradientId: string): void => {
  const state = useAppStore.getState();
  const layer = state.layers.find((entry) => entry.id === layerId);
  if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return;
  }
  const defs = normalizeDefs(layer.colorCycleData.gradientDefs ?? []);
  if (defs.length === 0) {
    return;
  }
  const def = resolveActiveDef(defs, gradientId);
  const paintSlot = def.currentSlot === EDITOR_SLOT ? 0 : clampSlot(def.currentSlot);
  state.updateLayer(layerId, {
    colorCycleData: {
      ...layer.colorCycleData,
      gradientDefs: defs,
      activeGradientId: def.id,
      paintSlot,
    },
  });
  requestGradientApply(layerId, 'select-gradient');
};

export const ensurePaintSlotPalette = (layer: Layer, fallbackStops: GradientStop[]): void => {
  if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return;
  }
  const paintSlot = clampSlot(layer.colorCycleData.paintSlot ?? 0);
  const slotPalettes = normalizePalettes(layer.colorCycleData.slotPalettes ?? []);
  const hasSlot = slotPalettes.some((entry) => entry.slot === paintSlot);
  if (hasSlot) {
    return;
  }
  useAppStore.getState().updateLayer(layer.id, {
    colorCycleData: {
      ...layer.colorCycleData,
      slotPalettes: [...slotPalettes, { slot: paintSlot, stops: cloneStops(fallbackStops) }],
    },
  });
};
