import {
  createShapeDrawingDispatchers,
} from '@/hooks/canvas/handlers/shapes/shapeDrawingDispatch';

type ShapeDispatchOptions = Parameters<typeof createShapeDrawingDispatchers>[0];

export const createShapeDrawingHandlers = ({
  shapeMode,
  shapeDrawingRefs,
  shapeDrawingDeps,
  toolsRef,
  isPointerDownRef,
}: ShapeDispatchOptions) => {
  return createShapeDrawingDispatchers({
    shapeMode,
    shapeDrawingRefs,
    shapeDrawingDeps,
    toolsRef,
    isPointerDownRef,
  });
};
