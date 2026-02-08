import type React from 'react';
import { useEffect } from 'react';

interface UseDrawingCanvasResizeCenterOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  devicePixelRatioRef: React.MutableRefObject<number>;
  drawRef: React.MutableRefObject<
    | ((
        ctx: CanvasRenderingContext2D,
        transform: { scale: number; offsetX: number; offsetY: number },
        skipDrawingCanvas?: boolean
      ) => void)
    | null
  >;
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  hasCenteredRef: React.MutableRefObject<boolean>;
  project: { width: number; height: number } | null;
  setCanvasDimensions: (width: number, height: number) => void;
  setPan: (offsetX: number, offsetY: number) => void;
}

export const useDrawingCanvasResizeCenter = ({
  canvasRef,
  wrapperRef,
  overlayCanvasRef,
  devicePixelRatioRef,
  drawRef,
  viewTransformRef,
  hasCenteredRef,
  project,
  setCanvasDimensions,
  setPan,
}: UseDrawingCanvasResizeCenterOptions) => {
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    let lastWidth = 0;
    let lastHeight = 0;
    let lastDpr = devicePixelRatioRef.current;

    const handleResize = () => {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      const { width, height } = wrapper.getBoundingClientRect();
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

      if (width !== lastWidth || height !== lastHeight || dpr !== lastDpr) {
        lastWidth = width;
        lastHeight = height;
        lastDpr = dpr;
        devicePixelRatioRef.current = dpr;

        const targetWidth = Math.max(1, Math.round(width * dpr));
        const targetHeight = Math.max(1, Math.round(height * dpr));
        if (canvas.width !== targetWidth) {
          canvas.width = targetWidth;
        }
        if (canvas.height !== targetHeight) {
          canvas.height = targetHeight;
        }

        const overlayCanvas = overlayCanvasRef.current;
        if (overlayCanvas) {
          const overlayWidth = Math.max(1, Math.round(width));
          const overlayHeight = Math.max(1, Math.round(height));
          if (overlayCanvas.width !== overlayWidth) {
            overlayCanvas.width = overlayWidth;
          }
          if (overlayCanvas.height !== overlayHeight) {
            overlayCanvas.height = overlayHeight;
          }
        }

        setCanvasDimensions(width, height);

        const drawFunc = drawRef.current;
        const viewTransform = viewTransformRef.current;
        if (drawFunc) {
          drawFunc(ctx, viewTransform);
        }

        if (!hasCenteredRef.current && project) {
          const scale = viewTransform.scale || 1;
          const contentWidth = project.width * scale;
          const contentHeight = project.height * scale;
          const offsetX = Math.floor((width - contentWidth) / 2);
          const offsetY = Math.floor((height - contentHeight) / 2);

          setPan(offsetX, offsetY);
          viewTransformRef.current.offsetX = offsetX;
          viewTransformRef.current.offsetY = offsetY;

          if (drawFunc) {
            drawFunc(ctx, viewTransformRef.current);
          }

          hasCenteredRef.current = true;
        }
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(handleResize);
    });

    resizeObserver.observe(wrapper);
    handleResize();

    return () => resizeObserver.disconnect();
  }, [
    canvasRef,
    wrapperRef,
    overlayCanvasRef,
    devicePixelRatioRef,
    drawRef,
    viewTransformRef,
    hasCenteredRef,
    project,
    setCanvasDimensions,
    setPan,
  ]);

  useEffect(() => {
    if (!project) return;
    const canvasEl = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvasEl || !wrapper) return;
    if (hasCenteredRef.current) return;

    const { width, height } = wrapper.getBoundingClientRect();
    const scale = viewTransformRef.current?.scale || 1;
    const contentWidth = project.width * scale;
    const contentHeight = project.height * scale;
    const offsetX = Math.floor((width - contentWidth) / 2);
    const offsetY = Math.floor((height - contentHeight) / 2);

    setPan(offsetX, offsetY);
    viewTransformRef.current.offsetX = offsetX;
    viewTransformRef.current.offsetY = offsetY;

    const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    if (ctx && drawRef.current) {
      drawRef.current(ctx, viewTransformRef.current);
    }

    hasCenteredRef.current = true;
  }, [project, setPan, canvasRef, wrapperRef, hasCenteredRef, viewTransformRef, drawRef]);
};
