import { useAppStore } from '@/stores/useAppStore';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import { cloneStops, getNextGradientSlot } from '@/hooks/canvas/utils/colorCycleHelpers';
import { signatureForStops } from '@/hooks/brushEngine/ccGradientRuntime';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import { quantizeColorCycleSpeed } from '@/utils/colorCycleSpeed';
import {
  allocateNextColorCycleDefId,
  normalizeNextColorCycleDefId,
} from '@/utils/colorCycleDefIds';
import {
  normalizeGradientSeamProfile,
  type GradientSeamProfile,
} from '@/lib/colorCycle/gradientSeamProfile';
import {
  rebuildGradientSlotUsageAndGC,
  rebuildOnDemandAndRetryAllocate,
  buildDefaultReservedSlots,
} from '@/utils/colorCycleSlotGC';
export type StoredStop = { position: number; color: string; opacity?: number };

export type GradientDefSource = 'manual' | 'fg' | 'sampled';

export type ColorCycleGradientDefStore = {
  id: number;
  kind: 'linear' | 'concentric';
  stops: StoredStop[];
  hash: string;
  source: GradientDefSource;
  seamProfile?: GradientSeamProfile;
  createdAtMs: number;
  slot?: number;
  speedCps?: number;
};

const EDITOR_SLOT = 255;

const clampSlot = (slot: number): number => Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(slot)));

const haveMatchingStops = (left: StoredStop[], right: StoredStop[]): boolean =>
  signatureForStops(left) === signatureForStops(right);

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
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') {
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

const reportDefIdAllocationFailure = (layerId: string) => {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') {
    return;
  }
  console.error('[CC] Gradient def id allocation failed', { layerId });
};

const runProjectSlotRebuild = (layerId: string) => {
  const state = useAppStore.getState();
  const result = rebuildGradientSlotUsageAndGC({
    layers: state.layers,
    scope: 'project',
    reservedSlots: buildDefaultReservedSlots(),
  });
  if (!result) {
    return null;
  }
  if (result.missingDefLayers && result.missingDefLayers.length > 0) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[CC] Slot GC aborted due to missing defs', {
        layerId,
        missingDefLayers: result.missingDefLayers,
      });
    }
    return result;
  }
  result.updates.forEach((update) => {
    state.updateLayer(update.layerId, { colorCycleData: update.colorCycleData });
  });
  return result;
};

