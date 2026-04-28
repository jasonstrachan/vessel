import type { ColorCycleBrushImplementation } from './ColorCycleBrushMigration';

type LayerLike = {
  id: string;
  layerType?: string;
  colorCycleData?: {
    canvas?: HTMLCanvasElement | null;
  };
};

type ColorCycleBrushLifecycle = ColorCycleBrushImplementation & {
  setLayerId?: (layerId: string) => void;
  setActiveLayer?: (layerId: string) => void;
  commitCurrentStroke?: (layerId: string) => void;
  commitToLayer?: (canvas: HTMLCanvasElement, layerId: string) => void;
  renderDirectToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void;
  clearPaintBuffer?: (layerId: string) => void;
  finalizeCurrentStroke?: (layerId: string) => void;
  startStroke: (layerId: string, clearBuffer?: boolean) => void;
};

export const resetColorCycleStroke = ({
  clearBuffer = false,
  options,
  initializeColorCycleBrush,
  activeLayerId,
  getLayers,
  bindBrushToCanvas,
  firstStampImmediateRef,
}: {
  clearBuffer?: boolean;
  options?: { skipGradientReinit?: boolean };
  initializeColorCycleBrush: (options?: { skipGradientReinit?: boolean }) => ColorCycleBrushImplementation | null;
  activeLayerId: string | null;
  getLayers: () => LayerLike[];
  bindBrushToCanvas: (
    brush: ColorCycleBrushImplementation | null | undefined,
    canvas: HTMLCanvasElement | null | undefined
  ) => void;
  firstStampImmediateRef: { current: boolean };
}): void => {
  try {
    const brush = initializeColorCycleBrush(options) as ColorCycleBrushLifecycle | null;

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
          const internal = brush.getCanvas();
          const ictx = internal.getContext?.('2d');
          let hasAlpha = false;
          try {
            const img = ictx?.getImageData(0, 0, Math.min(8, internal.width), Math.min(8, internal.height));
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

      brush.startStroke(layerId, clearBuffer);
      firstStampImmediateRef.current = true;
    }
  } catch {}
};

export const endColorCycleStrokeForLayer = ({
  activeLayerId,
  getActiveLayerColorCycleBrush,
}: {
  activeLayerId: string | null;
  getActiveLayerColorCycleBrush: () => ColorCycleBrushImplementation | null;
}): void => {
  const colorCycleBrush = getActiveLayerColorCycleBrush();
  const layerId = activeLayerId;
  if (colorCycleBrush && layerId) {
    colorCycleBrush.endStroke(layerId);
  }
};
