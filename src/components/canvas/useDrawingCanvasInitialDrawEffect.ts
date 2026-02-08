import { useEffect, type MutableRefObject, type RefObject } from 'react';

interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface UseDrawingCanvasInitialDrawEffectOptions {
  draw: (
    ctx: CanvasRenderingContext2D,
    transform: ViewTransform,
    skipDrawingCanvas?: boolean
  ) => void;
  drawRef: MutableRefObject<
    ((
      ctx: CanvasRenderingContext2D,
      viewTransform: { scale: number; offsetX: number; offsetY: number }
    ) => void) | null
  >;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  viewTransformRef: MutableRefObject<ViewTransform>;
}

export const useDrawingCanvasInitialDrawEffect = ({
  draw,
  drawRef,
  canvasRef,
  viewTransformRef,
}: UseDrawingCanvasInitialDrawEffectOptions) => {
  useEffect(() => {
    drawRef.current = draw;

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx && viewTransformRef.current) {
      draw(ctx, viewTransformRef.current);
    }
  }, [draw, drawRef, canvasRef, viewTransformRef]);
};
