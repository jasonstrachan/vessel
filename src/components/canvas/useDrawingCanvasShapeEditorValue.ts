import { useMemo } from 'react';
import { useAppStore } from '@/stores/useAppStore';

export const useDrawingCanvasShapeEditorValue = () => {
  const fallbackCanvasShapeEditor = useMemo(
    () => ({
      active: false,
      tool: null,
      draft: null,
    }),
    []
  );

  const canvasShapeEditor = useAppStore((state) => state.canvasShapeEditor) ?? fallbackCanvasShapeEditor;

  return {
    canvasShapeEditor,
  };
};
