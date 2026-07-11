import {
  CcShapePackingError,
  type CcExtractedShape,
  type CcPackingChannels,
  type CcPackingCut,
  type CcPackingLayerInput,
  type CcPackingPoint,
  type CcShapeSeparationOverride,
} from './types';

const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
] as const;

const validateChannels = (layer: CcPackingLayerInput): void => {
  const pixels = layer.width * layer.height;
  const byteChannels: Array<[string, Uint8Array | undefined]> = [
    ['paint', layer.channels.paint],
    ['gradientId', layer.channels.gradientId],
    ['speed', layer.channels.speed],
    ['flow', layer.channels.flow],
    ['phase', layer.channels.phase],
    ['alphaMask', layer.channels.alphaMask],
    ['softEdgeMask', layer.channels.softEdgeMask],
  ];
  for (const [name, channel] of byteChannels) {
    if (channel && channel.length !== pixels) {
      throw new CcShapePackingError('invalid-channel-length', `${name} length does not match layer dimensions.`, {
        layerId: layer.layerId,
        channel: name,
        expected: pixels,
        actual: channel.length,
      });
    }
  }
  if (layer.channels.gradientDefId.length !== pixels) {
    throw new CcShapePackingError('invalid-channel-length', 'gradientDefId length does not match layer dimensions.', {
      layerId: layer.layerId,
      channel: 'gradientDefId',
      expected: pixels,
      actual: layer.channels.gradientDefId.length,
    });
  }
};

const orientation = (a: CcPackingPoint, b: CcPackingPoint, c: CcPackingPoint): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const onSegment = (a: CcPackingPoint, b: CcPackingPoint, p: CcPackingPoint): boolean =>
  p.x >= Math.min(a.x, b.x) &&
  p.x <= Math.max(a.x, b.x) &&
  p.y >= Math.min(a.y, b.y) &&
  p.y <= Math.max(a.y, b.y);

const segmentsIntersect = (
  a: CcPackingPoint,
  b: CcPackingPoint,
  c: CcPackingPoint,
  d: CcPackingPoint,
): boolean => {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
      ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) {
    return true;
  }
  return (abC === 0 && onSegment(a, b, c)) ||
    (abD === 0 && onSegment(a, b, d)) ||
    (cdA === 0 && onSegment(c, d, a)) ||
    (cdB === 0 && onSegment(c, d, b));
};

const isCutEdge = (
  x: number,
  y: number,
  nextX: number,
  nextY: number,
  cuts: readonly CcPackingCut[],
): boolean => {
  if (cuts.length === 0) return false;
  const from = { x: x + 0.5, y: y + 0.5 };
  const to = { x: nextX + 0.5, y: nextY + 0.5 };
  return cuts.some((cut) => segmentsIntersect(from, to, cut.from, cut.to));
};

const findComponents = (
  layer: CcPackingLayerInput,
  cuts: readonly CcPackingCut[],
  splitByGradientDefId: boolean,
): number[][] => {
  const visited = new Uint8Array(layer.width * layer.height);
  const components: number[][] = [];
  const isVisiblyOccupied = (index: number): boolean => (
    layer.channels.paint[index] !== 0 &&
    (layer.channels.alphaMask?.[index] ?? 0) < 255 &&
    (layer.channels.softEdgeMask?.[index] ?? 255) > 0
  );
  for (let index = 0; index < visited.length; index += 1) {
    if (visited[index] || !isVisiblyOccupied(index)) continue;
    const component: number[] = [];
    const queue = [index];
    visited[index] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      component.push(current);
      const x = current % layer.width;
      const y = Math.floor(current / layer.width);
      for (const [dx, dy] of NEIGHBORS) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextY < 0 || nextX >= layer.width || nextY >= layer.height) continue;
        const next = nextY * layer.width + nextX;
        if (visited[next] || !isVisiblyOccupied(next)) continue;
        if (
          splitByGradientDefId &&
          layer.channels.gradientDefId[next] !== layer.channels.gradientDefId[current]
        ) continue;
        if (isCutEdge(x, y, nextX, nextY, cuts)) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    components.push(component);
  }
  return components;
};

