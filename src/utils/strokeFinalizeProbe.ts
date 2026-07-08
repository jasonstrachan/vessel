type ProbeMeta = Record<string, unknown>;

export const isStrokeFinalizeProbeEnabled = (): boolean => false;

export const getStrokeFinalizeProbeSession = (): string => '';

export const strokeFinalizeProbeMark = (
  label: string,
  edge: 'start' | 'end',
  meta?: ProbeMeta,
): void => {
  void label;
  void edge;
  void meta;
};

export const strokeFinalizeProbePoint = (label: string, meta?: ProbeMeta): void => {
  void label;
  void meta;
};

export const strokeFinalizeProbeTime = async <T>(
  label: string,
  task: () => Promise<T> | T,
  meta?: ProbeMeta,
): Promise<T> => {
  void label;
  void meta;
  return task();
};

export const strokeFinalizeProbeTimeSync = <T>(
  label: string,
  task: () => T,
  meta?: ProbeMeta,
): T => {
  void label;
  void meta;
  return task();
};
