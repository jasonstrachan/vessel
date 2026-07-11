import { rotateCcShape } from './quarterTurn';
import {
  CcShapePackingError,
  type CcExtractedShape,
  type CcPackedShapePlacement,
  type CcQuarterTurn,
  type CcRotatedShape,
  type CcShapePackingMetrics,
  type CcShapePackingOptions,
  type CcShapePackingResult,
} from './types';

type PackingState = {
  owner: Uint16Array;
  topY: Int32Array;
  placements: CcPackedShapePlacement[];
  minX: number;
  minY: number;
  maxX: number;
  occupiedArea: number;
};

type PlacementCandidate = {
  parent: PackingState;
  rotated: CcRotatedShape;
  x: number;
  y: number;
  supportShapeIds: string[];
  supportSpan: number;
  stabilityMargin: number;
  minX: number;
  minY: number;
  maxX: number;
  score: readonly [number, number, number, string];
};

const DEFAULT_ROTATIONS: readonly CcQuarterTurn[] = [0, 90, 180, 270];
const DEFAULT_BEAM_WIDTH = 8;
const DEFAULT_MINIMUM_SUPPORT_SPAN_RATIO = 0.1;
const MAX_ORDERING_VARIANTS = 16;
const LARGE_SHAPE_SET_THRESHOLD = 64;
const LARGE_SET_GRID_COLUMNS = 64;
const LARGE_SET_FOUNDATION_BEAM_DEPTH = 16;

const bottomProfiles = new WeakMap<CcRotatedShape, Int32Array>();

const getBottomProfile = (shape: CcRotatedShape): Int32Array => {
  const cached = bottomProfiles.get(shape);
  if (cached) return cached;
  const profile = new Int32Array(shape.width).fill(-1);
  forEachMaskPixel(shape, (localX, localY) => {
    profile[localX] = Math.max(profile[localX], localY);
  });
  bottomProfiles.set(shape, profile);
  return profile;
};

const forEachMaskPixel = (
  shape: CcRotatedShape,
  callback: (localX: number, localY: number) => void,
): void => {
  for (let index = 0; index < shape.mask.length; index += 1) {
    if (!shape.mask[index]) continue;
    callback(index % shape.width, Math.floor(index / shape.width));
  }
};

const collides = (
  state: PackingState,
  shape: CcRotatedShape,
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
  padding: number,
): boolean => {
  let collision = false;
  forEachMaskPixel(shape, (localX, localY) => {
    if (collision) return;
    const destinationX = x + localX;
    const destinationY = y + localY;
    if (
      destinationX < 0 ||
      destinationY < 0 ||
      destinationX >= canvasWidth ||
      destinationY >= canvasHeight
    ) {
      collision = true;
      return;
    }
    const minX = Math.max(0, destinationX - padding);
    const maxX = Math.min(canvasWidth - 1, destinationX + padding);
    const minY = Math.max(0, destinationY - padding);
    const maxY = Math.min(canvasHeight - 1, destinationY + padding);
    for (let checkY = minY; checkY <= maxY && !collision; checkY += 1) {
      for (let checkX = minX; checkX <= maxX; checkX += 1) {
        if (state.owner[checkY * canvasWidth + checkX] > 0) {
          collision = true;
          break;
        }
      }
    }
  });
  return collision;
};

const findDropY = (
  state: PackingState,
  shape: CcRotatedShape,
  x: number,
  canvasWidth: number,
  canvasHeight: number,
  padding: number,
): number | null => {
  let y = canvasHeight - shape.height;
  if (y < 0) return null;
  const bottom = getBottomProfile(shape);
  for (let localX = 0; localX < bottom.length; localX += 1) {
    if (bottom[localX] < 0) continue;
    for (let dx = -padding; dx <= padding; dx += 1) {
      const column = x + localX + dx;
      if (column < 0 || column >= canvasWidth) continue;
      const obstacleY = state.topY[column];
      if (obstacleY < canvasHeight) {
        y = Math.min(y, obstacleY - bottom[localX] - padding - 1);
      }
    }
  }
  return y >= 0 && !collides(state, shape, x, y, canvasWidth, canvasHeight, padding) ? y : null;
};

