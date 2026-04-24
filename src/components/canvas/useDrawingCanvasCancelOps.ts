import { getAppStoreState } from '@/stores/appStoreAccess';
import { useCallback } from 'react';

type CancelOptions = {
  includeFloatingPaste?: boolean;
  dispatchInteractionEnd?: boolean;
};

interface UseDrawingCanvasCancelOpsOptions {
  clearDrawingCanvas: () => void;
  interactionDispatch: (action: { type: 'DRAWING_END' }) => void;
  resetPolygonGradient: () => void;
  resetRectangleGradient: () => void;
  setNeedsRedraw: React.Dispatch<React.SetStateAction<number>>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  isDrawingShapeRef: React.MutableRefObject<boolean>;
  shapePointsRef: React.MutableRefObject<Array<unknown>>;
  isSelectingDirectionRef: React.MutableRefObject<boolean>;
}

export const useDrawingCanvasCancelOps = ({
  clearDrawingCanvas,
  interactionDispatch,
  resetPolygonGradient,
  resetRectangleGradient,
  setNeedsRedraw,
  overlayCanvasRef,
  isDrawingShapeRef,
  shapePointsRef,
  isSelectingDirectionRef,
}: UseDrawingCanvasCancelOpsOptions) =>
  useCallback(
    ({ includeFloatingPaste = false, dispatchInteractionEnd = true }: CancelOptions = {}) => {
      const store = getAppStoreState();
      let didCancel = false;

      if (store.polygonGradientState.drawingState !== 'idle') {
        resetPolygonGradient();
        didCancel = true;
      }

      if (store.rectangleBrushState.drawingState !== 'idle') {
        resetRectangleGradient();
        didCancel = true;
      }

      const hasShapeDrawing =
        store.shapeState.isDrawing ||
        store.shapeState.points.length > 0 ||
        isDrawingShapeRef.current ||
        shapePointsRef.current.length > 0 ||
        isSelectingDirectionRef.current;

      if (hasShapeDrawing) {
        store.setShapeDrawing(false);
        store.clearShapePoints();
        shapePointsRef.current = [];
        isDrawingShapeRef.current = false;
        isSelectingDirectionRef.current = false;
        didCancel = true;
      }

      if (store.shapeFill.session) {
        store.cancelShapeFillSession();
        didCancel = true;
      }

      if (includeFloatingPaste && store.floatingPaste) {
        store.cancelFloatingPaste();
        didCancel = true;
      }

      if (didCancel) {
        const overlayCanvas = overlayCanvasRef.current;
        if (overlayCanvas) {
          overlayCanvas.getContext('2d')?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }
        clearDrawingCanvas();
        if (dispatchInteractionEnd) {
          interactionDispatch({ type: 'DRAWING_END' });
        }
        setNeedsRedraw((prev) => prev + 1);
      }

      return didCancel;
    },
    [
      clearDrawingCanvas,
      interactionDispatch,
      isDrawingShapeRef,
      isSelectingDirectionRef,
      overlayCanvasRef,
      resetPolygonGradient,
      resetRectangleGradient,
      setNeedsRedraw,
      shapePointsRef,
    ]
  );
