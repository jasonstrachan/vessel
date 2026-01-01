import type React from 'react';
import type { AppState } from '@/stores/useAppStore';

export const getColorCycleStampTargetCtx = ({
  storeRef,
  drawingCtxRef,
}: {
  storeRef: React.MutableRefObject<AppState>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
}): CanvasRenderingContext2D | null => {
  const st = storeRef.current;
  const layer = st.layers.find(l => l.id === st.activeLayerId);
  let layerCanvas = layer?.colorCycleData?.canvas;

  if (!layerCanvas && layer?.layerType === 'color-cycle' && st.project) {
    try {
      st.initColorCycleForLayer(layer.id, st.project.width, st.project.height);
    } catch {}
    layerCanvas = st.layers.find(l => l.id === st.activeLayerId)?.colorCycleData?.canvas;
  }

  if (layerCanvas) {
    const layerCtx = layerCanvas.getContext('2d');
    if (layerCtx) {
      return layerCtx;
    }
  }

  return drawingCtxRef.current;
};