const resolveSupport = (
  state: PackingState,
  shape: CcRotatedShape,
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
  padding: number,
  minimumSupportSpanRatio: number,
): { ids: string[]; span: number; margin: number } | null => {
  const bottom = getBottomProfile(shape);
  const floorContacts: number[] = [];
  bottom.forEach((localY, localX) => {
    if (localY >= 0 && y + localY === canvasHeight - 1) floorContacts.push(x + localX);
  });
  if (floorContacts.length > 0) {
    return {
      ids: [],
      span: Math.max(...floorContacts) - Math.min(...floorContacts) + 1,
      margin: Number.POSITIVE_INFINITY,
    };
  }

  const contactXs: number[] = [];
  const supportPlacementIndexes = new Set<number>();
  const contactDistance = padding + 1;
  bottom.forEach((localY, localX) => {
    if (localY < 0) return;
    const destinationX = x + localX;
    const destinationY = y + localY;
    const checkY = destinationY + contactDistance;
    if (checkY >= canvasHeight) return;
    for (let dx = -contactDistance; dx <= contactDistance; dx += 1) {
      const checkX = destinationX + dx;
      if (checkX < 0 || checkX >= canvasWidth) continue;
      const owner = state.owner[checkY * canvasWidth + checkX];
      if (owner <= 0) continue;
      contactXs.push(destinationX);
      supportPlacementIndexes.add(owner - 1);
    }
  });
  if (contactXs.length === 0) return null;

  const minContactX = Math.min(...contactXs);
  const maxContactX = Math.max(...contactXs);
  const supportSpan = maxContactX - minContactX + 1;
  const centerX = x + shape.centerOfMass.x;
  const stabilityMargin = Math.min(centerX - minContactX, maxContactX + 1 - centerX);
  const minimumSpan = Math.max(1, Math.ceil(shape.width * minimumSupportSpanRatio));
  if (centerX < minContactX || centerX > maxContactX + 1 || supportSpan < minimumSpan) {
    return null;
  }
  return {
    ids: [...supportPlacementIndexes]
      .sort((left, right) => left - right)
      .map((index) => state.placements[index]?.shapeId)
      .filter((id): id is string => Boolean(id)),
    span: supportSpan,
    margin: stabilityMargin,
  };
};

const placementSignature = (
  placements: readonly CcPackedShapePlacement[],
  shape: CcRotatedShape,
  x: number,
  y: number,
): string => [
  ...placements.map((placement) => (
    `${placement.shapeId}:${placement.rotation}:${placement.x}:${placement.y}`
  )),
  `${shape.source.id}:${shape.rotation}:${x}:${y}`,
].join('|');

const candidateScore = (
  state: PackingState,
  shape: CcRotatedShape,
  x: number,
  y: number,
  canvasHeight: number,
): {
  minX: number;
  minY: number;
  maxX: number;
  score: readonly [number, number, number, string];
} => {
  const minX = Math.min(state.minX, x);
  const minY = Math.min(state.minY, y);
  const maxX = Math.max(state.maxX, x + shape.width - 1);
  const occupiedArea = state.occupiedArea + shape.source.area;
  const packedHeight = canvasHeight - minY;
  const horizontalSpan = maxX - minX + 1;
  const boundingWaste = packedHeight * horizontalSpan - occupiedArea;
  return {
    minX,
    minY,
    maxX,
    score: [
      packedHeight,
      boundingWaste,
      horizontalSpan,
      placementSignature(state.placements, shape, x, y),
    ],
  };
};

const compareScore = (
  left: readonly [number, number, number, string],
  right: readonly [number, number, number, string],
): number => left[0] - right[0] || left[1] - right[1] || left[2] - right[2] || left[3].localeCompare(right[3]);

const materializeCandidate = (
  candidate: PlacementCandidate,
  canvasWidth: number,
): PackingState => {
  const owner = candidate.parent.owner.slice();
  const topY = candidate.parent.topY.slice();
  const placementIndex = candidate.parent.placements.length + 1;
  forEachMaskPixel(candidate.rotated, (localX, localY) => {
    const index = (candidate.y + localY) * canvasWidth + candidate.x + localX;
    owner[index] = placementIndex;
    topY[candidate.x + localX] = Math.min(topY[candidate.x + localX], candidate.y + localY);
  });
  const placement: CcPackedShapePlacement = {
    shapeId: candidate.rotated.source.id,
    layerId: candidate.rotated.source.layerId,
    x: candidate.x,
    y: candidate.y,
    rotation: candidate.rotated.rotation,
    rotated: candidate.rotated,
    supportShapeIds: candidate.supportShapeIds,
    supportSpan: candidate.supportSpan,
    stabilityMargin: candidate.stabilityMargin,
  };
  return {
    owner,
    topY,
    placements: [...candidate.parent.placements, placement],
    minX: candidate.minX,
    minY: candidate.minY,
    maxX: candidate.maxX,
    occupiedArea: candidate.parent.occupiedArea + candidate.rotated.source.area,
  };
};

