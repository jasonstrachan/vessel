import type React from 'react';
import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import { flushColorCycleQueueBeforeFinalize } from '@/hooks/canvas/handlers/colorCycle/colorCycleFinalizeQueue';
import { finalizePendingEraserTool } from '@/hooks/canvas/handlers/eraserFinalize';

type ColorCyclePixelQueueLike = {
  onIdle?: (callback: () => void) => void;
  flushNow?: () => void;
};

type PendingEraserTool = {
  end: () => void;
  getROI: () => CaptureRegion | null;
};

export const runFinalizePrelude = async ({
  strokeBatchRef,
  processBatchedStrokes,
  colorCyclePixelQueue,
  isCCLayerSnapshot,
  isCCBrushSnapshot,
  pendingEraserTool,
  eraserToolRef,
  eraserRoiRef,
}: {
  strokeBatchRef: React.MutableRefObject<
    Array<{ pos: { x: number; y: number }; pressure: number; timestampMs?: number }>
  >;
  processBatchedStrokes: () => void;
  colorCyclePixelQueue: React.MutableRefObject<ColorCyclePixelQueueLike | null>;
  isCCLayerSnapshot: boolean;
  isCCBrushSnapshot: boolean;
  pendingEraserTool: PendingEraserTool | null;
  eraserToolRef: React.MutableRefObject<PendingEraserTool | null>;
  eraserRoiRef: React.MutableRefObject<CaptureRegion | null>;
}): Promise<{ shouldAwaitQueueIdle: boolean }> => {
  if (strokeBatchRef.current.length > 0) {
    processBatchedStrokes();
  }

  const activeQueue = colorCyclePixelQueue.current;
  const shouldAwaitQueueIdle = Boolean(activeQueue?.onIdle) && isCCLayerSnapshot && isCCBrushSnapshot;
  await flushColorCycleQueueBeforeFinalize({
    queue: activeQueue,
    shouldAwait: shouldAwaitQueueIdle,
  });

  finalizePendingEraserTool({
    pendingEraserTool,
    eraserToolRef,
    eraserRoiRef,
  });

  return { shouldAwaitQueueIdle };
};
