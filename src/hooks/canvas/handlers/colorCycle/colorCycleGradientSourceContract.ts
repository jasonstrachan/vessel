import type { GradientDefSource } from '@/utils/colorCycleGradientDefs';
import { ensureGradientDefForStops, hashStops } from '@/utils/colorCycleGradientDefs';
import {
  resolveActiveColorCycleGradient,
  type ForegroundGradientParams,
} from '@/hooks/canvas/utils/colorCycleHelpers';
import type { BrushSettings, Layer } from '@/types';
import type { MarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { resolveMarkSessionRuntimeStops } from '@/hooks/canvas/utils/colorCycleMarkSession';
import {
  buildCcDitherRuntimePalette,
  resolveCcDitherBandMode,
} from '@/utils/colorCycle/ccDitherRenderPalette';

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
  'binding' | 'frozenStopsStored' | 'frozenHash' | 'source' | 'gradientKind' | 'speedCps'
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
    Boolean(session.ditherRenderConfig?.enabled) || (!session.ditherRenderConfig && brushSettings.ditherEnabled);
  if (!session.frozenStopsStored?.length || !shouldUseSessionDither) {
    const runtimeStops = resolveMarkSessionRuntimeStops(session, session.frozenStopsStored);
    return {
      binding: session.binding,
      frozenStopsStored: runtimeStops,
      sourceStopsStored: session.source === 'sampled' ? runtimeStops : undefined,
      frozenHash: session.frozenHash,
      source: session.source,
      gradientKind: session.gradientKind,
      speedCps: session.speedCps,
    };
  }

  const pairBandCount =
    session.ditherRenderConfig?.pairBandCount ??
    resolveCcDitherBandMode(brushSettings.gradientBands ?? 16).pairBandCount;
  const algorithm = session.ditherRenderConfig?.algorithm ?? brushSettings.ditherAlgorithm;
  const renderPalette = buildCcDitherRuntimePalette({
    baseStops: session.frozenStopsStored,
    bands: pairBandCount,
    spread: session.ditherRenderConfig?.spread ?? brushSettings.ditherPaletteSpread,
    algorithm,
    preserveSourceStops:
      session.source !== 'sampled' &&
      pairBandCount <= 0 &&
      (algorithm ?? 'sierra-lite') === 'sierra-lite',
    debugContext: 'finalize-render-session',
  });
  const renderHash = hashStops(renderPalette.renderStops, session.gradientKind);
  if (session.binding && renderHash === session.frozenHash) {
    return {
      binding: session.binding,
      frozenStopsStored: renderPalette.renderStops,
      sourceStopsStored: session.source === 'sampled' ? session.frozenStopsStored : undefined,
      frozenHash: renderHash,
      source: session.source,
      gradientKind: session.gradientKind,
      speedCps: session.speedCps,
    };
  }

  const renderDef = ensureGradientDefForStops({
    layerId,
    kind: session.gradientKind,
    stops: renderPalette.renderStops,
    source: session.source,
    speedCps: session.speedCps ?? undefined,
    seamProfile: session.seamProfile,
    updateOptions: { skipColorCycleSync: true },
  });
  if (!renderDef) {
    return {
      binding: session.binding,
      frozenStopsStored: session.frozenStopsStored,
      sourceStopsStored: session.source === 'sampled' ? session.frozenStopsStored : undefined,
      frozenHash: session.frozenHash,
      source: session.source,
      gradientKind: session.gradientKind,
      speedCps: session.speedCps,
    };
  }

  return {
    binding: { kind: 'def', defId: renderDef.def.id, slot: renderDef.slot },
    frozenStopsStored: renderPalette.renderStops,
    sourceStopsStored: session.source === 'sampled' ? session.frozenStopsStored : undefined,
    frozenHash: renderDef.hash,
    source: session.source,
    gradientKind: session.gradientKind,
    speedCps: session.speedCps,
  };
};
