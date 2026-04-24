import type { Layer } from '@/types';

type OrderedLayer = Pick<Layer, 'order'>;
type NamedLayer = Pick<Layer, 'name'>;
type IdentifiedLayer = Pick<Layer, 'id'>;

export const normalizeLayerOrder = <TLayer extends OrderedLayer>(
  layers: TLayer[]
): TLayer[] => layers.map((layer, index) => ({ ...layer, order: index }));

export const getInsertionIndexAboveActiveLayer = (
  layers: IdentifiedLayer[],
  activeLayerId: string | null | undefined
): number => {
  const activeIndex = activeLayerId
    ? layers.findIndex((layer) => layer.id === activeLayerId)
    : -1;
  return activeIndex >= 0 ? activeIndex + 1 : layers.length;
};

export const generateDuplicateLayerName = (
  name: string,
  layers: NamedLayer[]
): string => {
  const trimmed = name?.trim() ?? '';
  const base = trimmed.length > 0 ? `${trimmed} Copy` : 'Layer Copy';
  if (!layers.some((layer) => layer.name === base)) {
    return base;
  }
  let suffix = 2;
  while (suffix < 1000) {
    const candidate = `${base} ${suffix}`;
    if (!layers.some((layer) => layer.name === candidate)) {
      return candidate;
    }
    suffix += 1;
  }
  return `${base} ${Date.now()}`;
};

export const insertLayerAtIndex = <TLayer>(
  layers: TLayer[],
  layer: TLayer,
  index: number
): TLayer[] => {
  const nextLayers = [...layers];
  nextLayers.splice(index, 0, layer);
  return nextLayers;
};

export const reorderLayerAtIndex = <TLayer>(
  layers: TLayer[],
  sourceIndex: number,
  destinationIndex: number
): TLayer[] => {
  const nextLayers = [...layers];
  const [removed] = nextLayers.splice(sourceIndex, 1);
  nextLayers.splice(destinationIndex, 0, removed);
  return nextLayers;
};

export type LayerBlockReorderResult<TLayer> = {
  didReorder: boolean;
  layers: TLayer[];
};

export const reorderLayerBlock = <TLayer extends IdentifiedLayer>(
  layers: TLayer[],
  layerIds: string[],
  destinationIndex: number
): LayerBlockReorderResult<TLayer> => {
  const uniqueLayerIds = Array.from(new Set(layerIds));
  if (uniqueLayerIds.length === 0) {
    return { didReorder: false, layers };
  }

  const layerIdSet = new Set(uniqueLayerIds);
  const indexedLayers = layers.map((layer, index) => ({ layer, index }));
  const blockEntries = indexedLayers.filter(({ layer }) => layerIdSet.has(layer.id));
  if (blockEntries.length === 0) {
    return { didReorder: false, layers };
  }

  const blockById = new Map(blockEntries.map(({ layer }) => [layer.id, layer]));
  const orderedBlock = uniqueLayerIds
    .map((id) => blockById.get(id))
    .filter((layer): layer is TLayer => Boolean(layer));
  const remainingLayers = layers.filter((layer) => !layerIdSet.has(layer.id));
  const removedBeforeDestination = blockEntries.filter(({ index }) => index < destinationIndex).length;
  const adjustedDestination = Math.max(
    0,
    Math.min(remainingLayers.length, destinationIndex - removedBeforeDestination)
  );
  const currentBlockStartIndex = blockEntries[0]?.index ?? -1;
  const isContiguousBlock = blockEntries.every(
    ({ index }, entryIndex) => index === currentBlockStartIndex + entryIndex
  );
  if (isContiguousBlock && adjustedDestination === currentBlockStartIndex) {
    return { didReorder: false, layers };
  }

  const nextLayers = [...remainingLayers];
  nextLayers.splice(adjustedDestination, 0, ...orderedBlock);

  const isSameOrder = nextLayers.length === layers.length
    && nextLayers.every((layer, index) => layers[index]?.id === layer.id);
  if (isSameOrder) {
    return { didReorder: false, layers };
  }

  return { didReorder: true, layers: nextLayers };
};
