export type PerfDebugDeps = {
  perfMark: (label: string) => void;
  perfMeasure: (label: string, startLabel: string, endLabel: string) => void;
  timeAsync: <T>(label: string, task: () => Promise<T>) => Promise<T>;
  debugEnabled: () => boolean;
  debugTimingEnabled: () => boolean;
  debugVerboseEnabled: () => boolean;
};

export const createPerfDebug = (deps: PerfDebugDeps) => {
  const debugTime = (label: string) => {
    if (deps.debugEnabled() && deps.debugTimingEnabled()) {
      console.time(label);
    }
  };

  const debugTimeEnd = (label: string) => {
    if (deps.debugEnabled() && deps.debugTimingEnabled()) {
      console.timeEnd(label);
    }
  };

  const debugVerbose = (...args: Parameters<typeof console.debug>) => {
    if (deps.debugEnabled() && deps.debugVerboseEnabled()) {
      console.debug(...args);
    }
  };

  const withTiming = async <T>(label: string, task: () => Promise<T> | T): Promise<T> => {
    debugTime(label);
    const startMark = `${label}:start`;
    const endMark = `${label}:end`;
    deps.perfMark(startMark);
    try {
      return await deps.timeAsync(label, async () => task());
    } finally {
      deps.perfMark(endMark);
      deps.perfMeasure(label, startMark, endMark);
      debugTimeEnd(label);
    }
  };

  return {
    debugTime,
    debugTimeEnd,
    debugVerbose,
    withTiming,
  };
};
