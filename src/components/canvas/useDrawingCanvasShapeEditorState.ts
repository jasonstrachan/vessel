import { useMemo, useRef } from 'react';
import type { ShapePoint } from '@/types';
import type { Project } from '@/types';
import { getCanvasBounds, normalizeCanvasShape } from '@/utils/canvasShape';

export const useDrawingCanvasShapeEditorState = ({
  project,
}: {
  project: Project | null;
}) => {
  const activeCanvasShape = useMemo(
    () => (project ? normalizeCanvasShape(project.canvasShape, project.width, project.height) : null),
    [project]
  );

  const canvasBounds = useMemo(
    () => (project ? getCanvasBounds(project.width, project.height) : null),
    [project]
  );

  const canvasShapeEditRef = useRef<{ isDrawing: boolean; start: ShapePoint | null }>({
    isDrawing: false,
    start: null,
  });
  const freehandPointsRef = useRef<ShapePoint[]>([]);

  return {
    activeCanvasShape,
    canvasBounds,
    canvasShapeEditRef,
    freehandPointsRef,
  };
};
