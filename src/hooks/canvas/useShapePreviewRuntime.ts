import { useMemo } from 'react';
import {
  createResetShapeDragRefsDispatcher,
} from '@/hooks/canvas/handlers/shapes/resetShapeDragRefs';
import {
  createShapePreviewDispatchers,
} from '@/hooks/canvas/handlers/shapes/shapePreviewThrottle';

type ResetShapeDragRefsArgs = Parameters<typeof createResetShapeDragRefsDispatcher>[0];
type ShapePreviewDispatchersArgs = Parameters<typeof createShapePreviewDispatchers>[0];

interface UseShapePreviewRuntimeArgs {
  resetShapeDragRefsArgs: ResetShapeDragRefsArgs;
  shapePreviewDispatchersArgs: ShapePreviewDispatchersArgs;
}

export const useShapePreviewRuntime = ({
  resetShapeDragRefsArgs,
  shapePreviewDispatchersArgs,
}: UseShapePreviewRuntimeArgs) => {
  const resetShapeDragRefs = useMemo(
    () => createResetShapeDragRefsDispatcher(resetShapeDragRefsArgs),
    [resetShapeDragRefsArgs]
  );

  const { triggerSimpleShapePreview, setSimpleShapePreviewRenderer } = useMemo(
    () => createShapePreviewDispatchers(shapePreviewDispatchersArgs),
    [shapePreviewDispatchersArgs]
  );

  return {
    resetShapeDragRefs,
    triggerSimpleShapePreview,
    setSimpleShapePreviewRenderer,
  };
};
