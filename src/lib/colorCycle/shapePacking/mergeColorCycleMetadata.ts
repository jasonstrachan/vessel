import type { CcLayerNamespaceRemap } from './consolidateLayerNamespaces';

type MetadataContainer = Record<string, unknown>;

export type CcMetadataSource = Readonly<{
  layerId: string;
  metadata: MetadataContainer;
}>;

const records = (value: unknown): MetadataContainer[] => (
  Array.isArray(value)
    ? value.filter((entry): entry is MetadataContainer => Boolean(entry) && typeof entry === 'object')
    : []
);

const remapCollection = (
  sources: readonly CcMetadataSource[],
  field: 'slotPalettes' | 'slotSpeeds' | 'gradientDefStore',
  remap: CcLayerNamespaceRemap,
): MetadataContainer[] => {
  const output: MetadataContainer[] = [];
  for (const source of sources) {
    const idMap = field === 'slotPalettes' || field === 'slotSpeeds'
      ? remap.gradientIdByLayerId.get(source.layerId)
      : remap.gradientDefIdByLayerId.get(source.layerId);
    const slotMap = remap.gradientIdByLayerId.get(source.layerId);
    if (!idMap) continue;
    for (const entry of records(source.metadata[field])) {
      const oldId = field === 'slotPalettes' || field === 'slotSpeeds' ? entry.slot : entry.id;
      if (typeof oldId !== 'number') continue;
      const nextId = idMap.get(oldId);
      if (nextId === undefined) continue;
      const next = { ...entry };
      if (field === 'slotPalettes' || field === 'slotSpeeds') next.slot = nextId;
      else {
        next.id = nextId;
        if (typeof next.slot === 'number') next.slot = slotMap?.get(next.slot) ?? next.slot;
      }
      output.push(next);
    }
  }
  return output.sort((left, right) => (
    Number(field === 'slotPalettes' || field === 'slotSpeeds' ? left.slot : left.id) -
    Number(field === 'slotPalettes' || field === 'slotSpeeds' ? right.slot : right.id)
  ));
};

export const mergeColorCycleMetadata = (
  sources: readonly CcMetadataSource[],
  remap: CcLayerNamespaceRemap,
): Readonly<{
  slotPalettes: MetadataContainer[];
  slotSpeeds: MetadataContainer[];
  gradientDefStore: MetadataContainer[];
  nextGradientDefId: number;
}> => {
  const slotPalettes = remapCollection(sources, 'slotPalettes', remap);
  const slotSpeeds = remapCollection(sources, 'slotSpeeds', remap);
  const gradientDefStore = remapCollection(sources, 'gradientDefStore', remap);
  const highestDefinitionId = gradientDefStore.reduce((highest, entry) => (
    typeof entry.id === 'number' ? Math.max(highest, entry.id) : highest
  ), 0);
  return {
    slotPalettes,
    slotSpeeds,
    gradientDefStore,
    nextGradientDefId: highestDefinitionId + 1,
  };
};

export const applyMergedColorCycleMetadata = (
  target: MetadataContainer,
  merged: ReturnType<typeof mergeColorCycleMetadata>,
): void => {
  target.slotPalettes = merged.slotPalettes;
  if (merged.slotSpeeds.length > 0) target.slotSpeeds = merged.slotSpeeds;
  else delete target.slotSpeeds;
  if (merged.gradientDefStore.length > 0) {
    target.gradientDefStore = merged.gradientDefStore;
    target.nextGradientDefId = merged.nextGradientDefId;
  } else {
    delete target.gradientDefStore;
    delete target.nextGradientDefId;
  }
};
