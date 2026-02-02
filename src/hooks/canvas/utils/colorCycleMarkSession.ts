import { useAppStore } from '@/stores/useAppStore';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import { cloneStops, getNextGradientSlot, resolveActiveColorCycleGradient } from '@/hooks/canvas/utils/colorCycleHelpers';
import {
  ensureGradientDefForStops,
  hashStops,
  type StoredStop,
  type GradientDefSource,
} from '@/utils/colorCycleGradientDefs';
import { TEMP_SAMPLE_SLOT } from '@/hooks/canvas/handlers/colorCycle/ccGradientSampling';
import { ccLog, ccWarn } from '@/utils/colorCycle/ccDebug';

export type MarkGradientSession = {
  markId: string;
  layerId: string;
  markKind: 'stroke' | 'shape';
  gradientKind: 'linear' | 'concentric';
  source: GradientDefSource;
  frozenStopsStored: StoredStop[];
  frozenHash: string;
  binding: { kind: 'def'; defId: number; slot: number } | null;
  previewStopsStored?: StoredStop[] | null;
  previewHash?: string;
  fallbackStopsStored?: StoredStop[];
  previewSlot?: number;
  samples?: Array<{ t01: number; rgba: [number, number, number, number] }>;
};

export type PreviewGradientResult = {
  source: GradientDefSource | 'fallback';
  phase: 'frozen' | 'sampling' | 'final';
  stopsStored: StoredStop[];
  defIdPlanned?: number;
};

const sessionsByLayer = new Map<string, MarkGradientSession>();
let markSessionPointerDownRef: { current: boolean } | null = null;
let isFinalizingSession = false;

export const registerMarkGradientPointerDownRef = (
  ref: { current: boolean } | null
): void => {
  markSessionPointerDownRef = ref;
};
let markCounter = 0;

const nextMarkId = () => {
  markCounter += 1;
  return `cc-mark-${markCounter}`;
};

const clampSlot = (slot: number): number => Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(slot)));

const collectUsedSlots = (layer: {
  colorCycleData?: {
    slotPalettes?: Array<{ slot: number }>;
    gradientDefs?: Array<{ currentSlot: number }>;
    gradientDefStore?: Array<{ slot?: number }>;
  } | null;
} | null | undefined): Set<number> => {
  const used = new Set<number>();
  if (!layer?.colorCycleData) {
    return used;
  }
  layer.colorCycleData.slotPalettes?.forEach((entry) => used.add(clampSlot(entry.slot)));
  layer.colorCycleData.gradientDefs?.forEach((entry) => used.add(clampSlot(entry.currentSlot)));
  layer.colorCycleData.gradientDefStore?.forEach((entry) => {
    if (typeof entry.slot === 'number') {
      used.add(clampSlot(entry.slot));
    }
  });
  used.add(63);
  return used;
};

const resolveSampledPreviewSlot = (layer: {
  colorCycleData?: {
    slotPalettes?: Array<{ slot: number }>;
    gradientDefs?: Array<{ currentSlot: number }>;
    gradientDefStore?: Array<{ slot?: number }>;
  } | null;
} | null | undefined): number => {
  const used = collectUsedSlots(layer);
  if (!used.has(TEMP_SAMPLE_SLOT)) {
    return TEMP_SAMPLE_SLOT;
  }
  const picked = getNextGradientSlot(used);
  return typeof picked === 'number' ? picked : 0;
};

const finalizeSampledSession = (session: MarkGradientSession): void => {
  const fallbackStops =
    session.fallbackStopsStored?.length ? session.fallbackStopsStored : session.frozenStopsStored;
  const sampledStops =
    session.previewStopsStored && session.previewStopsStored.length >= 2
      ? session.previewStopsStored
      : null;
  const finalStops = sampledStops ?? fallbackStops;
  session.frozenStopsStored = cloneStops(finalStops);
  session.frozenHash = hashStops(session.frozenStopsStored, session.gradientKind);

  if (!session.binding) {
    const defResult = ensureGradientDefForStops({
      layerId: session.layerId,
      kind: session.gradientKind,
      stops: session.frozenStopsStored,
      source: session.source,
      preferredSlot: session.previewSlot,
    });
    if (defResult) {
      session.binding = { kind: 'def', defId: defResult.def.id, slot: defResult.slot };
      session.previewSlot = clampSlot(defResult.slot);
    }
  }
};

