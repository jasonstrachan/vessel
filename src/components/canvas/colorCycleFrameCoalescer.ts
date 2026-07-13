import type {
  ColorCycleDirtyRect,
  ColorCycleLayerDirtyBatch,
} from '@/lib/colorCycle/document';

export type ColorCycleFrameFlush = {
  sourceLayerIds: string[];
  dirtyBatches: ColorCycleLayerDirtyBatch[];
  redrawOnly: boolean;
};

export type ColorCycleFrameCoalescer = {
  enqueueFrame: (
    sourceLayerId: string,
    dirtyBatches?: ColorCycleLayerDirtyBatch[],
  ) => void;
  enqueueRedraw: () => void;
  cancel: () => void;
};

type DirtyLayerAccumulator = {
  version: number;
  rects: ColorCycleDirtyRect[];
};

export const createColorCycleFrameCoalescer = (
  onFlush: (flush: ColorCycleFrameFlush) => void,
): ColorCycleFrameCoalescer => {
  const sourceLayerIds = new Set<string>();
  const dirtyByLayer = new Map<string, DirtyLayerAccumulator>();
  let redrawOnly = false;
  let frameId: number | null = null;

  const schedule = (): void => {
    if (frameId !== null) {
      return;
    }
    frameId = requestAnimationFrame(() => {
      frameId = null;
      const flush: ColorCycleFrameFlush = {
        sourceLayerIds: Array.from(sourceLayerIds),
        dirtyBatches: Array.from(dirtyByLayer, ([layerId, batch]) => ({
          layerId,
          version: batch.version,
          rects: batch.rects,
        })),
        redrawOnly,
      };
      sourceLayerIds.clear();
      dirtyByLayer.clear();
      redrawOnly = false;
      onFlush(flush);
    });
  };

  return {
    enqueueFrame: (sourceLayerId, dirtyBatches) => {
      sourceLayerIds.add(sourceLayerId);
      dirtyBatches?.forEach((batch) => {
        const existing = dirtyByLayer.get(batch.layerId);
        if (existing) {
          existing.version = Math.max(existing.version, batch.version);
          existing.rects.push(...batch.rects);
          return;
        }
        dirtyByLayer.set(batch.layerId, {
          version: batch.version,
          rects: [...batch.rects],
        });
      });
      schedule();
    },
    enqueueRedraw: () => {
      redrawOnly = true;
      schedule();
    },
    cancel: () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      sourceLayerIds.clear();
      dirtyByLayer.clear();
      redrawOnly = false;
    },
  };
};
