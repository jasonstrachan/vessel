import type { Layer } from '@/types';

type ColorCycleData = NonNullable<Layer['colorCycleData']>;
export type TransferredColorCycleGradientDef = NonNullable<ColorCycleData['gradientDefStore']>[number];
export type TransferredColorCycleSlotPalette = NonNullable<ColorCycleData['slotPalettes']>[number];

const cloneStops = (
  stops: TransferredColorCycleGradientDef['stops']
): TransferredColorCycleGradientDef['stops'] => stops.map((stop) => ({ ...stop }));

const cloneDef = (
  def: TransferredColorCycleGradientDef
): TransferredColorCycleGradientDef => ({
  ...def,
  stops: cloneStops(def.stops),
});

const cloneSlotPalette = (
  palette: TransferredColorCycleSlotPalette
): TransferredColorCycleSlotPalette => ({
  slot: palette.slot,
  stops: cloneStops(palette.stops),
});

export const cloneTransferredColorCycleGradientDefs = (
  defs?: TransferredColorCycleGradientDef[] | null
): TransferredColorCycleGradientDef[] | null => {
  if (!defs?.length) {
    return null;
  }
  return defs.map((def) => cloneDef(def));
};

export const cloneTransferredColorCycleSlotPalettes = (
  palettes?: TransferredColorCycleSlotPalette[] | null
): TransferredColorCycleSlotPalette[] | null => {
  if (!palettes?.length) {
    return null;
  }
  return palettes.map((palette) => cloneSlotPalette(palette));
};

const collectUsedDefIds = (defIds?: Uint16Array | null): number[] => {
  if (!defIds?.length) {
    return [];
  }
  const used = new Set<number>();
  for (const defId of defIds) {
    if (defId > 0) {
      used.add(defId);
    }
  }
  return [...used].sort((a, b) => a - b);
};

const collectReservedSlots = (layer: Layer): Set<number> => {
  const reserved = new Set<number>();
  layer.colorCycleData?.slotPalettes?.forEach((entry) => reserved.add(entry.slot));
  layer.colorCycleData?.gradientDefs?.forEach((entry) => reserved.add(entry.currentSlot));
  layer.colorCycleData?.gradientDefStore?.forEach((entry) => {
    if (typeof entry.slot === 'number') {
      reserved.add(entry.slot);
    }
  });
  return reserved;
};

const collectUsedGradientSlots = (gradientIds?: Uint8Array | null): number[] => {
  if (!gradientIds?.length) {
    return [];
  }
  const used = new Set<number>();
  for (const slot of gradientIds) {
    used.add(slot);
  }
  return [...used].sort((a, b) => a - b);
};

export const extractTransferredColorCycleSlotPalettes = (
  layer: Layer,
  gradientIds?: Uint8Array | null,
  defIds?: Uint16Array | null
): TransferredColorCycleSlotPalette[] | null => {
  const palettes = layer.colorCycleData?.slotPalettes;
  if (!palettes?.length) {
    return null;
  }
  const usedSlots = new Set(collectUsedGradientSlots(gradientIds));
  if (defIds?.length) {
    const defs = layer.colorCycleData?.gradientDefStore ?? [];
    const defsById = new Map(defs.map((entry) => [entry.id, entry]));
    for (const defId of collectUsedDefIds(defIds)) {
      const def = defsById.get(defId);
      if (typeof def?.slot === 'number') {
        usedSlots.add(def.slot);
      }
    }
  }
  if (usedSlots.size === 0) {
    return null;
  }
  const extracted = palettes
    .filter((entry) => usedSlots.has(entry.slot))
    .map((entry) => cloneSlotPalette(entry));
  return extracted.length > 0 ? extracted : null;
};

const findAvailableSlot = (reservedSlots: Set<number>): number | null => {
  for (let slot = 0; slot <= 255; slot += 1) {
    if (!reservedSlots.has(slot)) {
      return slot;
    }
  }
  return null;
};

const getStopsSignature = (stops: TransferredColorCycleSlotPalette['stops']): string =>
  JSON.stringify(stops.map((stop) => ({ position: stop.position, color: stop.color })));

