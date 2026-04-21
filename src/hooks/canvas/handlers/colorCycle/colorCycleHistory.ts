import type React from 'react';
import type { FinalizeQueue } from '@/lib/canvas';
import type { CanvasSnapshot } from '@/types';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import { commitLayerHistory } from '@/history/helpers/layerHistory';
import type { BoundingBox } from '@/hooks/canvas/handlers/shapes/ShapeFinalizeHandler';
import { useAppStore } from '@/stores/useAppStore';
import { captureColorCycleCanvasSnapshot } from '@/utils/colorCycleCanvasSnapshot';

type CaptureRegion = { x: number; y: number; width: number; height: number };

type LayerHistoryPayload = Parameters<typeof commitLayerHistory>[0];

export type DeferredColorCycleSaveOptions = {
  layerId: string;
  canvas: HTMLCanvasElement;
  beforeColorState: ColorCycleSerializedState;
  afterColorState?: ColorCycleSerializedState;
  actionType: CanvasSnapshot['actionType'];
  description: string;
  tool: string;
  coalesce?: LayerHistoryPayload['coalesce'];
  beforeImage?: LayerHistoryPayload['beforeImage'];
  skipBitmapDelta?: boolean;
  roi?: { x: number; y: number; width: number; height: number };
};

type ScheduleHistoryCommitOptions = {
  payload: LayerHistoryPayload;
  finalizeQueueRef: React.MutableRefObject<FinalizeQueue>;
  runIdleAsync: <T>(task: () => Promise<T> | T) => Promise<T>;
  withTiming: <T>(label: string, task: () => Promise<T> | T) => Promise<T>;
  logError: (message: string, error?: unknown) => void;
  finalizeLane: string;
};

type ScheduleDeferredSaveDeps = {
  captureCanvasToActiveLayer: (canvas: HTMLCanvasElement, roi?: CaptureRegion) => Promise<void>;
  project: { width: number; height: number } | null;
  runIdle: (cb: () => void) => void;
  runIdleAsync: <T>(task: () => Promise<T> | T) => Promise<T>;
  finalizeQueueRef: React.MutableRefObject<FinalizeQueue>;
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
  logError: (message: string, error?: unknown) => void;
  withTiming: <T>(label: string, task: () => Promise<T> | T) => Promise<T>;
  historyFinalizeLane: string;
};

export const scheduleHistoryCommit = ({
  payload,
  finalizeQueueRef,
  runIdleAsync,
  withTiming,
  logError,
  finalizeLane,
}: ScheduleHistoryCommitOptions): Promise<void> => {
  try {
    const job = finalizeQueueRef.current.enqueue(
      async () => {
        await runIdleAsync(async () => {
          await withTiming('cc:commit', () => commitLayerHistory(payload));
        });
      },
      finalizeLane
    );

    job.catch(error => {
      logError('[history] deferred commit failed', error);
    });

    return job;
  } catch (error) {
    logError('[history] failed to enqueue commit', error);
    return Promise.reject(error);
  }
};