const pointIndex = (point: CcPackingPoint, width: number, height: number): number | null => {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  return y * width + x;
};

const partitionComponentBySeeds = (
  component: readonly number[],
  componentId: number,
  layer: CcPackingLayerInput,
  seedGroups: readonly (readonly CcPackingPoint[])[],
  cuts: readonly CcPackingCut[],
): Map<number, number[]> => {
  const member = new Uint8Array(layer.width * layer.height);
  component.forEach((index) => { member[index] = 1; });
  const activeGroups = seedGroups
    .map((points, groupId) => ({
      groupId,
      seeds: points
        .map((point) => pointIndex(point, layer.width, layer.height))
        .filter((index): index is number => index !== null && member[index] === 1),
    }))
    .filter((entry) => entry.seeds.length > 0);

  if (activeGroups.length <= 1) {
    const owner = activeGroups[0]?.groupId ?? -(componentId + 1);
    return new Map([[owner, [...component]]]);
  }

  const distance = new Int32Array(layer.width * layer.height).fill(-1);
  const owner = new Int32Array(layer.width * layer.height).fill(-1);
  const queue: number[] = [];
  for (const group of activeGroups) {
    for (const seed of group.seeds) {
      if (distance[seed] === 0 && owner[seed] !== group.groupId) {
        throw new CcShapePackingError('conflicting-seeds', 'Two shape seed groups contain the same painted pixel.', {
          layerId: layer.layerId,
          componentId,
          seed,
        });
      }
      distance[seed] = 0;
      owner[seed] = group.groupId;
      queue.push(seed);
    }
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const x = current % layer.width;
    const y = Math.floor(current / layer.width);
    for (const [dx, dy] of NEIGHBORS) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextY < 0 || nextX >= layer.width || nextY >= layer.height) continue;
      const next = nextY * layer.width + nextX;
      if (!member[next] || isCutEdge(x, y, nextX, nextY, cuts)) continue;
      const nextDistance = distance[current] + 1;
      if (distance[next] === -1 || nextDistance < distance[next]) {
        distance[next] = nextDistance;
        owner[next] = owner[current];
        queue.push(next);
      } else if (nextDistance === distance[next] && owner[current] < owner[next]) {
        owner[next] = owner[current];
        queue.push(next);
      }
    }
  }

  const partitions = new Map<number, number[]>();
  for (const index of component) {
    const groupId = owner[index];
    if (groupId < 0) {
      throw new CcShapePackingError('unassigned-seed-partition', 'Seeded separation did not cover a painted pixel.', {
        layerId: layer.layerId,
        componentId,
        index,
      });
    }
    const pixels = partitions.get(groupId) ?? [];
    pixels.push(index);
    partitions.set(groupId, pixels);
  }
  return partitions;
};

const makeLocalChannels = (size: number, source: CcPackingChannels): CcPackingChannels => ({
  paint: new Uint8Array(size),
  gradientId: new Uint8Array(size),
  gradientDefId: new Uint16Array(size),
  speed: new Uint8Array(size),
  flow: new Uint8Array(size),
  phase: new Uint8Array(size),
  alphaMask: source.alphaMask ? new Uint8Array(size) : undefined,
  softEdgeMask: source.softEdgeMask ? new Uint8Array(size) : undefined,
});

