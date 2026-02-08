import { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
import { useDrawingShapeAuxRuntime } from '@/hooks/canvas/useDrawingShapeAuxRuntime';
import { useDrawingShapeRuntime } from '@/hooks/canvas/useDrawingShapeRuntime';

type DrawingHandlerRefs = ReturnType<typeof useDrawingHandlerRefs>;

type ShapeAuxRuntimeArgs = Parameters<typeof useDrawingShapeAuxRuntime>[0];
type ShapeRuntimeArgs = Parameters<typeof useDrawingShapeRuntime>[0];

interface UseDrawingShapeLifecycleBridgeOptions {
  refs: DrawingHandlerRefs;
  shapeAuxOptions: Omit<ShapeAuxRuntimeArgs, 'refs'>;
  shapeRuntimeOptions: Omit<
    ShapeRuntimeArgs,
    'refs' | 'capturePendingShapeSnapshot' | 'clearShapeBeforeSnapshot'
  >;
}

export const useDrawingShapeLifecycleBridge = ({
  refs,
  shapeAuxOptions,
  shapeRuntimeOptions,
}: UseDrawingShapeLifecycleBridgeOptions) => {
  const {
    clearDrawingCanvas,
    coerceDragShapeToPolygon,
    clearShapeBeforeSnapshot,
    capturePendingShapeSnapshot,
  } = useDrawingShapeAuxRuntime({
    refs,
    ...shapeAuxOptions,
  });

  const {
    startShapeDrawing,
    continueShapeDrawing,
    finalizeShapeDrawing,
  } = useDrawingShapeRuntime({
    refs,
    ...shapeRuntimeOptions,
    capturePendingShapeSnapshot,
    clearShapeBeforeSnapshot,
  });

  return {
    clearDrawingCanvas,
    coerceDragShapeToPolygon,
    startShapeDrawing,
    continueShapeDrawing,
    finalizeShapeDrawing,
  };
};
