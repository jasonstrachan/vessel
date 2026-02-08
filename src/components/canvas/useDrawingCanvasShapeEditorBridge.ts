import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { useCanvasShapeEditorHandlers, type CanvasShapeDraft } from './useCanvasShapeEditorHandlers';

type CanvasShapeEditorHandlerOptions = Parameters<typeof useCanvasShapeEditorHandlers>[0];

interface UseDrawingCanvasShapeEditorBridgeOptions
  extends Omit<CanvasShapeEditorHandlerOptions, 'updateCanvasShapeDraft'> {
  setCanvasShapeDraft: (shape: CanvasShapeDraft | null) => void;
  setNeedsRedraw: Dispatch<SetStateAction<number>>;
}

export const useDrawingCanvasShapeEditorBridge = ({
  setCanvasShapeDraft,
  setNeedsRedraw,
  ...handlerOptions
}: UseDrawingCanvasShapeEditorBridgeOptions) => {
  const updateCanvasShapeDraft = useCallback(
    (shape: CanvasShapeDraft | null) => {
      setCanvasShapeDraft(shape);
      setNeedsRedraw((prev) => prev + 1);
    },
    [setCanvasShapeDraft, setNeedsRedraw]
  );

  return useCanvasShapeEditorHandlers({
    ...handlerOptions,
    updateCanvasShapeDraft,
  });
};