const buildShape = (
  layer: CcPackingLayerInput,
  pixels: readonly number[],
  ordinal: number,
): CcExtractedShape => {
  let minX = layer.width;
  let minY = layer.height;
  let maxX = -1;
  let maxY = -1;
  for (const index of pixels) {
    const x = index % layer.width;
    const y = Math.floor(index / layer.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const size = width * height;
  const mask = new Uint8Array(size);
  const channels = makeLocalChannels(size, layer.channels);
  let sumX = 0;
  let sumY = 0;
  for (const sourceIndex of pixels) {
    const sourceX = sourceIndex % layer.width;
    const sourceY = Math.floor(sourceIndex / layer.width);
    const localX = sourceX - minX;
    const localY = sourceY - minY;
    const localIndex = localY * width + localX;
    mask[localIndex] = 1;
    channels.paint[localIndex] = layer.channels.paint[sourceIndex];
    channels.gradientId[localIndex] = layer.channels.gradientId[sourceIndex];
    channels.gradientDefId[localIndex] = layer.channels.gradientDefId[sourceIndex];
    channels.speed[localIndex] = layer.channels.speed[sourceIndex];
    channels.flow[localIndex] = layer.channels.flow[sourceIndex];
    channels.phase[localIndex] = layer.channels.phase[sourceIndex];
    if (channels.alphaMask && layer.channels.alphaMask) {
      channels.alphaMask[localIndex] = layer.channels.alphaMask[sourceIndex];
    }
    if (channels.softEdgeMask && layer.channels.softEdgeMask) {
      channels.softEdgeMask[localIndex] = layer.channels.softEdgeMask[sourceIndex];
    }
    sumX += localX + 0.5;
    sumY += localY + 0.5;
  }
  return {
    id: `${layer.layerId}:shape-${ordinal}`,
    layerId: layer.layerId,
    sourceBounds: { x: minX, y: minY, width, height },
    width,
    height,
    area: pixels.length,
    centerOfMass: { x: sumX / pixels.length, y: sumY / pixels.length },
    mask,
    channels,
  };
};

export const extractCcShapes = (
  layer: CcPackingLayerInput,
  override: CcShapeSeparationOverride = {},
): CcExtractedShape[] => {
  if (!Number.isInteger(layer.width) || !Number.isInteger(layer.height) || layer.width <= 0 || layer.height <= 0) {
    throw new CcShapePackingError('invalid-layer-dimensions', 'Layer dimensions must be positive integers.', {
      layerId: layer.layerId,
      width: layer.width,
      height: layer.height,
    });
  }
  validateChannels(layer);
  const cuts = override.cuts ?? [];
  const seedGroups = override.seedGroups ?? [];
  const splitByGradientDefId = override.splitByGradientDefId ?? false;
  const components = findComponents(layer, cuts, splitByGradientDefId);
  const partitionsByOwner = new Map<number, number[]>();
  components.forEach((component, componentId) => {
    const partitions = partitionComponentBySeeds(component, componentId, layer, seedGroups, cuts);
    partitions.forEach((pixels, owner) => {
      const existing = partitionsByOwner.get(owner) ?? [];
      for (const pixel of pixels) existing.push(pixel);
      partitionsByOwner.set(owner, existing);
    });
  });
  const partitions = [...partitionsByOwner.values()]
    .filter((pixels) => pixels.length > 0)
    .sort((left, right) => (
      left.reduce((minimum, index) => Math.min(minimum, index), Number.POSITIVE_INFINITY) -
      right.reduce((minimum, index) => Math.min(minimum, index), Number.POSITIVE_INFINITY)
    ));
  if (
    override.expectedShapeCount === undefined &&
    partitions.length === 1 &&
    partitions[0].length > 1
  ) {
    const pixels = partitions[0];
    let minX = layer.width;
    let minY = layer.height;
    let maxX = -1;
    let maxY = -1;
    pixels.forEach((index) => {
      const x = index % layer.width;
      const y = Math.floor(index / layer.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
    throw new CcShapePackingError(
      'ambiguous-touching-silhouette',
      'A lone connected silhouette cannot be proven to represent one shape. Provide expectedShapeCount, seed groups, or cuts.',
      {
        layerId: layer.layerId,
        componentBounds: {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        },
        occupiedPixels: pixels.length,
      },
    );
  }
  if (override.expectedShapeCount !== undefined && partitions.length !== override.expectedShapeCount) {
    throw new CcShapePackingError(
      'shape-count-mismatch',
      `Expected ${override.expectedShapeCount} shapes but resolved ${partitions.length}. Add or adjust seed groups/cuts.`,
      {
        layerId: layer.layerId,
        expected: override.expectedShapeCount,
        actual: partitions.length,
      },
    );
  }
  return partitions.map((pixels, ordinal) => buildShape(layer, pixels, ordinal));
};
