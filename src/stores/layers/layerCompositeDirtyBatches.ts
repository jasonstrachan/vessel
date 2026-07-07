import type { Layer, Project } from '@/types';
import {
  coalesceColorCycleDirtyRects,
  type ColorCycleDirtyRect,
  type ColorCycleLayerDirtyBatch,
} from '@/lib/colorCycle/document/ColorCycleLayerDocument';

type CompositeDirtyBatchState = {
  layers: Layer[];
  pendingCompositeDirtyBatches?: ColorCycleLayerDirtyBatch[];
  project: Project | null;
};

export const normalizeCompositeDirtyRects = (
  rects: ColorCycleDirtyRect[] | undefined,
  width: number,
  height: number,
): ColorCycleDirtyRect[] => {
  if (!rects?.length) {
    return [];
  }
  return coalesceColorCycleDirtyRects(
    rects
      .map((rect) => {
        const left = Math.max(0, Math.floor(rect.x));
        const top = Math.max(0, Math.floor(rect.y));
        const right = Math.min(width, Math.ceil(rect.x + rect.width));
        const bottom = Math.min(height, Math.ceil(rect.y + rect.height));
        if (right <= left || bottom <= top) {
          return null;
        }
        return {
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        };
      })
      .filter((rect): rect is ColorCycleDirtyRect => Boolean(rect)),
  );
};

export const createLayerDirtyBatches = (
  state: Pick<CompositeDirtyBatchState, 'layers' | 'project'>,
  layerIds: string[],
  dirtyRectsByLayerId?: Map<string, ColorCycleDirtyRect[]>,
): ColorCycleLayerDirtyBatch[] => {
  if (!state.project || layerIds.length === 0) {
    return [];
  }
  const uniqueLayerIds = Array.from(new Set(layerIds));
  return uniqueLayerIds.map((layerId) => {
    const layer = state.layers.find((candidate) => candidate.id === layerId);
    const normalizedRects = normalizeCompositeDirtyRects(
      dirtyRectsByLayerId?.get(layerId),
      state.project!.width,
      state.project!.height,
    );
    return {
      layerId,
      version: layer?.version ?? 0,
      rects: normalizedRects.length > 0
        ? normalizedRects
        : [{
            x: 0,
            y: 0,
            width: state.project!.width,
            height: state.project!.height,
          }],
    };
  });
};

export const appendPendingCompositeDirtyBatches = (
  state: CompositeDirtyBatchState,
  layerIds: string[],
  dirtyRectsByLayerId?: Map<string, ColorCycleDirtyRect[]>,
): ColorCycleLayerDirtyBatch[] => {
  const merged = new Map<string, ColorCycleLayerDirtyBatch>();
  [
    ...(state.pendingCompositeDirtyBatches ?? []),
    ...createLayerDirtyBatches(state, layerIds, dirtyRectsByLayerId),
  ].forEach((batch) => {
    const existing = merged.get(batch.layerId);
    if (!existing) {
      merged.set(batch.layerId, {
        layerId: batch.layerId,
        version: batch.version,
        rects: coalesceColorCycleDirtyRects(batch.rects),
      });
      return;
    }
    merged.set(batch.layerId, {
      layerId: batch.layerId,
      version: Math.max(existing.version, batch.version),
      rects: coalesceColorCycleDirtyRects([
        ...existing.rects,
        ...batch.rects,
      ]),
    });
  });
  return Array.from(merged.values());
};
