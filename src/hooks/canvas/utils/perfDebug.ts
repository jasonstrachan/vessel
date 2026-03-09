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
    void label;
  };

  const debugTimeEnd = (label: string) => {
    void label;
  };

  const debugVerbose = (...args: Parameters<typeof console.debug>) => {
    void args;
  };

  const withTiming = async <T>(label: string, task: () => Promise<T> | T): Promise<T> => {
    void label;
    void deps;
    return await task();
  };

  return {
    debugTime,
    debugTimeEnd,
    debugVerbose,
    withTiming,
  };
};
