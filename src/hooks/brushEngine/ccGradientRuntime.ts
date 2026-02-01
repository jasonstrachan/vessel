import { FLOW_SLOT_MASK, type FlowMode } from '@/lib/colorCycle/flowEncoding';
import type { BrushSettings, Layer } from '@/types';
import { getActiveMarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';

export type GradientStop = { position: number; color: string };
export type ColorCycleGradientDef = { id: string; name?: string; currentSlot: number };
export type ColorCycleSlotPalette = { slot: number; stops: GradientStop[] };

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

const EDITOR_SLOT = 63;

const clampSlot = (slot: number): number => Math.max(0, Math.min(FLOW_SLOT_MASK, Math.round(slot)));

const normalizePaintSlot = (slot: number): number => {
  const clamped = clampSlot(slot);
  return clamped === EDITOR_SLOT ? 0 : clamped;
};

const cloneStops = (stops: GradientStop[]): GradientStop[] =>
  stops.map((stop) => ({ position: stop.position, color: stop.color }));

export const signatureForStops = (stops: GradientStop[]): string =>
  stops.map((stop) => `${stop.position}:${stop.color}`).join('|');

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
  const activeSession = getActiveMarkGradientSession(layer.id);
  if (activeSession?.binding?.slot !== undefined) {
    return {
      layerId: layer.id,
      paintSlot: activeSession.binding.slot,
      slotPalettes: [
        {
          slot: activeSession.binding.slot,
          stops: cloneStops(activeSession.frozenStopsStored),
        },
      ],
      flowMode: layer.colorCycleData?.flowMode,
    };
  }
  const fallbackStops = resolveFallbackStops(layer, brushSettings);
  const paintSlot = resolvePaintSlot(layer, brushSettings);
  const palettes = normalizeSlotPalettes(layer.colorCycleData?.slotPalettes ?? []);

  const hasPaintPalette = palettes.some((entry) => entry.slot === paintSlot);
  const ensuredPalettes = hasPaintPalette
    ? palettes
    : [...palettes, { slot: paintSlot, stops: cloneStops(fallbackStops) }];

  return {
    layerId: layer.id,
    paintSlot,
    slotPalettes: ensuredPalettes,
    flowMode: layer.colorCycleData?.flowMode,
  };
};
