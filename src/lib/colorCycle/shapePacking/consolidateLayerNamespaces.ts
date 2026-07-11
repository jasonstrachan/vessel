import { CcShapePackingError, type CcPackingLayerInput } from './types';

export type CcLayerNamespaceRemap = Readonly<{
  gradientIdByLayerId: ReadonlyMap<string, ReadonlyMap<number, number>>;
  gradientDefIdByLayerId: ReadonlyMap<string, ReadonlyMap<number, number>>;
}>;

export type ConsolidatedCcPackingLayers = Readonly<{
  layers: readonly CcPackingLayerInput[];
  remap: CcLayerNamespaceRemap;
}>;

const collectPositiveIds = (values: Uint8Array | Uint16Array): number[] => (
  [...new Set(values)].filter((value) => value > 0).sort((left, right) => left - right)
);

const collectOccupiedGradientIds = (
  values: Uint8Array,
  paint: Uint8Array,
): number[] => {
  const ids = new Set<number>();
  for (let index = 0; index < values.length; index += 1) {
    if (paint[index] !== 0) ids.add(values[index]);
  }
  return [...ids].sort((left, right) => left - right);
};

/** Gives every selected source layer a collision-free destination namespace. */
export const consolidateCcLayerNamespaces = (
  layers: readonly CcPackingLayerInput[],
): ConsolidatedCcPackingLayers => {
  const gradientIdByLayerId = new Map<string, ReadonlyMap<number, number>>();
  const gradientDefIdByLayerId = new Map<string, ReadonlyMap<number, number>>();
  let nextGradientId = 1;
  let nextGradientDefId = 1;

  for (const layer of layers) {
    const gradientMap = new Map<number, number>();
    for (const id of collectOccupiedGradientIds(layer.channels.gradientId, layer.channels.paint)) {
      if (nextGradientId > 255) {
        throw new CcShapePackingError(
          'gradient-slot-capacity-exceeded',
          'The selected layers use more than 255 distinct gradient slots and cannot be consolidated losslessly.',
        );
      }
      gradientMap.set(id, nextGradientId);
      nextGradientId += 1;
    }
    gradientIdByLayerId.set(layer.layerId, gradientMap);

    const definitionMap = new Map<number, number>();
    for (const id of collectPositiveIds(layer.channels.gradientDefId)) {
      if (nextGradientDefId > 65_535) {
        throw new CcShapePackingError(
          'gradient-definition-capacity-exceeded',
          'The selected layers use more than 65,535 gradient definitions and cannot be consolidated losslessly.',
        );
      }
      definitionMap.set(id, nextGradientDefId);
      nextGradientDefId += 1;
    }
    gradientDefIdByLayerId.set(layer.layerId, definitionMap);
  }

  const remappedLayers = layers.map((layer): CcPackingLayerInput => {
    const gradientMap = gradientIdByLayerId.get(layer.layerId)!;
    const definitionMap = gradientDefIdByLayerId.get(layer.layerId)!;
    const gradientId = layer.channels.gradientId.slice();
    const gradientDefId = layer.channels.gradientDefId.slice();
    for (let index = 0; index < gradientId.length; index += 1) {
      const oldGradientId = gradientId[index];
      const oldDefinitionId = gradientDefId[index];
      if (layer.channels.paint[index] !== 0) gradientId[index] = gradientMap.get(oldGradientId) ?? 0;
      if (oldDefinitionId > 0) gradientDefId[index] = definitionMap.get(oldDefinitionId) ?? 0;
    }
    return {
      ...layer,
      channels: {
        ...layer.channels,
        gradientId,
        gradientDefId,
      },
    };
  });

  return {
    layers: remappedLayers,
    remap: { gradientIdByLayerId, gradientDefIdByLayerId },
  };
};
