import type React from 'react';
import type { BrushSettings } from '@/types';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import type { AutoSampleStops } from '@/hooks/canvas/handlers/shapes/ShapeFinalizeHandler';
import { computeAutoSampleStops } from '@/hooks/canvas/handlers/brushSampling';
export const CC_GRADIENT_SAMPLE_THROTTLE_MS = 120;

export type CcGradientSampleSession = {
  active: boolean;
  strokeId: string | null;
  tempSlot: number;
  stops: AutoSampleStops | null;
  hash: string;
  polyline: Array<{ x: number; y: number }>;
};

export type UpdateCcGradientSampleArgs = {
  session: CcGradientSampleSession;
  sourcePts: Array<{ x: number; y: number }>;
  now: number;
  lastUpdateRef: React.MutableRefObject<number>;
  sampleColor: (x: number, y: number) => string;
  allowTiny?: boolean;
  strokeId?: string | null;
};

const hashStops = (stops: AutoSampleStops): string =>
  stops
    .map((stop) => `${Math.round(stop.position * 1000)}:${stop.color}`)
    .join('|');

export const createCcGradientSampleSession = (): CcGradientSampleSession => ({
  active: false,
  strokeId: null,
  tempSlot: TEMP_SAMPLE_SLOT,
  stops: null,
  hash: '',
  polyline: [],
});

export const resetCcGradientSampleSession = (session: CcGradientSampleSession): void => {
  session.active = false;
  session.strokeId = null;
  session.stops = null;
  session.hash = '';
  session.polyline = [];
};

export const resetCcGradientSampleState = ({
  session,
  lastUpdateRef,
  sampleCountRef,
  sampleCountLastUpdateRef,
}: {
  session: CcGradientSampleSession;
  lastUpdateRef: React.MutableRefObject<number>;
  sampleCountRef: React.MutableRefObject<number>;
  sampleCountLastUpdateRef: React.MutableRefObject<number>;
}): void => {
  resetCcGradientSampleSession(session);
  lastUpdateRef.current = 0;
  sampleCountRef.current = 0;
  sampleCountLastUpdateRef.current = 0;
};

export const shouldSampleCcGradient = (
  settings: BrushSettings,
  brushPresetId: string | null | undefined
): boolean => {
  if (settings.brushShape !== 'color_cycle_shape') {
    return false;
  }
  if (brushPresetId !== 'color-cycle-gradient') {
    return false;
  }
  if (settings.colorCycleUseForegroundGradient) {
    return false;
  }
  return Boolean(settings.ccGradientSamplePerShape);
};

export const updateCcGradientSampleSession = ({
  session,
  sourcePts,
  now,
  lastUpdateRef,
  sampleColor,
  allowTiny = true,
  strokeId,
}: UpdateCcGradientSampleArgs): AutoSampleStops | null => {
  if (now - lastUpdateRef.current < CC_GRADIENT_SAMPLE_THROTTLE_MS) {
    return session.stops;
  }

  const stops = computeAutoSampleStops({
    sourcePts,
    sampleColor,
    options: { allowTiny },
  });

  if (!stops || stops.length < 2) {
    return session.stops;
  }

  const hash = hashStops(stops);
  if (hash === session.hash) {
    return session.stops;
  }

  session.active = true;
  session.strokeId = strokeId ?? session.strokeId ?? null;
  session.stops = stops;
  session.hash = hash;
  session.polyline = [...sourcePts];
  lastUpdateRef.current = now;

  return stops;
};

export const isTempSampleSlotAvailable = (
  layer: {
    colorCycleData?: {
      slotPalettes?: Array<{ slot: number }>;
      gradientDefs?: Array<{ currentSlot: number }>;
      gradientDefStore?: Array<{ slot?: number }>;
    } | null;
  } | null | undefined,
  slot: number = TEMP_SAMPLE_SLOT
): boolean => {
  if (!layer?.colorCycleData) {
    return true;
  }
  const used = new Set<number>();
  for (const entry of layer.colorCycleData.slotPalettes ?? []) {
    used.add(entry.slot);
  }
  for (const entry of layer.colorCycleData.gradientDefs ?? []) {
    used.add(entry.currentSlot);
  }
  for (const entry of layer.colorCycleData.gradientDefStore ?? []) {
    if (typeof entry.slot === 'number') {
      used.add(entry.slot);
    }
  }
  return !used.has(slot);
};

export const resolveActiveGradientSlot = (
  layer: {
    colorCycleData?: {
      activeGradientId?: string;
      gradientDefs?: Array<{ id: string; currentSlot: number }>;
      slotPalettes?: Array<{ slot: number }>;
    } | null;
  } | null | undefined
): number | null => {
  if (!layer?.colorCycleData) {
    return null;
  }
  const data = layer.colorCycleData;
  const activeId = data.activeGradientId ?? data.gradientDefs?.[0]?.id;
  const activeDef = data.gradientDefs?.find((entry) => entry.id === activeId) ?? data.gradientDefs?.[0];
  if (typeof activeDef?.currentSlot === 'number') {
    return activeDef.currentSlot;
  }
  const fallbackSlot = data.slotPalettes?.[0]?.slot;
  return typeof fallbackSlot === 'number' ? fallbackSlot : null;
};
