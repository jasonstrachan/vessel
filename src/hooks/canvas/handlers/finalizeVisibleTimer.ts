export type CreateFinalizeVisibleTimerArgs = {
  debugEnabled: () => boolean;
  debugTime: (label: string) => void;
  debugTimeEnd: (label: string) => void;
  perfMark: (name: string) => void;
  perfMeasure: (name: string, startMark: string, endMark: string) => void;
};

export const createFinalizeVisibleTimer = ({
  debugEnabled,
  debugTime,
  debugTimeEnd,
  perfMark,
  perfMeasure,
}: CreateFinalizeVisibleTimerArgs): {
  startFinalizeVisibleTimer: () => void;
  endFinalizeVisibleTimer: () => void;
} => {
  let finalizeVisibleTimerStarted = false;

  return {
    startFinalizeVisibleTimer: () => {
      if (finalizeVisibleTimerStarted) {
        return;
      }
      if (debugEnabled()) {
        debugTime('cc:visible-finalize');
      }
      perfMark('cc:visible-finalize:start');
      finalizeVisibleTimerStarted = true;
    },
    endFinalizeVisibleTimer: () => {
      if (!finalizeVisibleTimerStarted) {
        return;
      }
      if (debugEnabled()) {
        debugTimeEnd('cc:visible-finalize');
      }
      finalizeVisibleTimerStarted = false;
      perfMark('cc:visible-finalize:end');
      perfMeasure('cc:visible-finalize', 'cc:visible-finalize:start', 'cc:visible-finalize:end');
    },
  };
};
