import { getAppStoreState } from '@/stores/appStoreAccess';
import type React from 'react';
import { useCallback, useEffect } from 'react';
import { BrushShape, type Layer } from '@/types';
import { selectSequentialPlaybackActive, type AppState } from '@/stores/useAppStore';
import {
  getSequentialLayerRenderCanvas,
} from '@/lib/sequential/SequentialLayerRenderer';
import { getSequentialLivePreviewFrame } from '@/lib/sequential/SequentialLivePreviewRuntime';
import { getSequentialRenderFrame } from '@/runtime/playback/sequentialFrameCursor';
import { getLayerTransferCanvas, type LayerTransferCacheEntry } from './layerTransferCache';
import {
  getColorCyclePresentationCanvas,
  resolveColorCyclePresentation,
} from './resolveColorCyclePresentation';

interface UseDrawingCanvasCompositeBuffersOptions {
  project: { width: number; height: number } | null;
  layers: Layer[];
  activeLayerId: string | null;
  brushShape: BrushShape | undefined;
  antialiasing: boolean;
  displayMode: 'auto' | 'pixelated' | 'smooth';
  layerTransferCacheRef: React.MutableRefObject<Map<string, LayerTransferCacheEntry>>;
  underCompositeCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  overCompositeCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  underCompositeHasContentRef: React.MutableRefObject<boolean>;
  overCompositeHasContentRef: React.MutableRefObject<boolean>;
  compositeCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  renderStaticComposite: (canvas: HTMLCanvasElement) => boolean | Promise<boolean>;
  setCurrentOffscreenCanvas: (canvas: HTMLCanvasElement | null) => void;
}

const resolveSequentialLivePreviewSessionKey = (
  layerId: string,
  state: AppState
): string | null => {
  const sessionStartMs = state.sequentialRecord?.sessionStartMs;
  if (!Number.isFinite(sessionStartMs)) {
    return null;
  }
  return `${layerId}:${sessionStartMs}`;
};

