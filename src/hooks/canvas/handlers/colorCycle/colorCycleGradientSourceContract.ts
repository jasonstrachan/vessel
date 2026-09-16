import { getAppStoreState } from '@/stores/appStoreAccess';
import type { GradientDefSource } from '@/utils/colorCycleGradientDefs';
import { ensureGradientDefForStops, hashStops } from '@/utils/colorCycleGradientDefs';
import {
  resolveActiveColorCycleGradient,
  type ForegroundGradientParams,
} from '@/hooks/canvas/utils/colorCycleHelpers';
import type { BrushSettings, Layer } from '@/types';
import type { MarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { resolveMarkSessionRuntimeStops } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { resolveCcDitherInkMode } from '@/utils/colorCycle/ccDitherRenderPalette';
import { buildCcCycleInkPalettes, canUseCcInkSpread } from '@/utils/colorCycle/ccInkSpread';

export type ColorCycleGradientSourceBehavior = {
  source: GradientDefSource;
  usesSampledStops: boolean;
  usesSampledBaseOffset: boolean;
  requiresDeferredBinding: boolean;
};

export type ColorCycleGradientSourceState = ReturnType<typeof resolveActiveColorCycleGradient> & {
  source: GradientDefSource;
  behavior: ColorCycleGradientSourceBehavior;
};

export type ColorCycleGradientRenderSession = Pick<
  MarkGradientSession,
  'binding' | 'frozenStopsStored' | 'frozenHash' | 'source' | 'gradientKind' | 'speedCps' | 'seamProfile'
> & {
  sourceStopsStored?: MarkGradientSession['frozenStopsStored'];
  secondaryBinding?: { kind: 'def'; defId: number; slot: number };
  secondaryStopsStored?: MarkGradientSession['frozenStopsStored'];
};

export const resolveColorCycleGradientSource = ({
  ccGradientSource,
  useForegroundGradient,
  colorCyclePickupEnabled,
}: {
  ccGradientSource?: string | null;
  colorCyclePickupEnabled?: boolean;
  useForegroundGradient?: boolean | null;
}): GradientDefSource => {
  if (colorCyclePickupEnabled || ccGradientSource === 'sampled') {
    return 'sampled';
  }
  if (ccGradientSource === 'fg' || useForegroundGradient) {
    return 'fg';
  }
  return 'manual';
};

export const resolveColorCycleGradientSourceBehavior = (
  source: GradientDefSource
): ColorCycleGradientSourceBehavior => {
  switch (source) {
    case 'sampled':
      return {
        source,
        usesSampledStops: true,
        usesSampledBaseOffset: true,
        requiresDeferredBinding: true,
      };
    case 'fg':
      return {
        source,
        usesSampledStops: false,
        usesSampledBaseOffset: false,
        requiresDeferredBinding: false,
      };
    case 'manual':
    default:
      return {
        source: 'manual',
        usesSampledStops: false,
        usesSampledBaseOffset: false,
        requiresDeferredBinding: false,
      };
  }
};

export const resolveColorCycleGradientSourceState = ({
  layer,
  brushSettings,
  fgParams,
  ccGradientSource,
}: {
  layer: Layer;
  brushSettings: BrushSettings;
  fgParams?: ForegroundGradientParams;
  ccGradientSource?: string | null;
}): ColorCycleGradientSourceState => {
  const source = resolveColorCycleGradientSource({
    ccGradientSource,
    colorCyclePickupEnabled: brushSettings.colorCyclePickupEnabled,
    useForegroundGradient: brushSettings.colorCycleUseForegroundGradient,
  });
  return {
    ...resolveActiveColorCycleGradient(layer, brushSettings, fgParams),
    source,
    behavior: resolveColorCycleGradientSourceBehavior(source),
  };
};

export const resolveColorCycleGradientRenderSession = ({
  layerId,
  session,
  brushSettings,
}: {
  layerId: string;
  session: MarkGradientSession | null;
  brushSettings: BrushSettings;
}): ColorCycleGradientRenderSession | null => {
  if (!session) {
    return null;
  }

  const shouldUseSessionDither =
    Boolean(session.ditherRenderConfig?.enabled) ||
    (!session.ditherRenderConfig &&
      brushSettings.ditherEnabled &&
      brushSettings.ccFlatCycleDither !== true);
  const rawStops = session.rawStopsStored?.length
    ? session.rawStopsStored
    : session.frozenStopsStored;
  if (brushSettings.ditherEnabled && brushSettings.ccFlatCycleDither &&
      session.source !== 'fg' && !session.isRuntimePalette && !session.colourPickup) {
    const sourceStops = resolveMarkSessionRuntimeStops(session, rawStops, {
      enabled: false, rangeContrast: brushSettings.ccGradientRangeContrast,
    });
    const inks = buildCcCycleInkPalettes(sourceStops,
      canUseCcInkSpread(brushSettings, session.source, 'shape') ? brushSettings.ditherPaletteSpread : 0,
      session.seamProfile);
    const allocate = (stops: typeof sourceStops, retainedDefIds?: number[]) => ensureGradientDefForStops({
      layerId, kind: session.gradientKind, stops, source: session.source,
      speedCps: session.speedCps ?? undefined, seamProfile: 'hard', retainedDefIds,
      updateOptions: { skipColorCycleSync: true },
    });
    const primary = allocate(inks.primary);
    const secondary = primary ? allocate(inks.secondary, [primary.def.id]) : null;
    if (!primary || !secondary) throw new Error('No gradient slots available for the dither ink pair.');
    // Slot cleanup may compact the primary while allocating the second ink.
    const primarySlot = getAppStoreState().layers.find(layer => layer.id === layerId)
      ?.colorCycleData?.gradientDefStore?.find(def => def.id === primary.def.id)?.slot;
    if (primarySlot === undefined) throw new Error('The primary dither ink binding was lost.');
    return {
      ...session,
      binding: { kind: 'def', defId: primary.def.id, slot: primarySlot },
      secondaryBinding: { kind: 'def', defId: secondary.def.id, slot: secondary.slot },
      frozenStopsStored: inks.primary,
      secondaryStopsStored: inks.secondary,
      sourceStopsStored: sourceStops,
      frozenHash: primary.hash,
      seamProfile: 'hard',
    };
  }
  const sampledSourceStops = session.source === 'sampled'
    ? resolveMarkSessionRuntimeStops(session, rawStops, {
        enabled: false,
        rangeContrast: brushSettings.ccGradientRangeContrast,
      })
    : undefined;
  if (!session.frozenStopsStored?.length || !shouldUseSessionDither) {
    const runtimeStops = resolveMarkSessionRuntimeStops(session, rawStops, {
      enabled: false,
      rangeContrast: brushSettings.ccGradientRangeContrast,
    });
    const runtimeHash = hashStops(runtimeStops, session.gradientKind);
    const shouldAllocateRuntimeDef =
      session.source === 'sampled' &&
      runtimeHash !== session.frozenHash;
    if (shouldAllocateRuntimeDef) {
      const renderDef = ensureGradientDefForStops({
        layerId,
        kind: session.gradientKind,
        stops: runtimeStops,
        sourceStops: session.isRuntimePalette ? undefined : rawStops,
        source: session.source,
        speedCps: session.speedCps ?? undefined,
        seamProfile: session.seamProfile,
        sampledCapacityFallback: 'reuse-nearest-compatible',
        updateOptions: { skipColorCycleSync: true },
      });
      if (renderDef) {
        const committedStops = renderDef.reusedForCapacity
          ? renderDef.def.stops.map((stop) => ({ ...stop }))
          : runtimeStops;
        return {
          binding: { kind: 'def', defId: renderDef.def.id, slot: renderDef.slot },
          frozenStopsStored: committedStops,
          sourceStopsStored: renderDef.reusedForCapacity ? committedStops : sampledSourceStops,
          frozenHash: renderDef.hash,
          source: session.source,
          gradientKind: session.gradientKind,
          speedCps: session.speedCps,
          seamProfile: session.seamProfile,
        };
      }
    }
    return {
      binding: session.binding,
      frozenStopsStored: runtimeStops,
      sourceStopsStored: sampledSourceStops,
      frozenHash: runtimeHash,
      source: session.source,
      gradientKind: session.gradientKind,
      speedCps: session.speedCps,
      seamProfile: session.seamProfile,
    };
  }

  const pairBandCount =
    session.ditherRenderConfig?.pairBandCount ??
    resolveCcDitherInkMode(brushSettings).pairBandCount;
  const algorithm = session.ditherRenderConfig?.algorithm ?? brushSettings.ditherAlgorithm;
  const runtimeStops = resolveMarkSessionRuntimeStops(session, rawStops, {
    enabled: true,
    pairBandCount,
    spread: session.ditherRenderConfig?.spread ?? brushSettings.ditherPaletteSpread,
    rangeContrast: brushSettings.ccGradientRangeContrast,
    algorithm,
  });
  const renderHash = hashStops(runtimeStops, session.gradientKind);
  if (session.binding && renderHash === session.frozenHash) {
    return {
      binding: session.binding,
      frozenStopsStored: runtimeStops,
      sourceStopsStored: sampledSourceStops,
      frozenHash: renderHash,
      source: session.source,
      gradientKind: session.gradientKind,
      speedCps: session.speedCps,
      seamProfile: session.seamProfile,
    };
  }

  const renderDef = ensureGradientDefForStops({
    layerId,
    kind: session.gradientKind,
    stops: runtimeStops,
    sourceStops: session.isRuntimePalette ? undefined : rawStops,
    source: session.source,
    speedCps: session.speedCps ?? undefined,
    seamProfile: session.seamProfile,
    sampledCapacityFallback: session.source === 'sampled'
      ? 'reuse-nearest-compatible'
      : undefined,
    updateOptions: { skipColorCycleSync: true },
  });
  if (!renderDef) {
    return {
      binding: session.binding,
      frozenStopsStored: session.frozenStopsStored,
      sourceStopsStored: sampledSourceStops,
      frozenHash: session.frozenHash,
      source: session.source,
      gradientKind: session.gradientKind,
      speedCps: session.speedCps,
      seamProfile: session.seamProfile,
    };
  }

  const committedStops = renderDef.reusedForCapacity
    ? renderDef.def.stops.map((stop) => ({ ...stop }))
    : runtimeStops;
  return {
    binding: { kind: 'def', defId: renderDef.def.id, slot: renderDef.slot },
    frozenStopsStored: committedStops,
    sourceStopsStored: renderDef.reusedForCapacity ? committedStops : sampledSourceStops,
    frozenHash: renderDef.hash,
    source: session.source,
    gradientKind: session.gradientKind,
    speedCps: session.speedCps,
    seamProfile: session.seamProfile,
  };
};
