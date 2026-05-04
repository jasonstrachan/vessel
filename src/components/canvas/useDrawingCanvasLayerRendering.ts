import { getAppStoreState } from '@/stores/appStoreAccess';
import type React from 'react';
import { useCallback } from 'react';
import { BrushShape, type Layer } from '@/types';
import { selectSequentialPlaybackActive, type AppState } from '@/stores/useAppStore';
import {
  getSequentialLayerRenderCanvas,
} from '@/lib/sequential/SequentialLayerRenderer';
import { getSequentialRenderFrame } from '@/runtime/playback/sequentialFrameCursor';
import { getLayerTransferCanvas, type LayerTransferCacheEntry } from './layerTransferCache';
import {
  getColorCyclePresentationCanvas,
  resolveColorCyclePresentation,
} from './resolveColorCyclePresentation';

interface UseDrawingCanvasLayerRenderingOptions {
  project: { width: number; height: number; backgroundColor?: string | null } | null;
  layers: Layer[];
  activeLayerId: string | null;
  brushShape: BrushShape | undefined;
  antialiasing: boolean;
  displayMode: 'auto' | 'pixelated' | 'smooth';
  layerTransferCacheRef: React.MutableRefObject<Map<string, LayerTransferCacheEntry>>;
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
    const storeState = getAppStoreState() as AppState;
    const sequentialFrameIndex = getSequentialRenderFrame(storeState);
    const shouldHoldPreviousSequentialFrame = !selectSequentialPlaybackActive(storeState);
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

      if (layer.layerType === 'color-cycle') {
        const presentation = resolveColorCyclePresentation({
          layer,
          activeLayerId,
          projectWidth: project.width,
          projectHeight: project.height,
        });
        const source = getColorCyclePresentationCanvas(presentation, layer);
        if (source) {
          try {
            ctx.drawImage(source, 0, 0);
          } catch {
            // ignore transient color cycle draw errors
          }
        }
      } else if (layer.layerType === 'sequential' && layer.sequentialData) {
        const source = getSequentialLayerRenderCanvas({
          layer,
          width: project.width,
          height: project.height,
          frameIndex: sequentialFrameIndex,
          holdPreviousOnEmptyFrames: shouldHoldPreviousSequentialFrame,
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
        const transferCanvas = getLayerTransferCanvas(layer, layerTransferCacheRef.current);
        if (transferCanvas) {
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