const candidateXPositions = (
  state: PackingState,
  shape: CcRotatedShape,
  maximumX: number,
  canvasWidth: number,
  padding: number,
  isLargeShapeSet: boolean,
): number[] => {
  if (!isLargeShapeSet) return Array.from({ length: maximumX + 1 }, (_, x) => x);
  const positions = new Set<number>();
  const add = (x: number): void => {
    const clamped = Math.max(0, Math.min(maximumX, Math.round(x)));
    positions.add(clamped);
  };
  add(0);
  add(maximumX);
  add(maximumX / 2);
  const clearance = padding + 1;
  state.placements.forEach((placement) => {
    add(placement.x - shape.width - clearance);
    add(placement.x + placement.rotated.width + clearance);
    add(placement.x);
    add(placement.x + placement.rotated.width - shape.width);
  });
  const step = Math.max(1, Math.floor(canvasWidth / LARGE_SET_GRID_COLUMNS));
  for (let x = 0; x <= maximumX; x += step) add(x);
  return [...positions].sort((left, right) => left - right);
};

const findNonGravityCandidate = (
  state: PackingState,
  rotations: readonly CcRotatedShape[],
  options: Required<CcShapePackingOptions>,
): PlacementCandidate | null => {
  for (const rotated of rotations) {
    const maximumX = options.canvasWidth - rotated.width;
    const maximumY = options.canvasHeight - rotated.height;
    if (maximumX < 0 || maximumY < 0) continue;
    for (const gridStep of [32, 16, 8, 4, 2, 1]) {
      const pairs = new Map<string, { x: number; y: number }>();
      const add = (x: number, y: number): void => {
        const nextX = Math.max(0, Math.min(maximumX, Math.round(x)));
        const nextY = Math.max(0, Math.min(maximumY, Math.round(y)));
        pairs.set(`${nextX}:${nextY}`, { x: nextX, y: nextY });
      };
      for (let y = maximumY; y >= 0; y -= gridStep) {
        for (let x = 0; x <= maximumX; x += gridStep) add(x, y);
      }
      state.placements.forEach((placement) => {
        const clearance = options.padding + 1;
        const xs = [
          placement.x,
          placement.x + placement.rotated.width - rotated.width,
          placement.x - rotated.width - clearance,
          placement.x + placement.rotated.width + clearance,
        ];
        const ys = [
          placement.y,
          placement.y + placement.rotated.height - rotated.height,
          placement.y - rotated.height - clearance,
          placement.y + placement.rotated.height + clearance,
        ];
        xs.forEach((x) => ys.forEach((y) => add(x, y)));
      });
      const ordered = [...pairs.values()].sort((left, right) => right.y - left.y || left.x - right.x);
      for (const { x, y } of ordered) {
        if (collides(state, rotated, x, y, options.canvasWidth, options.canvasHeight, options.padding)) continue;
        const scored = candidateScore(state, rotated, x, y, options.canvasHeight);
        return {
          parent: state,
          rotated,
          x,
          y,
          supportShapeIds: [],
          supportSpan: 0,
          stabilityMargin: Number.NEGATIVE_INFINITY,
          ...scored,
        };
      }
    }
  }
  return null;
};

const overlapArea = (
  state: PackingState,
  shape: CcRotatedShape,
  x: number,
  y: number,
  canvasWidth: number,
): number => {
  let overlap = 0;
  forEachMaskPixel(shape, (localX, localY) => {
    if (state.owner[(y + localY) * canvasWidth + x + localX] > 0) overlap += 1;
  });
  return overlap;
};