export const mergeTransferredColorCycleSlotPalettes = ({
  layer,
  palettes,
  gradientIds,
}: {
  layer: Layer;
  palettes?: TransferredColorCycleSlotPalette[] | null;
  gradientIds?: Uint8Array | null;
}): {
  layer: Layer;
  remappedGradientIds: Uint8Array | null;
  slotRemap: Map<number, number>;
  changed: boolean;
} => {
  if (!palettes?.length || !gradientIds?.length) {
    return {
      layer,
      remappedGradientIds: gradientIds ? new Uint8Array(gradientIds) : null,
      slotRemap: new Map(),
      changed: false,
    };
  }

  const usedSlots = collectUsedGradientSlots(gradientIds);
  if (usedSlots.length === 0) {
    return {
      layer,
      remappedGradientIds: new Uint8Array(gradientIds),
      slotRemap: new Map(),
      changed: false,
    };
  }

  const sourceBySlot = new Map(palettes.map((entry) => [entry.slot, entry]));
  const colorCycleData = layer.colorCycleData ?? {};
  const existingPalettes = colorCycleData.slotPalettes ?? [];
  const nextPalettes = existingPalettes.map((entry) => cloneSlotPalette(entry));
  const existingBySlot = new Map(nextPalettes.map((entry) => [entry.slot, entry]));
  const existingBySignature = new Map<string, TransferredColorCycleSlotPalette>();
  nextPalettes.forEach((entry) => {
    const signature = getStopsSignature(entry.stops);
    if (!existingBySignature.has(signature)) {
      existingBySignature.set(signature, entry);
    }
  });

  const reservedSlots = collectReservedSlots(layer);
  const slotRemap = new Map<number, number>();
  let palettesChanged = false;

  for (const sourceSlot of usedSlots) {
    const sourcePalette = sourceBySlot.get(sourceSlot);
    if (!sourcePalette) {
      slotRemap.set(sourceSlot, sourceSlot);
      continue;
    }

    const signature = getStopsSignature(sourcePalette.stops);
    const exactBySlot = existingBySlot.get(sourceSlot);
    if (exactBySlot && getStopsSignature(exactBySlot.stops) === signature) {
      slotRemap.set(sourceSlot, sourceSlot);
      continue;
    }

    const exactBySignature = existingBySignature.get(signature);
    if (exactBySignature) {
      slotRemap.set(sourceSlot, exactBySignature.slot);
      continue;
    }

    const keepSourceSlot = !exactBySlot;
    const targetSlot = keepSourceSlot ? sourceSlot : findAvailableSlot(reservedSlots);
    if (targetSlot === null) {
      slotRemap.set(sourceSlot, sourceSlot);
      continue;
    }

    reservedSlots.add(targetSlot);
    const nextPalette = cloneSlotPalette({
      ...sourcePalette,
      slot: targetSlot,
    });
    nextPalettes.push(nextPalette);
    existingBySlot.set(targetSlot, nextPalette);
    existingBySignature.set(signature, nextPalette);
    slotRemap.set(sourceSlot, targetSlot);
    palettesChanged = true;
  }

  const remappedGradientIds = new Uint8Array(gradientIds);
  let bufferChanged = false;
  for (let index = 0; index < remappedGradientIds.length; index += 1) {
    const current = remappedGradientIds[index] ?? 0;
    const next = slotRemap.get(current) ?? current;
    if (next !== current) {
      remappedGradientIds[index] = next;
      bufferChanged = true;
    }
  }

  if (!palettesChanged) {
    return {
      layer,
      remappedGradientIds,
      slotRemap,
      changed: bufferChanged,
    };
  }

  return {
    layer: {
      ...layer,
      colorCycleData: {
        ...colorCycleData,
        slotPalettes: nextPalettes,
      },
    },
    remappedGradientIds,
    slotRemap,
    changed: true,
  };
};

