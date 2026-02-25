import type React from 'react';

interface UseDrawingCanvasElementRefsOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export const useDrawingCanvasElementRefs = ({
  canvasRef,
  wrapperRef,
  overlayCanvasRef,
}: UseDrawingCanvasElementRefsOptions) => ({
  canvasElementRef: canvasRef as React.RefObject<HTMLCanvasElement>,
  wrapperElementRef: wrapperRef as React.RefObject<HTMLDivElement>,
  overlayCanvasElementRef: overlayCanvasRef as React.RefObject<HTMLCanvasElement>,
});