const findOverlapCandidate = (
  state: PackingState,
  rotations: readonly CcRotatedShape[],
  options: Required<CcShapePackingOptions>,
): PlacementCandidate | null => {
  let best: { rotated: CcRotatedShape; x: number; y: number; overlap: number } | null = null;
  for (const rotated of rotations) {
    const maximumX = options.canvasWidth - rotated.width;
    const y = options.canvasHeight - rotated.height;
    if (maximumX < 0 || y < 0) continue;
    const positions = new Set<number>();
    for (let x = 0; x <= maximumX; x += 32) positions.add(x);
    positions.add(maximumX);
    state.placements.forEach((placement) => {
      positions.add(Math.max(0, Math.min(maximumX, placement.x)));
      positions.add(Math.max(0, Math.min(maximumX, placement.x + placement.rotated.width - rotated.width)));
    });
    const score = (x: number): void => {
      const overlap = overlapArea(state, rotated, x, y, options.canvasWidth);
      if (!best || overlap < best.overlap || (overlap === best.overlap && x < best.x)) {
        best = { rotated, x, y, overlap };
      }
    };
    positions.forEach(score);
    const currentBest = best as { rotated: CcRotatedShape; x: number; y: number; overlap: number } | null;
    if (currentBest?.rotated === rotated) {
      for (let x = Math.max(0, currentBest.x - 31); x <= Math.min(maximumX, currentBest.x + 31); x += 1) score(x);
    }
  }
  const resolved = best as { rotated: CcRotatedShape; x: number; y: number; overlap: number } | null;
  if (!resolved) return null;
  const scored = candidateScore(state, resolved.rotated, resolved.x, resolved.y, options.canvasHeight);
  return {
    parent: state,
    rotated: resolved.rotated,
    x: resolved.x,
    y: resolved.y,
    supportShapeIds: [],
    supportSpan: 0,
    stabilityMargin: Number.NEGATIVE_INFINITY,
    ...scored,
  };
};

const shapeOrderings = (shapes: readonly CcExtractedShape[]): CcExtractedShape[][] => {
  const withStableTie = (
    compare: (left: CcExtractedShape, right: CcExtractedShape) => number,
  ): CcExtractedShape[] => [...shapes].sort((left, right) => compare(left, right) || left.id.localeCompare(right.id));
  const pinFirstThenSort = (
    firstCompare: (left: CcExtractedShape, right: CcExtractedShape) => number,
    restCompare: (left: CcExtractedShape, right: CcExtractedShape) => number,
  ): CcExtractedShape[] => {
    const [first, ...rest] = withStableTie(firstCompare);
    return [first, ...rest.sort((left, right) => restCompare(left, right) || left.id.localeCompare(right.id))];
  };
  const largestThenAscending = (foundationCount: number): CcExtractedShape[] => {
    const byArea = withStableTie((left, right) => right.area - left.area);
    return [
      ...byArea.slice(0, foundationCount),
      ...byArea.slice(foundationCount).sort((left, right) => left.area - right.area || left.id.localeCompare(right.id)),
    ];
  };
  const variants = [
    withStableTie((left, right) => right.area - left.area),
    withStableTie((left, right) => Math.max(right.width, right.height) - Math.max(left.width, left.height)),
    withStableTie((left, right) =>
      (right.area / (right.width * right.height)) - (left.area / (left.width * left.height))),
    withStableTie((left, right) =>
      left.sourceBounds.y - right.sourceBounds.y || left.sourceBounds.x - right.sourceBounds.x),
    pinFirstThenSort(
      (left, right) => right.width - left.width,
      (left, right) => (right.area / (right.width * right.height)) - (left.area / (left.width * left.height)),
    ),
    pinFirstThenSort(
      (left, right) => right.width - left.width,
      (left, right) => left.area - right.area,
    ),
    largestThenAscending(2),
    largestThenAscending(4),
    largestThenAscending(8),
    largestThenAscending(12),
  ];
  const baseVariants = [...variants];
  for (const base of baseVariants) {
    for (let index = 0; index < base.length - 1 && variants.length < MAX_ORDERING_VARIANTS; index += 1) {
      const swapped = [...base];
      [swapped[index], swapped[index + 1]] = [swapped[index + 1], swapped[index]];
      variants.push(swapped);
    }
    if (variants.length >= MAX_ORDERING_VARIANTS) break;
  }
  const unique = new Map<string, CcExtractedShape[]>();
  variants.forEach((variant) => unique.set(variant.map((shape) => shape.id).join('|'), variant));
  return [...unique.values()];
};