export const extractTransferredColorCycleGradientDefs = (
  layer: Layer,
  defIds?: Uint16Array | null
): TransferredColorCycleGradientDef[] | null => {
  const store = layer.colorCycleData?.gradientDefStore;
  if (!store?.length) {
    return null;
  }
  const usedDefIds = new Set(collectUsedDefIds(defIds));
  if (usedDefIds.size === 0) {
    return null;
  }
  const defs = store
    .filter((entry) => usedDefIds.has(entry.id))
    .map((entry) => cloneDef(entry));
  return defs.length > 0 ? defs : null;
};

export const mergeTransferredColorCycleGradientDefs = ({
  layer,
  defs,
  defIds,
}: {
  layer: Layer;
  defs?: TransferredColorCycleGradientDef[] | null;
  defIds?: Uint16Array | null;
}): {
  layer: Layer;
  remappedDefIds: Uint16Array | null;
  changed: boolean;
} => {
  if (!defs?.length || !defIds?.length) {
    return {
      layer,
      remappedDefIds: defIds ? new Uint16Array(defIds) : null,
      changed: false,
    };
  }

  const usedDefIds = collectUsedDefIds(defIds);
  if (usedDefIds.length === 0) {
    return {
      layer,
      remappedDefIds: new Uint16Array(defIds),
      changed: false,
    };
  }

  const sourceById = new Map(defs.map((entry) => [entry.id, entry]));
  const colorCycleData = layer.colorCycleData ?? {};
  const existingStore = colorCycleData.gradientDefStore ?? [];
  const nextStore = existingStore.map((entry) => cloneDef(entry));
  const existingById = new Map(nextStore.map((entry) => [entry.id, entry]));
  const existingByHash = new Map<string, TransferredColorCycleGradientDef>();
  nextStore.forEach((entry) => {
    if (!existingByHash.has(entry.hash)) {
      existingByHash.set(entry.hash, entry);
    }
  });

  let nextGradientDefId = Math.max(
    colorCycleData.nextGradientDefId ?? 1,
    nextStore.reduce((max, entry) => Math.max(max, entry.id + 1), 1)
  );
  const remap = new Map<number, number>();
  let storeChanged = false;

  for (const sourceId of usedDefIds) {
    const sourceDef = sourceById.get(sourceId);
    if (!sourceDef) {
      remap.set(sourceId, 0);
      continue;
    }

    const exactById = existingById.get(sourceId);
    if (exactById?.hash === sourceDef.hash) {
      remap.set(sourceId, sourceId);
      continue;
    }

    const exactByHash = existingByHash.get(sourceDef.hash);
    if (exactByHash) {
      remap.set(sourceId, exactByHash.id);
      continue;
    }

    const keepSourceId = !exactById;
    const targetId = keepSourceId ? sourceId : nextGradientDefId++;
    const slot = typeof sourceDef.slot === 'number'
      ? sourceDef.slot
      : undefined;
    const nextDef = cloneDef({
      ...sourceDef,
      id: targetId,
      slot,
    });
    nextStore.push(nextDef);
    existingById.set(targetId, nextDef);
    existingByHash.set(nextDef.hash, nextDef);
    remap.set(sourceId, targetId);
    storeChanged = true;
    if (keepSourceId) {
      nextGradientDefId = Math.max(nextGradientDefId, targetId + 1);
    }
  }

  const remappedDefIds = new Uint16Array(defIds);
  let bufferChanged = false;
  for (let index = 0; index < remappedDefIds.length; index += 1) {
    const current = remappedDefIds[index] ?? 0;
    if (current <= 0) {
      continue;
    }
    const next = remap.get(current) ?? 0;
    if (next !== current) {
      remappedDefIds[index] = next;
      bufferChanged = true;
    }
  }

  if (!storeChanged) {
    return {
      layer,
      remappedDefIds,
      changed: bufferChanged,
    };
  }

  return {
    layer: {
      ...layer,
      colorCycleData: {
        ...colorCycleData,
        gradientDefStore: nextStore,
        nextGradientDefId,
      },
    },
    remappedDefIds,
    changed: true,
  };
};
