import type { GradientDefSource } from '@/utils/colorCycleGradientDefs';
import { ensureGradientDefForStops, hashStops } from '@/utils/colorCycleGradientDefs';
import {
  resolveActiveColorCycleGradient,
  type ForegroundGradientParams,
} from '@/hooks/canvas/utils/colorCycleHelpers';
import type { BrushSettings, Layer } from '@/types';
import type { MarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { resolveMarkSessionRuntimeStops } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { resolveCcDitherBandMode } from '@/utils/colorCycle/ccDitherRenderPalette';

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
};

export const resolveColorCycleGradientSource = ({
  ccGradientSource,
  useForegroundGradient,
}: {
  ccGradientSource?: string | null;
  useForegroundGradient?: boolean | null;
}): GradientDefSource => {
  if (ccGradientSource === 'sampled') {
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
    resolveCcDitherBandMode(brushSettings.gradientBands ?? 16).pairBandCount;
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
