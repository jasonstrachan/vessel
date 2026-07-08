import { getAppStoreState } from '@/stores/appStoreAccess';
import type React from 'react';
import type { FinalizeQueue } from '@/lib/canvas';
import type { CanvasSnapshot } from '@/types';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import { getColorCycleSerializedStatePaintByteLength } from '@/lib/colorCycle/document';
import { commitLayerHistory } from '@/history/helpers/layerHistory';
import type { BoundingBox } from '@/hooks/canvas/handlers/shapes/ShapeFinalizeHandler';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { captureColorCycleCanvasSnapshot } from '@/utils/colorCycleCanvasSnapshot';
import { trackPendingHistoryCommit } from '@/history/pendingHistoryCommits';
import {
  strokeFinalizeProbePoint,
  strokeFinalizeProbeTime,
  strokeFinalizeProbeTimeSync,
} from '@/utils/strokeFinalizeProbe';

type CaptureRegion = { x: number; y: number; width: number; height: number };

type LayerHistoryPayload = Parameters<typeof commitLayerHistory>[0];

const waitUntilAfterStrokeFinalize = (): Promise<void> =>
  new Promise((resolve) => {
    const finish = () => {
      if (typeof window !== 'undefined') {
        const requestIdle = (window as typeof window & {
          requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
        }).requestIdleCallback;
        if (typeof requestIdle === 'function') {
          requestIdle(() => resolve(), { timeout: 120 });
          return;
        }
      }
      setTimeout(resolve, 0);
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => finish());
      return;
    }

    finish();
  });

