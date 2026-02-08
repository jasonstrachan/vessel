import type React from 'react';
import type { AppState } from '@/stores/useAppStore';

export type OverlayCanvasDeps = {
  project: { width: number; height: number } | null;
  storeRef: React.MutableRefObject<AppState>;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  activeLayerWidth: number | null;
  activeLayerHeight: number | null;
};

export type CreateOverlayCanvasDispatchersArgs = OverlayCanvasDeps;

export const initDrawingCanvas = ({
  project,
  storeRef,
  drawingCanvasRef,
  drawingCtxRef,
}: Pick<OverlayCanvasDeps, 'project' | 'storeRef' | 'drawingCanvasRef' | 'drawingCtxRef'>): void => {
  let width = project?.width ?? 0;
  let height = project?.height ?? 0;

  if (!width || !height) {
    try {
      const state = storeRef.current;
      const ccLayer = state.layers.find(layer => (
        layer.layerType === 'color-cycle' &&
        layer.colorCycleData?.canvas
      ));
      if (ccLayer?.colorCycleData?.canvas) {
        width = ccLayer.colorCycleData.canvas.width || width;
        height = ccLayer.colorCycleData.canvas.height || height;
      }
    } catch {}
  }

  if (!width || !height) {
    try {
      const state = storeRef.current;
      const activeLayer = state.layers.find(layer => layer.id === state.activeLayerId);
      const framebuffer = activeLayer?.framebuffer as { width?: number; height?: number } | undefined;
      if (framebuffer?.width && framebuffer?.height) {
        width = framebuffer.width || width;
        height = framebuffer.height || height;
      }
    } catch {}
  }

  if (!width || !height) {
    width = 64;
    height = 64;
  }

  if (!drawingCanvasRef.current) {
    drawingCanvasRef.current = document.createElement('canvas');
  }

  if (drawingCanvasRef.current.width !== width || drawingCanvasRef.current.height !== height) {
    drawingCanvasRef.current.width = width;
    drawingCanvasRef.current.height = height;
  }

  drawingCtxRef.current = drawingCanvasRef.current.getContext('2d', {
    willReadFrequently: true,
    alpha: true,
    desynchronized: true
  });
};

export const ensureOverlayInitialized = ({
  project,
  drawingCanvasRef,
  drawingCtxRef,
  drawingCanvasHasContent,
  activeLayerWidth,
  activeLayerHeight,
  storeRef,
}: OverlayCanvasDeps): boolean => {
  if (!drawingCanvasRef.current || !drawingCtxRef.current) {
    initDrawingCanvas({ project, storeRef, drawingCanvasRef, drawingCtxRef });
    return Boolean(drawingCtxRef.current && drawingCanvasRef.current);
  }

  const targetW = project?.width ?? activeLayerWidth ?? drawingCanvasRef.current.width;
  const targetH = project?.height ?? activeLayerHeight ?? drawingCanvasRef.current.height;

  if (
    targetW &&
    targetH &&
    (drawingCanvasRef.current.width !== targetW || drawingCanvasRef.current.height !== targetH)
  ) {
    drawingCanvasRef.current.width = targetW;
    drawingCanvasRef.current.height = targetH;
    drawingCtxRef.current = drawingCanvasRef.current.getContext('2d', {
      willReadFrequently: true,
      alpha: true,
      desynchronized: true
    });
    drawingCanvasHasContent.current = false;
  }

  return Boolean(drawingCtxRef.current && drawingCanvasRef.current);
};

export const ensureOverlaySize = ({
  targetWidth,
  targetHeight,
  drawingCanvasRef,
  drawingCtxRef,
  drawingCanvasHasContent,
}: {
  targetWidth: number;
  targetHeight: number;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
}): void => {
  if (!targetWidth || !targetHeight) {
    return;
  }

  if (!drawingCanvasRef.current) {
    drawingCanvasRef.current = document.createElement('canvas');
  }

  if (
    drawingCanvasRef.current.width !== targetWidth ||
    drawingCanvasRef.current.height !== targetHeight
  ) {
    drawingCanvasRef.current.width = targetWidth;
    drawingCanvasRef.current.height = targetHeight;
    drawingCtxRef.current = drawingCanvasRef.current.getContext('2d', {
      willReadFrequently: true,
      alpha: true,
      desynchronized: true
    });
    drawingCanvasHasContent.current = false;
  }
};

export const createOverlayCanvasDispatchers = (
  args: CreateOverlayCanvasDispatchersArgs
): {
  initDrawingCanvas: () => void;
  ensureOverlayInitialized: () => boolean;
} => ({
  initDrawingCanvas: () => {
    initDrawingCanvas({
      project: args.project,
      storeRef: args.storeRef,
      drawingCanvasRef: args.drawingCanvasRef,
      drawingCtxRef: args.drawingCtxRef,
    });
  },
  ensureOverlayInitialized: () =>
    ensureOverlayInitialized({
      project: args.project,
      storeRef: args.storeRef,
      drawingCanvasRef: args.drawingCanvasRef,
      drawingCtxRef: args.drawingCtxRef,
      drawingCanvasHasContent: args.drawingCanvasHasContent,
      activeLayerWidth: args.activeLayerWidth,
      activeLayerHeight: args.activeLayerHeight,
    }),
});
