import { useRef } from 'react';

export const useDrawingCanvasRenderRuntimeRefs = () => {
  const drawRef = useRef<
    ((ctx: CanvasRenderingContext2D, viewTransform: { scale: number; offsetX: number; offsetY: number }) => void) | null
  >(null);
  const drawingAnimationFrameRef = useRef<number | null>(null);
  const previewAnimationFrameRef = useRef<number | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const devicePixelRatioRef = useRef(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const hasCenteredRef = useRef(false);

  return {
    drawRef,
    drawingAnimationFrameRef,
    previewAnimationFrameRef,
    overlayCanvasRef,
    devicePixelRatioRef,
    hasCenteredRef,
  };
};
