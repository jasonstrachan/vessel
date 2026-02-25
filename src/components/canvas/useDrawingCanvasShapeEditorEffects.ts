import { useEffect, type MutableRefObject } from 'react';
import type { ShapePoint } from '@/types';

interface UseDrawingCanvasShapeEditorEffectsOptions {
  canvasShapeEditor: {
    active: boolean;
    tool: 'rectangle' | 'circle' | 'freehand' | null;
  };
  showFeedback?: (message: string) => void;
  canvasShapeEditRef: MutableRefObject<{ isDrawing: boolean; start: ShapePoint | null }>;
  freehandPointsRef: MutableRefObject<ShapePoint[]>;
}

export const useDrawingCanvasShapeEditorEffects = ({
  canvasShapeEditor,
  showFeedback,
  canvasShapeEditRef,
  freehandPointsRef,
}: UseDrawingCanvasShapeEditorEffectsOptions) => {
  useEffect(() => {
    if (canvasShapeEditor.active) {
      return;
    }
    canvasShapeEditRef.current.isDrawing = false;
    canvasShapeEditRef.current.start = null;
    freehandPointsRef.current = [];
  }, [canvasShapeEditor.active, canvasShapeEditRef, freehandPointsRef]);

  useEffect(() => {
    if (!canvasShapeEditor.active || !showFeedback) {
      return;
    }

    const toolLabel =
      canvasShapeEditor.tool === 'freehand'
        ? 'Freehand'
        : canvasShapeEditor.tool === 'circle'
          ? 'Circle'
          : 'Rectangle';
    showFeedback(`${toolLabel} canvas bounds: draw on the canvas. Enter to confirm, Esc to cancel.`);
  }, [canvasShapeEditor.active, canvasShapeEditor.tool, showFeedback]);
};