export const ensureGradientDefForStops = (params: {
  layerId: string;
  kind: 'linear' | 'concentric';
  stops: StoredStop[];
  source: GradientDefSource;
  preferredSlot?: number;
  speedCps?: number;
  seamProfile?: GradientSeamProfile;
  updateOptions?: {
    skipColorCycleSync?: boolean;
  };
}): { def: ColorCycleGradientDefStore; slot: number; hash: string } | null => {
  const attemptEnsure = (): { result: { def: ColorCycleGradientDefStore; slot: number; hash: string } | null; failure?: 'no-slot' } => {
    const state = useAppStore.getState();
    const layer = state.layers.find((entry) => entry.id === params.layerId);
    if (!layer || layer.layerType !== 'color-cycle') {
      return { result: null };
    }
    const colorCycleData = layer.colorCycleData ?? {};
    const frozenStops = cloneStops(params.stops);
    const hash = hashStops(frozenStops, params.kind);
    const defStore = colorCycleData.gradientDefStore ?? [];
    const incomingSpeed = Number.isFinite(params.speedCps) ? params.speedCps : null;
    const incomingSpeedQ = quantizeColorCycleSpeed(incomingSpeed);
    const incomingSeamProfile = normalizeGradientSeamProfile(params.seamProfile);
    const matchesSpeed = (entry: ColorCycleGradientDefStore): boolean => {
      if (incomingSpeedQ === null) {
        return !Number.isFinite(entry.speedCps ?? NaN);
      }
      const entryQ = quantizeColorCycleSpeed(entry.speedCps);
      if (entryQ === null) {
        return false;
      }
      return Math.abs(entryQ - incomingSpeedQ) <= 1e-6;
    };
    const matchesSeamProfile = (entry: ColorCycleGradientDefStore): boolean =>
      normalizeGradientSeamProfile(entry.seamProfile) === incomingSeamProfile;
    const existing = defStore.find(
      (entry) => entry.hash === hash && matchesSpeed(entry) && matchesSeamProfile(entry)
    ) ?? null;
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
    let nextId = normalizeNextColorCycleDefId(
      defStore.map((entry) => entry.id),
      colorCycleData.nextGradientDefId ?? 1
    );
    let def: ColorCycleGradientDefStore;

    if (existing) {
      slot = typeof existingSlot === 'number'
        ? existingSlot
        : (preferredSlot !== null && !usedSlots.has(preferredSlot))
          ? preferredSlot
          : getNextGradientSlot(usedSlots);
      if (typeof slot !== 'number') {
        reportSlotAllocationFailure({ layerId: params.layerId, usedSlots, context: 'existing-def' });
        return { result: null, failure: 'no-slot' };
      }
      const nextSpeed = incomingSpeed !== null ? incomingSpeed : existing.speedCps;
      if (
        existing.slot !== slot ||
        (incomingSpeed !== null && existing.speedCps !== nextSpeed) ||
        normalizeGradientSeamProfile(existing.seamProfile) !== incomingSeamProfile
      ) {
        def = { ...existing, slot, speedCps: nextSpeed, seamProfile: incomingSeamProfile };
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
        return { result: null, failure: 'no-slot' };
      }
      const allocation = allocateNextColorCycleDefId({
        ids: defStore.map((entry) => entry.id),
        nextId,
      });
      if (allocation.id === null) {
        reportDefIdAllocationFailure(params.layerId);
        return { result: null };
      }
      nextId = allocation.nextGradientDefId;
      def = {
        id: allocation.id,
        kind: params.kind,
        stops: frozenStops,
        hash,
        source: params.source,
        seamProfile: incomingSeamProfile,
        createdAtMs: Date.now(),
        slot,
        speedCps: incomingSpeed ?? undefined,
      };
      nextDefStore = [...defStore, def];
    }

    const existingPalette = slotPalettes.find((entry) => entry.slot === slot);
    const nextSig = signatureForStops(frozenStops);
    const existingSig = existingPalette ? signatureForStops(existingPalette.stops) : null;
    const canHealExistingDefPalette =
      Boolean(existing) &&
      existing?.slot === slot &&
      existing?.hash === hash &&
      existingSig !== null &&
      existingSig !== nextSig;
    if (existingPalette && existingSig !== nextSig && !canHealExistingDefPalette) {
      if (process.env.NODE_ENV !== 'production') {
        throw new Error(
          `[CC] Slot overwrite blocked: slot ${slot} has different palette (layer ${params.layerId})`
        );
      }
      return { result: null };
    }
    const hasSlotPalette = Boolean(existingPalette);
    const paletteAlreadyMatches = Boolean(existingPalette && haveMatchingStops(existingPalette.stops, frozenStops));
    const nextSlotPalettes = hasSlotPalette
      ? paletteAlreadyMatches
        ? slotPalettes
        : slotPalettes.map((entry) =>
            entry.slot === slot
              ? { slot, stops: cloneStops(frozenStops) }
              : entry
          )
      : [...slotPalettes, { slot, stops: cloneStops(frozenStops) }];
    const nextNextGradientDefId = normalizeNextColorCycleDefId(
      nextDefStore.map((entry) => entry.id),
      nextId
    );
    const didChangeStore =
      nextDefStore !== defStore ||
      nextSlotPalettes !== slotPalettes ||
      nextNextGradientDefId !== (colorCycleData.nextGradientDefId ?? 1);

    if (didChangeStore) {
      state.updateLayer(layer.id, {
        colorCycleData: {
          ...colorCycleData,
          gradientDefStore: nextDefStore,
          nextGradientDefId: nextNextGradientDefId,
          slotPalettes: nextSlotPalettes,
        },
      }, params.updateOptions);
    }

    return { result: { def, slot, hash } };
  };

  const initial = attemptEnsure();
  if (initial.result) {
    return initial.result;
  }
  if (initial.failure !== 'no-slot') {
    return null;
  }

  let retryResult: { def: ColorCycleGradientDefStore; slot: number; hash: string } | null = null;
  rebuildOnDemandAndRetryAllocate({
    attemptAllocate: () => {
      const retry = attemptEnsure();
      if (retry.result) {
        retryResult = retry.result;
        return retry.result.slot;
      }
      return null;
    },
    runRebuild: () => runProjectSlotRebuild(params.layerId),
    throttleKey: `cc-slot-rebuild:${params.layerId}`,
    throttleMs: process.env.NODE_ENV === 'test' ? 0 : undefined,
  });

  return retryResult;
};
