import { useMemo, useRef } from 'react';
import { FinalizeQueue } from '@/lib/canvas';
import { useFinalizeQueueRegistration } from '@/hooks/canvas/useFinalizeQueueRegistration';
import { runIdle, runIdleAsync } from '@/hooks/canvas/utils/idle';
import { HISTORY_FINALIZE_LANE } from '@/hooks/canvas/drawingHandlersConfig';
import { trackPendingColorCycleSave } from '@/stores/pendingColorCycleSaves';
import {
  createColorCycleHistoryDispatchers,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleHistoryDispatchers';
import {
  buildColorCycleHistoryDispatcherArgs,
} from '@/hooks/canvas/handlers/colorCycle/buildColorCycleHistoryDispatcherArgs';

type HistoryDispatcherArgs = Omit<
  Parameters<typeof buildColorCycleHistoryDispatcherArgs>[0],
  'finalizeQueueRef' | 'runIdle' | 'runIdleAsync' | 'historyFinalizeLane' | 'trackPendingColorCycleSave'
>;

type UseColorCycleHistoryRuntimeArgs = HistoryDispatcherArgs;

export const useColorCycleHistoryRuntime = ({
  withTiming,
  logError,
  captureCanvasToActiveLayer,
  project,
  boundingBoxToCaptureRegion,
  perfMark,
  perfMeasure,
  debugTime,
  debugTimeEnd,
  debugVerbose,
}: UseColorCycleHistoryRuntimeArgs) => {
  const finalizeQueueRef = useRef(new FinalizeQueue());
  useFinalizeQueueRegistration({ finalizeQueueRef });

  const {
    scheduleHistoryCommit,
    commitRasterOverlay,
    scheduleDeferredColorCycleSave,
    scheduleDeferredColorCycleSaveWithState,
  } = useMemo(
    () =>
      createColorCycleHistoryDispatchers(
        buildColorCycleHistoryDispatcherArgs({
          finalizeQueueRef,
          runIdle,
          runIdleAsync,
          withTiming,
          logError,
          captureCanvasToActiveLayer,
          project,
          trackPendingColorCycleSave,
          boundingBoxToCaptureRegion,
          perfMark,
          perfMeasure,
          debugTime,
          debugTimeEnd,
          debugVerbose,
          historyFinalizeLane: HISTORY_FINALIZE_LANE,
        })
      ),
    [
      boundingBoxToCaptureRegion,
      captureCanvasToActiveLayer,
      debugTime,
      debugTimeEnd,
      debugVerbose,
      finalizeQueueRef,
      logError,
      perfMark,
      perfMeasure,
      project,
      withTiming,
    ]
  );

  return {
    finalizeQueueRef,
    scheduleHistoryCommit,
    commitRasterOverlay,
    scheduleDeferredColorCycleSave,
    scheduleDeferredColorCycleSaveWithState,
  };
};
