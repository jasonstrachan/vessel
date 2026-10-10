import { getAppStoreState } from '@/stores/appStoreAccess';
import type { CanvasSnapshot, SequentialLayerData, SequentialStrokeEvent } from '@/types';
import type { CaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import { commitSequentialLayerHistory } from '@/history/helpers/sequentialLayerHistory';
import { cloneSequentialLayerData } from '@/history/deltas/sequentialFrameDelta';
import { flushBufferedSequentialEvents } from '@/hooks/canvas/handlers/sequential/sequentialCapture';
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

// History partitions must keep chunk indices aligned with their filtered event order.
const filterSequentialData = (
  data: SequentialLayerData,
  accepts: (event: SequentialStrokeEvent) => boolean,
): SequentialLayerData => {
  const events: SequentialStrokeEvent[] = [];
  const selectedCounts = [0];
  for (const event of data.events) {
    if (accepts(event)) events.push(event);
    selectedCounts.push(events.length);
  }
  return {
    ...data,
    events,
    eventChunks: data.eventChunks?.flatMap(chunk => {
      const start = Math.max(0, Math.min(data.events.length, chunk.startEventIndex));
      const end = Math.max(start, Math.min(data.events.length, start + chunk.eventCount));
      const startEventIndex = selectedCounts[start];
      const eventCount = selectedCounts[end] - startEventIndex;
      return eventCount > 0 ? [{
        ...chunk,
        startEventIndex,
        eventCount,
        frameIndexes: [...new Set(events.slice(startEventIndex, startEventIndex + eventCount).map(event => event.frameIndex))].sort((a, b) => a - b),
      }] : [];
    }),
  };
};

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

  const state = getAppStoreState();
  const activeLayer = state.layers.find((layer) => layer.id === args.activeLayerId);
  if (activeLayer?.layerType === 'sequential' && activeLayer.sequentialData) {
    const sessionStartMs = state.sequentialRecord.sessionStartMs;
    if (!Number.isFinite(sessionStartMs)) {
      return false;
    }
    // Buffered movement belongs to this transaction, before its immutable snapshot.
    flushBufferedSequentialEvents({ state });
    const finalizedLayer = getAppStoreState().layers.find(layer => layer.id === args.activeLayerId);
    if (!finalizedLayer?.sequentialData) return false;
    const strokePrefix = `stroke-${Math.round(Number(sessionStartMs))}`;
    const afterSequentialData = cloneSequentialLayerData(finalizedLayer.sequentialData);
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
    let previousSequentialData = filterSequentialData(afterSequentialData, event => !matchesSessionStroke(event.strokeId));
    const committedStrokeIds = new Set<string>();
    for (let index = 0; index < sessionStrokeIds.length; index += 1) {
      const strokeId = sessionStrokeIds[index];
      committedStrokeIds.add(strokeId);
      const nextSequentialData = filterSequentialData(afterSequentialData, event =>
        !matchesSessionStroke(event.strokeId) || committedStrokeIds.has(event.strokeId));
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
