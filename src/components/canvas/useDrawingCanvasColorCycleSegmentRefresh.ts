import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';

import { bindColorCycleFramePublication } from '@/hooks/brushEngine/colorCycleInitController';
import { refreshLayerCCSurface } from '@/hooks/useBrushEngineSimplified';
import { getColorCycleBrushManager, type ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { CompositeSegment } from '@/stores/slices/layersSlice';
import type { ColorCycleLayerDirtyBatch } from '@/lib/colorCycle/document';
import type { Layer } from '@/types';
import { debugWarn } from '@/utils/debug';
import { recordColorCycleRuntimePerf } from '@/utils/perf/ccPerfProbe';

export type ColorCycleSegmentRefreshRequest = {
  dirtyBatches?: ColorCycleLayerDirtyBatch[];
  sourceLayerIds?: Iterable<string>;
};

interface UseDrawingCanvasColorCycleSegmentRefreshOptions {
  layers: Layer[];
  compositeSegmentsVersion: number;
  getCompositeSegmentsSnapshot: () => CompositeSegment[];
  layerMapRef: MutableRefObject<Map<string, Layer>>;
  compositeSegmentsRef: MutableRefObject<CompositeSegment[]>;
  pendingColorCycleRefreshRef: MutableRefObject<boolean>;
  colorCycleBrushManagerRef: MutableRefObject<ColorCycleBrushManager | null>;
}

export const useDrawingCanvasColorCycleSegmentRefresh = ({
  layers,
  compositeSegmentsVersion,
  getCompositeSegmentsSnapshot,
  layerMapRef,
  compositeSegmentsRef,
  pendingColorCycleRefreshRef,
  colorCycleBrushManagerRef,
}: UseDrawingCanvasColorCycleSegmentRefreshOptions) => {
  const isRefreshingRef = useRef(false);

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
  }, [compositeSegmentsRef, compositeSegmentsVersion, getCompositeSegmentsSnapshot]);

  const refreshColorCycleSegments = useCallback((
    request?: ColorCycleSegmentRefreshRequest,
  ): boolean => {
    const dirtyBatches = request?.dirtyBatches;
    const requestedLayerIds = request?.sourceLayerIds
      ? new Set(request.sourceLayerIds)
      : null;
    const dirtyLayerIds = dirtyBatches?.length
      ? new Set(dirtyBatches.map((batch) => batch.layerId))
      : null;
    const hasStaticDirtyBatch = dirtyLayerIds
      ? compositeSegmentsRef.current.some((segment) =>
          segment.kind === 'static' &&
          segment.layerIds.some((layerId) => dirtyLayerIds.has(layerId)),
        )
      : false;

    if (isRefreshingRef.current) {
      pendingColorCycleRefreshRef.current = true;
      return hasStaticDirtyBatch;
    }

    isRefreshingRef.current = true;
    recordColorCycleRuntimePerf('segmentRefresh');
    const segments = compositeSegmentsRef.current;
    try {
      if (!segments.length) {
        return hasStaticDirtyBatch;
      }
      const manager = colorCycleBrushManagerRef.current ?? getColorCycleBrushManager();
      if (!colorCycleBrushManagerRef.current) {
        colorCycleBrushManagerRef.current = manager;
      }

      segments.forEach((segment) => {
        if (segment.kind !== 'color-cycle') {
          return;
        }
        if (requestedLayerIds && !requestedLayerIds.has(segment.layerId)) {
          return;
        }
        const layer = layerMapRef.current.get(segment.layerId);
        if (!layer || !layer.colorCycleData) {
          return;
        }
        const brush = manager?.getSurfaceBrush(segment.layerId);
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

        try {
          brush.presentCurrentFrameToCanvas?.(layerCanvas, segment.layerId);
        } catch (error) {
          debugWarn('cc-render', '[DrawingCanvas] Failed to present color-cycle layer surface', {
            layerId: segment.layerId,
            error,
          });
        }
      });
    } finally {
      isRefreshingRef.current = false;
    }

    return hasStaticDirtyBatch;
  }, [colorCycleBrushManagerRef, compositeSegmentsRef, layerMapRef, pendingColorCycleRefreshRef]);

  useEffect(() => {
    const manager = colorCycleBrushManagerRef.current ?? getColorCycleBrushManager();
    colorCycleBrushManagerRef.current = manager;
    compositeSegmentsRef.current.forEach((segment) => {
      if (segment.kind !== 'color-cycle') {
        return;
      }
      const layer = layerMapRef.current.get(segment.layerId);
      const brush = manager.getSurfaceBrush(segment.layerId);
      if (!layer?.colorCycleData || !brush) {
        return;
      }
      const publicationBrush = manager.getInitBrush(segment.layerId);
      if (publicationBrush) {
        bindColorCycleFramePublication(publicationBrush, segment.layerId);
      }
      const wantPlaying = Boolean(
        layer.colorCycleData.isAnimating && layer.colorCycleData.mode !== 'recolor',
      );
      const isPlaying = brush.isPlaying?.() ?? false;
      if (wantPlaying && !isPlaying) {
        brush.startAnimation?.();
      } else if (!wantPlaying && isPlaying) {
        brush.stopAnimation?.();
      }
    });
  }, [
    colorCycleBrushManagerRef,
    compositeSegmentsRef,
    compositeSegmentsVersion,
    layerMapRef,
    layers,
  ]);

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
