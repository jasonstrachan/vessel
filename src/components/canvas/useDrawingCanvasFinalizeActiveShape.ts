import { useCallback } from 'react';

import { getAppStoreState } from '@/stores/appStoreAccess';
import { SHAPE_FILL_COMMIT_KEY } from '@/hooks/canvas/handlers/shapes/ShapeToolHandler';
import { runToolFlush } from '@/utils/toolFlushRegistry';

interface DrawingHandlersLike {
  initDrawingCanvas: () => void;
  drawingCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  finalizeDrawing: (skipHistory: boolean) => Promise<void>;
  isDrawingShapeRef: React.MutableRefObject<boolean>;
  finalizeShapeDrawing: () => Promise<void>;
}

interface UseDrawingCanvasFinalizeActiveShapeOptions {
  finalizeRectangleGradientFromState: () => Promise<boolean>;
  drawingHandlers: DrawingHandlersLike;
  sampleColorAtPosition: (x: number, y: number) => string;
  stateMachine: { finalizationComplete: () => void };
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  rebuildStaticComposite: () => boolean | Promise<boolean>;
  compositeCanvasDirtyRef: React.MutableRefObject<boolean>;
  setNeedsRedraw: React.Dispatch<React.SetStateAction<number>>;
  interactionDispatch: (action: { type: 'DRAWING_END' }) => void;
  tools: { shapeMode: boolean };
}

export const useDrawingCanvasFinalizeActiveShape = ({
  finalizeRectangleGradientFromState,
  drawingHandlers,
  stateMachine,
  rebuildStaticComposite,
  compositeCanvasDirtyRef,
  setNeedsRedraw,
  interactionDispatch,
  tools,
}: UseDrawingCanvasFinalizeActiveShapeOptions) =>
  useCallback(async (): Promise<boolean> => {
    const store = getAppStoreState();

    if (store.rectangleBrushState.drawingState !== 'idle') {
      return finalizeRectangleGradientFromState();
    }

    if (store.shapeFill.session) {
      return runToolFlush(SHAPE_FILL_COMMIT_KEY);
    }

    if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
      try {
        await drawingHandlers.finalizeShapeDrawing();
      } finally {
        stateMachine.finalizationComplete();
      }

      if (rebuildStaticComposite()) {
        compositeCanvasDirtyRef.current = false;
      }

      setNeedsRedraw((prev) => prev + 1);
      interactionDispatch({ type: 'DRAWING_END' });
      return true;
    }

    return false;
  }, [
    compositeCanvasDirtyRef,
    drawingHandlers,
    finalizeRectangleGradientFromState,
    interactionDispatch,
    rebuildStaticComposite,
    setNeedsRedraw,
    stateMachine,
    tools.shapeMode,
  ]);
