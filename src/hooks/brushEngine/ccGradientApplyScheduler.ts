import type { AppState } from '@/stores/useAppStore';
import { buildRuntimeSnapshot, signatureForStops, type CCRuntimeSnapshot } from './ccGradientRuntime';
import { appendGradientSeamProfileSignature } from '@/lib/colorCycle/gradientSeamProfile';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import type { ColorCycleGradientApplyBrushContext } from './colorCycleBrushContracts';

export type ColorCycleGradientApplyBrush = ColorCycleGradientApplyBrushContext;

const lastAppliedByLayer = new Map<
  string,
  { activeSlot: number; signatures: Map<number, string>; builtFromVersion: number | null }
>();

const pendingApplies = new Map<string, number>();
let getState: (() => AppState) | null = null;
let getBrushForLayer: ((layerId: string) => ColorCycleGradientApplyBrush | null | undefined) | null = null;
let getDocumentVersionForLayer: ((layerId: string) => number | null) | null = null;

export const setGradientApplyStateGetter = (getter: () => AppState): void => {
  getState = getter;
};

export const createColorCycleGradientApplyBrushContext = (
  brush: ColorCycleGradientApplyBrush | null | undefined,
): ColorCycleGradientApplyBrush | null => {
  if (!brush) {
    return null;
  }

  return {
    commitCurrentStroke: typeof brush.commitCurrentStroke === 'function'
      ? brush.commitCurrentStroke.bind(brush)
      : undefined,
    flush: typeof brush.flush === 'function'
      ? brush.flush.bind(brush)
      : undefined,
    setGradientSlotStops: typeof brush.setGradientSlotStops === 'function'
      ? brush.setGradientSlotStops.bind(brush)
      : undefined,
    setGradientSlot: typeof brush.setGradientSlot === 'function'
      ? brush.setGradientSlot.bind(brush)
      : undefined,
    setActiveGradientSlot: typeof brush.setActiveGradientSlot === 'function'
      ? brush.setActiveGradientSlot.bind(brush)
      : undefined,
  };
};

export const setGradientApplyBrushGetter = (
  getter: (layerId: string) => ColorCycleGradientApplyBrush | null | undefined,
): void => {
  getBrushForLayer = getter;
};

export const setGradientApplyDocumentVersionGetter = (
  getter: (layerId: string) => number | null,
): void => {
  getDocumentVersionForLayer = getter;
};

export const __resetGradientApplySchedulerForTests = (): void => {
  lastAppliedByLayer.clear();
  pendingApplies.forEach((handle) => cancelFrame(handle));
  pendingApplies.clear();
  getState = null;
  getBrushForLayer = null;
  getDocumentVersionForLayer = null;
};

const scheduleFrame = (cb: () => void): number => {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(cb);
  }
  return window.setTimeout(cb, 0);
};

const cancelFrame = (id: number) => {
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(id);
    return;
  }
  clearTimeout(id);
};

export const applyRuntimeToBrush = (
  brush: ColorCycleGradientApplyBrush,
  layerId: string,
  snapshot: CCRuntimeSnapshot
): void => {
  const builtFromVersion = snapshot.builtFromVersion ?? null;
  const previousApplied = lastAppliedByLayer.get(layerId);
  const previous = previousApplied?.builtFromVersion === builtFromVersion
    ? previousApplied
    : {
    activeSlot: -1,
    signatures: new Map<number, string>(),
    builtFromVersion,
  };
  const nextSignatures = new Map(previous.signatures);
  let didChangePalette = false;

  for (const palette of snapshot.slotPalettes) {
    if (!palette.stops || palette.stops.length === 0) {
      continue;
    }
    const signature = signatureForStops(palette.stops);
    const paletteSignature = appendGradientSeamProfileSignature(signature, palette.seamProfile);
    if (previous.signatures.get(palette.slot) !== paletteSignature) {
      didChangePalette = true;
      break;
    }
  }

  const isSampledTempPreviewUpdate = snapshot.paintSlot === TEMP_SAMPLE_SLOT;
  if (didChangePalette && !isSampledTempPreviewUpdate) {
    try {
      brush.commitCurrentStroke?.(layerId);
      brush.flush?.(layerId);
    } catch {}
  }

  for (const palette of snapshot.slotPalettes) {
    if (!palette.stops || palette.stops.length === 0) {
      continue;
    }
    const signature = appendGradientSeamProfileSignature(
      signatureForStops(palette.stops),
      palette.seamProfile,
    );
    if (previous.signatures.get(palette.slot) === signature) {
      continue;
    }
    try {
      if (typeof brush.setGradientSlotStops === 'function') {
        brush.setGradientSlotStops(layerId, palette.slot, palette.stops, palette.seamProfile);
      } else {
        brush.setGradientSlot?.(layerId, palette.slot, palette.stops, palette.seamProfile);
      }
      nextSignatures.set(palette.slot, signature);
    } catch {}
  }

  if (snapshot.paintSlot !== previous.activeSlot) {
    try {
      brush.setActiveGradientSlot?.(layerId, snapshot.paintSlot);
    } catch {}
  }

  if (didChangePalette || snapshot.paintSlot !== previous.activeSlot) {
    try {
      brush.flush?.(layerId);
    } catch {}
  }

  lastAppliedByLayer.set(layerId, {
    activeSlot: snapshot.paintSlot,
    signatures: nextSignatures,
    builtFromVersion,
  });
};

export const flushGradientApply = (layerId?: string): void => {
  const state = getState?.();
  if (!state) {
    return;
  }
  const targetLayerIds = layerId
    ? [layerId]
    : state.layers.filter((layer) => layer.layerType === 'color-cycle').map((layer) => layer.id);

  targetLayerIds.forEach((id) => {
    const pendingHandle = pendingApplies.get(id);
    if (typeof pendingHandle === 'number') {
      cancelFrame(pendingHandle);
      pendingApplies.delete(id);
    }

    const layer = state.layers.find((entry) => entry.id === id);
    if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      return;
    }
    if (layer.colorCycleData.mode === 'recolor') {
      return;
    }
    const brush = getBrushForLayer?.(id);
    if (!brush) {
      return;
    }
    const snapshot = {
      ...buildRuntimeSnapshot(layer, state.tools.brushSettings),
      builtFromVersion: getDocumentVersionForLayer?.(id) ?? null,
    };
    applyRuntimeToBrush(brush, id, snapshot);
  });
};

export const requestGradientApply = (layerId: string, reason?: string): void => {
  void reason;
  const pending = pendingApplies.get(layerId);
  if (typeof pending === 'number') {
    return;
  }
  const handle = scheduleFrame(() => {
    pendingApplies.delete(layerId);
    flushGradientApply(layerId);
  });
  pendingApplies.set(layerId, handle);
};

export const cancelGradientApply = (layerId: string): void => {
  const handle = pendingApplies.get(layerId);
  if (typeof handle !== 'number') {
    return;
  }
  cancelFrame(handle);
  pendingApplies.delete(layerId);
};
