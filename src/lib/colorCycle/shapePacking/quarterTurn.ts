import type {
  CcExtractedShape,
  CcPackingChannels,
  CcQuarterTurn,
  CcRotatedShape,
} from './types';

const rotatedDimensions = (
  width: number,
  height: number,
  rotation: CcQuarterTurn,
): { width: number; height: number } => (
  rotation === 90 || rotation === 270
    ? { width: height, height: width }
    : { width, height }
);

const rotateCoordinate = (
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: CcQuarterTurn,
): { x: number; y: number } => {
  switch (rotation) {
    case 0:
      return { x, y };
    case 90:
      return { x: height - 1 - y, y: x };
    case 180:
      return { x: width - 1 - x, y: height - 1 - y };
    case 270:
      return { x: y, y: width - 1 - x };
  }
};

const rotatePoint = (
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: CcQuarterTurn,
): { x: number; y: number } => {
  switch (rotation) {
    case 0:
      return { x, y };
    case 90:
      return { x: height - y, y: x };
    case 180:
      return { x: width - x, y: height - y };
    case 270:
      return { x: y, y: width - x };
  }
};

const makeChannels = (size: number, source: CcPackingChannels): CcPackingChannels => ({
  paint: new Uint8Array(size),
  gradientId: new Uint8Array(size),
  gradientDefId: new Uint16Array(size),
  speed: new Uint8Array(size),
  flow: new Uint8Array(size),
  phase: new Uint8Array(size),
  alphaMask: source.alphaMask ? new Uint8Array(size) : undefined,
  softEdgeMask: source.softEdgeMask ? new Uint8Array(size) : undefined,
});

export const rotateCcShape = (
  shape: CcExtractedShape,
  rotation: CcQuarterTurn,
): CcRotatedShape => {
  const dimensions = rotatedDimensions(shape.width, shape.height, rotation);
  const size = dimensions.width * dimensions.height;
  const mask = new Uint8Array(size);
  const channels = makeChannels(size, shape.channels);
  for (let sourceIndex = 0; sourceIndex < shape.mask.length; sourceIndex += 1) {
    if (!shape.mask[sourceIndex]) continue;
    const sourceX = sourceIndex % shape.width;
    const sourceY = Math.floor(sourceIndex / shape.width);
    const destination = rotateCoordinate(
      sourceX,
      sourceY,
      shape.width,
      shape.height,
      rotation,
    );
    const destinationIndex = destination.y * dimensions.width + destination.x;
    mask[destinationIndex] = 1;
    channels.paint[destinationIndex] = shape.channels.paint[sourceIndex];
    channels.gradientId[destinationIndex] = shape.channels.gradientId[sourceIndex];
    channels.gradientDefId[destinationIndex] = shape.channels.gradientDefId[sourceIndex];
    channels.speed[destinationIndex] = shape.channels.speed[sourceIndex];
    channels.flow[destinationIndex] = shape.channels.flow[sourceIndex];
    channels.phase[destinationIndex] = shape.channels.phase[sourceIndex];
    if (channels.alphaMask && shape.channels.alphaMask) {
      channels.alphaMask[destinationIndex] = shape.channels.alphaMask[sourceIndex];
    }
    if (channels.softEdgeMask && shape.channels.softEdgeMask) {
      channels.softEdgeMask[destinationIndex] = shape.channels.softEdgeMask[sourceIndex];
    }
  }
  return {
    source: shape,
    rotation,
    ...dimensions,
    centerOfMass: rotatePoint(
      shape.centerOfMass.x,
      shape.centerOfMass.y,
      shape.width,
      shape.height,
      rotation,
    ),
    mask,
    channels,
  };
};
