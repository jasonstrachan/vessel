import { useEffect } from 'react';
import type React from 'react';
import {
  ensureOverlaySize as ensureOverlaySizeExternal,
} from '@/hooks/canvas/handlers/overlayCanvas';

export const useOverlaySizeEffects = ({
  ensureOverlayInitialized,
  project,
  activeLayerWidth,
  activeLayerHeight,
  drawingCanvasRef,
  drawingCtxRef,
  drawingCanvasHasContent,
}: {
  ensureOverlayInitialized: () => void;
  project: { width: number; height: number } | null;
  activeLayerWidth: number | null;
  activeLayerHeight: number | null;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
}): void => {
  useEffect(() => {
    ensureOverlayInitialized();
  }, [ensureOverlayInitialized]);

  useEffect(() => {
    const projWidth = project?.width ?? null;
    const projHeight = project?.height ?? null;

    const targetWidth = projWidth || activeLayerWidth;
    const targetHeight = projHeight || activeLayerHeight;
    if (!targetWidth || !targetHeight) {
      return;
    }

    ensureOverlaySizeExternal({
      targetWidth,
      targetHeight,
      drawingCanvasRef,
      drawingCtxRef,
      drawingCanvasHasContent,
    });
  }, [project?.width, project?.height, activeLayerWidth, activeLayerHeight, drawingCanvasHasContent, drawingCanvasRef, drawingCtxRef]);
};