export const beginMarkGradientSession = (params: {
  layerId: string;
  markKind: 'stroke' | 'shape';
  gradientKind: 'linear' | 'concentric';
  source: GradientDefSource;
  stops: StoredStop[];
}): MarkGradientSession | null => {
  if (process.env.NODE_ENV !== 'production' && isFinalizingSession) {
    throw new Error('[CC] beginMarkGradientSession called during finalize/commit');
  }
  if (process.env.NODE_ENV !== 'production' && sessionsByLayer.has(params.layerId)) {
    throw new Error(`[CC] beginMarkGradientSession called while a session is active for ${params.layerId}`);
  }
  const state = useAppStore.getState();
  const layer = state.layers.find((entry) => entry.id === params.layerId);
  if (!layer || layer.layerType !== 'color-cycle') {
    return null;
  }
  const frozenStops = cloneStops(params.stops);
  if (params.source === 'sampled') {
    const session: MarkGradientSession = {
      markId: nextMarkId(),
      layerId: params.layerId,
      markKind: params.markKind,
      gradientKind: params.gradientKind,
      source: params.source,
      frozenStopsStored: frozenStops,
      frozenHash: '',
      binding: null,
      previewStopsStored: null,
      previewHash: '',
      fallbackStopsStored: cloneStops(frozenStops),
      previewSlot: clampSlot(resolveSampledPreviewSlot(layer)),
      samples: [],
    };
    sessionsByLayer.set(params.layerId, session);
    ccLog('begin session', {
      markId: session.markId,
      layerId: params.layerId,
      source: params.source,
      kind: params.gradientKind,
      stopsLen: params.stops?.length ?? 0,
      previewSlot: typeof session.previewSlot === 'number' ? clampSlot(session.previewSlot) : null,
    });
    ccLog('mark slot (during)', {
      layerId: params.layerId,
      markId: session.markId,
      defId: session.binding?.defId ?? null,
      slot:
        session.binding?.slot ??
        (typeof session.previewSlot === 'number' ? clampSlot(session.previewSlot) : null),
      phase: session.binding ? 'bound' : 'sampling',
    });
    ccLog('begin session stack', new Error('[CC] begin session stack').stack ?? null);
    return session;
  }

  const defResult = ensureGradientDefForStops({
    layerId: params.layerId,
    kind: params.gradientKind,
    stops: frozenStops,
    source: params.source,
  });
  if (!defResult) {
    return null;
  }

  const session: MarkGradientSession = {
    markId: nextMarkId(),
    layerId: params.layerId,
    markKind: params.markKind,
    gradientKind: params.gradientKind,
    source: params.source,
    frozenStopsStored: frozenStops,
    frozenHash: defResult.hash,
    binding: { kind: 'def', defId: defResult.def.id, slot: defResult.slot },
  };
  sessionsByLayer.set(params.layerId, session);
  ccLog('begin session', {
    markId: session.markId,
    layerId: params.layerId,
    source: params.source,
    kind: params.gradientKind,
    stopsLen: params.stops?.length ?? 0,
    defId: session.binding?.defId,
    slot: session.binding?.slot,
  });
  ccLog('mark slot (during)', {
    layerId: params.layerId,
    markId: session.markId,
    defId: session.binding?.defId ?? null,
    slot: session.binding?.slot ?? null,
    phase: session.binding ? 'bound' : 'sampling',
  });
  ccLog('begin session stack', new Error('[CC] begin session stack').stack ?? null);
  return session;
};

export const getActiveMarkGradientSession = (layerId: string): MarkGradientSession | null =>
  sessionsByLayer.get(layerId) ?? null;

export const finalizeMarkGradientSession = (layerId: string): MarkGradientSession | null => {
  const session = sessionsByLayer.get(layerId) ?? null;
  ccLog('finalize session', { layerId, markId: session?.markId });
  if (process.env.NODE_ENV !== 'production') {
    isFinalizingSession = true;
  }
  try {
    if (session?.source === 'sampled') {
      finalizeSampledSession(session);
    }
    if (session) {
      ccLog('mark slot (finalized)', {
        layerId,
        markId: session.markId,
        defId: session.binding?.defId ?? null,
        slot:
          session.binding?.slot ??
          (typeof session.previewSlot === 'number' ? clampSlot(session.previewSlot) : null),
        phase: session.binding ? 'bound' : 'sampling',
      });
    }
    sessionsByLayer.delete(layerId);
    return session;
  } finally {
    if (process.env.NODE_ENV !== 'production') {
      isFinalizingSession = false;
    }
  }
};

export const cancelMarkGradientSession = (layerId: string): void => {
  if (markSessionPointerDownRef?.current) {
    ccWarn('cancel during active mark', { layerId, stack: new Error().stack ?? null });
    return;
  }
  ccWarn('cancel session', { layerId, stack: new Error().stack ?? null });
  sessionsByLayer.delete(layerId);
};

export const getPreviewGradientForActiveMark = (layerId: string): PreviewGradientResult | null => {
  const session = sessionsByLayer.get(layerId);
  if (session) {
    if (session.source === 'sampled') {
      const sampledStops =
        session.previewStopsStored && session.previewStopsStored.length >= 2
          ? session.previewStopsStored
          : null;
      const fallbackStops =
        session.fallbackStopsStored?.length ? session.fallbackStopsStored : session.frozenStopsStored;
      const stops = sampledStops ?? fallbackStops;
      if (process.env.NODE_ENV !== 'production') {
        ccLog('preview', {
          markId: session.markId,
          layerId,
          source: sampledStops ? 'sampled' : 'fallback',
          phase: session.binding ? 'final' : 'sampling',
          stopsLen: stops.length,
        });
        if (!stops || stops.length < 2) {
          throw new Error('[CC] Sampled preview produced <2 stops');
        }
      }
      return {
        source: sampledStops ? 'sampled' : 'fallback',
        phase: session.binding ? 'final' : 'sampling',
        stopsStored: cloneStops(stops),
        defIdPlanned: session.binding?.defId,
      };
    }
    return {
      source: session.source,
      phase: 'frozen',
      stopsStored: cloneStops(session.frozenStopsStored),
      defIdPlanned: session.binding?.defId,
    };
  }

  const state = useAppStore.getState();
  const layer = state.layers.find((entry) => entry.id === layerId);
  if (!layer || layer.layerType !== 'color-cycle') {
    return null;
  }
  const resolved = resolveActiveColorCycleGradient(layer, state.tools.brushSettings, {
    fgColorHex: state.palette.foregroundColor,
    fgLightness: state.tools.brushSettings.colorCycleFgLightness,
    fgVariance: state.tools.brushSettings.colorCycleFgVariance,
    fgHueShift: state.tools.brushSettings.colorCycleFgHueShift,
    fgSaturationShift: state.tools.brushSettings.colorCycleFgSaturationShift,
    fgOpacity: state.tools.brushSettings.colorCycleFgOpacity,
    fgStops: state.tools.brushSettings.colorCycleFgStops,
  });
  return {
    source: 'fallback',
    phase: 'final',
    stopsStored: cloneStops(resolved.activeStops),
  };
};
