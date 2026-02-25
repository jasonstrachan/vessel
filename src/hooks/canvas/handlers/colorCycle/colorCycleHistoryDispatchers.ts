import type React from 'react';
import { commitRasterOverlay, scheduleDeferredColorCycleSaveWithState } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import {
  scheduleDeferredColorCycleSave,
  scheduleHistoryCommit,
  type DeferredColorCycleSaveOptions,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleHistory';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import type { FinalizeQueue } from '@/lib/canvas';
import type { CommitRasterOverlayOptions } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import type { BoundingBox } from '@/hooks/canvas/utils/captureRegions';

type LayerHistoryPayload = Parameters<typeof scheduleHistoryCommit>[0]['payload'];
type DeferredSaveWithStateArgs = Parameters<typeof scheduleDeferredColorCycleSaveWithState>[0];

type CaptureRegion = { x: number; y: number; width: number; height: number };

export type CreateColorCycleHistoryDispatchersArgs = {
  finalizeQueueRef: React.MutableRefObject<FinalizeQueue>;
  runIdle: (cb: () => void) => void;
  runIdleAsync: <T>(task: () => Promise<T> | T) => Promise<T>;
  withTiming: <T>(label: string, task: () => Promise<T> | T) => Promise<T>;
  logError: (message: string, error?: unknown) => void;
  captureCanvasToActiveLayer: (canvas: HTMLCanvasElement, roi?: CaptureRegion) => Promise<void>;
  project: { width: number; height: number } | null;
  trackPendingColorCycleSave: (layerId: string, promise: Promise<void>) => void;
  boundingBoxToCaptureRegion: (
    bbox: BoundingBox | null,
    padding: number,
    project: { width: number; height: number } | null
  ) => CaptureRegion | undefined;
  perfMark: (label: string) => void;
  perfMeasure: (label: string, startLabel: string, endLabel: string) => void;
  debugTime: (label: string) => void;
  debugTimeEnd: (label: string) => void;
  debugVerbose: (label: string, payload: Record<string, unknown>) => void;
  historyFinalizeLane: string;
};

export const createColorCycleHistoryDispatchers = (
  args: CreateColorCycleHistoryDispatchersArgs
): {
  scheduleHistoryCommit: (payload: LayerHistoryPayload) => Promise<void>;
  commitRasterOverlay: (options: CommitRasterOverlayOptions) => Promise<void>;
  scheduleDeferredColorCycleSave: (options: DeferredColorCycleSaveOptions) => Promise<void>;
  scheduleDeferredColorCycleSaveWithState: (args: DeferredSaveWithStateArgs) => Promise<void>;
} => {
  const scheduleHistoryCommitHandler = (payload: LayerHistoryPayload): Promise<void> =>
    scheduleHistoryCommit({
      payload,
      finalizeQueueRef: args.finalizeQueueRef,
      runIdleAsync: args.runIdleAsync,
      withTiming: args.withTiming,
      logError: args.logError,
      finalizeLane: args.historyFinalizeLane,
    });

  const commitRasterOverlayHandler = async (
    options: CommitRasterOverlayOptions
  ): Promise<void> => {
    await commitRasterOverlay(options, {
      project: args.project,
      captureCanvasToActiveLayer: args.captureCanvasToActiveLayer,
      scheduleHistoryCommit: scheduleHistoryCommitHandler,
      withTiming: args.withTiming,
    });
  };

  const scheduleDeferredColorCycleSaveHandler = (
    options: DeferredColorCycleSaveOptions
  ): Promise<void> =>
    scheduleDeferredColorCycleSave(options, {
      captureCanvasToActiveLayer: args.captureCanvasToActiveLayer,
      project: args.project,
      runIdle: args.runIdle,
      runIdleAsync: args.runIdleAsync,
      finalizeQueueRef: args.finalizeQueueRef,
      trackPendingColorCycleSave: args.trackPendingColorCycleSave,
      boundingBoxToCaptureRegion: args.boundingBoxToCaptureRegion,
      perfMark: args.perfMark,
      perfMeasure: args.perfMeasure,
      debugTime: args.debugTime,
      debugTimeEnd: args.debugTimeEnd,
      debugVerbose: args.debugVerbose,
      logError: args.logError,
      withTiming: args.withTiming,
      historyFinalizeLane: args.historyFinalizeLane,
    });

  const scheduleDeferredColorCycleSaveWithStateHandler = (
    deferredArgs: DeferredSaveWithStateArgs
  ): Promise<void> =>
    scheduleDeferredColorCycleSaveWithState(deferredArgs, {
      scheduleDeferredColorCycleSave: scheduleDeferredColorCycleSaveHandler,
      captureColorCycleBrushState,
      perfMark: args.perfMark,
      perfMeasure: args.perfMeasure,
      debugTime: args.debugTime,
      debugTimeEnd: args.debugTimeEnd,
    });

  return {
    scheduleHistoryCommit: scheduleHistoryCommitHandler,
    commitRasterOverlay: commitRasterOverlayHandler,
    scheduleDeferredColorCycleSave: scheduleDeferredColorCycleSaveHandler,
    scheduleDeferredColorCycleSaveWithState: scheduleDeferredColorCycleSaveWithStateHandler,
  };
};
