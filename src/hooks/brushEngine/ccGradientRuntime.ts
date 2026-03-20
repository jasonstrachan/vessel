import { FLOW_SLOT_MASK, type FlowMode } from '@/lib/colorCycle/flowEncoding';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import type { BrushSettings, Layer } from '@/types';
import type { MarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import type { GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import { normalizeGradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';

export type GradientStop = { position: number; color: string; opacity?: number };
export type ColorCycleGradientDef = { id: string; name?: string; currentSlot: number };
export type ColorCycleSlotPalette = {
  slot: number;
  stops: GradientStop[];
  seamProfile?: GradientSeamProfile;
};

export type CCRuntimeSnapshot = {
  layerId: string;
  paintSlot: number;
  slotPalettes: ColorCycleSlotPalette[];
  flowMode?: FlowMode;
};

const DEFAULT_CC_GRADIENT: GradientStop[] = [
  { position: 0.0, color: '#ff0000' },
  { position: 0.17, color: '#ff7f00' },
  { position: 0.33, color: '#ffff00' },
  { position: 0.5, color: '#00ff00' },
  { position: 0.67, color: '#0000ff' },
  { position: 0.83, color: '#4b0082' },
  { position: 1.0, color: '#9400d3' },
];

const EDITOR_SLOT = 255;

const clampSlot = (slot: number): number => Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(slot)));

const normalizePaintSlot = (slot: number): number => {
  const clamped = clampSlot(slot);
  return clamped === EDITOR_SLOT ? 0 : clamped;
};

const cloneStops = (stops: GradientStop[]): GradientStop[] =>
  stops.map((stop) => ({ position: stop.position, color: stop.color, opacity: stop.opacity }));

const resolveSessionSeamProfile = (
  session: MarkGradientSession | null,
): GradientSeamProfile => normalizeGradientSeamProfile(session?.seamProfile);

const resolveSlotSeamProfile = (
  layer: Layer,
  slot: number,
  session: MarkGradientSession | null,
): GradientSeamProfile => {
  if (session) {
    const sampledSlot = session.source === 'sampled' ? TEMP_SAMPLE_SLOT : null;
    if (session.binding?.slot === slot || sampledSlot === slot) {
      return resolveSessionSeamProfile(session);
    }
  }
  const def = layer.colorCycleData?.gradientDefStore?.find((entry) => entry.slot === slot);
  return normalizeGradientSeamProfile(def?.seamProfile);
};

let activeMarkSessionGetter: ((layerId: string) => MarkGradientSession | null) | null = null;
let activeMarkSessionLoad: Promise<void> | null = null;

export const __setActiveMarkSessionGetterForTests = (
  getter: ((layerId: string) => MarkGradientSession | null) | null
): void => {
  activeMarkSessionGetter = getter;
  activeMarkSessionLoad = null;
};

const ensureActiveMarkSessionGetter = () => {
  if (activeMarkSessionGetter || activeMarkSessionLoad) {
    return;
  }
  activeMarkSessionLoad = import('../canvas/utils/colorCycleMarkSession')
    .then((mod) => {
      activeMarkSessionGetter = mod.getActiveMarkGradientSession ?? null;
    })
    .catch(() => {
      activeMarkSessionGetter = null;
    })
    .finally(() => {
      activeMarkSessionLoad = null;
    });
};

const resolveActiveMarkGradientSession = (layerId: string): MarkGradientSession | null => {
  if (!activeMarkSessionGetter) {
    ensureActiveMarkSessionGetter();
    return null;
  }
  try {
    return activeMarkSessionGetter?.(layerId) ?? null;
  } catch {
    return null;
  }
};

export const signatureForStops = (stops: GradientStop[]): string =>
  stops
    .map((stop) => `${stop.position}:${stop.color}:${Number.isFinite(stop.opacity) ? stop.opacity : 1}`)
    .join('|');

const resolveFallbackStops = (layer: Layer | undefined, brushSettings: BrushSettings): GradientStop[] => {
  return (
    layer?.colorCycleData?.gradient ??
    brushSettings.colorCycleGradient ??
    DEFAULT_CC_GRADIENT
  );
};

export const resolvePaintSlot = (layer: Layer | undefined, brushSettings: BrushSettings): number => {
  if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return 0;
  }
  const data = layer.colorCycleData;
  const defs = data.gradientDefs ?? [];
  const activeId = data.activeGradientId ?? defs[0]?.id;
  const activeDef = defs.find((entry) => entry.id === activeId) ?? defs[0];
  const isFg = Boolean(brushSettings.colorCycleUseForegroundGradient);
  const rawSlot = isFg
    ? (data.fgActiveSlot ?? data.paintSlot ?? activeDef?.currentSlot ?? 0)
    : (data.paintSlot ?? activeDef?.currentSlot ?? 0);
  return normalizePaintSlot(rawSlot);
};

const normalizeSlotPalettes = (palettes: ColorCycleSlotPalette[]): ColorCycleSlotPalette[] =>
  palettes
    .map((entry) => ({
      slot: clampSlot(entry.slot),
      stops: cloneStops(entry.stops),
    }))
    .filter((entry) => entry.slot !== EDITOR_SLOT);

export const buildRuntimeSnapshot = (
  layer: Layer,
  brushSettings: BrushSettings
): CCRuntimeSnapshot => {
  const activeSession = resolveActiveMarkGradientSession(layer.id);
  if (activeSession?.source === 'sampled') {
    const sampledStops =
      activeSession.previewStopsStored && activeSession.previewStopsStored.length >= 2
        ? activeSession.previewStopsStored
        : null;
    const fallbackStops =
      activeSession.fallbackStopsStored?.length
        ? activeSession.fallbackStopsStored
        : activeSession.frozenStopsStored;
    const stops = cloneStops(sampledStops ?? fallbackStops);
    return {
      layerId: layer.id,
      paintSlot: TEMP_SAMPLE_SLOT,
      slotPalettes: [{
        slot: TEMP_SAMPLE_SLOT,
        stops,
        seamProfile: resolveSessionSeamProfile(activeSession),
      }],
      flowMode: layer.colorCycleData?.flowMode,
    };
  }
  if (activeSession?.binding?.slot !== undefined) {
    return {
      layerId: layer.id,
      paintSlot: activeSession.binding.slot,
      slotPalettes: [
        {
          slot: activeSession.binding.slot,
          stops: cloneStops(activeSession.frozenStopsStored),
          seamProfile: resolveSessionSeamProfile(activeSession),
        },
      ],
      flowMode: layer.colorCycleData?.flowMode,
    };
  }
  const fallbackStops = resolveFallbackStops(layer, brushSettings);
  const paintSlot = resolvePaintSlot(layer, brushSettings);
  const palettes = normalizeSlotPalettes(layer.colorCycleData?.slotPalettes ?? []);
  const normalizedPalettes = palettes.map((entry) => ({
    slot: entry.slot,
    stops: cloneStops(entry.stops),
    seamProfile: resolveSlotSeamProfile(layer, entry.slot, activeSession),
  }));

  const hasPaintPalette = normalizedPalettes.some((entry) => entry.slot === paintSlot);
  const ensuredPalettes = hasPaintPalette
    ? normalizedPalettes
    : [...normalizedPalettes, {
        slot: paintSlot,
        stops: cloneStops(fallbackStops),
        seamProfile: resolveSlotSeamProfile(layer, paintSlot, activeSession),
      }];

  return {
    layerId: layer.id,
    paintSlot,
    slotPalettes: ensuredPalettes,
    flowMode: layer.colorCycleData?.flowMode,
  };
};
