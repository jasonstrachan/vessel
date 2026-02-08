import { useDrawingBrushToolRuntime } from '@/hooks/canvas/useDrawingBrushToolRuntime';
import { useDrawingShapeRuntimeBridge } from '@/hooks/canvas/useDrawingShapeRuntimeBridge';
import type { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import type { useDrawingHandlersStoreState } from '@/hooks/canvas/useDrawingHandlersStoreState';
import type { useBrushEngineSimplified } from '@/hooks/useBrushEngineSimplified';
import type { useUserBrushEngine } from '@/hooks/useUserBrushEngine';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;
type StoreState = ReturnType<typeof useDrawingHandlersStoreState>;

interface UseDrawingHandlersToolRuntimeBridgesOptions {
  refs: DrawingHandlerRefs;
  storeRef: StoreState['storeRef'];
  brushEngine: ReturnType<typeof useBrushEngineSimplified>;
  userBrushEngine: ReturnType<typeof useUserBrushEngine>;
}

export const useDrawingHandlersToolRuntimeBridges = ({
  refs,
  storeRef,
  brushEngine,
  userBrushEngine,
}: UseDrawingHandlersToolRuntimeBridgesOptions) => {
  const shapeRuntime = useDrawingShapeRuntimeBridge({
    refs,
    storeRef,
  });

  const brushToolRuntime = useDrawingBrushToolRuntime({
    refs,
    storeRef,
    brushEngine,
    userBrushEngine,
  });

  return {
    shapeRuntime,
    brushToolRuntime,
  };
};
