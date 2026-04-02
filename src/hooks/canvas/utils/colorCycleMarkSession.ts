import { useAppStore } from '@/stores/useAppStore';
import {
  cloneStops,
  resolveActiveColorCycleGradient,
} from '@/hooks/canvas/utils/colorCycleHelpers';
import {
  buildCcDitherRuntimePalette,
  resolveCcDitherBandMode,
} from '@/utils/colorCycle/ccDitherRenderPalette';
import {
  ensureGradientDefForStops,
  hashStops,
  type StoredStop,
  type GradientDefSource,
} from '@/utils/colorCycleGradientDefs';
import { ccLog, ccWarn } from '@/utils/colorCycle/ccDebug';
import {
  type GradientSeamProfile,
} from '@/lib/colorCycle/gradientSeamProfile';

export type MarkGradientSession = {
  markId: string;
  layerId: string;
  markKind: 'stroke' | 'shape';
  gradientKind: 'linear' | 'concentric';
  source: GradientDefSource;
  seamProfile?: GradientSeamProfile;
  frozenStopsStored: StoredStop[];
  frozenHash: string;
  binding: { kind: 'def'; defId: number; slot: number } | null;
  speedCps?: number | null;
  previewStopsStored?: StoredStop[] | null;
  previewHash?: string;
  fallbackStopsStored?: StoredStop[];
  samples?: Array<{ t01: number; rgba: [number, number, number, number] }>;
  ditherRenderConfig?: FrozenCcDitherRenderConfig;
};

export type FrozenCcDitherRenderConfig = {
  enabled: boolean;
  pairBandCount: number;
  spread?: number;
  algorithm?: ReturnType<typeof useAppStore.getState>['tools']['brushSettings']['ditherAlgorithm'];
};

export type PreviewGradientResult = {
  source: GradientDefSource | 'fallback';
  phase: 'frozen' | 'sampling' | 'final';
  stopsStored: StoredStop[];
  defIdPlanned?: number;
};

const summarizeStopsForDebug = (stops: StoredStop[] | null | undefined) =>
  (stops ?? []).slice(0, 8).map((stop) => ({
    p: Number(stop.position.toFixed(3)),
    c: stop.color,
  }));

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
    const runtimeStops = resolveMarkSessionRuntimeStops(session, session.frozenStopsStored);
    const defResult = ensureGradientDefForStops({
      layerId: session.layerId,
      kind: session.gradientKind,
      stops: runtimeStops,
      source: session.source,
      speedCps: session.speedCps ?? undefined,
      seamProfile: session.seamProfile,
    });
    if (defResult) {
      session.binding = { kind: 'def', defId: defResult.def.id, slot: defResult.slot };
    }
  }
};

export const captureFrozenCcDitherRenderConfig = (): FrozenCcDitherRenderConfig => {
  const brushSettings = useAppStore.getState().tools.brushSettings;
  const mode = resolveCcDitherBandMode(brushSettings.gradientBands ?? 16);
  return {
    enabled: Boolean(brushSettings.ditherEnabled),
    pairBandCount: mode.pairBandCount,
    spread: brushSettings.ditherPaletteSpread,
    algorithm: brushSettings.ditherAlgorithm,
  };
};

export const resolveMarkSessionRuntimeStops = (
  session: Pick<MarkGradientSession, 'ditherRenderConfig' | 'source'> | null | undefined,
  stops: StoredStop[],
  liveOverrides?: {
    enabled?: boolean;
    pairBandCount?: number;
    spread?: number;
    algorithm?: ReturnType<typeof useAppStore.getState>['tools']['brushSettings']['ditherAlgorithm'];
  },
): StoredStop[] => {
  const clonedStops = cloneStops(stops);
  const config = session?.ditherRenderConfig;
  const enabled = liveOverrides?.enabled ?? config?.enabled ?? false;
  if (!enabled) {
    ccLog('runtime stops bypass dither', {
      enabled,
      inCount: clonedStops.length,
      inStops: summarizeStopsForDebug(clonedStops),
    });
    return clonedStops;
  }
  const bands = liveOverrides?.pairBandCount ?? config?.pairBandCount ?? 0;
  const spread = liveOverrides?.spread ?? config?.spread;
  const algorithm = liveOverrides?.algorithm ?? config?.algorithm;
  const preserveSourceStops =
    session?.source !== 'sampled' &&
    bands <= 0 &&
    algorithm === 'sierra-lite';
  const runtimeStops = buildCcDitherRuntimePalette({
    baseStops: clonedStops,
    bands,
    spread,
    algorithm,
    preserveSourceStops,
  }).renderStops;
  ccLog('runtime stops rebuild', {
    enabled,
    bands,
    spread,
    algorithm,
    source: session?.source ?? null,
    preserveSourceStops,
    inCount: clonedStops.length,
    outCount: runtimeStops.length,
    inStops: summarizeStopsForDebug(clonedStops),
    outStops: summarizeStopsForDebug(runtimeStops),
  });
  return runtimeStops;
};

export const beginMarkGradientSession = (params: {
  layerId: string;
  markKind: 'stroke' | 'shape';
  gradientKind: 'linear' | 'concentric';
  source: GradientDefSource;
  stops: StoredStop[];
  speedCps?: number;
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
  const seamProfile: GradientSeamProfile = 'hard';
  const frozenStops = cloneStops(params.stops);
  const ditherRenderConfig = captureFrozenCcDitherRenderConfig();
  if (params.source === 'sampled') {
    const session: MarkGradientSession = {
      markId: nextMarkId(),
      layerId: params.layerId,
      markKind: params.markKind,
      gradientKind: params.gradientKind,
      source: params.source,
      seamProfile,
      frozenStopsStored: frozenStops,
      frozenHash: '',
      binding: null,
      speedCps: params.speedCps,
      previewStopsStored: null,
      previewHash: '',
      fallbackStopsStored: cloneStops(frozenStops),
      samples: [],
      ditherRenderConfig,
    };
    sessionsByLayer.set(params.layerId, session);
    ccLog('begin session', {
      markId: session.markId,
      layerId: params.layerId,
      source: params.source,
      kind: params.gradientKind,
      stopsLen: params.stops?.length ?? 0,
      ditherRenderConfig,
      stops: summarizeStopsForDebug(frozenStops),
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
  }

  const runtimeStops = resolveMarkSessionRuntimeStops(
    { ditherRenderConfig, source: params.source },
    frozenStops,
  );
  const defResult = ensureGradientDefForStops({
    layerId: params.layerId,
    kind: params.gradientKind,
    stops: runtimeStops,
    source: params.source,
    speedCps: params.speedCps,
    seamProfile,
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
    seamProfile,
    frozenStopsStored: frozenStops,
    frozenHash: defResult.hash,
    binding: { kind: 'def', defId: defResult.def.id, slot: defResult.slot },
    speedCps: params.speedCps,
    ditherRenderConfig,
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
        slot: session.binding?.slot ?? null,
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
