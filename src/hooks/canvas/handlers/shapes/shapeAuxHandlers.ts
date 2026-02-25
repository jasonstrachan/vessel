import {
  createClearDrawingCanvasDispatcher,
} from '@/hooks/canvas/handlers/clearDrawingCanvas';
import {
  coerceDragShapeToPolygon as coerceDragShapeToPolygonExternal,
} from '@/hooks/canvas/handlers/shapes/shapeDragPolygon';
import {
  createShapeSnapshotDispatchers,
} from '@/hooks/canvas/handlers/shapeSnapshots';

type ClearArgs = Parameters<typeof createClearDrawingCanvasDispatcher>[0];
type CoerceArgs = Parameters<typeof coerceDragShapeToPolygonExternal>[0];
type SnapshotArgs = Parameters<typeof createShapeSnapshotDispatchers>[0];

export const createShapeAuxHandlers = ({
  clearArgs,
  coerceArgs,
  snapshotArgs,
}: {
  clearArgs: ClearArgs;
  coerceArgs: CoerceArgs;
  snapshotArgs: SnapshotArgs;
}) => {
  const clearDrawingCanvas = createClearDrawingCanvasDispatcher(clearArgs);
  const coerceDragShapeToPolygon = () => coerceDragShapeToPolygonExternal(coerceArgs);
  const shapeSnapshots = createShapeSnapshotDispatchers(snapshotArgs);
  return {
    clearDrawingCanvas,
    coerceDragShapeToPolygon,
    ...shapeSnapshots,
  };
};
