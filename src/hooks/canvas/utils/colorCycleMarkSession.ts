import { withCanvasSamplingBatch } from '@/utils/canvasSamplingBatch';
import { sampleFixedPathBands } from '@/hooks/canvas/handlers/colorCycle/sampledPathStroke';
import { ensurePalette } from '@/lib/colorCycle/paletteService';
import { buildSampledInkPalettes } from '@/hooks/canvas/handlers/colorCycle/alignSampledStroke';
import studioExtension from '@/extensions/studioExtension';
import { resolveLayerSamplingCanvas } from '@/components/canvas/resolveColorCyclePresentation';
import { type CcColourPickup } from '@/utils/colorCycle/ccColourPickup';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { getColorCycleBrushStrokeStateForOwner } from '@/lib/colorCycle/document';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import { resolveStampDitherSecondaryIndex } from '@/hooks/brushEngine/strokeStampDither';
import { buildSampledStops } from '@/hooks/canvas/handlers/colorCycle/ccSampling';
import type { AppState } from '@/stores/useAppStore';
import {
  cloneStops,
  parseCssColorToRgba,
  resolveActiveColorCycleGradient,
} from '@/hooks/canvas/utils/colorCycleHelpers';
import {
  buildCcDitherRuntimePalette,
  resolveCcDitherInkMode,
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
import { normalizeColorCycleSampledMotion } from '@/utils/colorCycleSampledMotion';
import type { ColorCycleSampledMotion } from '@/types';
import {
  applyGradientSeamProfile,
  type GradientSeamProfile,
  normalizeGradientSeamProfile,
} from '@/lib/colorCycle/gradientSeamProfile';

export type MarkGradientSession = {
  markId: string;
  colourPickup?: CcColourPickup;
  layerId: string;
  markKind: 'stroke' | 'shape';
  gradientKind: 'linear' | 'concentric';
  source: GradientDefSource;
  seamProfile?: GradientSeamProfile;
  isRuntimePalette?: boolean;
  sampledMotion?: ColorCycleSampledMotion;
  sampledAlignment?: { speedCps: number; bandPx?: number };
  sampledPathStops?: StoredStop[];
  sampledPathSecondaryStops?: StoredStop[];
  sampledPairedInks?: boolean;
  sampledBristles?: boolean;
  sampledSourceSeamProfile?: GradientSeamProfile;
  sampledPrimaryCoverage?: number;
  sampledSecondaryStops?: StoredStop[];
  rawStopsStored?: StoredStop[];
  frozenStopsStored: StoredStop[];
  frozenHash: string;
  binding: { kind: 'def'; defId: number; slot: number } | null;
  speedCps?: number | null;
  previewStopsStored?: StoredStop[] | null;
  previewHash?: string;
  fallbackStopsStored?: StoredStop[];
  samples?: Array<{ t01: number; rgba: [number, number, number, number] }>;
  sampledRepresentativeColor?: string;
  sampledStrokePoints?: Array<{ x: number; y: number }>;
  sampledStrokeColorAt?: (x: number, y: number) => string;
  ditherRenderConfig?: FrozenCcDitherRenderConfig;
};

export type FrozenCcDitherRenderConfig = {
  enabled: boolean;
  pairBandCount: number;
  spread?: number;
  rangeContrast?: number;
  algorithm?: AppState['tools']['brushSettings']['ditherAlgorithm'];
  useDitherRenderPalette?: boolean;
  fillBackground?: boolean;
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

export const resolveSampledStrokeInkPalettes = (
  session: Pick<MarkGradientSession, 'ditherRenderConfig' | 'sampledRepresentativeColor' | 'sampledPrimaryCoverage' | 'source' | 'sampledSourceSeamProfile'>,
  stops: StoredStop[],
  rangeContrast = session.ditherRenderConfig?.rangeContrast,
  retainSourceBands = false,
): ReturnType<typeof buildSampledInkPalettes> => {
  let targets = applyCcGradientContrast(stops, rangeContrast, session.sampledRepresentativeColor);
  if (targets.length > 1) {
    // Split the colours actually traversed by playback, not just authored nodes.
    // Bake the source seam before splitting: blending separate inks afterwards
    // does not preserve their linear-light mixture. Output palettes use a hard seam.
    let rgba: Uint8Array | Uint8ClampedArray;
    if (retainSourceBands) {
      rgba = new Uint8ClampedArray(targets.length * 4);
      targets.forEach((stop, i) => {
        const color = parseCssColorToRgba(stop.color);
        color[3] = Math.round(color[3] * (stop.opacity ?? 1));
        rgba.set(color, i * 4);
      });
      applyGradientSeamProfile(rgba, { paletteSize: targets.length, seamProfile: session.sampledSourceSeamProfile });
    } else {
      rgba = ensurePalette({ stops: targets, seamProfile: session.sampledSourceSeamProfile }).rgba;
    }
    const count = rgba.length / 4;
    targets = Array.from({ length: count }, (_, i) => ({
      position: i / Math.max(1, count - 1),
      color: `rgba(${rgba[i * 4]}, ${rgba[i * 4 + 1]}, ${rgba[i * 4 + 2]}, ${rgba[i * 4 + 3] / 255})`,
    }));
  }
  return buildSampledInkPalettes(targets, session.ditherRenderConfig?.spread, session.sampledPrimaryCoverage);
};

const nextMarkId = () => {
  markCounter += 1;
  return `cc-mark-${markCounter}`;
};

const finalizeSampledSession = (session: MarkGradientSession): void => {
  // Preview sampling is throttled; a short or coalesced stroke may have only
  // sampled pointer-down. The committed gradient must cover its complete path.
  if (session.markKind === 'stroke' && session.sampledStrokePoints && session.sampledStrokeColorAt) {
    const sampled = buildSampledStops({
      markKind: session.markKind,
      pickup: session.colourPickup,
      preserveSingleSampleColor: session.isRuntimePalette,
      sourcePts: session.sampledStrokePoints,
      sampleColor: session.sampledStrokeColorAt,
      allowTiny: true,
    });
    if (sampled) {
      session.previewStopsStored = sampled.stops;
      session.previewHash = hashStops(sampled.stops, session.gradientKind);
      session.samples = sampled.samples;
    }
    if (session.sampledAlignment?.bandPx && !session.sampledBristles) {
      const source = withCanvasSamplingBatch(() => sampleFixedPathBands(session.sampledStrokePoints!, session.sampledAlignment!.bandPx!, session.sampledStrokeColorAt!));
      const inks = resolveSampledStrokeInkPalettes(session, source, getAppStoreState().tools.brushSettings.ccGradientRangeContrast, true);
      session.sampledPathStops = inks.primary;
      session.sampledPathSecondaryStops = session.sampledPairedInks ? inks.secondary : undefined;
    }
    delete session.sampledStrokeColorAt;
  }
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
  if (session.sampledPairedInks) {
    const inks = resolveSampledStrokeInkPalettes(
      session,
      session.rawStopsStored,
      liveGradientContrast,
    );
    session.frozenStopsStored = inks.primary;
    session.sampledSecondaryStops = inks.secondary;
  }
  session.frozenHash = hashStops(session.frozenStopsStored, session.gradientKind);

  if (!session.binding) {
    const defResult = ensureGradientDefForStops({
      layerId: session.layerId,
      kind: session.gradientKind,
      stops: session.frozenStopsStored,
      sourceStops: session.isRuntimePalette ? undefined : session.rawStopsStored,
      source: session.source,
      speedCps: session.speedCps ?? undefined,
      seamProfile: session.seamProfile,
      sampledCapacityFallback: 'reuse-nearest-compatible',
      updateOptions: { skipColorCycleSync: true },
    });
    if (defResult) {
      if (defResult.reusedForCapacity) {
        session.rawStopsStored = cloneStops(defResult.def.stops);
        session.frozenStopsStored = cloneStops(defResult.def.stops);
        session.frozenHash = defResult.def.hash;
      }
      session.binding = { kind: 'def', defId: defResult.def.id, slot: defResult.slot };
    }
  }
};

export const captureFrozenCcDitherRenderConfig = (): FrozenCcDitherRenderConfig => {
  const brushSettings = getAppStoreState().tools.brushSettings;
  const mode = resolveCcDitherInkMode(brushSettings);
  const config = {
    // Flat-cycle strokes write smooth indices, so their LUT must stay the base
    // gradient; the pair-band render palette would remap them into ripples.
    enabled: Boolean(brushSettings.ditherEnabled),
    pairBandCount: mode.pairBandCount,
    spread: brushSettings.ditherPaletteSpread,
    rangeContrast: brushSettings.ccGradientRangeContrast,
    algorithm: brushSettings.ditherAlgorithm,
    useDitherRenderPalette: brushSettings.ccFlatCycleDither !== true,
    fillBackground:
      (brushSettings.ditherGradBgFill ?? brushSettings.ditherBackgroundFill) !== false,
  };
  return config;
};

export const resolveMarkSessionRuntimeStops = (
  session: Pick<
    MarkGradientSession,
    'ditherRenderConfig' | 'source' | 'sampledRepresentativeColor' | 'isRuntimePalette' | 'sampledPairedInks'
  > | null | undefined,
  stops: StoredStop[],
  liveOverrides?: {
    enabled?: boolean;
    pairBandCount?: number;
    spread?: number;
    rangeContrast?: number;
    algorithm?: AppState['tools']['brushSettings']['ditherAlgorithm'];
    useDitherRenderPalette?: boolean;
    fillBackground?: boolean;
  },
): StoredStop[] => {
  const clonedStops = cloneStops(stops);
  if (session?.sampledPairedInks) {
    // These inputs are raw sampled colours even though their committed output
    // is a runtime palette. Contrast must also apply while the mark is active.
    return applyCcGradientContrast(
      clonedStops,
      liveOverrides?.rangeContrast ?? session.ditherRenderConfig?.rangeContrast,
      session.sampledRepresentativeColor,
    );
  }
  if (session?.isRuntimePalette) {
    return clonedStops;
  }
  const config = session?.ditherRenderConfig;
  const enabled = liveOverrides?.enabled ?? config?.enabled ?? false;
  const contrastStops = applyCcGradientContrast(
    clonedStops,
    liveOverrides?.rangeContrast ?? config?.rangeContrast,
    session?.sampledRepresentativeColor,
  );
  if (!enabled) {
    return contrastStops;
  }
  const bands = liveOverrides?.pairBandCount ?? config?.pairBandCount ?? 0;
  const spread = liveOverrides?.spread ?? config?.spread;
  const algorithm = liveOverrides?.algorithm ?? config?.algorithm;
  const useDitherRenderPalette =
    liveOverrides?.useDitherRenderPalette ?? config?.useDitherRenderPalette ?? true;
  const preserveSourceStops =
    !useDitherRenderPalette ||
    (
      bands <= 0 &&
      algorithm === 'sierra-lite' &&
      session?.source !== 'sampled'
    );
  const runtimeStops = buildCcDitherRuntimePalette({
    baseStops: contrastStops,
    bands,
    spread,
    algorithm,
    preserveSourceStops,
    useDitherRenderPalette,
    fillBackground: liveOverrides?.fillBackground ?? config?.fillBackground,
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
  const seamProfile: GradientSeamProfile = normalizeGradientSeamProfile(
    state.tools.brushSettings.colorCycleGradientSeamProfile,
  );
  const hasSampledRuntimePalette =
    (state.tools.brushSettings.colorCyclePickupEnabled
      ? state.tools.ccGradientSource === 'manual'
      : params.source === 'manual') &&
    state.tools.brushSettings.colorCycleGradientIsRuntimePalette === true;
  const isRuntimePalette = state.tools.brushSettings.colorCyclePickupEnabled === true ||
    params.source === 'manual' && hasSampledRuntimePalette;
  const sampledMotion = hasSampledRuntimePalette
    ? normalizeColorCycleSampledMotion(state.tools.brushSettings.colorCycleSampledMotion) ?? undefined
    : undefined;
  const frozenStops = cloneStops(params.stops);
  const ditherRenderConfig = captureFrozenCcDitherRenderConfig();
  let colourPickup: CcColourPickup | undefined;
  if (state.tools.brushSettings.colorCyclePickupEnabled === true) {
    const sourceCanvas = resolveLayerSamplingCanvas(layer);
    let image: ImageData | null = null;
    if (sourceCanvas && typeof document !== 'undefined') {
      const snapshot = document.createElement('canvas');
      snapshot.width = sourceCanvas.width;
      snapshot.height = sourceCanvas.height;
      const ctx = snapshot.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(sourceCanvas, 0, 0);
        image = ctx.getImageData(0, 0, snapshot.width, snapshot.height);
      }
    }
    colourPickup = {
      image,
      sampleBase: state.tools.ccGradientSource === 'sampled',
      baseStops: resolveMarkSessionRuntimeStops({
        source: params.source,
        ditherRenderConfig,
        isRuntimePalette: state.tools.brushSettings.colorCycleGradientIsRuntimePalette === true,
      }, frozenStops),
      brushSize: state.tools.brushSettings.size,
    };
    if (params.markKind === 'stroke' && !colourPickup.sampleBase) {
      colourPickup.strokePaletteIndicesAt = (x, y) => {
        const width = state.project?.width ?? 0;
        const height = state.project?.height ?? 0;
        if (x < 0 || y < 0 || x >= width || y >= height) return [];
        const brush = getColorCycleBrushManager().getCommitBrush(params.layerId);
        if (!brush) return [];
        const stroke = getColorCycleBrushStrokeStateForOwner(brush, params.layerId);
        const index = Math.floor(y) * width + Math.floor(x);
        if (!stroke?.buffers.paint[index] || stroke.buffers.gid[index] !== TEMP_SAMPLE_SLOT) return [];
        const primary = brush.getSampledStrokeDitherPrimaryBuffer?.(params.layerId)?.[index];
        return primary
          ? [primary, resolveStampDitherSecondaryIndex(primary)]
          : [stroke.buffers.paint[index]];
      };
    }
  }
  const alignment = studioExtension.sampledStrokeAlignment?.(params.layerId);
  const sampledDitherStroke = !colourPickup && params.markKind === 'stroke' &&
        state.tools.brushSettings.colorCycleStampDitherEnabled &&
        !state.tools.brushSettings.colorCyclePencilEnabled;
  const sampledPairedInks = Boolean(sampledDitherStroke && state.tools.brushSettings.colorCycleStampDitherBgFill !== false);
  const sampledAlignment = params.source === 'sampled' && sampledDitherStroke && alignment
        ? { speedCps: alignment.speedCps, bandPx: state.tools.brushSettings.colorCycleBandSpacingPx ?? 20 } : undefined;
  if (params.source === 'sampled' || colourPickup || sampledPairedInks) {
    const session: MarkGradientSession = {
      markId: nextMarkId(),
      colourPickup,
      layerId: params.layerId,
      markKind: params.markKind,
      gradientKind: params.gradientKind,
      source: colourPickup ? 'sampled' : params.source,
      seamProfile: sampledPairedInks ? 'hard' : seamProfile,
      sampledSourceSeamProfile: sampledPairedInks ? seamProfile : undefined,
      isRuntimePalette: isRuntimePalette || sampledPairedInks || (!colourPickup && params.markKind === 'stroke' &&
        studioExtension.preserveSampledStrokePalette === true),
      sampledMotion,
      sampledAlignment,
      sampledPairedInks,
      sampledBristles: Boolean(sampledDitherStroke && state.tools.brushSettings.colorCycleBristlesEnabled),
      rawStopsStored: cloneStops(frozenStops),
      frozenStopsStored: frozenStops,
      frozenHash: '',
      binding: null,
      speedCps: sampledAlignment?.speedCps ?? params.speedCps,
      previewStopsStored: params.source !== 'sampled' && !colourPickup ? cloneStops(frozenStops) : null,
      previewHash: '',
      fallbackStopsStored: colourPickup ? cloneStops(colourPickup.baseStops) : [],
      samples: [],
      ditherRenderConfig,
    };
    sessionsByLayer.set(params.layerId, session);
    return session;
  }

  const runtimeStops = resolveMarkSessionRuntimeStops(
    { ditherRenderConfig, source: params.source, isRuntimePalette },
    frozenStops,
  );
  const defResult = ensureGradientDefForStops({
    layerId: params.layerId,
    kind: params.gradientKind,
    stops: runtimeStops,
    sourceStops: isRuntimePalette ? undefined : frozenStops,
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
    isRuntimePalette,
    sampledMotion,
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
    if (session?.source === 'sampled' || session?.sampledPairedInks) {
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
  const session = sessionsByLayer.get(layerId);
  if (session?.source === 'sampled' || session?.sampledPairedInks) {
    sampledTempSlotStateByLayer.set(layerId, 'abandoned');
  }
  sessionsByLayer.delete(layerId);
};

export const getPreviewGradientForActiveMark = (layerId: string): PreviewGradientResult | null => {
  const session = sessionsByLayer.get(layerId);
  if (session) {
    if (session.source === 'sampled' || session.sampledPairedInks) {
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
        source: session.source,
        phase: session.binding ? 'final' : 'sampling',
        stopsStored: session.colourPickup ? cloneStops(sampledStops) : applyCcGradientContrast(
          sampledStops,
          getAppStoreState().tools.brushSettings.ccGradientRangeContrast ??
            session.ditherRenderConfig?.rangeContrast,
          session.sampledRepresentativeColor,
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
