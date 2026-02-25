import { useEffect, type MutableRefObject } from 'react';

interface UseDrawingCanvasViewScaleSyncOptions {
  viewTransformRef: MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  canvasZoom: number;
}

export const useDrawingCanvasViewScaleSync = ({
  viewTransformRef,
  canvasZoom,
}: UseDrawingCanvasViewScaleSyncOptions) => {
  useEffect(() => {
    viewTransformRef.current.scale = canvasZoom || 1;
  }, [canvasZoom, viewTransformRef]);
};
