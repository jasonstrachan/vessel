export type SequentialPatchOutcomeReason =
  | 'applied_run_patch'
  | 'collapsed_to_band_patch'
  | 'collapsed_to_full_patch'
  | 'fallback_exception';

export const recordSequentialFlushPerf = (args: {
  events: number;
  durationMs: number;
}): void => {
  void args;
};

export const recordSequentialAppendPerf = (args: {
  events: number;
  durationMs: number;
}): void => {
  void args;
};

export const recordSequentialMaterializePerf = (args: {
  events: number;
  durationMs: number;
}): void => {
  void args;
};

export const setSequentialFrameCacheSnapshot = (args: {
  hits: number;
  misses: number;
  entries: number;
}): void => {
  void args;
};

export const recordSequentialPatchOutcome = (args: {
  attempts: number;
  applied: number;
  fallbacks: number;
}): void => {
  void args;
};

export const recordSequentialPatchReason = (reason: SequentialPatchOutcomeReason): void => {
  void reason;
};

export const recordSequentialTemporalDistributionPerf = (args: {
  events: number;
  buckets: number;
  splitCapture: boolean;
  reason: string;
  smear: number;
  inputStamps: number;
}): void => {
  void args;
};
