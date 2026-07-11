import { CcShapePackingError, type CcPackingChannels, type CcPackingLayerInput, type CcPackedShapePlacement } from './types';

const makeEmptyChannels = (size: number, source: CcPackingChannels): CcPackingChannels => ({
  paint: new Uint8Array(size),
  gradientId: new Uint8Array(size),
  gradientDefId: new Uint16Array(size),
  speed: new Uint8Array(size),
  flow: new Uint8Array(size),
  phase: new Uint8Array(size),
  // Masks can carry meaningful defaults outside painted pixels (for example,
  // an erase mask may be opaque by default). Preserve the untouched field and
  // overwrite only packed destinations below.
  alphaMask: source.alphaMask?.slice(),
  softEdgeMask: source.softEdgeMask?.slice(),
});

const makeConsolidatedChannels = (
  size: number,
  sources: readonly CcPackingLayerInput[],
): CcPackingChannels => ({
  paint: new Uint8Array(size),
  gradientId: new Uint8Array(size),
  gradientDefId: new Uint16Array(size),
  speed: new Uint8Array(size),
  flow: new Uint8Array(size),
  phase: new Uint8Array(size),
  alphaMask: sources.some((layer) => layer.channels.alphaMask) ? new Uint8Array(size) : undefined,
  softEdgeMask: sources.some((layer) => layer.channels.softEdgeMask)
    ? new Uint8Array(size).fill(255)
    : undefined,
});

export const rewritePackedCcLayers = (
  layers: readonly CcPackingLayerInput[],
  placements: readonly CcPackedShapePlacement[],
  options: Readonly<{ destinationLayerId?: string; allowOverlap?: boolean }> = {},
): Map<string, CcPackingChannels> => {
  const layersById = new Map(layers.map((layer) => [layer.layerId, layer] as const));
  const rewritten = new Map<string, CcPackingChannels>();
  const destinationLayer = options.destinationLayerId
    ? layersById.get(options.destinationLayerId)
    : undefined;
  if (options.destinationLayerId && !destinationLayer) {
    throw new CcShapePackingError('unknown-destination-layer', 'The destination CC layer is not selected.', {
      layerId: options.destinationLayerId,
    });
  }
  const outputLayers = destinationLayer ? [destinationLayer] : layers;
  outputLayers.forEach((layer) => {
    rewritten.set(
      layer.layerId,
      destinationLayer
        ? makeConsolidatedChannels(layer.width * layer.height, layers)
        : makeEmptyChannels(layer.width * layer.height, layer.channels),
    );
  });

  for (const placement of placements) {
    const layer = layersById.get(placement.layerId);
    const outputLayer = destinationLayer ?? layer;
    const destination = outputLayer ? rewritten.get(outputLayer.layerId) : undefined;
    if (!layer || !outputLayer || !destination) {
      throw new CcShapePackingError('unknown-placement-layer', 'Packed placement targets an unknown selected layer.', {
        layerId: placement.layerId,
        shapeId: placement.shapeId,
      });
    }
    const shape = placement.rotated;
    for (let localIndex = 0; localIndex < shape.mask.length; localIndex += 1) {
      if (!shape.mask[localIndex]) continue;
      const localX = localIndex % shape.width;
      const localY = Math.floor(localIndex / shape.width);
      const x = placement.x + localX;
      const y = placement.y + localY;
      if (x < 0 || y < 0 || x >= outputLayer.width || y >= outputLayer.height) {
        throw new CcShapePackingError('placement-out-of-bounds', 'Packed placement exceeds its layer dimensions.', {
          layerId: outputLayer.layerId,
          shapeId: placement.shapeId,
          x,
          y,
        });
      }
      const destinationIndex = y * outputLayer.width + x;
      if (destination.paint[destinationIndex] !== 0 && !options.allowOverlap) {
        throw new CcShapePackingError('placement-overlap', 'Two packed shapes overlap on the same selected layer.', {
          layerId: outputLayer.layerId,
          shapeId: placement.shapeId,
          x,
          y,
        });
      }
      destination.paint[destinationIndex] = shape.channels.paint[localIndex];
      destination.gradientId[destinationIndex] = shape.channels.gradientId[localIndex];
      destination.gradientDefId[destinationIndex] = shape.channels.gradientDefId[localIndex];
      destination.speed[destinationIndex] = shape.channels.speed[localIndex];
      destination.flow[destinationIndex] = shape.channels.flow[localIndex];
      destination.phase[destinationIndex] = shape.channels.phase[localIndex];
      if (destination.alphaMask && shape.channels.alphaMask) {
        destination.alphaMask[destinationIndex] = shape.channels.alphaMask[localIndex];
      }
      if (destination.softEdgeMask && shape.channels.softEdgeMask) {
        destination.softEdgeMask[destinationIndex] = shape.channels.softEdgeMask[localIndex];
      }
    }
  }
  return rewritten;
};