const validateOptions = (options: CcShapePackingOptions): Required<CcShapePackingOptions> => {
  const padding = options.padding ?? 1;
  const beamWidth = options.beamWidth ?? DEFAULT_BEAM_WIDTH;
  const minimumSupportSpanRatio = options.minimumSupportSpanRatio ?? DEFAULT_MINIMUM_SUPPORT_SPAN_RATIO;
  const rotations = [...new Set(options.rotations ?? DEFAULT_ROTATIONS)];
  if (!Number.isInteger(options.canvasWidth) || !Number.isInteger(options.canvasHeight) || options.canvasWidth <= 0 || options.canvasHeight <= 0) {
    throw new CcShapePackingError('invalid-canvas-dimensions', 'Packing canvas dimensions must be positive integers.');
  }
  if (!Number.isInteger(padding) || padding < 0 || padding > 16) {
    throw new CcShapePackingError('invalid-padding', 'Packing padding must be an integer between 0 and 16.');
  }
  if (!Number.isInteger(beamWidth) || beamWidth <= 0 || beamWidth > 128) {
    throw new CcShapePackingError('invalid-beam-width', 'Beam width must be an integer between 1 and 128.');
  }
  if (minimumSupportSpanRatio < 0 || minimumSupportSpanRatio > 1) {
    throw new CcShapePackingError('invalid-support-ratio', 'Minimum support span ratio must be between 0 and 1.');
  }
  if (rotations.length === 0 || rotations.some((rotation) => !DEFAULT_ROTATIONS.includes(rotation))) {
    throw new CcShapePackingError('invalid-rotations', 'Rotations must contain at least one quarter turn.');
  }
  return {
    canvasWidth: options.canvasWidth,
    canvasHeight: options.canvasHeight,
    padding,
    beamWidth,
    minimumSupportSpanRatio,
    rotations,
    allowNonGravityNesting: options.allowNonGravityNesting ?? false,
    allowPartialPreview: options.allowPartialPreview ?? false,
    allowOverlap: options.allowOverlap ?? false,
  };
};

