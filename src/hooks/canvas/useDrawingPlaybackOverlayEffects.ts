import { useEffect, type MutableRefObject } from 'react';

interface UseDrawingPlaybackOverlayEffectsOptions {
  drawingCtxRef: MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  drawingCanvasHasContent: MutableRefObject<boolean>;
  initDrawingCanvas: () => void;
  shapeMode: boolean;
}

export const useDrawingPlaybackOverlayEffects = ({
  drawingCtxRef,
  drawingCanvasRef,
  drawingCanvasHasContent,
  initDrawingCanvas,
  shapeMode,
}: UseDrawingPlaybackOverlayEffectsOptions) => {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleClearOverlay = () => {
      try {
        const ctx = drawingCtxRef.current;
        const canvas = drawingCanvasRef.current;
        if (!ctx || !canvas) return;
        ctx.setTransform?.(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawingCanvasHasContent.current = false;
      } catch {
        // no-op
      }
    };
    window.addEventListener('cc:clear-overlay', handleClearOverlay);
    return () => {
      window.removeEventListener('cc:clear-overlay', handleClearOverlay);
    };
  }, [drawingCtxRef, drawingCanvasRef, drawingCanvasHasContent]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    initDrawingCanvas();
  }, [initDrawingCanvas]);

  useEffect(() => {
    if (!shapeMode) {
      return;
    }
    initDrawingCanvas();
  }, [shapeMode, initDrawingCanvas]);
};
