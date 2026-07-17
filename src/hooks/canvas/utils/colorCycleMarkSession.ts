import { getAppStoreState } from '@/stores/appStoreAccess';
import type { AppState } from '@/stores/useAppStore';
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
import {
  applyCcSampledRangeContrast as applyCcGradientContrast,
} from '@/utils/colorCycle/ccSampledRangeContrast';
import { ccWarn } from '@/utils/colorCycle/ccDebug';
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
  rawStopsStored?: StoredStop[];
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
  rangeContrast?: number;
  algorithm?: AppState['tools']['brushSettings']['ditherAlgorithm'];
};

export type PreviewGradientResult = {
  source: GradientDefSource | 'fallback';
  phase: 'frozen' | 'sampling' | 'final';
  stopsStored: StoredStop[];
  defIdPlanned?: number;
};

const sessionsByLayer = new Map<string, MarkGradientSession>();
const sampledTempSlotStateByLayer = new Map<string, 'clean' | 'abandoned'>();
let markSessionPointerDownRef: { current: boolean } | null = null;
let isFinalizingSession = false;

/**
 * Unknown layers are reconciled once before their first sampled shape commit.
 * A cancelled sampled mark invalidates that ownership until its temp pixels are discarded.
 */
export const needsSampledTempSlotReconciliation = (layerId: string): boolean =>
  sampledTempSlotStateByLayer.get(layerId) !== 'clean';

export const markSampledTempSlotReconciled = (layerId: string): void => {
  sampledTempSlotStateByLayer.set(layerId, 'clean');
};

export const __resetSampledTempSlotOwnershipForTests = (): void => {
  sampledTempSlotStateByLayer.clear();
};

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
  const liveGradientContrast = getAppStoreState().tools.brushSettings.ccGradientRangeContrast;
  session.rawStopsStored = cloneStops(finalStops);
  session.frozenStopsStored = resolveMarkSessionRuntimeStops(
    session,
    session.rawStopsStored,
    { rangeContrast: liveGradientContrast },
  );
  session.frozenHash = hashStops(session.frozenStopsStored, session.gradientKind);

  if (!session.binding) {
    const defResult = ensureGradientDefForStops({
      layerId: session.layerId,
      kind: session.gradientKind,
      stops: session.frozenStopsStored,
      source: session.source,
      speedCps: session.speedCps ?? undefined,
      seamProfile: session.seamProfile,
      updateOptions: { skipColorCycleSync: true },
    });
    if (defResult) {
      session.binding = { kind: 'def', defId: defResult.def.id, slot: defResult.slot };
    }
  }
};

export const captureFrozenCcDitherRenderConfig = (): FrozenCcDitherRenderConfig => {
  const brushSettings = getAppStoreState().tools.brushSettings;
  const mode = resolveCcDitherBandMode(brushSettings.gradientBands ?? 16);
  const config = {
    // Flat-cycle strokes write smooth indices, so their LUT must stay the base
    // gradient; the pair-band render palette would remap them into ripples.
    enabled: Boolean(brushSettings.ditherEnabled) && brushSettings.ccFlatCycleDither !== true,
    pairBandCount: mode.pairBandCount,
    spread: brushSettings.ditherPaletteSpread,
    rangeContrast: brushSettings.ccGradientRangeContrast,
    algorithm: brushSettings.ditherAlgorithm,
  };
  return config;
};

export const resolveMarkSessionRuntimeStops = (
  session: Pick<MarkGradientSession, 'ditherRenderConfig' | 'source'> | null | undefined,
  stops: StoredStop[],
  liveOverrides?: {
    enabled?: boolean;
    pairBandCount?: number;
    spread?: number;
    rangeContrast?: number;
    algorithm?: AppState['tools']['brushSettings']['ditherAlgorithm'];
  },
): StoredStop[] => {
  const clonedStops = cloneStops(stops);
  const config = session?.ditherRenderConfig;
  const enabled = liveOverrides?.enabled ?? config?.enabled ?? false;
  const contrastStops = applyCcGradientContrast(
    clonedStops,
    liveOverrides?.rangeContrast ?? config?.rangeContrast,
  );
  if (!enabled) {
    return contrastStops;
  }
  const bands = liveOverrides?.pairBandCount ?? config?.pairBandCount ?? 0;
  const spread = liveOverrides?.spread ?? config?.spread;
  const algorithm = liveOverrides?.algorithm ?? config?.algorithm;
  const preserveSourceStops =
    bands <= 0 &&
    algorithm === 'sierra-lite' &&
    session?.source !== 'sampled';
  const runtimeStops = buildCcDitherRuntimePalette({
    baseStops: contrastStops,
    bands,
    spread,
    algorithm,
    preserveSourceStops,
    debugContext: session?.source === 'sampled' ? 'runtime-snapshot-sampled' : undefined,
  }).renderStops;
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
  const state = getAppStoreState();
  const layer = state.layers.find((entry) => entry.id === params.layerId);
  if (!layer || layer.layerType !== 'color-cycle') {
    return null;
  }
  const sampledSoftSeamEnabled = state.tools.brushSettings.ccSampledSoftSeamEnabled !== false;
  const seamProfile: GradientSeamProfile =
    params.source === 'sampled' && sampledSoftSeamEnabled ? 'soft' : 'hard';
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
      rawStopsStored: cloneStops(frozenStops),
      frozenStopsStored: frozenStops,
      frozenHash: '',
      binding: null,
      speedCps: params.speedCps,
      previewStopsStored: null,
      previewHash: '',
      fallbackStopsStored: [],
      samples: [],
      ditherRenderConfig,
    };
    sessionsByLayer.set(params.layerId, session);
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
    updateOptions: { skipColorCycleSync: true },
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
    rawStopsStored: frozenStops,
    frozenStopsStored: runtimeStops,
    frozenHash: defResult.hash,
    binding: { kind: 'def', defId: defResult.def.id, slot: defResult.slot },
    speedCps: params.speedCps,
    ditherRenderConfig,
  };
  sessionsByLayer.set(params.layerId, session);
  return session;
};

export const getActiveMarkGradientSession = (layerId: string): MarkGradientSession | null =>
  sessionsByLayer.get(layerId) ?? null;

export const finalizeMarkGradientSession = (layerId: string): MarkGradientSession | null => {
  const session = sessionsByLayer.get(layerId) ?? null;
  if (process.env.NODE_ENV !== 'production') {
    isFinalizingSession = true;
  }
  try {
    if (session?.source === 'sampled') {
      finalizeSampledSession(session);
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
  if (sessionsByLayer.get(layerId)?.source === 'sampled') {
    sampledTempSlotStateByLayer.set(layerId, 'abandoned');
  }
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
      if (!sampledStops) {
        ccWarn('sampled preview missing sampled stops', {
          layerId,
          markId: session.markId,
          hasPreviewStopsStored: Boolean(session.previewStopsStored?.length),
          previewStopsLen: session.previewStopsStored?.length ?? 0,
          fallbackStopsLen: session.fallbackStopsStored?.length ?? 0,
          frozenStopsLen: session.frozenStopsStored?.length ?? 0,
        });
        return null;
      }
      return {
        source: 'sampled',
        phase: session.binding ? 'final' : 'sampling',
        stopsStored: applyCcGradientContrast(
          sampledStops,
          getAppStoreState().tools.brushSettings.ccGradientRangeContrast ??
            session.ditherRenderConfig?.rangeContrast,
        ),
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

  const state = getAppStoreState();
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
