import { getAppStoreState } from '@/stores/appStoreAccess';
import { debugLog, logError } from '@/utils/debug';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import {
  setFgPending,
  buildForegroundDerivedGradientSpec,
  clampForegroundDerivedBands,
  deriveForegroundGradientStops,
  EDITOR_SLOT,
} from '@/utils/colorCycleGradients';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import { flushGradientApply, requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import type { AppState } from '@/stores/useAppStore';
import {
  rebuildGradientSlotUsageAndGC,
  rebuildOnDemandAndRetryAllocate,
  buildDefaultReservedSlots,
} from '@/utils/colorCycleSlotGC';
import {
  cloneStops,
  getNextGradientSlot,
  resolveActiveColorCycleGradient,
} from '@/hooks/canvas/utils/colorCycleHelpers';
import { getActiveMarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';
import { resolveColorCycleGradientSource } from '@/hooks/canvas/handlers/colorCycle/colorCycleGradientSourceContract';
import type { Layer } from '@/types';

const shouldLogCcGradientDebug = (): boolean => {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  try {
    return Boolean(
      (
        globalThis as {
          __TB_DEBUG?: { logCC?: boolean; logCCGradient?: boolean };
        }
      ).__TB_DEBUG?.logCC ||
      (
        globalThis as {
          __TB_DEBUG?: { logCC?: boolean; logCCGradient?: boolean };
        }
      ).__TB_DEBUG?.logCCGradient
    );
  } catch {
    return false;
  }
};

const gradientTraceByLayer = new Map<string, { sig: string; source: 'manual' | 'fg' | 'sampled' }>();

const gradientSig = (stops: Array<{ position: number; color: string }>): string =>
  stops.map((stop) => `${stop.position}:${stop.color}`).join('|');

const isGrayHex = (value: string): boolean => {
  const raw = value.trim().toLowerCase();
  if (!raw.startsWith('#')) {
    return false;
  }
  const hex = raw.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    const r = hex[0];
    const g = hex[1];
    const b = hex[2];
    return r === g && g === b;
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = hex.slice(0, 2);
    const g = hex.slice(2, 4);
    const b = hex.slice(4, 6);
    return r === g && g === b;
  }
  return false;
};

const isLikelyGrayGradient = (stops: Array<{ position: number; color: string }>): boolean => {
  if (stops.length < 2) {
    return false;
  }
  return stops.every((stop) => isGrayHex(stop.color));
};

export const runProjectSlotRebuild = (layerId: string) => {
  const state = getAppStoreState();
  const result = rebuildGradientSlotUsageAndGC({
    layers: state.layers,
    scope: 'project',
    reservedSlots: buildDefaultReservedSlots(),
  });
  if (!result) {
    return null;
  }
  if (result.missingDefLayers && result.missingDefLayers.length > 0) {
    if (process.env.NODE_ENV !== 'production') {
      logError('[CC] Slot GC aborted due to missing defs', {
        layerId,
        missingDefLayers: result.missingDefLayers,
      });
    }
    return result;
  }
  result.updates.forEach((update) => {
    state.updateLayer(update.layerId, { colorCycleData: update.colorCycleData });
  });
  return result;
};

export const getFgParamsFromState = (state: AppState) => ({
  fgColorHex: state.palette.foregroundColor,
  fgLightness: state.tools.brushSettings.colorCycleFgLightness,
  fgVariance: state.tools.brushSettings.colorCycleFgVariance,
  fgHueShift: state.tools.brushSettings.colorCycleFgHueShift,
  fgSaturationShift: state.tools.brushSettings.colorCycleFgSaturationShift,
  fgOpacity: state.tools.brushSettings.colorCycleFgOpacity,
  fgStops: state.tools.brushSettings.colorCycleFgStops,
});

type EnsureActiveColorCycleGradientSlotArgs = {
  state: AppState;
  layer: Layer;
  brush?: ColorCycleBrushImplementation | null;
};

export const ensureActiveColorCycleGradientSlot = ({
  state,
  layer,
  brush,
}: EnsureActiveColorCycleGradientSlotArgs): void => {
  const brushSettings = state.tools.brushSettings;
  const useSampledGradient = state.tools.ccGradientSource === 'sampled';
  const useForegroundGradient = Boolean(brushSettings.colorCycleUseForegroundGradient);
  const {
    gradientDefs,
    slotPalettes,
    activeGradientId,
    activeSlot,
    activeStops,
    needsBootstrap
  } = resolveActiveColorCycleGradient(layer, brushSettings, getFgParamsFromState(state));

  const preserveGradientPhase = true;
  if (shouldLogCcGradientDebug()) {
    const source = resolveColorCycleGradientSource({
      ccGradientSource: state.tools.ccGradientSource,
      useForegroundGradient: brushSettings.colorCycleUseForegroundGradient,
    });
    const sig = gradientSig(activeStops);
    const previous = gradientTraceByLayer.get(layer.id);
    const gray = isLikelyGrayGradient(activeStops);
    if (!previous || previous.sig !== sig || previous.source !== source) {
      debugLog('raw-console', '[cc gradient debug] ensure slot', {
        layerId: layer.id,
        source,
        changed: !previous ? 'initial' : 'changed',
        fromSource: previous?.source ?? null,
        isGray: gray,
        stopsCount: activeStops.length,
        activeGradientId,
        activeSlot,
        paintSlot: layer.colorCycleData?.paintSlot ?? null,
        fgActiveSlot: layer.colorCycleData?.fgActiveSlot ?? null,
      });
      gradientTraceByLayer.set(layer.id, { sig, source });
    }
  }

  if (useSampledGradient) {
    if (brush && typeof (brush as { setPreserveGradientPhase?: (enabled: boolean) => void }).setPreserveGradientPhase === 'function') {
      (brush as { setPreserveGradientPhase: (enabled: boolean) => void }).setPreserveGradientPhase(preserveGradientPhase);
    }
    const activeSession = getActiveMarkGradientSession(layer.id);
    if (activeSession?.source === 'sampled') {
      requestGradientApply(layer.id, 'ensure-active-slot:sampled');
    }
    return;
  }

  if (!useForegroundGradient) {
    if (brush && typeof (brush as { setPreserveGradientPhase?: (enabled: boolean) => void }).setPreserveGradientPhase === 'function') {
      (brush as { setPreserveGradientPhase: (enabled: boolean) => void }).setPreserveGradientPhase(preserveGradientPhase);
    }
    if (needsBootstrap) {
      try {
        state.updateLayer(layer.id, {
          colorCycleData: {
            ...(layer.colorCycleData ?? {}),
            gradientDefs,
            slotPalettes,
            activeGradientId,
            gradient: activeStops,
            paintSlot: activeSlot,
          }
        });
      } catch {}
    }
    requestGradientApply(layer.id, 'ensure-active-slot');
    return;
  }

  if (brush && typeof (brush as { setPreserveGradientPhase?: (enabled: boolean) => void }).setPreserveGradientPhase === 'function') {
    (brush as { setPreserveGradientPhase: (enabled: boolean) => void }).setPreserveGradientPhase(preserveGradientPhase);
  }
  const foregroundColor = state.palette.foregroundColor ?? brushSettings.color ?? '#ffffff';
  const bands = clampForegroundDerivedBands(brushSettings.colorCycleFgStops);
  const derivedSpec = buildForegroundDerivedGradientSpec({
    baseColor: foregroundColor,
    lightness: brushSettings.colorCycleFgLightness,
    variance: brushSettings.colorCycleFgVariance,
    hueShift: brushSettings.colorCycleFgHueShift,
    saturationShift: brushSettings.colorCycleFgSaturationShift,
    opacity: brushSettings.colorCycleFgOpacity,
    bands,
  });
  const prevKey = layer.colorCycleData?.fgDerivedKey ?? null;
  const nextKey = derivedSpec.key;
  if (prevKey !== nextKey) {
    setFgPending(layer.id, true);
  }
  const derivedGradients =
    layer.colorCycleData?.fgDerivedGradients ??
    layer.colorCycleData?.derivedGradients ??
    [];
  const existingDerived = derivedGradients.find((entry) => entry.key === derivedSpec.key);
  const existingSlot = existingDerived?.slot ?? null;
  const fgActiveSlot = layer.colorCycleData?.fgActiveSlot ?? null;
  const derivedStops = deriveForegroundGradientStops(derivedSpec);
  const existingPalette = existingSlot !== null
    ? slotPalettes.find((entry) => entry.slot === existingSlot)
    : undefined;
  const stopsMatch = existingPalette?.stops.length === derivedStops.length &&
    existingPalette.stops.every((stop, index) => {
      const nextStop = derivedStops[index];
      return stop.position === nextStop?.position && stop.color === nextStop?.color;
    });

  if (prevKey === nextKey && existingSlot !== null && fgActiveSlot === existingSlot && stopsMatch) {
    requestGradientApply(layer.id, 'fg-active');
    setFgPending(layer.id, false);
    return;
  }
  const defSlots = new Set<number>();
  layer.colorCycleData?.gradientDefStore?.forEach((entry) => {
    if (typeof entry.slot === 'number') {
      defSlots.add(entry.slot);
    }
  });
  let nextSlotPalettes = slotPalettes;
  let nextDerivedGradients = derivedGradients;
  let targetSlot: number | null = existingDerived?.slot ?? null;

  if (targetSlot !== null) {
    if (defSlots.has(targetSlot)) {
      targetSlot = null;
    }
    if (targetSlot !== null) {
      const resolvedSlot = targetSlot;
      const existingPalette = slotPalettes.find((entry) => entry.slot === resolvedSlot);
      if (existingPalette) {
        nextSlotPalettes = slotPalettes.map((entry) =>
          entry.slot === resolvedSlot ? { slot: resolvedSlot, stops: cloneStops(derivedStops) } : entry
        );
      } else {
        nextSlotPalettes = [...slotPalettes, { slot: resolvedSlot, stops: cloneStops(derivedStops) }];
      }
    }
  } else {
    const usedSlots = new Set<number>();
    slotPalettes.forEach((entry) => usedSlots.add(entry.slot));
    gradientDefs.forEach((entry) => usedSlots.add(entry.currentSlot));
    defSlots.forEach((slot) => usedSlots.add(slot));
    usedSlots.add(EDITOR_SLOT);
    usedSlots.add(TEMP_SAMPLE_SLOT);
    const assignDerivedSlot = (slot: number | null) => {
      if (slot === null) {
        return;
      }
      targetSlot = slot;
      nextSlotPalettes = [...slotPalettes, { slot, stops: cloneStops(derivedStops) }];
      nextDerivedGradients = [
        ...derivedGradients,
        { key: derivedSpec.key, slot, spec: derivedSpec }
      ];
    };
    const nextSlot = getNextGradientSlot(usedSlots);
    if (nextSlot !== null) {
      assignDerivedSlot(nextSlot);
    } else {
      rebuildOnDemandAndRetryAllocate({
        attemptAllocate: () => {
          const retryUsed = new Set<number>();
          const latest = getAppStoreState().layers.find((entry) => entry.id === layer.id);
          const latestData = latest?.colorCycleData;
          latestData?.slotPalettes?.forEach((entry) => retryUsed.add(entry.slot));
          latestData?.gradientDefs?.forEach((entry) => retryUsed.add(entry.currentSlot));
          latestData?.gradientDefStore?.forEach((entry) => {
            if (typeof entry.slot === 'number') {
              retryUsed.add(entry.slot);
            }
          });
          retryUsed.add(EDITOR_SLOT);
          retryUsed.add(TEMP_SAMPLE_SLOT);
          const retrySlot = getNextGradientSlot(retryUsed);
          if (retrySlot !== null) {
            assignDerivedSlot(retrySlot);
            return retrySlot;
          }
          return null;
        },
        runRebuild: () => runProjectSlotRebuild(layer.id),
        throttleKey: `cc-slot-rebuild:fg:${layer.id}`,
        throttleMs: process.env.NODE_ENV === 'test' ? 0 : undefined,
      });
    }
  }

  if (targetSlot === null) {
    if (prevKey !== nextKey) {
      setFgPending(layer.id, false);
    }
    return;
  }

  const fgSlotChanged = layer.colorCycleData?.fgActiveSlot !== targetSlot;
  if (
    nextSlotPalettes !== slotPalettes ||
    nextDerivedGradients !== derivedGradients ||
    fgSlotChanged
  ) {
    try {
      state.updateLayer(layer.id, {
        colorCycleData: {
          ...(layer.colorCycleData ?? {}),
          slotPalettes: nextSlotPalettes,
          fgActiveSlot: targetSlot,
          fgDerivedKey: nextKey,
          fgDerivedGradients: nextDerivedGradients,
        }
      });
    } catch {}
  }

  requestGradientApply(layer.id, 'fg-update');
  if (brush) {
    try {
      const canvas = layer.colorCycleData?.canvas as HTMLCanvasElement | undefined;
      if (canvas) {
        flushGradientApply(layer.id);
        brush.setTargetCanvas?.(canvas);
        brush.renderDirectToCanvas?.(canvas, layer.id);
      }
    } catch {}
    try {
      setFgPending(layer.id, false);
      window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate', { detail: { onlyActiveLayer: true } }));
    } catch {}
  }
};
