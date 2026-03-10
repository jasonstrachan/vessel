import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import type { AppState } from '@/stores/useAppStore';
import { buildRuntimeSnapshot, signatureForStops, type CCRuntimeSnapshot } from './ccGradientRuntime';

const lastAppliedByLayer = new Map<
  string,
  { activeSlot: number; signatures: Map<number, string> }
>();

const pendingApplies = new Map<string, number>();
let getState: (() => AppState) | null = null;

export const setGradientApplyStateGetter = (getter: () => AppState): void => {
  getState = getter;
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
  brush: ColorCycleBrushImplementation,
  layerId: string,
  snapshot: CCRuntimeSnapshot
): void => {
  const previous = lastAppliedByLayer.get(layerId) ?? {
    activeSlot: -1,
    signatures: new Map<number, string>(),
  };
  const nextSignatures = new Map(previous.signatures);
  let didChangePalette = false;

  for (const palette of snapshot.slotPalettes) {
    if (!palette.stops || palette.stops.length === 0) {
      continue;
    }
    const signature = signatureForStops(palette.stops);
    if (previous.signatures.get(palette.slot) !== signature) {
      didChangePalette = true;
      break;
    }
  }

  if (didChangePalette) {
    try {
      brush.commitCurrentStroke?.(layerId);
      brush.flush?.(layerId);
    } catch {}
  }

  for (const palette of snapshot.slotPalettes) {
    if (!palette.stops || palette.stops.length === 0) {
      continue;
    }
    const signature = signatureForStops(palette.stops);
    if (previous.signatures.get(palette.slot) === signature) {
      continue;
    }
    try {
      if (typeof brush.setGradientSlotStops === 'function') {
        brush.setGradientSlotStops(layerId, palette.slot, palette.stops);
      } else {
        brush.setGradientSlot?.(layerId, palette.slot, palette.stops);
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
  });
};

export const flushGradientApply = (layerId?: string): void => {
  const state = getState?.();
  if (!state) {
    return;
  }
  const manager = getColorCycleBrushManager();
  const targetLayerIds = layerId
    ? [layerId]
    : state.layers.filter((layer) => layer.layerType === 'color-cycle').map((layer) => layer.id);

  targetLayerIds.forEach((id) => {
    const layer = state.layers.find((entry) => entry.id === id);
    if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      return;
    }
    if (layer.colorCycleData.mode === 'recolor') {
      return;
    }
    const brush = manager.getBrush(id) as ColorCycleBrushImplementation | undefined;
    if (!brush) {
      return;
    }
    const snapshot = buildRuntimeSnapshot(layer, state.tools.brushSettings);
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
