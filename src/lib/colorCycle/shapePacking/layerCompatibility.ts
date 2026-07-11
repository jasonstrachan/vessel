import { CcShapePackingError } from './types';

export type CcPackingPresentationLayer = Readonly<{
  id: string;
  name?: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: unknown;
  alignment?: unknown;
  groupId?: unknown;
}>;

const comparablePresentation = (layer: CcPackingPresentationLayer): Record<string, unknown> => ({
  visible: layer.visible ?? true,
  opacity: layer.opacity ?? 1,
  blendMode: layer.blendMode ?? 'source-over',
  alignment: layer.alignment ?? null,
  groupId: layer.groupId ?? null,
});

export const assertCompatibleCcLayerPresentation = (
  layers: readonly CcPackingPresentationLayer[],
  destinationLayerId: string,
): void => {
  const destination = layers.find((layer) => layer.id === destinationLayerId);
  if (!destination) {
    throw new CcShapePackingError('destination-layer-not-selected', 'The destination CC layer must be selected.');
  }
  const destinationPresentation = comparablePresentation(destination);
  for (const layer of layers) {
    const presentation = comparablePresentation(layer);
    const incompatibleFields = Object.keys(destinationPresentation).filter((field) => (
      JSON.stringify(presentation[field]) !== JSON.stringify(destinationPresentation[field])
    ));
    if (incompatibleFields.length > 0) {
      throw new CcShapePackingError(
        'incompatible-selected-layer-presentation',
        `Selected layer "${layer.name ?? layer.id}" cannot be losslessly collapsed into the destination layer.`,
        { layerId: layer.id, destinationLayerId, incompatibleFields },
      );
    }
  }
};

export const assertSelectedLayersAreContiguous = (
  allLayerIds: readonly string[],
  selectedLayerIds: readonly string[],
): void => {
  const selected = new Set(selectedLayerIds);
  const indexes = allLayerIds
    .map((layerId, index) => selected.has(layerId) ? index : -1)
    .filter((index) => index >= 0);
  if (indexes.length <= 1) return;
  const first = Math.min(...indexes);
  const last = Math.max(...indexes);
  if (last - first + 1 !== indexes.length) {
    throw new CcShapePackingError(
      'noncontiguous-selected-layers',
      'Selected CC layers are separated by unselected layers and cannot be collapsed without changing stack composition.',
      { selectedLayerIds },
    );
  }
};