export const scheduleDeferredColorCycleSave = (
  options: DeferredColorCycleSaveOptions,
  deps: ScheduleDeferredSaveDeps
): Promise<void> => {
  const {
    layerId,
    canvas,
    beforeColorState,
    afterColorState: providedAfterColorState,
    actionType,
    description,
    tool,
    coalesce,
    beforeImage = null,
    skipBitmapDelta = true,
    roi,
  } = options;
  const {
    captureCanvasToActiveLayer,
    project,
    runIdle,
    runIdleAsync,
    finalizeQueueRef,
    trackPendingColorCycleSave,
    boundingBoxToCaptureRegion,
    perfMark,
    perfMeasure,
    debugTime,
    debugTimeEnd,
    debugVerbose,
    logError,
    withTiming,
    historyFinalizeLane,
  } = deps;

  const shouldCaptureCanvas = !skipBitmapDelta;
  let sanitizedRoi: CaptureRegion | undefined;

  if (shouldCaptureCanvas && roi && project) {
    perfMark('cc:roi:start');
    sanitizedRoi = boundingBoxToCaptureRegion(
      {
        minX: roi.x,
        minY: roi.y,
        maxX: roi.x + roi.width,
        maxY: roi.y + roi.height,
      },
      0,
      project
    );
    perfMark('cc:roi:end');
    perfMeasure('cc:roi', 'cc:roi:start', 'cc:roi:end');
  }

  let nextAfterColorState: ColorCycleSerializedState | null = providedAfterColorState ?? null;

  const captureStage = async (): Promise<void> => {
    await runIdleAsync(async () => {
      if (shouldCaptureCanvas) {
        await withTiming('cc:capture', () => captureCanvasToActiveLayer(canvas, sanitizedRoi));
      }

      if (!nextAfterColorState) {
        perfMark('cc:state-serialize-after:start');
        debugTime('cc:state-serialize-after');
        nextAfterColorState = captureColorCycleBrushState(layerId);
        debugTimeEnd('cc:state-serialize-after');
        perfMark('cc:state-serialize-after:end');
        perfMeasure(
          'cc:state-serialize-after',
          'cc:state-serialize-after:start',
          'cc:state-serialize-after:end'
        );
      }

      debugVerbose('[cc-delta-capture]', {
        beforeBytes: beforeColorState?.layers?.[0]?.strokeData?.paintBuffer?.byteLength ?? -1,
        afterBytes: nextAfterColorState?.layers?.[0]?.strokeData?.paintBuffer?.byteLength ?? -1,
        beforeCtr: beforeColorState?.layers?.[0]?.strokeData?.strokeCounter ?? -1,
        afterCtr: nextAfterColorState?.layers?.[0]?.strokeData?.strokeCounter ?? -1,
      });

      const state = useAppStore.getState();
      const layer = state.layers.find((entry) => entry.id === layerId);
      if (layer?.layerType === 'color-cycle' && layer.colorCycleData) {
        const nextCanvasImageData = captureColorCycleCanvasSnapshot({
          canvas,
          existingImageData: layer.colorCycleData.canvasImageData,
          roi,
        });

        if (nextCanvasImageData) {
          state.updateLayer(
            layerId,
            {
              colorCycleData: {
                ...layer.colorCycleData,
                canvasImageData: nextCanvasImageData,
                canvasWidth: nextCanvasImageData.width,
                canvasHeight: nextCanvasImageData.height,
              },
            },
            { skipColorCycleSync: true }
          );
        }
      }
    });
  };

  const commitStage = async (): Promise<void> => {
    await runIdleAsync(async () => {
      await withTiming('cc:commit', () =>
        commitLayerHistory({
          layerId,
          beforeImage,
          beforeColorState,
          afterColorState: nextAfterColorState,
          actionType,
          description,
          tool,
          coalesce,
          skipBitmapDelta,
          bitmapRoi: sanitizedRoi ?? undefined,
        })
      );
    });
  };

  const trackedPromise = new Promise<void>((resolve, reject) => {
    const scheduleError = (error: unknown) => {
      logError('Deferred color cycle save failed', error);
      if (process.env.NODE_ENV !== 'production') {
        console.error('[cc:defer] finalize queue rejected', error);
      }
      reject(error);
    };

    const schedule = () => {
      try {
        const capturePromise = finalizeQueueRef.current.enqueue(captureStage, layerId);
        capturePromise
          .then(() => finalizeQueueRef.current.enqueue(commitStage, historyFinalizeLane))
          .then(resolve)
          .catch(scheduleError);
      } catch (error) {
        scheduleError(error);
      }
    };

    try {
      runIdle(schedule);
    } catch (error) {
      scheduleError(error);
    }
  });

  trackPendingColorCycleSave(layerId, trackedPromise);

  return trackedPromise;
};
