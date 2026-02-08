import { useCallback, useEffect, type MutableRefObject } from 'react';
import { refreshLayerCCSurface } from '@/hooks/useBrushEngineSimplified';
import { getColorCycleBrushManager, type ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { CompositeSegment } from '@/stores/slices/layersSlice';
import type { Layer } from '@/types';
import type { MaskManager } from '@/layers/MaskManager';

interface UseDrawingCanvasColorCycleSegmentRefreshOptions {
  layers: Layer[];
  compositeSegmentsVersion: number;
  getCompositeSegmentsSnapshot: () => CompositeSegment[];
  layerMapRef: MutableRefObject<Map<string, Layer>>;
  compositeSegmentsRef: MutableRefObject<CompositeSegment[]>;
  pendingColorCycleRefreshRef: MutableRefObject<boolean>;
  colorCycleBrushManagerRef: MutableRefObject<ColorCycleBrushManager | null>;
  maskManager: MaskManager;
}

export const useDrawingCanvasColorCycleSegmentRefresh = ({
  layers,
  compositeSegmentsVersion,
  getCompositeSegmentsSnapshot,
  layerMapRef,
  compositeSegmentsRef,
  pendingColorCycleRefreshRef,
  colorCycleBrushManagerRef,
  maskManager,
}: UseDrawingCanvasColorCycleSegmentRefreshOptions) => {
  useEffect(() => {
    const map = new Map<string, Layer>();
    layers.forEach((layer) => {
      map.set(layer.id, layer);
    });
    layerMapRef.current = map;
    pendingColorCycleRefreshRef.current = true;
  }, [layerMapRef, layers, pendingColorCycleRefreshRef]);

  useEffect(() => {
    compositeSegmentsRef.current = getCompositeSegmentsSnapshot();
    pendingColorCycleRefreshRef.current = true;
  }, [compositeSegmentsRef, compositeSegmentsVersion, getCompositeSegmentsSnapshot, pendingColorCycleRefreshRef]);

  const refreshColorCycleSegments = useCallback(() => {
    const segments = compositeSegmentsRef.current;
    if (!segments.length) {
      return;
    }
    const manager = colorCycleBrushManagerRef.current ?? getColorCycleBrushManager();
    if (!colorCycleBrushManagerRef.current) {
      colorCycleBrushManagerRef.current = manager;
    }

    segments.forEach((segment) => {
      if (segment.kind !== 'color-cycle') {
        return;
      }
      const layer = layerMapRef.current.get(segment.layerId);
      if (!layer || !layer.colorCycleData) {
        return;
      }
      const brush = manager?.getBrush(segment.layerId);
      if (!brush) {
        return;
      }
      const layerCanvas = refreshLayerCCSurface(brush, segment.layerId);
      if (!layerCanvas) {
        return;
      }
      if (layerCanvas && 'setTargetCanvas' in brush && typeof brush.setTargetCanvas === 'function') {
        brush.setTargetCanvas(layerCanvas);
      }

      const wantPlaying = Boolean(layer.colorCycleData.isAnimating && layer.colorCycleData.mode !== 'recolor');
      const isPlaying = typeof brush.isPlaying === 'function' ? brush.isPlaying() : false;
      if (wantPlaying && !isPlaying) {
        brush.startAnimation?.();
      } else if (!wantPlaying && isPlaying) {
        brush.stopAnimation?.();
      }

      if (layer.colorCycleData.isAnimating) {
        brush.updateAnimation?.();
      }
      brush.renderDirectToCanvas?.(layerCanvas, segment.layerId);
      const layerCanvasCtx = layerCanvas.getContext(
        '2d',
        { willReadFrequently: true } as CanvasRenderingContext2DSettings
      );
      if (layerCanvasCtx) {
        maskManager.applyMaskToCanvas(layer.id, layerCanvasCtx);
      }
    });
  }, [colorCycleBrushManagerRef, compositeSegmentsRef, layerMapRef, maskManager]);

  useEffect(() => {
    if (pendingColorCycleRefreshRef.current) {
      pendingColorCycleRefreshRef.current = false;
      refreshColorCycleSegments();
    }
  }, [compositeSegmentsVersion, layers, pendingColorCycleRefreshRef, refreshColorCycleSegments]);

  return {
    refreshColorCycleSegments,
  };
};
