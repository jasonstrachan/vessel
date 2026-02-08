import type { CanvasSnapshot } from '@/types';
import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import { commitSequentialLayerHistory } from '@/history/helpers/sequentialLayerHistory';
import { cloneSequentialLayerData } from '@/history/deltas/sequentialFrameDelta';
import {
  commitBrushHistory,
  type ManagedColorCycleBrush,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import { useAppStore } from '@/stores/useAppStore';

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

export const createCommitStrokeHistoryDeps = ({
  scheduleDeferredColorCycleSave,
  scheduleHistoryCommit,
  captureColorCycleBrushState,
  perfMark,
  perfMeasure,
  debugTime,
  debugTimeEnd,
  debugVerbose,
}: CommitStrokeHistoryDeps): CommitStrokeHistoryDeps => ({
  scheduleDeferredColorCycleSave,
  scheduleHistoryCommit,
  captureColorCycleBrushState,
  perfMark,
  perfMeasure,
  debugTime,
  debugTimeEnd,
  debugVerbose,
});

export const commitStrokeHistoryIfNeeded = async (
  args: CommitStrokeHistoryArgs,
  deps: CommitStrokeHistoryDeps
): Promise<boolean> => {
  if (!args.shouldCommit) {
    return false;
  }

  const state = useAppStore.getState();
  const activeLayer = state.layers.find((layer) => layer.id === args.activeLayerId);
  if (activeLayer?.layerType === 'sequential' && activeLayer.sequentialData) {
    const sessionStartMs = state.sequentialRecord.sessionStartMs;
    if (!Number.isFinite(sessionStartMs)) {
      return false;
    }
    const strokePrefix = `stroke-${Math.round(Number(sessionStartMs))}`;
    const afterSequentialData = cloneSequentialLayerData(activeLayer.sequentialData);
    const matchesSessionStroke = (strokeId: string): boolean =>
      strokeId === strokePrefix || strokeId.startsWith(`${strokePrefix}-`);
    const sessionStrokeIds: string[] = [];
    afterSequentialData.events.forEach((event) => {
      if (!matchesSessionStroke(event.strokeId)) {
        return;
      }
      if (!sessionStrokeIds.includes(event.strokeId)) {
        sessionStrokeIds.push(event.strokeId);
      }
    });
    if (sessionStrokeIds.length <= 0) {
      return false;
    }
    let previousSequentialData = {
      ...afterSequentialData,
      events: afterSequentialData.events.filter((event) => !matchesSessionStroke(event.strokeId)),
    };
    for (let index = 0; index < sessionStrokeIds.length; index += 1) {
      const strokeId = sessionStrokeIds[index];
      const nextSequentialData = {
        ...previousSequentialData,
        events: previousSequentialData.events.concat(
          afterSequentialData.events.filter((event) => event.strokeId === strokeId)
        ),
      };
      const nextCoalesce =
        args.coalesce && sessionStrokeIds.length > 1
          ? {
              ...args.coalesce,
              key: `${args.coalesce.key}:${strokeId}`,
            }
          : args.coalesce;
      await commitSequentialLayerHistory({
        layerId: args.activeLayerId,
        beforeSequentialData: previousSequentialData,
        afterSequentialData: nextSequentialData,
        actionType: args.actionType,
        description: args.description,
        tool: args.tool,
        coalesce: nextCoalesce,
      });
      previousSequentialData = nextSequentialData;
    }
    return true;
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

export const createCommitStrokeHistoryIfNeededDispatcher = (
  deps: CommitStrokeHistoryDeps
) => async (args: CommitStrokeHistoryArgs): Promise<boolean> =>
  commitStrokeHistoryIfNeeded(args, deps);
