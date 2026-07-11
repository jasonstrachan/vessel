import type { Layer, Project } from '@/types';
import { CcShapePackingError } from '@/lib/colorCycle/shapePacking';

export type CcPackingLayerSelector = Readonly<{
  id?: string;
  name?: string;
}>;

export const resolvePackingLayers = (
  project: Pick<Project, 'layers'>,
  selectors: readonly CcPackingLayerSelector[],
): Layer[] => {
  if (selectors.length === 0) {
    throw new CcShapePackingError('missing-layer-selectors', 'At least one selected CC layer is required.');
  }
  const resolved: Layer[] = [];
  const seen = new Set<string>();
  for (const selector of selectors) {
    let layer: Layer | undefined;
    if (selector.id) {
      layer = project.layers.find((candidate) => candidate.id === selector.id);
    } else if (selector.name) {
      const matches = project.layers.filter((candidate) => candidate.name === selector.name);
      if (matches.length > 1) {
        throw new CcShapePackingError('ambiguous-layer-name', `Layer name "${selector.name}" is not unique; select it by ID.`, {
          name: selector.name,
          matchingLayerIds: matches.map((candidate) => candidate.id),
        });
      }
      layer = matches[0];
    } else {
      throw new CcShapePackingError('invalid-layer-selector', 'Each layer selector requires an ID or exact name.');
    }
    if (!layer) {
      throw new CcShapePackingError('missing-selected-layer', 'A selected layer was not found.', { selector });
    }
    if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      throw new CcShapePackingError('selected-layer-not-color-cycle', `Layer "${layer.name}" is not a CC layer.`, {
        layerId: layer.id,
        layerName: layer.name,
      });
    }
    if (!seen.has(layer.id)) {
      seen.add(layer.id);
      resolved.push(layer);
    }
  }
  return resolved;
};
