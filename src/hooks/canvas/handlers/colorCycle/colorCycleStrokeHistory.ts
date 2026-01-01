import type { CanvasSnapshot } from '@/types';
import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import {
  commitBrushHistory,
  type ManagedColorCycleBrush,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';

type LayerHistoryPayload = Parameters<typeof commitBrushHistory>[0];

export type CommitStrokeHistoryArgs = {
  shouldCommit: boolean;
  activeLayerId: string;
  layerBeforeImage: ImageData | null;
  layerBeforeColorState: ColorCycleSerializedState | null;
  actionType: CanvasSnapshot['actionType'];
  description: string;
  tool: string;
  coalesce?: LayerHistoryPayload['coalesce'];
  historyBitmapRoi?: CaptureRegion;
  shouldSkipBitmapDelta: boolean;
  isColorCycleLayer: boolean;
  isColorCycleBrush: boolean;
  deferredLayerCanvas: HTMLCanvasElement | null;
  strokeCaptureRoi?: CaptureRegion;
  brushForCleanup?: ManagedColorCycleBrush;
};

export type CommitStrokeHistoryDeps = Parameters<typeof commitBrushHistory>[1];

export const commitStrokeHistoryIfNeeded = async (
  args: CommitStrokeHistoryArgs,
  deps: CommitStrokeHistoryDeps
): Promise<boolean> => {
  if (!args.shouldCommit) {
    return false;
  }

  if (args.brushForCleanup?.flush) {
    args.brushForCleanup.flush(args.activeLayerId);
  }

  const shouldDeferColorCycleSave =
    args.isColorCycleLayer &&
    args.isColorCycleBrush &&
    Boolean(args.deferredLayerCanvas);

  await commitBrushHistory({
    activeLayerId: args.activeLayerId,
    layerBeforeImage: args.layerBeforeImage,
    layerBeforeColorState: args.layerBeforeColorState,
    actionType: args.actionType,
    description: args.description,
    tool: args.tool,
    coalesce: args.coalesce,
    historyBitmapRoi: args.historyBitmapRoi,
    shouldSkipBitmapDelta: args.shouldSkipBitmapDelta,
    shouldDeferColorCycleSave,
    deferredLayerCanvas: args.deferredLayerCanvas,
    strokeCaptureRoi: args.strokeCaptureRoi,
  }, deps);

  return true;
};
