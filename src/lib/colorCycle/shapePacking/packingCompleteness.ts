import { CcShapePackingError, type CcExtractedShape, type CcShapePackingResult } from './types';

export const isCompleteCcPacking = (
  shapes: readonly CcExtractedShape[],
  packing: CcShapePackingResult,
): boolean => {
  if (packing.placements.length !== shapes.length) return false;
  const placedIds = new Set(packing.placements.map((placement) => placement.shapeId));
  return shapes.every((shape) => placedIds.has(shape.id));
};

/** Prevents preview-only partial placements from reaching a destructive rewrite. */
export const assertCompleteCcPacking = (
  shapes: readonly CcExtractedShape[],
  packing: CcShapePackingResult,
): void => {
  if (isCompleteCcPacking(shapes, packing)) return;
  const placedIds = new Set(packing.placements.map((placement) => placement.shapeId));
  throw new CcShapePackingError(
    'partial-packing-cannot-be-materialized',
    'A partial packing result is diagnostics-only and cannot rewrite project data.',
    {
      shapeCount: shapes.length,
      placedShapeCount: packing.placements.length,
      unplacedShapeIds: shapes.filter((shape) => !placedIds.has(shape.id)).map((shape) => shape.id),
    },
  );
};
