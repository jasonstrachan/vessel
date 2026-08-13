import type { ColorCycleSurfaceBrush } from './colorCycleSurface';

type LayerLike = {
  id: string;
  layerType?: string;
  colorCycleData?: {
    canvas?: HTMLCanvasElement | null;
  };
};

export type ColorCycleBrushLifecycle = ColorCycleSurfaceBrush & {
  setLayerId?: (layerId: string) => void;
  setActiveLayer?: (layerId: string) => void;
  commitCurrentStroke?: (layerId: string) => void;
  commitToLayer?: (canvas: HTMLCanvasElement, layerId: string) => void;
  renderDirectToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void;
  clearPaintBuffer?: (layerId: string) => void;
  finalizeCurrentStroke?: (layerId: string) => void;
  endStroke?: (layerId?: string) => void;
  startStroke?: (layerId: string, clearBuffer?: boolean) => void;
};

export const resetColorCycleStroke = ({
  clearBuffer = false,
  options,
  initializeColorCycleBrush,
  activeLayerId,
  getLayers,
  bindBrushToCanvas,
  beforeStartStroke,
  firstStampImmediateRef,
}: {
  clearBuffer?: boolean;
  options?: { skipGradientReinit?: boolean };
  initializeColorCycleBrush: (options?: { skipGradientReinit?: boolean }) => ColorCycleBrushLifecycle | null;
  activeLayerId: string | null;
  getLayers: () => LayerLike[];
  bindBrushToCanvas: (
    brush: ColorCycleSurfaceBrush | null | undefined,
    canvas: HTMLCanvasElement | null | undefined
  ) => void;
  beforeStartStroke?: () => void;
  firstStampImmediateRef: { current: boolean };
}): void => {
  try {
    const brush = initializeColorCycleBrush(options);

    if (brush) {
      const layerId = activeLayerId;
      if (!layerId) {
        return;
      }
      brush.setLayerId?.(layerId);
      brush.setActiveLayer?.(layerId);

      try {
        const layer = getLayers().find((entry) => entry.id === layerId);
        const layerCanvas = layer?.colorCycleData?.canvas || null;
        if (layer && layer.layerType === 'color-cycle' && layerCanvas) {
          const internal = brush.getCanvas?.() ?? null;
          const ictx = internal?.getContext?.('2d');
          let hasAlpha = false;
          try {
            const img = internal && ictx && 'getImageData' in ictx
              ? ictx?.getImageData(0, 0, Math.min(8, internal.width), Math.min(8, internal.height))
              : null;
            const data = img?.data ?? null;
            if (data) {
              for (let i = 3; i < data.length; i += 4) {
                if (data[i] > 0) {
                  hasAlpha = true;
                  break;
                }
              }
            }
          } catch {}

          if (hasAlpha) {
            bindBrushToCanvas(brush, layerCanvas);
            brush.commitCurrentStroke?.(layerId);
            if (typeof brush.commitToLayer === 'function') {
              brush.commitToLayer(layerCanvas, layerId);
            } else {
              brush.renderDirectToCanvas?.(layerCanvas, layerId);
            }
          }
        }
      } catch {}

      try {
        if (typeof brush.finalizeCurrentStroke === 'function') {
          brush.finalizeCurrentStroke(layerId);
        } else if (typeof brush.endStroke === 'function') {
          brush.endStroke(layerId);
        }
      } catch {}

      beforeStartStroke?.();

      if (typeof brush.startStroke === 'function') {
        brush.startStroke(layerId, clearBuffer);
        firstStampImmediateRef.current = true;
      }
    }
  } catch {}
};

export const endColorCycleStrokeForLayer = ({
  activeLayerId,
  getActiveLayerColorCycleBrush,
}: {
  activeLayerId: string | null;
  getActiveLayerColorCycleBrush: () => Pick<ColorCycleBrushLifecycle, 'endStroke'> | null;
}): void => {
  const colorCycleBrush = getActiveLayerColorCycleBrush();
  const layerId = activeLayerId;
  if (colorCycleBrush && layerId && typeof colorCycleBrush.endStroke === 'function') {
    colorCycleBrush.endStroke(layerId);
  }
};
