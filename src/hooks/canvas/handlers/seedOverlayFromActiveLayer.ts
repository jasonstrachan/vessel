import { getAppStoreState } from '@/stores/appStoreAccess';
import type { Layer } from '@/types';
import { setOverlaySeededFromLayer } from '@/hooks/canvas/utils/overlaySeedState';
import { getSequentialLayerRenderCanvas } from '@/lib/sequential/SequentialLayerRenderer';

export const seedOverlayFromActiveLayer = ({
  activeLayer,
  drawCtx,
}: {
  activeLayer: Layer;
  drawCtx: CanvasRenderingContext2D;
}): boolean => {
  if (activeLayer.layerType === 'color-cycle') {
    setOverlaySeededFromLayer(drawCtx.canvas, false);
    return false;
  }

  if (activeLayer.layerType === 'sequential' && activeLayer.sequentialData) {
    const state = getAppStoreState();
    const project = state.project;
    if (project) {
      const source = getSequentialLayerRenderCanvas({
        layer: activeLayer,
        width: project.width,
        height: project.height,
        frameIndex: state.sequentialRecord.currentFrame,
        holdPreviousOnEmptyFrames: true,
      });
      if (source) {
        try {
          drawCtx.drawImage(source, 0, 0);
          setOverlaySeededFromLayer(drawCtx.canvas, true);
          return true;
        } catch {
          // Fall through to framebuffer/imageData fallback.
        }
      }
    }
  }

  const framebuffer = activeLayer.framebuffer;
  if (framebuffer && framebuffer.width > 0 && framebuffer.height > 0) {
    try {
      drawCtx.drawImage(framebuffer, 0, 0);
      setOverlaySeededFromLayer(drawCtx.canvas, true);
      return true;
    } catch {
      // Fall back to imageData when framebuffer is temporarily unavailable.
    }
  }

  if (activeLayer.imageData) {
    drawCtx.putImageData(activeLayer.imageData, 0, 0);
    setOverlaySeededFromLayer(drawCtx.canvas, true);
    return true;
  }

  setOverlaySeededFromLayer(drawCtx.canvas, false);
  return false;
};