export const packCcShapes = (
  shapes: readonly CcExtractedShape[],
  rawOptions: CcShapePackingOptions,
): CcShapePackingResult => {
  const options = validateOptions(rawOptions);
  if (shapes.length > 65_535) {
    throw new CcShapePackingError('too-many-shapes', 'Packing supports at most 65,535 selected shapes.');
  }
  if (shapes.length === 0) {
    return {
      placements: [],
      metrics: {
        shapeCount: 0,
        occupiedArea: 0,
        packedHeight: 0,
        horizontalSpan: 0,
        boundingWasteArea: 0,
        packingDensity: 1,
        exploredStateCount: 0,
        orderingCount: 0,
      },
    };
  }

  const rotationsByShape = new Map(shapes.map((shape) => [
    shape.id,
    options.rotations.map((rotation) => rotateCcShape(shape, rotation)),
  ] as const));
  const orderings = shapeOrderings(shapes);
  const isLargeShapeSet = shapes.length > LARGE_SHAPE_SET_THRESHOLD;
  // Large jobs still need each fundamentally different base ordering. Adjacent
  // swap variants are the expensive part; dropping density/source orderings
  // made concave artwork behave as if "largest first" were the only policy.
  const activeOrderings = isLargeShapeSet
    ? options.allowNonGravityNesting
      ? orderings.slice(5, 6)
      : orderings.slice(0, 10)
    : orderings;
  const completed: PackingState[] = [];
  let exploredStateCount = 0;
  let maximumPlacedShapeCount = 0;
  let blockedShapeId: string | null = null;
  const orderingFailures: Array<{ placed: number; blockedShapeId: string }> = [];
  let bestPartialState: PackingState | null = null;

  for (const ordering of activeOrderings) {
    let orderingPlacedShapeCount = 0;
    let beam: PackingState[] = [{
      owner: new Uint16Array(options.canvasWidth * options.canvasHeight),
      topY: new Int32Array(options.canvasWidth).fill(options.canvasHeight),
      placements: [],
      minX: options.canvasWidth,
      minY: options.canvasHeight,
      maxX: -1,
      occupiedArea: 0,
    }];
    for (const shape of ordering) {
      const candidates: PlacementCandidate[] = [];
      for (const state of beam) {
        for (const rotated of rotationsByShape.get(shape.id) ?? []) {
          const maximumX = options.canvasWidth - rotated.width;
          for (const x of candidateXPositions(
            state,
            rotated,
            maximumX,
            options.canvasWidth,
            options.padding,
            isLargeShapeSet,
          )) {
            const y = findDropY(
              state,
              rotated,
              x,
              options.canvasWidth,
              options.canvasHeight,
              options.padding,
            );
            if (y === null) continue;
            const support = resolveSupport(
              state,
              rotated,
              x,
              y,
              options.canvasWidth,
              options.canvasHeight,
              options.padding,
              options.minimumSupportSpanRatio,
            );
            if (!support) continue;
            const scored = candidateScore(state, rotated, x, y, options.canvasHeight);
            candidates.push({
              parent: state,
              rotated,
              x,
              y,
              supportShapeIds: support.ids,
              supportSpan: support.span,
              stabilityMargin: support.margin,
              ...scored,
            });
            exploredStateCount += 1;
          }
        }
      }
      if (
        candidates.length === 0 &&
        options.allowNonGravityNesting &&
        orderingPlacedShapeCount >= Math.floor(shapes.length * 0.8)
      ) {
        for (const state of beam) {
          const nested = findNonGravityCandidate(state, rotationsByShape.get(shape.id) ?? [], options);
          if (nested) candidates.push(nested);
        }
      }
      if (
        candidates.length === 0 &&
        options.allowOverlap &&
        orderingPlacedShapeCount >= Math.floor(shapes.length * 0.8)
      ) {
        for (const state of beam) {
          const overlapping = findOverlapCandidate(state, rotationsByShape.get(shape.id) ?? [], options);
          if (overlapping) candidates.push(overlapping);
        }
      }
      candidates.sort((left, right) => compareScore(left.score, right.score));
      const effectiveBeamWidth = isLargeShapeSet && orderingPlacedShapeCount >= LARGE_SET_FOUNDATION_BEAM_DEPTH
        ? 1
        : options.beamWidth;
      beam = candidates.slice(0, effectiveBeamWidth).map((candidate) => (
        materializeCandidate(candidate, options.canvasWidth)
      ));
      if (beam.length === 0) {
        blockedShapeId = shape.id;
        orderingFailures.push({ placed: orderingPlacedShapeCount, blockedShapeId: shape.id });
        break;
      }
      maximumPlacedShapeCount = Math.max(maximumPlacedShapeCount, ...beam.map((state) => state.placements.length));
      orderingPlacedShapeCount = Math.max(orderingPlacedShapeCount, ...beam.map((state) => state.placements.length));
      const leadingState = beam[0];
      if (leadingState && (!bestPartialState || leadingState.placements.length > bestPartialState.placements.length)) {
        bestPartialState = leadingState;
      }
    }
    completed.push(...beam.filter((state) => state.placements.length === shapes.length));
  }

  if (completed.length === 0) {
    if (options.allowPartialPreview && bestPartialState) completed.push(bestPartialState);
  }
  if (completed.length === 0) {
    const blockedShape = blockedShapeId ? shapes.find((shape) => shape.id === blockedShapeId) : undefined;
    throw new CcShapePackingError('insufficient-space', 'The selected shapes cannot be packed inside the existing canvas.', {
      canvasWidth: options.canvasWidth,
      canvasHeight: options.canvasHeight,
      shapeCount: shapes.length,
      occupiedArea: shapes.reduce((total, shape) => total + shape.area, 0),
      maximumPlacedShapeCount,
      blockedShapeId,
      blockedShape: blockedShape ? {
        area: blockedShape.area,
        width: blockedShape.width,
        height: blockedShape.height,
      } : undefined,
      exploredStateCount,
      orderingFailures,
    });
  }
  completed.sort((left, right) => {
    const leftHeight = options.canvasHeight - left.minY;
    const rightHeight = options.canvasHeight - right.minY;
    const leftSpan = left.maxX - left.minX + 1;
    const rightSpan = right.maxX - right.minX + 1;
    const leftWaste = leftHeight * leftSpan - left.occupiedArea;
    const rightWaste = rightHeight * rightSpan - right.occupiedArea;
    const leftSignature = left.placements.map((entry) => `${entry.shapeId}:${entry.rotation}:${entry.x}:${entry.y}`).join('|');
    const rightSignature = right.placements.map((entry) => `${entry.shapeId}:${entry.rotation}:${entry.x}:${entry.y}`).join('|');
    return leftHeight - rightHeight || leftWaste - rightWaste || leftSpan - rightSpan || leftSignature.localeCompare(rightSignature);
  });
  const best = completed[0];
  const packedHeight = options.canvasHeight - best.minY;
  const horizontalSpan = best.maxX - best.minX + 1;
  const boundingArea = packedHeight * horizontalSpan;
  const metrics: CcShapePackingMetrics = {
    shapeCount: best.placements.length,
    occupiedArea: best.occupiedArea,
    packedHeight,
    horizontalSpan,
    boundingWasteArea: boundingArea - best.occupiedArea,
    packingDensity: boundingArea > 0 ? best.occupiedArea / boundingArea : 1,
    exploredStateCount,
    orderingCount: activeOrderings.length,
  };
  return { placements: best.placements, metrics };
};