export const useDrawingCanvasCompositeBuffers = ({
  project,
  layers,
  activeLayerId,
  brushShape,
  antialiasing,
  displayMode,
  layerTransferCacheRef,
  underCompositeCanvasRef,
  overCompositeCanvasRef,
  underCompositeHasContentRef,
  overCompositeHasContentRef,
  compositeCanvasRef,
  renderStaticComposite,
  setCurrentOffscreenCanvas,
}: UseDrawingCanvasCompositeBuffersOptions) => {
  useEffect(() => {
    const cache = layerTransferCacheRef.current;
    if (cache.size === 0) {
      return;
    }

    const rasterLayerIds = new Set(
      layers.filter((layer) => Boolean(layer.imageData)).map((layer) => layer.id)
    );

    for (const layerId of cache.keys()) {
      if (!rasterLayerIds.has(layerId)) {
        cache.delete(layerId);
      }
    }
  }, [layerTransferCacheRef, layers]);

  const renderSplitComposites = useCallback(() => {
    if (!project || project.width <= 0 || project.height <= 0) {
      underCompositeHasContentRef.current = false;
      overCompositeHasContentRef.current = false;
      return;
    }

    if (typeof document === 'undefined') {
      underCompositeHasContentRef.current = false;
      overCompositeHasContentRef.current = false;
      return;
    }

    if (!underCompositeCanvasRef.current) {
      underCompositeCanvasRef.current = document.createElement('canvas');
    }
    if (!overCompositeCanvasRef.current) {
      overCompositeCanvasRef.current = document.createElement('canvas');
    }

    const underCanvas = underCompositeCanvasRef.current;
    const overCanvas = overCompositeCanvasRef.current;

    if (!underCanvas || !overCanvas) {
      underCompositeHasContentRef.current = false;
      overCompositeHasContentRef.current = false;
      return;
    }

    if (underCanvas.width !== project.width || underCanvas.height !== project.height) {
      underCanvas.width = project.width;
      underCanvas.height = project.height;
    }
    if (overCanvas.width !== project.width || overCanvas.height !== project.height) {
      overCanvas.width = project.width;
      overCanvas.height = project.height;
    }

    const underCtx = underCanvas.getContext('2d', { willReadFrequently: true });
    const overCtx = overCanvas.getContext('2d', { willReadFrequently: true });

    if (!underCtx || !overCtx) {
      underCompositeHasContentRef.current = false;
      overCompositeHasContentRef.current = false;
      return;
    }

    underCtx.clearRect(0, 0, project.width, project.height);
    overCtx.clearRect(0, 0, project.width, project.height);

    const isPixelBrush =
      brushShape === BrushShape.PIXEL_ROUND ||
      (brushShape === BrushShape.SQUARE && !antialiasing);
    const isPixelatedDisplay = displayMode === 'pixelated';
    const allowSmoothing = !isPixelatedDisplay && !isPixelBrush;
    underCtx.imageSmoothingEnabled = allowSmoothing;
    overCtx.imageSmoothingEnabled = allowSmoothing;

    const sortedLayers = [...layers].sort((a, b) => a.order - b.order);
    const activeLayer = activeLayerId ? sortedLayers.find((layer) => layer.id === activeLayerId) ?? null : null;
    const activeOrder = activeLayer ? activeLayer.order : Number.POSITIVE_INFINITY;
    const storeState = getAppStoreState() as AppState;
    const sequentialFrameIndex = getSequentialRenderFrame(storeState);
    const shouldHoldPreviousSequentialFrame = !selectSequentialPlaybackActive(storeState);

    let drewUnder = false;
    let drewOver = false;

    for (const layer of sortedLayers) {
      if (!layer.visible) {
        continue;
      }

      const targetCtx: CanvasRenderingContext2D = layer.order > activeOrder ? overCtx : underCtx;

      targetCtx.save();
      targetCtx.globalCompositeOperation = layer.blendMode;
      targetCtx.globalAlpha = layer.opacity;

      let drewLayer = false;

      if (layer.layerType === 'color-cycle') {
        const presentation = resolveColorCyclePresentation({
          layer,
          activeLayerId,
          projectWidth: project.width,
          projectHeight: project.height,
        });
        const source = getColorCyclePresentationCanvas(presentation);
        if (source) {
          try {
            targetCtx.drawImage(source, 0, 0);
            drewLayer = true;
          } catch {
            // ignore draw errors for transient states
          }
        }
      } else if (layer.layerType === 'sequential' && layer.sequentialData) {
        const includePreviewEvents =
          Boolean(storeState.sequentialRecord?.isPointerDown) && storeState.activeLayerId === layer.id;
        const source = getSequentialLayerRenderCanvas({
          layer,
          width: project.width,
          height: project.height,
          frameIndex: sequentialFrameIndex,
          holdPreviousOnEmptyFrames: shouldHoldPreviousSequentialFrame,
          ...(includePreviewEvents ? { deferAppendPatching: true } : {}),
        });
        if (source) {
          try {
            targetCtx.drawImage(source as CanvasImageSource, 0, 0);
            const livePreviewFrame = includePreviewEvents
              ? getSequentialLivePreviewFrame({
                  layerId: layer.id,
                  sessionKey: resolveSequentialLivePreviewSessionKey(layer.id, storeState),
                  width: project.width,
                  height: project.height,
                  frameIndex: sequentialFrameIndex,
                  frameCount: layer.sequentialData.frameCount,
                })
              : null;
            if (livePreviewFrame) {
              targetCtx.drawImage(
                livePreviewFrame.canvas as CanvasImageSource,
                livePreviewFrame.bounds.x,
                livePreviewFrame.bounds.y,
                livePreviewFrame.bounds.width,
                livePreviewFrame.bounds.height,
                livePreviewFrame.bounds.x,
                livePreviewFrame.bounds.y,
                livePreviewFrame.bounds.width,
                livePreviewFrame.bounds.height
              );
            }
            drewLayer = true;
          } catch {
            // ignore draw errors for transient states
          }
        }
      } else if (layer.framebuffer) {
        try {
          targetCtx.drawImage(layer.framebuffer as CanvasImageSource, 0, 0);
          drewLayer = true;
        } catch {
          // ignore draw errors for transient states
        }
      } else if (layer.imageData) {
        const transferCanvas = getLayerTransferCanvas(layer, layerTransferCacheRef.current);
        if (transferCanvas) {
          try {
            targetCtx.drawImage(transferCanvas, 0, 0);
            drewLayer = true;
          } catch {
            // ignore draw errors for transient states
          }
        }
      }

      targetCtx.restore();

      if (drewLayer) {
        if (targetCtx === underCtx) {
          drewUnder = true;
        } else {
          drewOver = true;
        }
      }
    }

    underCompositeHasContentRef.current = drewUnder;
    overCompositeHasContentRef.current = drewOver;

  }, [
    activeLayerId,
    antialiasing,
    brushShape,
    displayMode,
    layerTransferCacheRef,
    layers,
    overCompositeCanvasRef,
    overCompositeHasContentRef,
    project,
    underCompositeCanvasRef,
    underCompositeHasContentRef,
  ]);

  const ensureStaticCompositeCanvas = useCallback(() => {
    if (!project) {
      return null;
    }
    if (!compositeCanvasRef.current && typeof document !== 'undefined') {
      compositeCanvasRef.current = document.createElement('canvas');
    }
    if (compositeCanvasRef.current) {
      if (
        compositeCanvasRef.current.width !== project.width ||
        compositeCanvasRef.current.height !== project.height
      ) {
        compositeCanvasRef.current.width = project.width;
        compositeCanvasRef.current.height = project.height;
      }
    }
    return compositeCanvasRef.current;
  }, [compositeCanvasRef, project]);

  const rebuildStaticComposite = useCallback((): boolean | Promise<boolean> => {
    const canvas = ensureStaticCompositeCanvas();
    if (!canvas) {
      return false;
    }
    const rendered = renderStaticComposite(canvas);
    if (typeof rendered === 'object' && rendered !== null && 'then' in rendered) {
      return rendered.then((resolved) => {
        if (resolved) {
          setCurrentOffscreenCanvas(canvas);
        }
        return resolved;
      });
    }
    if (rendered) {
      setCurrentOffscreenCanvas(canvas);
    }
    return rendered;
  }, [ensureStaticCompositeCanvas, renderStaticComposite, setCurrentOffscreenCanvas]);

  return {
    renderSplitComposites,
    rebuildStaticComposite,
  };
};
