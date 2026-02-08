import type React from 'react';
import { useCallback } from 'react';
import { BrushShape, type Layer } from '@/types';
import { useAppStore } from '@/stores/useAppStore';
import {
  getSequentialLayerRenderCanvas,
} from '@/lib/sequential/SequentialLayerRenderer';

interface UseDrawingCanvasLayerRenderingOptions {
  project: { width: number; height: number; backgroundColor?: string | null } | null;
  layers: Layer[];
  activeLayerId: string | null;
  brushShape: BrushShape | undefined;
  antialiasing: boolean;
  displayMode: 'auto' | 'pixelated' | 'smooth';
  layerTransferCacheRef: React.MutableRefObject<Map<string, HTMLCanvasElement | OffscreenCanvas>>;
}

export const useDrawingCanvasLayerRendering = ({
  project,
  layers,
  activeLayerId,
  brushShape,
  antialiasing,
  displayMode,
  layerTransferCacheRef,
}: UseDrawingCanvasLayerRenderingOptions) => {
  return useCallback((ctx: CanvasRenderingContext2D) => {
    if (!project) return;

    const sortedLayers = [...layers].sort((a, b) => a.order - b.order);
    const activeId = activeLayerId;
    const storeState = useAppStore.getState() as {
      sequentialRecord?: { currentFrame?: number };
    };
    const sequentialFrameIndex = storeState.sequentialRecord?.currentFrame ?? 0;
    const isPixelatedDisplay = displayMode === 'pixelated';
    const shouldSmooth = !isPixelatedDisplay && !(
      brushShape === BrushShape.PIXEL_ROUND ||
      (brushShape === BrushShape.SQUARE && !antialiasing)
    );

    ctx.save();
    ctx.imageSmoothingEnabled = shouldSmooth;

    if (project.backgroundColor && project.backgroundColor !== 'transparent') {
      ctx.fillStyle = project.backgroundColor;
      ctx.fillRect(0, 0, project.width, project.height);
    }

    for (const layer of sortedLayers) {
      if (!layer.visible || layer.id === activeId) {
        continue;
      }

      ctx.save();
      ctx.globalCompositeOperation = layer.blendMode;
      ctx.globalAlpha = layer.opacity;

      if (
        layer.layerType === 'color-cycle' &&
        layer.colorCycleData?.canvas &&
        layer.colorCycleData.mode !== 'recolor'
      ) {
        try {
          ctx.drawImage(layer.colorCycleData.canvas, 0, 0);
        } catch {
          // ignore transient color cycle draw errors
        }
      } else if (
        layer.layerType === 'color-cycle' &&
        layer.colorCycleData?.mode === 'recolor' &&
        layer.colorCycleData.canvas
      ) {
        try {
          ctx.drawImage(layer.colorCycleData.canvas, 0, 0);
        } catch {
          // ignore transient color cycle draw errors
        }
      } else if (layer.layerType === 'sequential' && layer.sequentialData) {
        const source = getSequentialLayerRenderCanvas({
          layer,
          width: project.width,
          height: project.height,
          frameIndex: sequentialFrameIndex,
        });
        if (source) {
          try {
            ctx.drawImage(source as CanvasImageSource, 0, 0);
          } catch {
            // ignore transient draw errors
          }
        }
      } else if (layer.framebuffer) {
        try {
          ctx.drawImage(layer.framebuffer as CanvasImageSource, 0, 0);
        } catch {
          // ignore transient draw errors
        }
      } else if (layer.imageData) {
        let transferCanvas = layerTransferCacheRef.current.get(layer.id);
        if (!transferCanvas) {
          const canvas = document.createElement('canvas');
          canvas.width = layer.imageData.width;
          canvas.height = layer.imageData.height;
          transferCanvas = canvas;
          layerTransferCacheRef.current.set(layer.id, transferCanvas);
        }
        if (
          transferCanvas.width !== layer.imageData.width ||
          transferCanvas.height !== layer.imageData.height
        ) {
          transferCanvas.width = layer.imageData.width;
          transferCanvas.height = layer.imageData.height;
        }

        const transferCtx = transferCanvas.getContext(
          '2d',
          { willReadFrequently: true } as CanvasRenderingContext2DSettings
        ) as CanvasRenderingContext2D | null;

        if (transferCtx) {
          transferCtx.clearRect(0, 0, transferCanvas.width, transferCanvas.height);
          transferCtx.putImageData(layer.imageData, 0, 0);
          try {
            ctx.drawImage(transferCanvas, 0, 0);
          } catch {
            // ignore transient draw errors
          }
        }
      }

      ctx.restore();
    }

    ctx.restore();

  }, [activeLayerId, antialiasing, brushShape, displayMode, layerTransferCacheRef, layers, project]);
};
