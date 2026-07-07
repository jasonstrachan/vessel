import { useStrokeToolRuntime } from '@/canvas/runtime/StrokeRuntime';
import { useShapeToolRuntime } from '@/canvas/runtime/ShapeRuntime';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import type { useDrawingHandlersStoreState } from '@/hooks/canvas/useDrawingHandlersStoreState';
import type { useUserBrushEngine } from '@/hooks/useUserBrushEngine';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type StoreState = ReturnType<typeof useDrawingHandlersStoreState>;

interface UseDrawingHandlersToolRuntimeBridgesOptions {
  refs: DrawingHandlerRefs;
  storeRef: StoreState['storeRef'];
  brushStampRuntime: Parameters<typeof useStrokeToolRuntime>[0]['brushRuntime'];
  userBrushEngine: ReturnType<typeof useUserBrushEngine>;
}

export const useDrawingHandlersToolRuntimeBridges = ({
  refs,
  storeRef,
  brushStampRuntime,
  userBrushEngine,
}: UseDrawingHandlersToolRuntimeBridgesOptions) => {
  const shapeRuntime = useShapeToolRuntime({
    refs,
    storeRef,
  });

  const brushToolRuntime = useStrokeToolRuntime({
    refs,
    storeRef,
    brushRuntime: brushStampRuntime,
    userBrushEngine,
  });

  return {
    shapeRuntime,
    brushToolRuntime,
  };
};