const materializeHistoryPayload = (payload: LayerHistoryPayload): LayerHistoryPayload => {
  if (payload.skipBitmapDelta || payload.afterImage) {
    return payload;
  }
  const state = getAppStoreState();
  const layer = state.layers.find((entry) => entry.id === payload.layerId);
  if (!layer || layer.layerType === 'color-cycle' || !layer.imageData) {
    return payload;
  }
  return {
    ...payload,
    afterImage: layer.imageData,
  };
};

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
  const nextPayload = materializeHistoryPayload(payload);
  const enqueuedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const probeMeta = {
    layerId: nextPayload.layerId,
    actionType: nextPayload.actionType,
    tool: nextPayload.tool,
    skipBitmapDelta: nextPayload.skipBitmapDelta,
    hasBitmapRoi: Boolean(nextPayload.bitmapRoi),
    hasAfterImage: Boolean(nextPayload.afterImage),
    finalizeLane,
  };
  try {
    strokeFinalizeProbePoint('scheduleHistoryCommit:enqueue', probeMeta);
    const job = finalizeQueueRef.current.enqueue(
      async () => {
        await strokeFinalizeProbeTime(
          'scheduleHistoryCommit:job',
          async () => {
            await strokeFinalizeProbeTime(
              'scheduleHistoryCommit:deferAfterFinalize',
              waitUntilAfterStrokeFinalize,
              probeMeta
            );
            const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
            strokeFinalizeProbePoint('scheduleHistoryCommit:jobStart', {
              ...probeMeta,
              delayAfterEnqueueMs: Math.max(0, startedAt - enqueuedAt),
            });
            await runIdleAsync(async () => {
            await strokeFinalizeProbeTime(
              'scheduleHistoryCommit:commitLayerHistory',
              () => withTiming('cc:commit', () => commitLayerHistory(nextPayload)),
              probeMeta
            );
            });
          },
          probeMeta
        );
      },
      finalizeLane
    );

    job.catch(error => {
      logError('[history] deferred commit failed', error);
    });
    trackPendingHistoryCommit(job);

    return Promise.resolve();
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
    sanitizedRoi = strokeFinalizeProbeTimeSync(
      'scheduleDeferredColorCycleSave:roi',
      () => boundingBoxToCaptureRegion(
        {
          minX: roi.x,
          minY: roi.y,
          maxX: roi.x + roi.width,
          maxY: roi.y + roi.height,
        },
        0,
        project
      ),
      { layerId, width: roi.width, height: roi.height }
    );
    perfMark('cc:roi:end');
    perfMeasure('cc:roi', 'cc:roi:start', 'cc:roi:end');
  }

  let nextAfterColorState: ColorCycleSerializedState | null = providedAfterColorState ?? null;
  const probeMeta = {
    layerId,
    tool,
    actionType,
    skipBitmapDelta,
    shouldCaptureCanvas,
    hasRoi: Boolean(roi),
  };

  const captureStage = async (): Promise<void> => {
    await strokeFinalizeProbeTime('scheduleDeferredColorCycleSave:captureStage', () => runIdleAsync(async () => {
      if (shouldCaptureCanvas) {
        await strokeFinalizeProbeTime(
          'scheduleDeferredColorCycleSave:captureCanvasToActiveLayer',
          () => withTiming('cc:capture', () => captureCanvasToActiveLayer(canvas, sanitizedRoi)),
          probeMeta
        );
      }

      if (!nextAfterColorState) {
        perfMark('cc:state-serialize-after:start');
        debugTime('cc:state-serialize-after');
        nextAfterColorState = strokeFinalizeProbeTimeSync(
          'scheduleDeferredColorCycleSave:captureColorCycleBrushState',
          () => captureColorCycleBrushState(layerId),
          probeMeta
        );
        debugTimeEnd('cc:state-serialize-after');
        perfMark('cc:state-serialize-after:end');
        perfMeasure(
          'cc:state-serialize-after',
          'cc:state-serialize-after:start',
          'cc:state-serialize-after:end'
        );
      }

      debugVerbose('[cc-delta-capture]', {
        beforeBytes: getColorCycleSerializedStatePaintByteLength(beforeColorState),
        afterBytes: getColorCycleSerializedStatePaintByteLength(nextAfterColorState),
        beforeCtr: beforeColorState?.layers?.[0]?.strokeData?.strokeCounter ?? -1,
        afterCtr: nextAfterColorState?.layers?.[0]?.strokeData?.strokeCounter ?? -1,
      });

      const state = getAppStoreState();
      const layer = state.layers.find((entry) => entry.id === layerId);
      if (layer?.layerType === 'color-cycle' && layer.colorCycleData) {
        const { colorCycleData } = layer;
        const manager = getColorCycleBrushManager() as Partial<ReturnType<typeof getColorCycleBrushManager>>;
        const documentVersion = manager.getDocument?.(layerId)?.version ?? null;
        const nextCanvasImageData = strokeFinalizeProbeTimeSync(
          'scheduleDeferredColorCycleSave:captureCanvasSnapshot',
          () => captureColorCycleCanvasSnapshot({
            canvas,
            existingImageData: colorCycleData.canvasImageData,
            roi,
            builtFromVersion: documentVersion,
          }),
          {
            ...probeMeta,
            hasExistingImageData: Boolean(colorCycleData.canvasImageData),
            documentVersion,
          }
        );

        if (nextCanvasImageData) {
          strokeFinalizeProbeTimeSync(
            'scheduleDeferredColorCycleSave:updateCanvasSnapshotLayer',
            () => state.updateLayer(
              layerId,
              {
                colorCycleData: {
                  ...colorCycleData,
                  canvasImageData: nextCanvasImageData,
                  canvasWidth: nextCanvasImageData.width,
                  canvasHeight: nextCanvasImageData.height,
                },
              },
              { skipColorCycleSync: true }
            ),
            {
              ...probeMeta,
              width: nextCanvasImageData.width,
              height: nextCanvasImageData.height,
            }
          );
        }
      }
    }), probeMeta);
  };

  const commitStage = async (): Promise<void> => {
    await strokeFinalizeProbeTime('scheduleDeferredColorCycleSave:commitStage', () => runIdleAsync(async () => {
      await strokeFinalizeProbeTime(
        'scheduleDeferredColorCycleSave:commitLayerHistory',
        () => withTiming('cc:commit', () =>
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
        ),
        probeMeta
      );
    }), probeMeta);
  };

  const trackedPromise = new Promise<void>((resolve, reject) => {
    const scheduleError = (error: unknown) => {
      logError('Deferred color cycle save failed', error);
      if (process.env.NODE_ENV !== 'production') {
        logError('[cc:defer] finalize queue rejected', error);
      }
      reject(error);
    };

    const schedule = () => {
      try {
        strokeFinalizeProbePoint('scheduleDeferredColorCycleSave:enqueueCapture', probeMeta);
        const capturePromise = finalizeQueueRef.current.enqueue(captureStage, layerId);
        capturePromise
          .then(() => {
            strokeFinalizeProbePoint('scheduleDeferredColorCycleSave:enqueueCommit', probeMeta);
            return finalizeQueueRef.current.enqueue(commitStage, historyFinalizeLane);
          })
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
