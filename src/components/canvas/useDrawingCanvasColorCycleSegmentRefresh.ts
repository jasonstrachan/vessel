import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';

import { bindColorCycleFramePublication } from '@/hooks/brushEngine/colorCycleInitController';
import { refreshLayerCCSurface } from '@/hooks/useBrushEngineSimplified';
import { getColorCycleBrushManager, type ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { selectEffectiveColorCyclePlaying, useAppStore } from '@/stores/useAppStore';
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

// Interlace owns composition, but each indexed member still owns a live surface.
// Traverse existing IDs without building a temporary list on every frame.
const forEachColorCycleSegmentLayerId = (
  segments: CompositeSegment[],
  visit: (layerId: string) => void,
): void => {
  for (const segment of segments) {
    if (segment.kind === 'color-cycle') {
      visit(segment.layerId);
    } else if (segment.kind === 'interlace') {
      for (const layerId of segment.layerIds) visit(layerId);
    }
  }
};

export const useDrawingCanvasColorCycleSegmentRefresh = ({
  layers,
  compositeSegmentsVersion,
  getCompositeSegmentsSnapshot,
  layerMapRef,
  compositeSegmentsRef,
  pendingColorCycleRefreshRef,
  colorCycleBrushManagerRef,
}: UseDrawingCanvasColorCycleSegmentRefreshOptions) => {
  const effectivePlaying = useAppStore(selectEffectiveColorCyclePlaying);
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

      forEachColorCycleSegmentLayerId(segments, (layerId) => {
        if (requestedLayerIds && !requestedLayerIds.has(layerId)) {
          return;
        }
        const layer = layerMapRef.current.get(layerId);
        if (layer?.layerType !== 'color-cycle' || !layer.colorCycleData) {
          return;
        }
        const brush = manager?.getSurfaceBrush(layerId);
        if (!brush) {
          return;
        }
        const layerCanvas = refreshLayerCCSurface(brush, layerId);
        if (!layerCanvas) {
          return;
        }
        if (layerCanvas && 'setTargetCanvas' in brush && typeof brush.setTargetCanvas === 'function') {
          brush.setTargetCanvas(layerCanvas);
        }

        try {
          brush.presentCurrentFrameToCanvas?.(layerCanvas, layerId);
        } catch (error) {
          debugWarn('cc-render', '[DrawingCanvas] Failed to present color-cycle layer surface', {
            layerId,
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
    forEachColorCycleSegmentLayerId(compositeSegmentsRef.current, (layerId) => {
      const layer = layerMapRef.current.get(layerId);
      if (layer?.layerType !== 'color-cycle' || !layer.colorCycleData) {
        return;
      }
      const brush = manager.getSurfaceBrush(layerId);
      if (!brush) {
        return;
      }
      const publicationBrush = manager.getInitBrush(layerId);
      if (publicationBrush) {
        bindColorCycleFramePublication(publicationBrush, layerId);
      }
      const wantPlaying = Boolean(
        effectivePlaying && layer.colorCycleData.isAnimating && layer.colorCycleData.mode !== 'recolor',
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
    effectivePlaying,
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
